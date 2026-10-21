# Funções compartilhadas pelos scripts AWS do SafeID (server/ e client/).
#
# Uso, no começo de cada script:
#   . (Join-Path $PSScriptRoot 'aws-common.ps1')
#   $aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot
#
# Os scripts são versionados: IDs de VPC/subnet/security group, senhas e e-mails vêm do
# arquivo de ambiente de produção (server/.env.production e client/.env.production, fora do
# git), nunca de valores fixos no código. O .env de desenvolvimento não é lido pelos scripts.

$ErrorActionPreference = 'Stop'
# Sem pager: no Windows o AWS CLI abriria o "more" e o script ficaria parado esperando tecla
$env:AWS_PAGER = ''

$DefaultEnvFile = '.env.production'

function Import-DotEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content -Path $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()

        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) {
            return
        }

        $equalsIndex = $line.IndexOf('=')
        if ($equalsIndex -lt 1) {
            return
        }

        $name = $line.Substring(0, $equalsIndex).Trim()
        $value = $line.Substring($equalsIndex + 1).Trim()

        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if (-not [string]::IsNullOrWhiteSpace($name)) {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

function Assert-CommandExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName,

        [string]$Hint = ''
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Comando '$CommandName' não encontrado. $Hint".Trim()
    }
}

# Roda um executável sem deixar o stderr virar exceção. No Windows PowerShell 5.1, com
# ErrorActionPreference=Stop, qualquer linha no stderr de um comando redirecionado
# interrompe o script, inclusive em consultas que podem falhar de propósito ("existe?").
# Devolve a saída padrão; o código de saída fica em $LASTEXITCODE.
function Invoke-Quiet {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $FilePath @Arguments 2>$null
    }
    finally {
        $ErrorActionPreference = $previous
    }

    return $output
}

function Invoke-AwsQuiet {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    return Invoke-Quiet -FilePath 'aws' -Arguments $Arguments
}

function Get-AwsAccountId {
    $accountId = Invoke-AwsQuiet -Arguments @('sts', 'get-caller-identity', '--query', 'Account', '--output', 'text')
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accountId)) {
        throw "Sem credenciais AWS válidas. Faça login (aws configure ou aws sso login) e rode de novo."
    }

    return $accountId.Trim()
}

# Carrega o arquivo de ambiente, fixa a região de todas as chamadas do AWS CLI e confere o login.
# Devolve @{ Region; AccountId; EnvFile }.
function Initialize-AwsScript {
    param(
        [string]$EnvFile = $DefaultEnvFile,

        [Parameter(Mandatory = $true)]
        [string]$BaseDir
    )

    if ([string]::IsNullOrWhiteSpace($EnvFile)) {
        $EnvFile = $DefaultEnvFile
    }

    $envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $BaseDir $EnvFile }
    if (-not (Test-Path $envPath)) {
        $example = Join-Path $BaseDir '.env.production.example'
        throw "Arquivo de ambiente não encontrado: $envPath. Copie $example para $envPath e preencha os valores de produção."
    }

    Import-DotEnvFile -Path $envPath
    # Os scripts chamados em sequência pelo deploy.ps1 rodam no mesmo processo e enxergam o mesmo arquivo
    $env:SAFEID_ENV_FILE = (Resolve-Path $envPath).Path

    Assert-CommandExists -CommandName 'aws' -Hint 'Instale o AWS CLI v2: https://aws.amazon.com/cli/'

    $region = $env:AWS_REGION
    if ([string]::IsNullOrWhiteSpace($region)) {
        $region = Invoke-AwsQuiet -Arguments @('configure', 'get', 'region')
    }
    if ([string]::IsNullOrWhiteSpace($region)) {
        $region = 'us-east-1'
    }
    $region = "$region".Trim()

    # Toda chamada do CLI usa a mesma região, inclusive as que não passam --region
    $env:AWS_REGION = $region
    $env:AWS_DEFAULT_REGION = $region

    $accountId = Get-AwsAccountId

    # Trava contra publicar na conta errada (ex.: perfil padrão do CLI logado em outra conta)
    $expectedAccount = $env:AWS_ACCOUNT_ID
    if (-not [string]::IsNullOrWhiteSpace($expectedAccount) -and $expectedAccount.Trim() -ne $accountId) {
        $profileLabel = if ($env:AWS_PROFILE) { "perfil '$($env:AWS_PROFILE)'" } else { 'perfil padrão' }
        throw "O AWS CLI ($profileLabel) está logado na conta final $($accountId.Substring($accountId.Length - 4)), mas AWS_ACCOUNT_ID pede a final $($expectedAccount.Trim().Substring($expectedAccount.Trim().Length - 4)). Rode: aws login --profile $($env:AWS_PROFILE)"
    }

    return @{
        Region    = $region
        AccountId = $accountId
        EnvFile   = $env:SAFEID_ENV_FILE
    }
}

