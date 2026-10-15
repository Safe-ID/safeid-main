param(
    [ValidateSet("Create", "Delete")]
    [string]$Action = "Create"
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

. (Join-Path $PSScriptRoot 'aws-common.ps1')
Import-DotEnvFile -Path (Join-Path $PSScriptRoot '.env')

# ===== Configuração do deploy =====
# Ajuste estas variáveis no server/.env. Os segredos (DATABASE_URL, JWT, HIBP, IA...)
# não passam por aqui: vão para o SSM com put-ssm-secrets.ps1 e o ECS os injeta na task.
$AiEndpoint = if ($env:AI_ENDPOINT) { $env:AI_ENDPOINT } else { "" }
$AwsRegion = if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }
$ClusterName = if ($env:ECS_CLUSTER_NAME) { $env:ECS_CLUSTER_NAME } else { "safeid-cluster" }
$ServiceName = if ($env:ECS_SERVICE_NAME) { $env:ECS_SERVICE_NAME } else { "safeid-service" }
$TaskFamily = if ($env:ECS_TASK_FAMILY) { $env:ECS_TASK_FAMILY } else { "safeid-task" }
$ContainerName = if ($env:ECS_CONTAINER_NAME) { $env:ECS_CONTAINER_NAME } else { "safeid-backend" }
$ImageUri = if ($env:SAFEID_IMAGE_URI) { $env:SAFEID_IMAGE_URI } else { "" }
$TaskSubnetIds = Get-RequiredEnvList -Name 'BACKEND_SUBNET_IDS'
$AlbSubnetIds = Get-RequiredEnvList -Name 'ALB_SUBNET_IDS'
$AlbSecurityGroupName = if ($env:ALB_SECURITY_GROUP_NAME) { $env:ALB_SECURITY_GROUP_NAME } else { "safeid-alb-sg" }
$TaskSecurityGroupName = if ($env:TASK_SECURITY_GROUP_NAME) { $env:TASK_SECURITY_GROUP_NAME } else { "safeid-ecs-sg" }
$DatabaseSecurityGroupId = Get-RequiredEnv -Name 'DATABASE_SECURITY_GROUP_ID'
$RedisSecurityGroupId = Get-RequiredEnv -Name 'REDIS_SECURITY_GROUP_ID'
$RedisHost = if ($env:REDIS_HOST) { $env:REDIS_HOST } else { "" }
$RedisPort = if ($env:REDIS_PORT) { [int]$env:REDIS_PORT } else { 6379 }
$AppPort = if ($env:APP_PORT) { $env:APP_PORT } else { "3000" }
$AlbScheme = if ($env:ALB_SCHEME) { $env:ALB_SCHEME } else { "internet-facing" }
$AlbAllowedClientCidr = if ($env:ALB_ALLOWED_CLIENT_CIDR) { $env:ALB_ALLOWED_CLIENT_CIDR } elseif ($env:ALB_ALLOWED_CLIENT_IP) { "$($env:ALB_ALLOWED_CLIENT_IP)/32" } else { "0.0.0.0/0" }
$AlbHttpsCertificateArn = if ($env:ALB_HTTPS_CERTIFICATE_ARN) { $env:ALB_HTTPS_CERTIFICATE_ARN } else { "" }
$AlbSslPolicy = if ($env:ALB_SSL_POLICY) { $env:ALB_SSL_POLICY } else { "ELBSecurityPolicy-2016-08" }
$AssignPublicIp = if ($env:ASSIGN_PUBLIC_IP) { $env:ASSIGN_PUBLIC_IP } else { "ENABLED" }
$HIBPBaseUrl = if ($env:HIBP_BASE_URL) { $env:HIBP_BASE_URL } else { "https://haveibeenpwned.com/api/v3" }
$HIBPMinIntervalMs = if ($env:HIBP_MIN_INTERVAL_MS) { $env:HIBP_MIN_INTERVAL_MS } else { "1500" }
$CorsOrigin = if ($env:CORS_ORIGIN) { $env:CORS_ORIGIN } else { "" }
$SwaggerEnabled = if ($env:SWAGGER_ENABLED) { $env:SWAGGER_ENABLED } else { "false" }
$SwaggerPath = if ($env:SWAGGER_PATH) { $env:SWAGGER_PATH } else { "api/docs" }
$LogLevel = if ($env:LOG_LEVEL) { $env:LOG_LEVEL } else { "info" }
$HealthCheckPath = "/api/health"
$DesiredCount = if ($env:DESIRED_COUNT) { [int]$env:DESIRED_COUNT } else { 1 }

