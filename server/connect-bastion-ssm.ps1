# Túnel do SSM Session Manager pelo bastion até o ALB, o RDS ou o Redis.
# Precisa do plugin do Session Manager: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#
# Uso:
#   .\connect-bastion-ssm.ps1 -Target Rds     # PostgreSQL em localhost:5432
#   .\connect-bastion-ssm.ps1 -Target Redis   # Redis em localhost:6379
#   .\connect-bastion-ssm.ps1 -Target Alb     # ALB em localhost:8080
param(
    [ValidateSet("Alb", "Rds", "Redis", "Custom")]
    [string]$Target = "Alb",

    [string]$RemoteHost,

    [int]$RemotePort,

    [int]$LocalPort,

    [string]$InstanceId,

    [string]$EnvFile = ".env.production"
)

. (Join-Path $PSScriptRoot 'aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot

$ClusterName = if ($env:ECS_CLUSTER_NAME) { $env:ECS_CLUSTER_NAME } else { "safeid-cluster" }
$BastionInstanceName = if ($env:BASTION_INSTANCE_NAME) { $env:BASTION_INSTANCE_NAME } else { "safeid-bastion" }

function Get-BastionInstanceId {
    if (-not [string]::IsNullOrWhiteSpace($InstanceId)) {
        return $InstanceId
    }

    $resolvedInstanceId = aws ec2 describe-instances `
        --filters "Name=tag:Name,Values=$BastionInstanceName" "Name=instance-state-name,Values=pending,running,stopping,stopped" `
        --query "Reservations[0].Instances[0].InstanceId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resolvedInstanceId) -or $resolvedInstanceId -eq "None") {
        throw "Não encontrei a instância bastion. Rode primeiro .\create-bastion-ssm.ps1 -Action Create."
    }

    return $resolvedInstanceId.Trim()
}

function Resolve-Target {
    switch ($Target) {
        "Alb" {
            $remoteHost = $RemoteHost
            if ([string]::IsNullOrWhiteSpace($remoteHost) -and -not [string]::IsNullOrWhiteSpace($env:ALB_DNS_NAME)) {
                $remoteHost = $env:ALB_DNS_NAME
            }

            if ([string]::IsNullOrWhiteSpace($remoteHost)) {
                $remoteHost = Invoke-AwsQuiet -Arguments @(
                    'elbv2', 'describe-load-balancers',
                    '--names', "$ClusterName-alb",
                    '--query', 'LoadBalancers[0].DNSName',
                    '--output', 'text'
                )

                if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteHost) -or $remoteHost -eq "None") {
                    throw "Não consegui localizar o ALB interno do backend."
                }
            }

            return @{
                Host = $remoteHost.Trim()
                Port = if ($RemotePort) { $RemotePort } else { 80 }
                LocalPort = if ($LocalPort) { $LocalPort } else { 8080 }
            }
        }

        "Rds" {
            $remoteHost = if ($RemoteHost) { $RemoteHost } else { Get-RdsEndpoint }

            return @{
                Host = $remoteHost.Trim()
                Port = if ($RemotePort) { $RemotePort } else { 5432 }
                LocalPort = if ($LocalPort) { $LocalPort } else { 5432 }
            }
        }

        "Redis" {
            $remoteHost = if ($RemoteHost) { $RemoteHost } else { Get-RedisEndpoint }

            return @{
                Host = $remoteHost.Trim()
                Port = if ($RemotePort) { $RemotePort } else { 6379 }
                LocalPort = if ($LocalPort) { $LocalPort } else { 6379 }
            }
        }

        default {
            if ([string]::IsNullOrWhiteSpace($RemoteHost)) {
                throw "Passe -RemoteHost ao usar Target=Custom."
            }

            return @{
                Host = $RemoteHost.Trim()
                Port = if ($RemotePort) { $RemotePort } else { 80 }
                LocalPort = if ($LocalPort) { $LocalPort } else { 8080 }
            }
        }
    }
}

$instanceId = Get-BastionInstanceId
$targetInfo = Resolve-Target

$parameters = "host=$($targetInfo.Host),portNumber=$($targetInfo.Port),localPortNumber=$($targetInfo.LocalPort)"

Write-Host "Abrindo túnel SSM via bastion $instanceId para $($targetInfo.Host):$($targetInfo.Port) em localhost:$($targetInfo.LocalPort)..."

$awsArgs = @(
    "ssm", "start-session",
    "--target", $instanceId,
    "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
    "--parameters", $parameters
)

$process = Start-Process `
    -FilePath "aws" `
    -ArgumentList $awsArgs `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($process.ExitCode -ne 0) {
    throw "Falha ao iniciar o túnel SSM. ExitCode: $($process.ExitCode)"
}