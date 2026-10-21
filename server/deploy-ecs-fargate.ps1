# Publica o backend no ECS Fargate atrás de um Application Load Balancer.
# Cria o que faltar (cluster, log group, roles, security groups, ALB, target group,
# listeners) e registra uma task definition nova com a imagem informada.
#
# Uso:
#   .\deploy-ecs-fargate.ps1                     # imagem do commit atual (push-ecr-image.ps1 antes)
#   .\deploy-ecs-fargate.ps1 -ImageTag 3f2a1b9   # outra tag já publicada no ECR (ex.: voltar versão)
#   .\deploy-ecs-fargate.ps1 -ValidateOnly       # só confere a configuração (não cria nada)
#   .\deploy-ecs-fargate.ps1 -Action Delete      # remove service, ALB, cluster, roles e log group
#
# Os segredos (DATABASE_URL, JWT, HIBP, IA...) não passam por aqui: vão para o SSM com
# put-ssm-secrets.ps1 e o ECS os injeta na task. Se a versão nova não ficar saudável,
# o ECS volta sozinho para a anterior (deployment circuit breaker) e o script falha.
param(
    [ValidateSet("Create", "Delete")]
    [string]$Action = "Create",

    [string]$EnvFile = ".env.production",
    [string]$ImageTag = "",
    [switch]$ValidateOnly,
    [switch]$Force
)

. (Join-Path $PSScriptRoot 'aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot
$SsmPrefix = Get-SsmPrefix

# ===== Configuração do deploy (server/.env.production) =====
$AiEndpoint = if ($env:AI_ENDPOINT) { $env:AI_ENDPOINT } else { "" }
$AwsRegion = $aws.Region
$ClusterName = if ($env:ECS_CLUSTER_NAME) { $env:ECS_CLUSTER_NAME } else { "safeid-cluster" }
$ServiceName = if ($env:ECS_SERVICE_NAME) { $env:ECS_SERVICE_NAME } else { "safeid-service" }
$TaskFamily = if ($env:ECS_TASK_FAMILY) { $env:ECS_TASK_FAMILY } else { "safeid-task" }
$ContainerName = if ($env:ECS_CONTAINER_NAME) { $env:ECS_CONTAINER_NAME } else { "safeid-backend" }
# SAFEID_IMAGE_URI força uma imagem específica; sem ela, usa o ECR do projeto com a tag do commit
$ImageUri = if ($env:SAFEID_IMAGE_URI -and -not (Test-PlaceholderValue -Value $env:SAFEID_IMAGE_URI)) { $env:SAFEID_IMAGE_URI } else { "" }
$TaskSubnetIds = Get-RequiredEnvList -Name 'BACKEND_SUBNET_IDS'
$AlbSubnetIds = Get-RequiredEnvList -Name 'ALB_SUBNET_IDS'
$AlbSecurityGroupName = if ($env:ALB_SECURITY_GROUP_NAME) { $env:ALB_SECURITY_GROUP_NAME } else { "safeid-alb-sg" }
$TaskSecurityGroupName = if ($env:TASK_SECURITY_GROUP_NAME) { $env:TASK_SECURITY_GROUP_NAME } else { "safeid-ecs-sg" }
$DatabaseSecurityGroupId = Get-RequiredEnv -Name 'DATABASE_SECURITY_GROUP_ID'
$RedisSecurityGroupId = Get-RequiredEnv -Name 'REDIS_SECURITY_GROUP_ID'
$RedisPort = if ($env:REDIS_PORT) { [int]$env:REDIS_PORT } else { 6379 }
$AppPort = if ($env:APP_PORT) { $env:APP_PORT } else { "3000" }
$AlbScheme = if ($env:ALB_SCHEME) { $env:ALB_SCHEME } else { "internet-facing" }
$AlbAllowedClientCidr = if ($env:ALB_ALLOWED_CLIENT_CIDR) { $env:ALB_ALLOWED_CLIENT_CIDR } elseif ($env:ALB_ALLOWED_CLIENT_IP) { "$($env:ALB_ALLOWED_CLIENT_IP)/32" } else { "0.0.0.0/0" }
# Sem certificado (ou com o valor de exemplo), o ALB fica só em HTTP
$AlbHttpsCertificateArn = Get-EnvOrDefault -Name 'ALB_HTTPS_CERTIFICATE_ARN' -Default ''
if (Test-PlaceholderValue -Value $AlbHttpsCertificateArn) { $AlbHttpsCertificateArn = "" }
# TLS 1.2 e 1.3 apenas (a política de 2016 ainda aceitava TLS 1.0)
$AlbSslPolicy = if ($env:ALB_SSL_POLICY) { $env:ALB_SSL_POLICY } else { "ELBSecurityPolicy-TLS13-1-2-2021-06" }
$AssignPublicIp = if ($env:ASSIGN_PUBLIC_IP) { $env:ASSIGN_PUBLIC_IP } else { "ENABLED" }
$HIBPBaseUrl = if ($env:HIBP_BASE_URL) { $env:HIBP_BASE_URL } else { "https://haveibeenpwned.com/api/v3" }
$SwaggerEnabled = if ($env:SWAGGER_ENABLED) { $env:SWAGGER_ENABLED } else { "false" }
$SwaggerPath = if ($env:SWAGGER_PATH) { $env:SWAGGER_PATH } else { "api/docs" }
$LogLevel = if ($env:LOG_LEVEL) { $env:LOG_LEVEL } else { "info" }
$HealthCheckPath = "/api/health"
$DesiredCount = if ($env:DESIRED_COUNT) { [int]$env:DESIRED_COUNT } else { 1 }
# 0,5 vCPU / 1 GB comporta API + workers na escala atual (ARQUITETURA_AWS.md, seção 8)
$TaskCpu = Get-EnvOrDefault -Name 'ECS_TASK_CPU' -Default '512'
$TaskMemory = Get-EnvOrDefault -Name 'ECS_TASK_MEMORY' -Default '1024'

$AwsAccountId = $aws.AccountId
$LogGroupName = "/ecs/$ClusterName"
$LoadBalancerName = "$ClusterName-alb"
$TargetGroupName = "$ClusterName-tg"
$ExecutionRoleName = "$ClusterName-ecsTaskExecutionRole"
$ExecutionPolicyArn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
$ExecutionSsmPolicyName = "safeid-ssm-secrets"
# Task role: permissões que o código da aplicação usa (ex.: SES). A execution role
# fica só com o que o ECS precisa para subir o container (ECR, logs, SSM).
$TaskRoleName = if ($env:ECS_TASK_ROLE_NAME) { $env:ECS_TASK_ROLE_NAME } else { "safeid-task-role" }
# SES: domínio verificado e configuration set (create-ses.ps1)
$SesDomain = Get-EnvOrDefault -Name 'SES_DOMAIN' -Default 'safeid.app.br'
$SesRegion = Get-EnvOrDefault -Name 'AWS_SES_REGION' -Default $AwsRegion
$SesConfigurationSet = Get-EnvOrDefault -Name 'SES_CONFIGURATION_SET' -Default 'safeid-default'
$TaskSesPolicyName = "safeid-ses-send"
$LogRetentionDays = if ($env:LOG_RETENTION_DAYS) { [int]$env:LOG_RETENTION_DAYS } else { 30 }
# Tempo entre o SIGTERM e o SIGKILL, para o shutdown gracioso fechar workers e conexões
$ContainerStopTimeout = 120

function Get-SubnetVpcId {
    $vpcId = Invoke-AwsQuiet -Arguments (@('ec2', 'describe-subnets', '--subnet-ids') + $TaskSubnetIds + @('--query', 'Subnets[0].VpcId', '--output', 'text'))

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vpcId) -or $vpcId -eq "None") {
        throw "Não achei as subnets de BACKEND_SUBNET_IDS na região $AwsRegion. Confira os IDs em $(Get-EnvFileLabel)."
    }

    return $vpcId.Trim()
}

