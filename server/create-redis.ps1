param(
    [ValidateSet("Create", "Delete", "ApplyParameterGroup")]
    [string]$Action = "Create"
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

. (Join-Path $PSScriptRoot 'aws-common.ps1')
Import-DotEnvFile -Path (Join-Path $PSScriptRoot '.env')

# ===== Configurações =====
$CACHE_CLUSTER_ID        = "safeid-redis"
$CACHE_NODE_TYPE         = "cache.t3.micro"
$CACHE_ENGINE            = "redis"
$CACHE_ENGINE_VERSION    = Get-EnvOrDefault -Name 'REDIS_ENGINE_VERSION' -Default '7.1'
$CACHE_PORT              = 6379
$CACHE_SUBNET_GROUP_NAME = "safeid-redis-subnet-group"
$CACHE_SUBNET_GROUP_DESC = "Subnet group for SafeID Redis"
$CACHE_SECURITY_GROUP_ID = Get-RequiredEnv -Name 'REDIS_SECURITY_GROUP_ID'
$SUBNET_IDS              = Get-RequiredEnvList -Name 'REDIS_SUBNET_IDS'

# O BullMQ exige maxmemory-policy=noeviction. Com o padrão (volatile-lru), sob pressão
# de memória o Redis pode apagar locks de jobs e travar ou duplicar execuções.
$CACHE_PARAMETER_GROUP   = "safeid-redis-queues"

function Test-RedisSubnetGroupExists {
    try {
        $null = aws elasticache describe-cache-subnet-groups `
            --cache-subnet-group-name $CACHE_SUBNET_GROUP_NAME `
            --query "CacheSubnetGroups[0].CacheSubnetGroupName" `
            --output text 2>$null
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        return $false
    }
}

function Test-RedisClusterExists {
    try {
        $null = aws elasticache describe-cache-clusters `
            --cache-cluster-id $CACHE_CLUSTER_ID `
            --show-cache-node-info `
            --query "CacheClusters[0].CacheClusterId" `
            --output text 2>$null
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        return $false
    }
}

# 7.x -> redis7; 6.x -> redis6.x; 5.0.6 -> redis5.0
function Get-ParameterGroupFamily {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EngineVersion
    )

    $parts = $EngineVersion.Split('.')
    $major = [int]$parts[0]

    if ($major -ge 7) {
        return "redis$major"
    }
    if ($major -eq 6) {
        return "redis6.x"
    }
    return "redis$major.$($parts[1])"
}

function Get-ClusterEngineVersion {
    $version = aws elasticache describe-cache-clusters `
        --cache-cluster-id $CACHE_CLUSTER_ID `
        --query "CacheClusters[0].EngineVersion" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($version)) {
        throw "Falha ao obter a versão do Redis '$CACHE_CLUSTER_ID'."
    }

    return $version.Trim()
}

function Ensure-ParameterGroup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Family
    )

    $existingFamily = aws elasticache describe-cache-parameter-groups `
        --cache-parameter-group-name $CACHE_PARAMETER_GROUP `
        --query "CacheParameterGroups[0].CacheParameterGroupFamily" `
        --output text 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Criando parameter group '$CACHE_PARAMETER_GROUP' ($Family)..."
        aws elasticache create-cache-parameter-group `
            --cache-parameter-group-name $CACHE_PARAMETER_GROUP `
            --cache-parameter-group-family $Family `
            --description "SafeID BullMQ (noeviction)" > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o parameter group '$CACHE_PARAMETER_GROUP'."
        }
    }
    elseif ($existingFamily.Trim() -ne $Family) {
        throw "O parameter group '$CACHE_PARAMETER_GROUP' é da família $($existingFamily.Trim()), mas o Redis precisa de $Family."
    }
    else {
        Write-Host "Parameter group '$CACHE_PARAMETER_GROUP' já existe."
    }

    # Idempotente: reaplica o valor mesmo se o grupo já existir
    aws elasticache modify-cache-parameter-group `
        --cache-parameter-group-name $CACHE_PARAMETER_GROUP `
        --parameter-name-values "ParameterName=maxmemory-policy,ParameterValue=noeviction" > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao definir maxmemory-policy=noeviction no parameter group."
    }
}

function Ensure-SubnetGroup {
    if (-not (Test-RedisSubnetGroupExists)) {
        Write-Host "Redis Subnet Group não encontrado. Criando..."
        aws elasticache create-cache-subnet-group `
            --cache-subnet-group-name $CACHE_SUBNET_GROUP_NAME `
            --cache-subnet-group-description $CACHE_SUBNET_GROUP_DESC `
            --subnet-ids $SUBNET_IDS 2>$null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o Redis Subnet Group."
        }
    }
    else {
        Write-Host "Redis Subnet Group já existe."
    }
}