$AwsAccountId = Get-AwsAccountId
$LogGroupName = "/ecs/$ClusterName"
$LoadBalancerName = "$ClusterName-alb"
$TargetGroupName = "$ClusterName-tg"
$ExecutionRoleName = "$ClusterName-ecsTaskExecutionRole"
$ExecutionPolicyArn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
$ExecutionSsmPolicyName = "safeid-ssm-secrets"
# Task role: permissões que o código da aplicação usa (ex.: SES). A execution role
# fica só com o que o ECS precisa para subir o container (ECR, logs, SSM).
$TaskRoleName = if ($env:ECS_TASK_ROLE_NAME) { $env:ECS_TASK_ROLE_NAME } else { "safeid-task-role" }
$LogRetentionDays = if ($env:LOG_RETENTION_DAYS) { [int]$env:LOG_RETENTION_DAYS } else { 30 }
# Tempo entre o SIGTERM e o SIGKILL, para o shutdown gracioso fechar workers e conexões
$ContainerStopTimeout = 120

function Invoke-AwsJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & aws @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao executar: aws $($Arguments -join ' ')"
    }
}

function Get-SubnetVpcId {
    $vpcId = aws ec2 describe-subnets `
        --subnet-ids $TaskSubnetIds `
        --query "Subnets[0].VpcId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vpcId) -or $vpcId -eq "None") {
        throw "Falha ao identificar a VPC dos subnets informados."
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

    $stdoutPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".out")
    $stderrPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".err")

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
        $trustPath = Join-Path $env:TEMP "$ExecutionRoleName-trust.json"
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

    $ssmPolicyPath = Join-Path $env:TEMP "$ExecutionRoleName-ssm.json"
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
        $trustPath = Join-Path $env:TEMP "$TaskRoleName-trust.json"
        [System.IO.File]::WriteAllText($trustPath, (ConvertTo-SafeJson $trustPolicy), [System.Text.UTF8Encoding]::new($false))

        # Sem políticas por enquanto: a permissão do SES entra com o monitoramento (T7.3)
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

    return $roleArn.Trim()
}