function Validate-SubnetIds {
    if ($AlbSubnetIds.Count -lt 2) {
        throw "ALB_SUBNET_IDS deve conter ao menos dois subnets em Availability Zones diferentes. Application Load Balancer precisa de pelo menos duas subnets para criação."
    }

    if ($TaskSubnetIds.Count -lt 1) {
        throw "BACKEND_SUBNET_IDS deve conter ao menos um subnet para as tasks do ECS."
    }
}

function Get-VpcCidrBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$VpcId
    )

    $cidrBlock = aws ec2 describe-vpcs `
        --vpc-ids $VpcId `
        --query "Vpcs[0].CidrBlock" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($cidrBlock) -or $cidrBlock -eq "None") {
        throw "Falha ao identificar o CIDR da VPC."
    }

    return $cidrBlock.Trim()
}

function ConvertTo-SafeJson {
    param([Parameter(Mandatory = $true)]$InputObject)
    return ($InputObject | ConvertTo-Json -Depth 20 -Compress)
}

function Test-ClusterExists {
    try {
        $status = aws ecs describe-clusters `
            --clusters $ClusterName `
            --query "clusters[0].status" `
            --output text 2>$null

        return ($LASTEXITCODE -eq 0 -and $status -eq "ACTIVE")
    }
    catch {
        return $false
    }
}

function Test-LoadBalancerExists {
    try {
        $result = aws elbv2 describe-load-balancers `
            --names $LoadBalancerName `
            --query "LoadBalancers[0].LoadBalancerArn" `
            --output text 2>$null

        return ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($result) -and $result -ne "None")
    }
    catch {
        return $false
    }
}

function Test-TargetGroupExists {
    try {
        $result = aws elbv2 describe-target-groups `
            --names $TargetGroupName `
            --query "TargetGroups[0].TargetGroupArn" `
            --output text 2>$null

        return ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($result) -and $result -ne "None")
    }
    catch {
        return $false
    }
}

function Test-LogGroupExists {
    try {
        $result = aws logs describe-log-groups `
            --log-group-name-prefix $LogGroupName `
            --query "logGroups[?logGroupName=='$LogGroupName'].logGroupName | [0]" `
            --output text 2>$null

        return ($LASTEXITCODE -eq 0 -and $result -eq $LogGroupName)
    }
    catch {
        return $false
    }
}

function Test-IamRoleExists {
    param(
        [string]$RoleName = $ExecutionRoleName
    )

    try {
        $result = aws iam get-role `
            --role-name $RoleName `
            --query "Role.RoleName" `
            --output text 2>$null

        return ($LASTEXITCODE -eq 0 -and $result -eq $RoleName)
    }
    catch {
        return $false
    }
}

function Get-OrCreateSecurityGroup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GroupName,

        [Parameter(Mandatory = $true)]
        [string]$VpcId,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $groupId = aws ec2 describe-security-groups `
        --filters "Name=group-name,Values=$GroupName" "Name=vpc-id,Values=$VpcId" `
        --query "SecurityGroups[0].GroupId" `
        --output text 2>$null

    if ($LASTEXITCODE -eq 0 -and $groupId -and $groupId -ne "None") {
        return $groupId.Trim()
    }

    $created = aws ec2 create-security-group `
        --group-name $GroupName `
        --description $Description `
        --vpc-id $VpcId `
        --query "GroupId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($created)) {
        throw "Falha ao criar o security group '$GroupName'."
    }

    return $created.Trim()
}