# Grava (ou atualiza) NOME=valor no arquivo de ambiente, preservando as outras linhas.
# Usado pelo provisionamento para guardar IDs criados (ex.: distribuição do CloudFront).
function Set-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $lines = if (Test-Path $Path) { @(Get-Content -Path $Path -Encoding UTF8) } else { @() }
    $updated = $false
    $result = foreach ($line in $lines) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=") {
            $updated = $true
            "$Name=$Value"
        }
        else {
            $line
        }
    }

    if (-not $updated) {
        $result = @($result) + "$Name=$Value"
    }

    [System.IO.File]::WriteAllLines($Path, [string[]]$result, [System.Text.UTF8Encoding]::new($false))
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Get-EnvFileLabel {
    if ($env:SAFEID_ENV_FILE) { return $env:SAFEID_ENV_FILE }
    return $DefaultEnvFile
}

function Get-RequiredEnv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Defina $Name em $(Get-EnvFileLabel) (veja o .env.production.example)."
    }

    return $value.Trim()
}

function Get-EnvOrDefault {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Default
    )

    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Default
    }

    return $value.Trim()
}

# Lista separada por vírgula (ex.: "subnet-a,subnet-b")
function Get-RequiredEnvList {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $items = @((Get-RequiredEnv -Name $Name) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($items.Count -eq 0) {
        throw "Defina ao menos um valor em $Name em $(Get-EnvFileLabel)."
    }

    return $items
}

function Test-LocalOnlyValue {
    param(
        [AllowEmptyString()]
        [string]$Value
    )

    return ($Value -match '(?i)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)')
}

# Valores de exemplo do .env.example / .env.production.example
function Test-PlaceholderValue {
    param(
        [AllowEmptyString()]
        [string]$Value
    )

    return ($Value -match '(?i)(your[_-]|replace_with|change_?me|xxxxxxxx|^test-key$)')
}

# URL pública de produção: obrigatória, sem localhost e sem valor de exemplo
function Get-PublicUrlEnv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $value = (Get-RequiredEnv -Name $Name).TrimEnd('/')
    if ((Test-LocalOnlyValue -Value $value) -or (Test-PlaceholderValue -Value $value)) {
        throw "$Name precisa ser a URL pública de produção (está '$value')."
    }
    if ($value -notmatch '^https?://') {
        throw "$Name precisa começar com https:// (está '$value')."
    }

    return $value
}

# Arquivo temporário com JSON (UTF-8 sem BOM) no formato file:// que o AWS CLI aceita.
# No PowerShell 5.1, aspas dentro de argumentos de executáveis se perdem; por arquivo, não.
function Write-TempJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        $InputObject,

        [int]$Depth = 20
    )

    $path = Join-Path ([System.IO.Path]::GetTempPath()) $Name
    $json = if ($InputObject -is [string]) { $InputObject } else { $InputObject | ConvertTo-Json -Depth $Depth -Compress }
    [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))

    return "file://" + ($path -replace '\\', '/')
}

# Ações destrutivas (Delete) pedem para digitar o nome do recurso, a menos que venha -Force
function Confirm-Destructive {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Resource,

        [Parameter(Mandatory = $true)]
        [string]$Description,

        [switch]$Force
    )

    if ($Force) {
        return
    }

    Write-Host ""
    Write-Host "ATENÇÃO: $Description" -ForegroundColor Yellow
    $answer = Read-Host "Digite '$Resource' para confirmar"
    if ($answer -ne $Resource) {
        throw "Cancelado: a confirmação não confere."
    }
}

# ===== Identificadores dos recursos (com padrão; ajuste no arquivo de ambiente se precisar) =====
function Get-DbInstanceIdentifier { return (Get-EnvOrDefault -Name 'DB_INSTANCE_IDENTIFIER' -Default 'safeid-pg') }
function Get-RedisClusterId { return (Get-EnvOrDefault -Name 'REDIS_CLUSTER_ID' -Default 'safeid-redis') }
function Get-EcrRepositoryName { return (Get-EnvOrDefault -Name 'ECR_REPOSITORY' -Default 'safeid-backend') }

function Get-EcrRepositoryUri {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Aws
    )

    return "$($Aws.AccountId).dkr.ecr.$($Aws.Region).amazonaws.com/$(Get-EcrRepositoryName)"
}

# Tag da imagem: o commit atual (rastreável e imutável). Com alterações não commitadas,
# ganha o sufixo -dirty-<data> para nunca reaproveitar a tag de um commit limpo.
function Get-DeployImageTag {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoDir
    )

    $fallback = "manual-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        return $fallback
    }

    $sha = Invoke-Quiet -FilePath 'git' -Arguments @('-C', $RepoDir, 'rev-parse', '--short=12', 'HEAD')
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sha)) {
        return $fallback
    }

    $dirty = Invoke-Quiet -FilePath 'git' -Arguments @('-C', $RepoDir, 'status', '--porcelain', '--untracked-files=no')
    if (-not [string]::IsNullOrWhiteSpace(($dirty -join ''))) {
        return "$($sha.Trim())-dirty-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    }

    return $sha.Trim()
}