function Create-Redis {
    if (Test-RedisClusterExists) {
        Write-Host "O cluster Redis '$CACHE_CLUSTER_ID' já existe. Abortando criação."
        return
    }

    Ensure-SubnetGroup
    Ensure-ParameterGroup -Family (Get-ParameterGroupFamily -EngineVersion $CACHE_ENGINE_VERSION)

    Write-Host "Criando Redis..."
    aws elasticache create-cache-cluster `
        --cache-cluster-id $CACHE_CLUSTER_ID `
        --cache-node-type $CACHE_NODE_TYPE `
        --engine $CACHE_ENGINE `
        --engine-version $CACHE_ENGINE_VERSION `
        --cache-parameter-group-name $CACHE_PARAMETER_GROUP `
        --num-cache-nodes 1 `
        --cache-subnet-group-name $CACHE_SUBNET_GROUP_NAME `
        --security-group-ids $CACHE_SECURITY_GROUP_ID `
        --port $CACHE_PORT 2>$null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar o Redis."
    }

    Write-Host "Aguardando o Redis ficar disponível..."
    aws elasticache wait cache-cluster-available `
        --cache-cluster-id $CACHE_CLUSTER_ID 2>$null

    if ($LASTEXITCODE -ne 0) {
        throw "O Redis não ficou disponível no tempo esperado."
    }

    $endpoint = aws elasticache describe-cache-clusters `
        --cache-cluster-id $CACHE_CLUSTER_ID `
        --show-cache-node-info `
        --query "CacheClusters[0].CacheNodes[0].Endpoint.Address" `
        --output text 2>$null

    Write-Host "Redis pronto!"
    Write-Host "Endpoint: $endpoint"
    Write-Host "Porta: 6379"
}

function Delete-Redis {
    if (Test-RedisClusterExists) {
        Write-Host "Removendo cluster Redis..."
        aws elasticache delete-cache-cluster `
            --cache-cluster-id $CACHE_CLUSTER_ID 2>$null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao solicitar remoção do cluster Redis."
        }

        Write-Host "Aguardando remoção do cluster..."
        aws elasticache wait cache-cluster-deleted `
            --cache-cluster-id $CACHE_CLUSTER_ID 2>$null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao aguardar a remoção do cluster Redis."
        }
    }
    else {
        Write-Host "O cluster Redis '$CACHE_CLUSTER_ID' não existe. Pulando remoção."
    }

    if (Test-RedisSubnetGroupExists) {
        Write-Host "Removendo Redis Subnet Group..."
        aws elasticache delete-cache-subnet-group `
            --cache-subnet-group-name $CACHE_SUBNET_GROUP_NAME 2>$null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao remover o Redis Subnet Group."
        }
    }
    else {
        Write-Host "Redis Subnet Group não existe. Nada a remover."
    }

    Write-Host "Redis removido completamente."
}

# Aplica o parameter group ao cluster que já existe (sem reinício: maxmemory-policy é dinâmico)
function Apply-ParameterGroup {
    if (-not (Test-RedisClusterExists)) {
        throw "O cluster Redis '$CACHE_CLUSTER_ID' não existe."
    }

    $engineVersion = Get-ClusterEngineVersion
    Ensure-ParameterGroup -Family (Get-ParameterGroupFamily -EngineVersion $engineVersion)

    Write-Host "Aplicando '$CACHE_PARAMETER_GROUP' ao cluster '$CACHE_CLUSTER_ID' (Redis $engineVersion)..."
    aws elasticache modify-cache-cluster `
        --cache-cluster-id $CACHE_CLUSTER_ID `
        --cache-parameter-group-name $CACHE_PARAMETER_GROUP `
        --apply-immediately > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao aplicar o parameter group ao cluster."
    }

    Write-Host "Aguardando o cluster ficar disponível..."
    aws elasticache wait cache-cluster-available `
        --cache-cluster-id $CACHE_CLUSTER_ID

    $status = aws elasticache describe-cache-clusters `
        --cache-cluster-id $CACHE_CLUSTER_ID `
        --query "CacheClusters[0].CacheParameterGroup.[CacheParameterGroupName,ParameterApplyStatus]" `
        --output text

    Write-Host "Parameter group: $status (esperado: $CACHE_PARAMETER_GROUP in-sync)"
}

switch ($Action) {
    "Create" { Create-Redis }
    "Delete" { Delete-Redis }
    "ApplyParameterGroup" { Apply-ParameterGroup }
}