function Add-IngressRule {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GroupId,

        [Parameter(Mandatory = $true)]
        [int]$Port,

        [Parameter(Mandatory = $true)]
        [string]$Source,

        [ValidateSet("group", "cidr")]
        [string]$SourceType = "group"
    )

    $arguments = @(
        "ec2", "authorize-security-group-ingress",
        "--group-id", $GroupId,
        "--protocol", "tcp",
        "--port", $Port.ToString()
    )

    if ($SourceType -eq "cidr") {
        $arguments += @("--cidr", $Source)
    }
    else {
        $arguments += @("--source-group", $Source)
    }

    $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".out")
    $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".err")

    try {
        $process = Start-Process `
            -FilePath "aws" `
            -ArgumentList $arguments `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        $stderrText = if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw } else { "" }

        if ($process.ExitCode -ne 0) {
            if ($stderrText -match "InvalidPermission\.Duplicate") {
                Write-Host "Regra de ingress já existente para $GroupId na porta $Port. Continuando..."
                return
            }

            throw "Falha ao aplicar regra de ingress em $GroupId na porta $Port. Detalhe: $stderrText"
        }
    }
    finally {
        Remove-Item $stdoutPath -ErrorAction SilentlyContinue
        Remove-Item $stderrPath -ErrorAction SilentlyContinue
    }
}

function Ensure-LogGroup {
    if (-not (Test-LogGroupExists)) {
        aws logs create-log-group --log-group-name $LogGroupName
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o log group '$LogGroupName'."
        }
    }

    # Sem política, os logs ficam guardados para sempre
    aws logs put-retention-policy `
        --log-group-name $LogGroupName `
        --retention-in-days $LogRetentionDays

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao definir a retenção de $LogRetentionDays dias no log group '$LogGroupName'."
    }
}

function Ensure-IamExecutionRole {
    $trustPolicy = @{
        Version   = "2012-10-17"
        Statement = @(
            @{
                Effect    = "Allow"
                Principal = @{ Service = "ecs-tasks.amazonaws.com" }
                Action    = "sts:AssumeRole"
            }
        )
    }

    if (-not (Test-IamRoleExists)) {
        $trustPath = Join-Path ([System.IO.Path]::GetTempPath()) "$ExecutionRoleName-trust.json"
        [System.IO.File]::WriteAllText($trustPath, (ConvertTo-SafeJson $trustPolicy), [System.Text.UTF8Encoding]::new($false))

        aws iam create-role `
            --role-name $ExecutionRoleName `
            --assume-role-policy-document ("file://" + ($trustPath -replace '\\', '/')) > $null 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar a role de execução do ECS."
        }
    }

    aws iam attach-role-policy `
        --role-name $ExecutionRoleName `
        --policy-arn $ExecutionPolicyArn 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Policy de execução já estava anexada ou não pôde ser anexada. Continuando..."
    }

    $roleArn = aws iam get-role `
        --role-name $ExecutionRoleName `
        --query "Role.Arn" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($roleArn)) {
        throw "Falha ao obter o ARN da role de execução."
    }

    # Leitura dos segredos do SSM (I.4), restrita ao prefixo do SafeID
    $ssmPolicy = @{
        Version   = "2012-10-17"
        Statement = @(
            @{
                Effect   = "Allow"
                Action   = @("ssm:GetParameters")
                Resource = "arn:aws:ssm:${AwsRegion}:${AwsAccountId}:parameter$SsmPrefix/*"
            },
            @{
                Effect    = "Allow"
                Action    = @("kms:Decrypt")
                Resource  = "*"
                Condition = @{
                    StringEquals = @{ "kms:ViaService" = "ssm.$AwsRegion.amazonaws.com" }
                }
            }
        )
    }

    $ssmPolicyPath = Join-Path ([System.IO.Path]::GetTempPath()) "$ExecutionRoleName-ssm.json"
    [System.IO.File]::WriteAllText($ssmPolicyPath, (ConvertTo-SafeJson $ssmPolicy), [System.Text.UTF8Encoding]::new($false))

    aws iam put-role-policy `
        --role-name $ExecutionRoleName `
        --policy-name $ExecutionSsmPolicyName `
        --policy-document ("file://" + ($ssmPolicyPath -replace '\\', '/'))

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao anexar a política de leitura do SSM à role de execução."
    }

    return $roleArn.Trim()
}