# ===== Endpoints: do arquivo de ambiente ou descobertos na AWS =====
function Get-RdsEndpoint {
    $configured = Get-EnvOrDefault -Name 'RDS_ENDPOINT' -Default ''
    if (-not [string]::IsNullOrWhiteSpace($configured) -and -not (Test-PlaceholderValue -Value $configured)) {
        return $configured
    }

    $identifier = Get-DbInstanceIdentifier
    $endpoint = Invoke-AwsQuiet -Arguments @(
        'rds', 'describe-db-instances',
        '--db-instance-identifier', $identifier,
        '--query', 'DBInstances[0].Endpoint.Address',
        '--output', 'text'
    )

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($endpoint) -or $endpoint -eq 'None') {
        throw "Não achei o RDS '$identifier'. Rode server/create-database.ps1 ou defina RDS_ENDPOINT em $(Get-EnvFileLabel)."
    }

    return $endpoint.Trim()
}

function Get-RedisEndpoint {
    $configured = Get-EnvOrDefault -Name 'REDIS_HOST' -Default ''
    if (-not [string]::IsNullOrWhiteSpace($configured) -and -not (Test-PlaceholderValue -Value $configured)) {
        # O .env de desenvolvimento aponta para o Redis local; isso nunca pode ir para produção
        if (Test-LocalOnlyValue -Value $configured) {
            throw "REDIS_HOST aponta para um endereço local ($configured). Deixe vazio para usar o ElastiCache ou informe o endpoint dele."
        }
        return $configured
    }

    $clusterId = Get-RedisClusterId
    $endpoint = Invoke-AwsQuiet -Arguments @(
        'elasticache', 'describe-cache-clusters',
        '--cache-cluster-id', $clusterId,
        '--show-cache-node-info',
        '--query', 'CacheClusters[0].CacheNodes[0].Endpoint.Address',
        '--output', 'text'
    )

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($endpoint) -or $endpoint -eq 'None') {
        throw "Não achei o ElastiCache '$clusterId'. Rode server/create-redis.ps1 ou defina REDIS_HOST em $(Get-EnvFileLabel)."
    }

    return $endpoint.Trim()
}

# Parâmetros de pool do Prisma em produção (I.6): 10 conexões por task,
# 20 em deploy com 2 tasks, bem abaixo do max_connections do db.t3.micro
$PrismaPoolParams = @{
    connection_limit = "10"
    pool_timeout     = "20"
}

function Add-PrismaPoolParams {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DatabaseUrl
    )

    $url = $DatabaseUrl
    foreach ($name in $PrismaPoolParams.Keys) {
        if ($url -notmatch "[?&]$name=") {
            $separator = if ($url.Contains('?')) { '&' } else { '?' }
            $url = "$url$separator$name=$($PrismaPoolParams[$name])"
        }
    }

    return $url
}

# DATABASE_URL de produção: montada a partir do RDS, nunca a DATABASE_URL do .env,
# que aponta para o banco local de desenvolvimento
function Get-ProductionDatabaseUrl {
    $rdsEndpoint = Get-RdsEndpoint
    $dbUser = Get-EnvOrDefault -Name 'DB_USER' -Default 'safeid_user'
    $dbPassword = Get-RequiredEnv -Name 'DB_PASSWORD'
    $dbName = Get-EnvOrDefault -Name 'DB_NAME' -Default 'safeid_db'

    $encodedUser = [System.Uri]::EscapeDataString($dbUser)
    $encodedPassword = [System.Uri]::EscapeDataString($dbPassword)

    # ${...}: sem as chaves o PowerShell leria "$dbName?schema" como uma variável só (? vale em nome de variável)
    return Add-PrismaPoolParams -DatabaseUrl "postgresql://${encodedUser}:${encodedPassword}@${rdsEndpoint}:5432/${dbName}?schema=public"
}

# ===== Segredos no SSM Parameter Store (I.4) =====
# SecureString em /safeid/prod/<NOME>. O ECS injeta cada um como variável de ambiente.
function Get-SsmPrefix {
    return (Get-EnvOrDefault -Name 'SSM_PREFIX' -Default '/safeid/prod').TrimEnd('/')
}

# Sem estes a aplicação não sobe (ou sobe insegura) em produção
$SsmRequiredSecrets = @(
    'DATABASE_URL',
    'JWT_SECRET',
    'REFRESH_TOKEN_SECRET',
    'SESSION_SECRET',
    'HIBP_API_KEY',
    # Assina o link de descadastro dos alertas de vazamento
    'MONITORING_UNSUBSCRIBE_SECRET',
    # Sem ela os dados de vazamento são gravados sem criptografia no banco
    'ENCRYPTION_KEY'
)

# Enviados só quando existem no arquivo de ambiente
$SsmOptionalSecrets = @(
    'AI_API_KEY',
    'GOOGLE_CLIENT_SECRET',
    # Protege GET /api/health/jobs
    'ADMIN_TOKEN',
    # HMAC do e-mail no histórico e no cache. Depois de definido, não troque: os hashes antigos deixam de bater
    'EMAIL_HASH_SECRET'
)

# Tamanho mínimo dos segredos gerados por nós (em caracteres)
$SsmSecretMinLength = @{
    JWT_SECRET                    = 32
    REFRESH_TOKEN_SECRET          = 32
    SESSION_SECRET                = 32
    MONITORING_UNSUBSCRIBE_SECRET = 32
}
