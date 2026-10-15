param(
    [ValidateSet("Alb", "Rds", "Redis", "Custom")]
    [string]$Target = "Alb",

    [string]$RemoteHost,

    [int]$RemotePort,

    [int]$LocalPort,

    [string]$InstanceId
)

$ErrorActionPreference = "Stop"


. (Join-Path $PSScriptRoot 'aws-common.ps1')
Import-DotEnvFile -Path (Join-Path $PSScriptRoot '.env')

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
                $remoteHost = aws elbv2 describe-load-balancers `
                    --names "$ClusterName-alb" `
                    --query "LoadBalancers[0].DNSName" `
                    --output text 2>$null

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
            $remoteHost = if ($RemoteHost) { $RemoteHost } elseif ($env:RDS_ENDPOINT) { $env:RDS_ENDPOINT } else { "" }

            if ([string]::IsNullOrWhiteSpace($remoteHost)) {
                throw "Defina RDS_ENDPOINT no .env ou passe -RemoteHost."
            }

            return @{
                Host = $remoteHost.Trim()
                Port = if ($RemotePort) { $RemotePort } else { 5432 }
                LocalPort = if ($LocalPort) { $LocalPort } else { 5432 }
            }
        }

        "Redis" {
            $remoteHost = if ($RemoteHost) { $RemoteHost } elseif ($env:REDIS_HOST) { $env:REDIS_HOST } else { "" }

            if ([string]::IsNullOrWhiteSpace($remoteHost)) {
                throw "Defina REDIS_HOST no .env ou passe -RemoteHost."
            }

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