function Ensure-IamTaskRole {
    $trustPolicy = @{
        Version   = "2012-10-17"
        Statement = @(
            @{
                Effect    = "Allow"
                Principal = @{ Service = "ecs-tasks.amazonaws.com" }
                Action    = "sts:AssumeRole"
            }
        )
    }

    if (-not (Test-IamRoleExists -RoleName $TaskRoleName)) {
        $trustPath = Join-Path ([System.IO.Path]::GetTempPath()) "$TaskRoleName-trust.json"
        [System.IO.File]::WriteAllText($trustPath, (ConvertTo-SafeJson $trustPolicy), [System.Text.UTF8Encoding]::new($false))

        aws iam create-role `
            --role-name $TaskRoleName `
            --assume-role-policy-document ("file://" + ($trustPath -replace '\\', '/')) > $null 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar a task role da aplicação."
        }
    }

    $roleArn = aws iam get-role `
        --role-name $TaskRoleName `
        --query "Role.Arn" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($roleArn)) {
        throw "Falha ao obter o ARN da task role."
    }

    # Envio de e-mail (verificação e alertas): só pelo domínio do SafeID, com o configuration set
    $sesPolicy = @{
        Version   = "2012-10-17"
        Statement = @(
            @{
                Effect    = "Allow"
                Action    = @("ses:SendEmail")
                Resource  = @(
                    "arn:aws:ses:${SesRegion}:${AwsAccountId}:identity/$SesDomain",
                    "arn:aws:ses:${SesRegion}:${AwsAccountId}:configuration-set/$SesConfigurationSet"
                )
                Condition = @{
                    StringLike = @{ "ses:FromAddress" = "*@$SesDomain" }
                }
            }
        )
    }

    $sesPolicyPath = Join-Path ([System.IO.Path]::GetTempPath()) "$TaskRoleName-ses.json"
    [System.IO.File]::WriteAllText($sesPolicyPath, (ConvertTo-SafeJson $sesPolicy), [System.Text.UTF8Encoding]::new($false))

    aws iam put-role-policy `
        --role-name $TaskRoleName `
        --policy-name $TaskSesPolicyName `
        --policy-document ("file://" + ($sesPolicyPath -replace '\\', '/'))

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao anexar a política de envio do SES à task role."
    }

    return $roleArn.Trim()
}

# Configuração não sensível da aplicação. URLs públicas são obrigatórias; as opcionais só
# entram quando estão no arquivo de ambiente (as ausentes usam o padrão do código).
function Get-AppEnvironment {
    # Entram nos links dos e-mails: localhost quebraria a verificação e o descadastro
    $appUrl = Get-PublicUrlEnv -Name 'APP_URL'
    $frontendUrl = Get-PublicUrlEnv -Name 'FRONTEND_URL'

    # Sem CORS_ORIGIN o navegador bloquearia o frontend; o padrão é o próprio FRONTEND_URL
    $corsOrigin = Get-EnvOrDefault -Name 'CORS_ORIGIN' -Default $frontendUrl
    if ((Test-LocalOnlyValue -Value $corsOrigin) -or (Test-PlaceholderValue -Value $corsOrigin) -or $corsOrigin -match 'yourdomain') {
        throw "CORS_ORIGIN precisa ser a URL pública do frontend (está '$corsOrigin')."
    }

    $emailProvider = Get-EnvOrDefault -Name 'EMAIL_PROVIDER' -Default 'ses'
    if ($emailProvider -eq 'ses') {
        foreach ($name in @('EMAIL_FROM', 'SES_DOMAIN')) {
            if (Test-PlaceholderValue -Value (Get-RequiredEnv -Name $name)) {
                throw "$name ainda está com o valor de exemplo."
            }
        }
    }
    else {
        Write-Host "Aviso: EMAIL_PROVIDER=$emailProvider. Em produção os e-mails de verificação não saem e o cadastro por e-mail não termina." -ForegroundColor Yellow
    }

    $environment = @(
        @{ name = "APP_URL"; value = $appUrl },
        @{ name = "FRONTEND_URL"; value = $frontendUrl },
        @{ name = "CORS_ORIGIN"; value = $corsOrigin },
        @{ name = "EMAIL_PROVIDER"; value = $emailProvider },
        @{ name = "AWS_SES_REGION"; value = $SesRegion },
        @{ name = "SES_CONFIGURATION_SET"; value = $SesConfigurationSet }
    )

    # Login com Google: precisa do ID (aqui), do segredo (SSM) e do callback público
    $googleClientId = Get-EnvOrDefault -Name 'GOOGLE_CLIENT_ID' -Default ''
    if (-not [string]::IsNullOrWhiteSpace($googleClientId) -and -not (Test-PlaceholderValue -Value $googleClientId)) {
        $environment += @{ name = "GOOGLE_CLIENT_ID"; value = $googleClientId }
        $environment += @{ name = "GOOGLE_CALLBACK_URL"; value = (Get-PublicUrlEnv -Name 'GOOGLE_CALLBACK_URL') }
    }

    $optional = @(
        'EMAIL_FROM', 'EMAIL_REPLY_TO', 'SES_MAX_PER_SECOND', 'EMAIL_VERIFICATION_TTL_HOURS',
        'APP_ROLE', 'SCHEDULER_TZ', 'MONITORING_ENABLED', 'MONITORING_MAX_SWEEP_HOURS',
        'HIBP_CATALOG_SYNC_CRON', 'HIBP_CATALOG_PROBE_CRON', 'HIBP_PLAN_CHECK_CRON',
        'MONITORING_RECONCILE_CRON', 'MONITORING_WEEKLY_SWEEP_CRON', 'UNVERIFIED_CLEANUP_CRON',
        'UNVERIFIED_ACCOUNT_TTL_DAYS', 'HIBP_RPM_LIMIT', 'HIBP_RPM_SAFETY_FACTOR', 'HIBP_RPM_FALLBACK',
        'HIBP_EXPECTED_LATENCY_S', 'AI_MODEL', 'AI_TIMEOUT_MS',
        'JWT_EXPIRES_IN', 'REFRESH_TOKEN_EXPIRES_IN', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX_REQUESTS'
    )

    foreach ($name in $optional) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $environment += @{ name = $name; value = $value.Trim() }
        }
    }

    return $environment
}

# Referências do bloco "secrets" da task definition, a partir do que existe no SSM
function Get-ContainerSecrets {
    $allNames = @($SsmRequiredSecrets + $SsmOptionalSecrets)
    $parameterNames = @($allNames | ForEach-Object { "$SsmPrefix/$_" })

    # Só os nomes: o valor (cifrado) não é pedido nem impresso. O GetParameters aceita até 10 nomes por chamada.
    $existing = @()
    for ($start = 0; $start -lt $parameterNames.Count; $start += 10) {
        $batch = @($parameterNames[$start..([Math]::Min($start + 9, $parameterNames.Count - 1))])
        $found = aws ssm get-parameters `
            --names $batch `
            --query "Parameters[].Name" `
            --output text

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao consultar os segredos no SSM."
        }

        $existing += @("$found" -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    $missing = @($SsmRequiredSecrets | Where-Object { $existing -notcontains "$SsmPrefix/$_" })
    if ($missing.Count -gt 0) {
        throw "Segredos ausentes no SSM: $($missing -join ', '). Rode put-ssm-secrets.ps1 antes do deploy."
    }

    return @($allNames | Where-Object { $existing -contains "$SsmPrefix/$_" } | ForEach-Object {
        @{
            name      = $_
            valueFrom = "arn:aws:ssm:${AwsRegion}:${AwsAccountId}:parameter$SsmPrefix/$_"
        }
    })
}