# Referências do bloco "secrets" da task definition, a partir do que existe no SSM
function Get-ContainerSecrets {
    $allNames = @($SsmRequiredSecrets + $SsmOptionalSecrets)
    $parameterNames = @($allNames | ForEach-Object { "$SsmPrefix/$_" })

    # Só os nomes: o valor (cifrado) não é pedido nem impresso
    $found = aws ssm get-parameters `
        --names $parameterNames `
        --query "Parameters[].Name" `
        --output text

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao consultar os segredos no SSM."
    }

    $existing = @("$found" -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

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
        aws ecs create-cluster --cluster-name $ClusterName
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

        aws ecs create-cluster --cluster-name $ClusterName
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
            --output text

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
        $stdoutPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".out")
        $stderrPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".err")

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

    $stdoutPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".out")
    $stderrPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".err")

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

        return $targetGroupArn
    }
    finally {
        Remove-Item $stdoutPath -ErrorAction SilentlyContinue
        Remove-Item $stderrPath -ErrorAction SilentlyContinue
    }
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

    $stdoutPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".out")
    $stderrPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".err")

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

function Get-RedisHostValue {
    if (-not [string]::IsNullOrWhiteSpace($RedisHost)) {
        $value = $RedisHost
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:REDIS_HOST)) {
        $value = $env:REDIS_HOST
    }
    else {
        throw "Informe -RedisHost ou defina REDIS_HOST no ambiente."
    }

    # O .env de desenvolvimento aponta para o Redis local; isso nunca pode ir para produção
    if (Test-LocalOnlyValue -Value $value) {
        throw "REDIS_HOST aponta para um endereço local ($value). Use o endpoint do ElastiCache no deploy."
    }

    return $value
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
        @{ name = "HIBP_MIN_INTERVAL_MS"; value = "$HIBPMinIntervalMs" },
        @{ name = "CORS_ORIGIN"; value = $CorsOrigin },
        @{ name = "SWAGGER_ENABLED"; value = $SwaggerEnabled },
        @{ name = "SWAGGER_PATH"; value = $SwaggerPath },
        @{ name = "LOG_LEVEL"; value = $LogLevel },
        @{ name = "AI_ENDPOINT"; value = $AiEndpoint }
    )

    $taskDefinition = @{
        family                  = $TaskFamily
        networkMode             = "awsvpc"
        requiresCompatibilities  = @("FARGATE")
        cpu                     = "512"
        memory                  = "1024"
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

    $taskDefPath = Join-Path $env:TEMP "$TaskFamily-taskdef.json"
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

    if (Test-ServiceExists) {
        aws ecs update-service `
            --cluster $ClusterName `
            --service $ServiceName `
            --task-definition $TaskDefinitionArn `
            --desired-count $DesiredCount `
            --network-configuration $networkConfiguration `
            --force-new-deployment

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao atualizar o serviço ECS."
        }
    }
    else {
        aws ecs create-service `
            --cluster $ClusterName `
            --service-name $ServiceName `
            --task-definition $TaskDefinitionArn `
            --desired-count $DesiredCount `
            --launch-type FARGATE `
            --network-configuration $networkConfiguration `
            --load-balancers $loadBalancer `
            --health-check-grace-period-seconds 60

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o serviço ECS."
        }
    }

    aws ecs wait services-stable `
        --cluster $ClusterName `
        --services $ServiceName

    if ($LASTEXITCODE -ne 0) {
        throw "O serviço ECS não estabilizou no tempo esperado."
    }
}

function Remove-ServiceAndCluster {
    $serviceStatus = aws ecs describe-services `
        --cluster $ClusterName `
        --services $ServiceName `
        --query "services[0].status" `
        --output text 2>$null

    if ($LASTEXITCODE -eq 0 -and $serviceStatus -and $serviceStatus -ne "None" -and $serviceStatus -ne "INACTIVE") {
        Write-Host "Removendo serviço ECS..."

        aws ecs delete-service `
            --cluster $ClusterName `
            --service $ServiceName `
            --force

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao remover o serviço ECS."
        }
    }
    else {
        Write-Host "Serviço ECS já está inativo ou não existe. Seguindo com a remoção do restante do stack..."
    }

    $taskDefinitions = aws ecs list-task-definitions `
        --family-prefix $TaskFamily `
        --sort DESC `
        --query "taskDefinitionArns" `
        --output text

    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($taskDefinitions)) {
        foreach ($taskDefinitionArn in ($taskDefinitions -split '\s+')) {
            if (-not [string]::IsNullOrWhiteSpace($taskDefinitionArn)) {
                aws ecs deregister-task-definition --task-definition $taskDefinitionArn 1>$null 2>$null
            }
        }
    }

    $stdoutPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".out")
    $stderrPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".err")

    try {
        $lbProcess = Start-Process `
            -FilePath "aws" `
            -ArgumentList @(
                "elbv2", "describe-load-balancers",
                "--names", $LoadBalancerName,
                "--query", "LoadBalancers[0].LoadBalancerArn",
                "--output", "text"
            ) `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath

        $lbStdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
        $lbArn = if ([string]::IsNullOrWhiteSpace($lbStdout)) { "" } else { $lbStdout.Trim() }

        if ($lbProcess.ExitCode -ne 0) {
            $lbArn = ""
        }
    }
    finally {
        Remove-Item $stdoutPath -ErrorAction SilentlyContinue
        Remove-Item $stderrPath -ErrorAction SilentlyContinue
    }

    if ($lbArn -and $lbArn -ne "None") {
        $stdoutPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".out")
        $stderrPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".err")

        try {
            $listenerProcess = Start-Process `
                -FilePath "aws" `
                -ArgumentList @(
                    "elbv2", "describe-listeners",
                    "--load-balancer-arn", $lbArn,
                    "--query", "Listeners[?Port==`"80`"].ListenerArn | [0]",
                    "--output", "text"
                ) `
                -NoNewWindow `
                -Wait `
                -PassThru `
                -RedirectStandardOutput $stdoutPath `
                -RedirectStandardError $stderrPath

            $listenerStdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
            $listenerArn = if ([string]::IsNullOrWhiteSpace($listenerStdout)) { "" } else { $listenerStdout.Trim() }

            if ($listenerProcess.ExitCode -eq 0 -and $listenerArn -and $listenerArn -ne "None") {
                aws elbv2 delete-listener --listener-arn $listenerArn 2>$null
            }
        }
        finally {
            Remove-Item $stdoutPath -ErrorAction SilentlyContinue
            Remove-Item $stderrPath -ErrorAction SilentlyContinue
        }

        aws elbv2 delete-load-balancer --load-balancer-arn $lbArn 2>$null
    }

    $stdoutPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".out")
    $stderrPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".err")

    try {
        $tgProcess = Start-Process `
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

        $tgStdout = if (Test-Path $stdoutPath) { Get-Content -Path $stdoutPath -Raw } else { "" }
        $tgArn = if ([string]::IsNullOrWhiteSpace($tgStdout)) { "" } else { $tgStdout.Trim() }

        if ($tgProcess.ExitCode -ne 0) {
            $tgArn = ""
        }
    }
    finally {
        Remove-Item $stdoutPath -ErrorAction SilentlyContinue
        Remove-Item $stderrPath -ErrorAction SilentlyContinue
    }

    if ($tgArn -and $tgArn -ne "None") {
        aws elbv2 delete-target-group --target-group-arn $tgArn 2>$null
    }

    $vpcId = Get-SubnetVpcId

    function Remove-SecurityGroupIfPresent {
        param(
            [Parameter(Mandatory = $true)]
            [string]$GroupId,

            [Parameter(Mandatory = $true)]
            [string]$GroupLabel
        )

        $stdoutPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".out")
        $stderrPath = Join-Path $env:TEMP ([System.IO.Path]::GetRandomFileName() + ".err")

        try {
            $process = Start-Process `
                -FilePath "aws" `
                -ArgumentList @("ec2", "delete-security-group", "--group-id", $GroupId) `
                -NoNewWindow `
                -Wait `
                -PassThru `
                -RedirectStandardOutput $stdoutPath `
                -RedirectStandardError $stderrPath

            if ($process.ExitCode -ne 0) {
                $stderrText = if (Test-Path $stderrPath) { Get-Content -Path $stderrPath -Raw } else { "" }

                if ($stderrText -match "DependencyViolation|InvalidGroup\.InUse") {
                    Write-Host "$GroupLabel ainda está em uso. Seguindo com a remoção do restante do stack..."
                    return
                }

                throw "Falha ao remover o security group $GroupLabel. Detalhe: $stderrText"
            }
        }
        finally {
            Remove-Item $stdoutPath -ErrorAction SilentlyContinue
            Remove-Item $stderrPath -ErrorAction SilentlyContinue
        }
    }

    $albSgId = aws ec2 describe-security-groups `
        --filters "Name=group-name,Values=$AlbSecurityGroupName" "Name=vpc-id,Values=$vpcId" `
        --query "SecurityGroups[0].GroupId" `
        --output text 2>$null

    if ($albSgId -and $albSgId -ne "None") {
        Remove-SecurityGroupIfPresent -GroupId $albSgId -GroupLabel $AlbSecurityGroupName
    }

    $taskSgId = aws ec2 describe-security-groups `
        --filters "Name=group-name,Values=$TaskSecurityGroupName" "Name=vpc-id,Values=$vpcId" `
        --query "SecurityGroups[0].GroupId" `
        --output text 2>$null

    if ($taskSgId -and $taskSgId -ne "None") {
        Remove-SecurityGroupIfPresent -GroupId $taskSgId -GroupLabel $TaskSecurityGroupName
    }

    if (Test-LogGroupExists) {
        aws logs delete-log-group --log-group-name $LogGroupName 2>$null
    }

    if (Test-ClusterExists) {
        aws ecs delete-cluster --cluster $ClusterName 2>$null
    }

    if (Test-IamRoleExists) {
        aws iam detach-role-policy `
            --role-name $ExecutionRoleName `
            --policy-arn $ExecutionPolicyArn 2>$null

        # A role só pode ser apagada depois de remover as políticas inline
        aws iam delete-role-policy `
            --role-name $ExecutionRoleName `
            --policy-name $ExecutionSsmPolicyName 2>$null

        aws iam delete-role --role-name $ExecutionRoleName 2>$null
    }

    if (Test-IamRoleExists -RoleName $TaskRoleName) {
        $inlinePolicies = aws iam list-role-policies `
            --role-name $TaskRoleName `
            --query "PolicyNames" `
            --output text 2>$null

        foreach ($policyName in @("$inlinePolicies" -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne 'None' })) {
            aws iam delete-role-policy --role-name $TaskRoleName --policy-name $policyName 2>$null
        }

        aws iam delete-role --role-name $TaskRoleName 2>$null
    }

    Write-Host "Stack ECS/ALB removido."
}