function Ensure-Cluster {
    $clusterStatus = aws ecs describe-clusters `
        --clusters $ClusterName `
        --query "clusters[0].status" `
        --output text 2>$null

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($clusterStatus) -or $clusterStatus -eq "None") {
        aws ecs create-cluster --cluster-name $ClusterName > $null
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o cluster ECS '$ClusterName'."
        }
        return
    }

    if ($clusterStatus -eq "INACTIVE") {
        Write-Host "Cluster ECS '$ClusterName' está inativo. Removendo e recriando..."
        aws ecs delete-cluster --cluster $ClusterName 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao remover o cluster ECS inativo '$ClusterName'."
        }

        aws ecs create-cluster --cluster-name $ClusterName > $null
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao recriar o cluster ECS '$ClusterName'."
        }
    }
}

function Ensure-LoadBalancer {
    param(
        [Parameter(Mandatory = $true)]
        [string]$VpcId,

        [Parameter(Mandatory = $true)]
        [string]$AlbSecurityGroupId
    )

    Validate-SubnetIds

    if (-not (Test-LoadBalancerExists)) {
        aws elbv2 create-load-balancer `
            --name $LoadBalancerName `
            --type application `
            --scheme $AlbScheme `
            --subnets $AlbSubnetIds `
            --security-groups $AlbSecurityGroupId `
            --query "LoadBalancers[0].LoadBalancerArn" `
            --output text > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o Application Load Balancer."
        }
    }

    $albArn = aws elbv2 describe-load-balancers `
        --names $LoadBalancerName `
        --query "LoadBalancers[0].LoadBalancerArn" `
        --output text

    $albDnsName = aws elbv2 describe-load-balancers `
        --names $LoadBalancerName `
        --query "LoadBalancers[0].DNSName" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($albArn)) {
        throw "Falha ao obter o Application Load Balancer criado."
    }

    return @{
        Arn     = $albArn.Trim()
        DnsName = $albDnsName.Trim()
    }
}

function Get-ListenerArnByPort {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AlbArn,

        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $listeners = aws elbv2 describe-listeners `
        --load-balancer-arn $AlbArn `
        --output json 2>$null | ConvertFrom-Json

    if ($LASTEXITCODE -ne 0 -or -not $listeners -or -not $listeners.Listeners) {
        return $null
    }

    $listener = $listeners.Listeners | Where-Object { [int]$_.Port -eq $Port } | Select-Object -First 1
    if ($null -eq $listener) {
        return $null
    }

    return $listener.ListenerArn
}

function Ensure-TargetGroup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$VpcId
    )

    if (-not (Test-TargetGroupExists)) {
        $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".out")
        $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".err")

        try {
            $createProcess = Start-Process `
                -FilePath "aws" `
                -ArgumentList @(
                    "elbv2", "create-target-group",
                    "--name", $TargetGroupName,
                    "--protocol", "HTTP",
                    "--port", $AppPort.ToString(),
                    "--target-type", "ip",
                    "--vpc-id", $VpcId,
                    "--health-check-path", $HealthCheckPath,
                    "--health-check-protocol", "HTTP",
                    "--query", "TargetGroups[0].TargetGroupArn",
                    "--output", "text"
                ) `
                -NoNewWindow `
                -Wait `
                -PassThru `
                -RedirectStandardOutput $stdoutPath `
                -RedirectStandardError $stderrPath

            $createStdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
            $createdArn = if ([string]::IsNullOrWhiteSpace($createStdout)) { "" } else { $createStdout.Trim() }

            if ($createProcess.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($createdArn)) {
                $stderrText = if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw } else { "" }
                throw "Falha ao criar o target group do ALB. Detalhe: $stderrText"
            }
        }
        finally {
            Remove-Item $stdoutPath -ErrorAction SilentlyContinue
            Remove-Item $stderrPath -ErrorAction SilentlyContinue
        }
    }

    $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".out")
    $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".err")

    try {
        $describeProcess = Start-Process `
            -FilePath "aws" `
            -ArgumentList @(
                "elbv2", "describe-target-groups",
                "--names", $TargetGroupName,
                "--query", "TargetGroups[0].TargetGroupArn",
                "--output", "text"
            ) `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        $describeStdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
        $targetGroupArn = if ([string]::IsNullOrWhiteSpace($describeStdout)) { "" } else { $describeStdout.Trim() }

        if ($describeProcess.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($targetGroupArn)) {
            $stderrText = if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw } else { "" }
            throw "Falha ao obter o target group do ALB. Detalhe: $stderrText"
        }
    }
    finally {
        Remove-Item $stdoutPath -ErrorAction SilentlyContinue
        Remove-Item $stderrPath -ErrorAction SilentlyContinue
    }

    # Deploy mais rápido: a task nova entra após 2 checks de 15 s (o padrão era 5 de 30 s)
    # e a antiga sai em 30 s (o padrão era 300 s). Reaplicado a cada deploy.
    aws elbv2 modify-target-group `
        --target-group-arn $targetGroupArn `
        --health-check-path $HealthCheckPath `
        --health-check-interval-seconds 15 `
        --healthy-threshold-count 2 `
        --unhealthy-threshold-count 3 > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao ajustar o health check do target group."
    }

    aws elbv2 modify-target-group-attributes `
        --target-group-arn $targetGroupArn `
        --attributes Key=deregistration_delay.timeout_seconds,Value=30 > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao ajustar o tempo de retirada das tasks antigas do target group."
    }

    return $targetGroupArn
}

function Ensure-Listener {
    param(
        [Parameter(Mandatory = $true)]
        [string]$AlbArn,

        [Parameter(Mandatory = $true)]
        [int]$Port,

        [Parameter(Mandatory = $true)]
        [string]$Protocol,

        [Parameter(Mandatory = $true)]
        [string]$DefaultActions,

        [string]$CertificateArn = ""
    )

    $listenerArn = Get-ListenerArnByPort -AlbArn $AlbArn -Port $Port

    if ($listenerArn -and $listenerArn -ne "None") {
        return $listenerArn.Trim()
    }

    $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".out")
    $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + ".err")

    try {
        $arguments = @(
            "elbv2", "create-listener",
            "--load-balancer-arn", $AlbArn,
            "--protocol", $Protocol,
            "--port", $Port.ToString(),
            "--default-actions", $DefaultActions,
            "--query", "Listeners[0].ListenerArn",
            "--output", "text"
        )

        if (-not [string]::IsNullOrWhiteSpace($CertificateArn)) {
            $arguments += @("--certificates", "CertificateArn=$CertificateArn")
        }

        if ($Protocol -eq "HTTPS") {
            $arguments += @("--ssl-policy", $AlbSslPolicy)
        }

        $createProcess = Start-Process `
            -FilePath "aws" `
            -ArgumentList $arguments `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        $listenerStdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
        $listenerArn = if ([string]::IsNullOrWhiteSpace($listenerStdout)) { "" } else { $listenerStdout.Trim() }

        if ($createProcess.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($listenerArn)) {
            $stderrText = if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw } else { "" }
            throw "Falha ao criar o listener do ALB. Detalhe: $stderrText"
        }

        return $listenerArn
    }
    finally {
        Remove-Item $stdoutPath -ErrorAction SilentlyContinue
        Remove-Item $stderrPath -ErrorAction SilentlyContinue
    }
}

function New-TaskDefinitionJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExecutionRoleArn,

        [Parameter(Mandatory = $true)]
        [string]$TaskRoleArn,

        [Parameter(Mandatory = $true)]
        [string]$RedisHostValue,

        [Parameter(Mandatory = $true)]
        [object[]]$ContainerSecrets
    )

    # Só configuração não sensível. Os segredos vêm do SSM pelo bloco "secrets".
    $containerEnvironment = @(
        @{ name = "NODE_ENV"; value = "production" },
        @{ name = "APP_PORT"; value = $AppPort },
        @{ name = "REDIS_HOST"; value = $RedisHostValue },
        @{ name = "REDIS_PORT"; value = "$RedisPort" },
        @{ name = "HIBP_BASE_URL"; value = $HIBPBaseUrl },
        # Produção nunca usa o mock da HIBP
        @{ name = "HIBP_USE_MOCK"; value = "false" },
        @{ name = "SWAGGER_ENABLED"; value = $SwaggerEnabled },
        @{ name = "SWAGGER_PATH"; value = $SwaggerPath },
        @{ name = "LOG_LEVEL"; value = $LogLevel },
        @{ name = "AI_ENDPOINT"; value = $AiEndpoint }
    ) + $AppEnvironment

    $taskDefinition = @{
        family                  = $TaskFamily
        networkMode             = "awsvpc"
        requiresCompatibilities  = @("FARGATE")
        cpu                     = $TaskCpu
        memory                  = $TaskMemory
        executionRoleArn        = $ExecutionRoleArn
        taskRoleArn             = $TaskRoleArn
        containerDefinitions    = @(
            @{
                name         = $ContainerName
                image        = $ImageUri
                essential    = $true
                stopTimeout  = $ContainerStopTimeout
                portMappings = @(
                    @{
                        containerPort = [int]$AppPort
                        hostPort      = [int]$AppPort
                        protocol      = "tcp"
                    }
                )
                environment  = $containerEnvironment
                secrets      = $ContainerSecrets
                logConfiguration = @{
                    logDriver = "awslogs"
                    options   = @{
                        "awslogs-group"         = $LogGroupName
                        "awslogs-region"        = $AwsRegion
                        "awslogs-stream-prefix" = "ecs"
                    }
                }
            }
        )
    }

    return ConvertTo-SafeJson $taskDefinition
}

function Register-TaskDefinition {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExecutionRoleArn,

        [Parameter(Mandatory = $true)]
        [string]$TaskRoleArn,

        [Parameter(Mandatory = $true)]
        [string]$RedisHostValue,

        [Parameter(Mandatory = $true)]
        [object[]]$ContainerSecrets
    )

    $json = New-TaskDefinitionJson `
        -ExecutionRoleArn $ExecutionRoleArn `
        -TaskRoleArn $TaskRoleArn `
        -RedisHostValue $RedisHostValue `
        -ContainerSecrets $ContainerSecrets

    $taskDefPath = Join-Path ([System.IO.Path]::GetTempPath()) "$TaskFamily-taskdef.json"
    [System.IO.File]::WriteAllText($taskDefPath, $json, [System.Text.UTF8Encoding]::new($false))

    $taskDefinitionArn = aws ecs register-task-definition `
        --cli-input-json ("file://" + ($taskDefPath -replace '\\', '/')) `
        --query "taskDefinition.taskDefinitionArn" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($taskDefinitionArn)) {
        throw "Falha ao registrar a task definition."
    }

    return $taskDefinitionArn.Trim()
}

function Test-ServiceExists {
    $count = aws ecs describe-services `
        --cluster $ClusterName `
        --services $ServiceName `
        --query "length(services[?status=='ACTIVE' || status=='DRAINING'])" `
        --output text 2>$null

    return ($LASTEXITCODE -eq 0 -and $count -match '^[0-9]+$' -and [int]$count -gt 0)
}

function Ensure-Service {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskDefinitionArn,

        [Parameter(Mandatory = $true)]
        [string]$TaskSecurityGroupId,

        [Parameter(Mandatory = $true)]
        [string]$TargetGroupArn
    )

    $networkConfiguration = "awsvpcConfiguration={subnets=[$($TaskSubnetIds -join ',')],securityGroups=[$TaskSecurityGroupId],assignPublicIp=$AssignPublicIp}"
    $loadBalancer = "targetGroupArn=$TargetGroupArn,containerName=$ContainerName,containerPort=$AppPort"
    # A task nova sobe ao lado da antiga (200%) e só substitui depois de saudável. Se não ficar
    # saudável, o circuit breaker cancela o deploy e volta para a task definition anterior.
    $deploymentConfiguration = "deploymentCircuitBreaker={enable=true,rollback=true},maximumPercent=200,minimumHealthyPercent=100"

    if (Test-ServiceExists) {
        Write-Host "Atualizando o serviço ECS '$ServiceName'..."
        aws ecs update-service `
            --cluster $ClusterName `
            --service $ServiceName `
            --task-definition $TaskDefinitionArn `
            --desired-count $DesiredCount `
            --network-configuration $networkConfiguration `
            --deployment-configuration $deploymentConfiguration `
            --health-check-grace-period-seconds 60 `
            --force-new-deployment > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao atualizar o serviço ECS."
        }
    }
    else {
        Write-Host "Criando o serviço ECS '$ServiceName'..."
        aws ecs create-service `
            --cluster $ClusterName `
            --service-name $ServiceName `
            --task-definition $TaskDefinitionArn `
            --desired-count $DesiredCount `
            --launch-type FARGATE `
            --network-configuration $networkConfiguration `
            --load-balancers $loadBalancer `
            --deployment-configuration $deploymentConfiguration `
            --health-check-grace-period-seconds 60 > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o serviço ECS."
        }
    }

    Write-Host "Aguardando a versão nova ficar saudável no ALB (alguns minutos)..."
    aws ecs wait services-stable `
        --cluster $ClusterName `
        --services $ServiceName

    $waitExitCode = $LASTEXITCODE

    # Depois de um rollback o serviço também fica "estável", só que na versão antiga
    $primary = aws ecs describe-services `
        --cluster $ClusterName `
        --services $ServiceName `
        --query "services[0].deployments[?status=='PRIMARY'] | [0].[taskDefinition, rolloutState]" `
        --output text

    $primaryParts = @("$primary" -split '\s+' | Where-Object { $_ })
    $logsHint = "Veja os logs: aws logs tail $LogGroupName --since 30m"

    if ($primaryParts.Count -ge 1 -and $primaryParts[0] -ne $TaskDefinitionArn) {
        throw "A versão nova não ficou saudável e o ECS voltou para a anterior ($($primaryParts[0])). $logsHint"
    }

    if ($waitExitCode -ne 0) {
        throw "O serviço ECS não estabilizou no tempo esperado (rollout: $($primaryParts[1])). $logsHint"
    }
}