function Deploy-EcsFargate {
    if ([string]::IsNullOrWhiteSpace($ImageUri)) {
        throw "Informe -ImageUri com a imagem publicada no ECR."
    }

    $vpcId = Get-SubnetVpcId
    $vpcCidr = Get-VpcCidrBlock -VpcId $vpcId
    $redisHostValue = Get-RedisHostValue
    $containerSecrets = Get-ContainerSecrets

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
            Write-Host "Aviso: ALB público sem allowlist explícita. O acesso ficará aberto para 0.0.0.0/0 e a proteção deve vir de HTTPS, auth e WAF, se aplicável."
        }

        if ([string]::IsNullOrWhiteSpace($AlbHttpsCertificateArn)) {
            Add-IngressRule -GroupId $albSgId -Port 80 -Source $AlbAllowedClientCidr -SourceType cidr
        }
        else {
            Add-IngressRule -GroupId $albSgId -Port 80 -Source $AlbAllowedClientCidr -SourceType cidr
            Add-IngressRule -GroupId $albSgId -Port 443 -Source $AlbAllowedClientCidr -SourceType cidr
        }
    }
    else {
        Add-IngressRule -GroupId $albSgId -Port 80 -Source $vpcCidr -SourceType cidr

        if (-not [string]::IsNullOrWhiteSpace($AlbAllowedClientCidr)) {
            Write-Host "Aviso: ALB interno só será acessível diretamente da internet se seu IP estiver conectado à VPC (VPN/Bastion)."
        }
    }

    Add-IngressRule -GroupId $taskSgId -Port ([int]$AppPort) -Source $albSgId

    if (-not [string]::IsNullOrWhiteSpace($DatabaseSecurityGroupId)) {
        Add-IngressRule -GroupId $DatabaseSecurityGroupId -Port 5432 -Source $taskSgId
    }

    if (-not [string]::IsNullOrWhiteSpace($RedisSecurityGroupId)) {
        Add-IngressRule -GroupId $RedisSecurityGroupId -Port $RedisPort -Source $taskSgId
    }

    $lb = Ensure-LoadBalancer -VpcId $vpcId -AlbSecurityGroupId $albSgId
    [string]$targetGroupArn = Ensure-TargetGroup -VpcId $vpcId

    if ($AlbScheme -eq "internet-facing" -and -not [string]::IsNullOrWhiteSpace($AlbHttpsCertificateArn)) {
        Ensure-Listener `
            -AlbArn $lb.Arn `
            -Port 80 `
            -Protocol "HTTP" `
            -DefaultActions "Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}" | Out-Null

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

    Write-Host "ECS Fargate publicado com sucesso."
    Write-Host "ALB DNS: $($lb.DnsName)"
    if ($AlbScheme -eq "internet-facing" -and -not [string]::IsNullOrWhiteSpace($AlbHttpsCertificateArn)) {
        Write-Host "URL: https://$($lb.DnsName)"
    }
    else {
        Write-Host "URL: http://$($lb.DnsName)"
    }
}

switch ($Action) {
    "Create" { Deploy-EcsFargate }
    "Delete" { Remove-ServiceAndCluster }
}