function Remove-ServiceAndCluster {
    Confirm-Destructive `
        -Resource $ClusterName `
        -Description "remove o serviço '$ServiceName', o ALB, o cluster '$ClusterName', as roles e os logs. O banco, o Redis e os segredos do SSM não são apagados." `
        -Force:$Force

    $serviceStatus = Invoke-AwsQuiet -Arguments @(
        'ecs', 'describe-services',
        '--cluster', $ClusterName,
        '--services', $ServiceName,
        '--query', 'services[0].status',
        '--output', 'text'
    )

    if ($LASTEXITCODE -eq 0 -and $serviceStatus -and $serviceStatus -ne "None" -and $serviceStatus -ne "INACTIVE") {
        Write-Host "Removendo o serviço ECS..."

        aws ecs delete-service `
            --cluster $ClusterName `
            --service $ServiceName `
            --force > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao remover o serviço ECS."
        }

        aws ecs wait services-inactive --cluster $ClusterName --services $ServiceName
    }
    else {
        Write-Host "Serviço ECS já está inativo ou não existe. Seguindo com o restante..."
    }

    $taskDefinitions = Invoke-AwsQuiet -Arguments @(
        'ecs', 'list-task-definitions',
        '--family-prefix', $TaskFamily,
        '--query', 'taskDefinitionArns',
        '--output', 'text'
    )

    foreach ($taskDefinitionArn in @("$taskDefinitions" -split '\s+' | Where-Object { $_ -and $_ -ne 'None' })) {
        $null = Invoke-AwsQuiet -Arguments @('ecs', 'deregister-task-definition', '--task-definition', $taskDefinitionArn)
    }

    $lbArn = Invoke-AwsQuiet -Arguments @(
        'elbv2', 'describe-load-balancers',
        '--names', $LoadBalancerName,
        '--query', 'LoadBalancers[0].LoadBalancerArn',
        '--output', 'text'
    )

    if ($LASTEXITCODE -eq 0 -and $lbArn -and "$lbArn".Trim() -ne "None") {
        Write-Host "Removendo o Application Load Balancer..."
        # Apagar o ALB apaga os listeners junto
        aws elbv2 delete-load-balancer --load-balancer-arn "$lbArn".Trim()
        # O target group e os security groups só liberam depois que o ALB some de vez
        aws elbv2 wait load-balancers-deleted --load-balancer-arns "$lbArn".Trim()
    }

    $tgArn = Invoke-AwsQuiet -Arguments @(
        'elbv2', 'describe-target-groups',
        '--names', $TargetGroupName,
        '--query', 'TargetGroups[0].TargetGroupArn',
        '--output', 'text'
    )

    if ($LASTEXITCODE -eq 0 -and $tgArn -and "$tgArn".Trim() -ne "None") {
        $null = Invoke-AwsQuiet -Arguments @('elbv2', 'delete-target-group', '--target-group-arn', "$tgArn".Trim())
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Target group '$TargetGroupName' ainda em uso. Rode o Delete de novo em alguns minutos."
        }
    }

    $vpcId = Get-SubnetVpcId

    foreach ($groupName in @($AlbSecurityGroupName, $TaskSecurityGroupName)) {
        $groupId = aws ec2 describe-security-groups `
            --filters "Name=group-name,Values=$groupName" "Name=vpc-id,Values=$vpcId" `
            --query "SecurityGroups[0].GroupId" `
            --output text

        if (-not $groupId -or "$groupId".Trim() -eq "None") {
            continue
        }

        # As interfaces de rede do ALB e das tasks levam alguns minutos para sumir
        $removed = $false
        for ($attempt = 1; $attempt -le 10 -and -not $removed; $attempt++) {
            $null = Invoke-AwsQuiet -Arguments @('ec2', 'delete-security-group', '--group-id', "$groupId".Trim())
            if ($LASTEXITCODE -eq 0) {
                $removed = $true
            }
            else {
                Start-Sleep -Seconds 30
            }
        }

        if (-not $removed) {
            Write-Host "Security group '$groupName' ainda em uso. Rode o Delete de novo em alguns minutos."
        }
    }

    if (Test-LogGroupExists) {
        $null = Invoke-AwsQuiet -Arguments @('logs', 'delete-log-group', '--log-group-name', $LogGroupName)
    }

    if (Test-ClusterExists) {
        $null = Invoke-AwsQuiet -Arguments @('ecs', 'delete-cluster', '--cluster', $ClusterName)
    }

    foreach ($roleName in @($ExecutionRoleName, $TaskRoleName)) {
        if (-not (Test-IamRoleExists -RoleName $roleName)) {
            continue
        }

        # A role só pode ser apagada depois de remover as políticas anexadas e as inline
        $attached = Invoke-AwsQuiet -Arguments @('iam', 'list-attached-role-policies', '--role-name', $roleName, '--query', 'AttachedPolicies[].PolicyArn', '--output', 'text')
        foreach ($policyArn in @("$attached" -split '\s+' | Where-Object { $_ -and $_ -ne 'None' })) {
            $null = Invoke-AwsQuiet -Arguments @('iam', 'detach-role-policy', '--role-name', $roleName, '--policy-arn', $policyArn)
        }

        $inline = Invoke-AwsQuiet -Arguments @('iam', 'list-role-policies', '--role-name', $roleName, '--query', 'PolicyNames', '--output', 'text')
        foreach ($policyName in @("$inline" -split '\s+' | Where-Object { $_ -and $_ -ne 'None' })) {
            $null = Invoke-AwsQuiet -Arguments @('iam', 'delete-role-policy', '--role-name', $roleName, '--policy-name', $policyName)
        }

        $null = Invoke-AwsQuiet -Arguments @('iam', 'delete-role', '--role-name', $roleName)
    }

    Write-Host "Stack ECS/ALB removido."
}

# Imagem do deploy: SAFEID_IMAGE_URI ou o ECR do projeto com a tag pedida (padrão: commit atual)
function Resolve-ImageUri {
    # -ImageTag (usado pelo deploy.ps1) vence a SAFEID_IMAGE_URI, para nunca publicar uma imagem antiga por engano
    if ([string]::IsNullOrWhiteSpace($ImageTag) -and -not [string]::IsNullOrWhiteSpace($ImageUri)) {
        Write-Host "Usando SAFEID_IMAGE_URI do arquivo de ambiente."
        return $ImageUri
    }

    $tag = if ([string]::IsNullOrWhiteSpace($ImageTag)) { Get-DeployImageTag -RepoDir $PSScriptRoot } else { $ImageTag }
    $repositoryName = Get-EcrRepositoryName

    $digest = Invoke-AwsQuiet -Arguments @(
        'ecr', 'describe-images',
        '--repository-name', $repositoryName,
        '--image-ids', "imageTag=$tag",
        '--query', 'imageDetails[0].imageDigest',
        '--output', 'text'
    )

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($digest) -or "$digest".Trim() -eq 'None') {
        throw "A imagem '${repositoryName}:$tag' não está no ECR. Rode .\push-ecr-image.ps1 antes (ou use o deploy.ps1 da raiz, que faz tudo)."
    }

    return "$(Get-EcrRepositoryUri -Aws $aws):$tag"
}

function Deploy-EcsFargate {
    Validate-SubnetIds

    if ($ValidateOnly) {
        $vpcId = Get-SubnetVpcId
        $null = Get-RedisEndpoint
        $null = Get-AppEnvironment
        Write-Host "Configuração do ECS conferida (VPC $vpcId, ALB '$LoadBalancerName')."
        return
    }

    # Tudo que pode falhar por configuração é conferido antes de criar qualquer recurso
    $script:ImageUri = Resolve-ImageUri
    $vpcId = Get-SubnetVpcId
    $vpcCidr = Get-VpcCidrBlock -VpcId $vpcId
    $redisHostValue = Get-RedisEndpoint
    $containerSecrets = Get-ContainerSecrets
    $script:AppEnvironment = Get-AppEnvironment

    Write-Host "Imagem: $ImageUri"

    Ensure-Cluster
    Ensure-LogGroup

    $executionRoleArn = Ensure-IamExecutionRole
    $taskRoleArn = Ensure-IamTaskRole

    $albSgId = Get-OrCreateSecurityGroup `
        -GroupName $AlbSecurityGroupName `
        -VpcId $vpcId `
        -Description "SafeID ALB security group"

    $taskSgId = Get-OrCreateSecurityGroup `
        -GroupName $TaskSecurityGroupName `
        -VpcId $vpcId `
        -Description "SafeID ECS task security group"

    if ($AlbScheme -eq "internet-facing") {
        if ([string]::IsNullOrWhiteSpace($env:ALB_ALLOWED_CLIENT_CIDR) -and [string]::IsNullOrWhiteSpace($env:ALB_ALLOWED_CLIENT_IP)) {
            Write-Host "Aviso: ALB público sem allowlist explícita. O acesso fica aberto para 0.0.0.0/0; a proteção vem de HTTPS, autenticação e rate limit."
        }

        Add-IngressRule -GroupId $albSgId -Port 80 -Source $AlbAllowedClientCidr -SourceType cidr

        if (-not [string]::IsNullOrWhiteSpace($AlbHttpsCertificateArn)) {
            Add-IngressRule -GroupId $albSgId -Port 443 -Source $AlbAllowedClientCidr -SourceType cidr
        }
    }
    else {
        Add-IngressRule -GroupId $albSgId -Port 80 -Source $vpcCidr -SourceType cidr

        if (-not [string]::IsNullOrWhiteSpace($AlbAllowedClientCidr)) {
            Write-Host "Aviso: ALB interno só é acessível de dentro da VPC (VPN ou bastion)."
        }
    }

    Add-IngressRule -GroupId $taskSgId -Port ([int]$AppPort) -Source $albSgId
    Add-IngressRule -GroupId $DatabaseSecurityGroupId -Port 5432 -Source $taskSgId
    Add-IngressRule -GroupId $RedisSecurityGroupId -Port $RedisPort -Source $taskSgId

    $lb = Ensure-LoadBalancer -VpcId $vpcId -AlbSecurityGroupId $albSgId
    [string]$targetGroupArn = Ensure-TargetGroup -VpcId $vpcId

    if ($AlbScheme -eq "internet-facing" -and -not [string]::IsNullOrWhiteSpace($AlbHttpsCertificateArn)) {
        $redirectAction = "Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}"

        $httpListenerArn = Ensure-Listener `
            -AlbArn $lb.Arn `
            -Port 80 `
            -Protocol "HTTP" `
            -DefaultActions $redirectAction

        # Um listener 80 criado antes do certificado ainda encaminharia HTTP puro para a API
        aws elbv2 modify-listener --listener-arn $httpListenerArn --default-actions $redirectAction > $null
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao configurar o redirecionamento de HTTP para HTTPS."
        }

        Ensure-Listener `
            -AlbArn $lb.Arn `
            -Port 443 `
            -Protocol "HTTPS" `
            -DefaultActions "Type=forward,TargetGroupArn=$targetGroupArn" `
            -CertificateArn $AlbHttpsCertificateArn | Out-Null
    }
    else {
        Ensure-Listener `
            -AlbArn $lb.Arn `
            -Port 80 `
            -Protocol "HTTP" `
            -DefaultActions "Type=forward,TargetGroupArn=$targetGroupArn" | Out-Null
    }

    $taskDefinitionArn = Register-TaskDefinition `
        -ExecutionRoleArn $executionRoleArn `
        -TaskRoleArn $taskRoleArn `
        -RedisHostValue $redisHostValue `
        -ContainerSecrets $containerSecrets

    Ensure-Service `
        -TaskDefinitionArn $taskDefinitionArn `
        -TaskSecurityGroupId $taskSgId `
        -TargetGroupArn $targetGroupArn

    $scheme = if ($AlbScheme -eq "internet-facing" -and -not [string]::IsNullOrWhiteSpace($AlbHttpsCertificateArn)) { "https" } else { "http" }

    Write-Host ""
    Write-Host "Backend publicado: $taskDefinitionArn"
    Write-Host "ALB:     $scheme`://$($lb.DnsName)"
    Write-Host "APP_URL: $(Get-EnvOrDefault -Name 'APP_URL' -Default '')  (o DNS da API precisa apontar para o ALB)"
}

switch ($Action) {
    "Create" { Deploy-EcsFargate }
    "Delete" { Remove-ServiceAndCluster }
}
