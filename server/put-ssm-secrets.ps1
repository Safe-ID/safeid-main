# Envia os segredos de produção para o SSM Parameter Store (SecureString, tier standard).
# O deploy-ecs-fargate.ps1 referencia esses parâmetros e o ECS os injeta na task:
# nenhum segredo fica em texto na task definition.
#
# Uso:
#   .\put-ssm-secrets.ps1                       # lê o server/.env
#   .\put-ssm-secrets.ps1 -EnvFile .env.prod    # lê outro arquivo
#   .\put-ssm-secrets.ps1 -DryRun               # só mostra o que seria enviado (sem valores)
#
# Os valores nunca são impressos.
param(
    [string]$EnvFile = ".env",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

. (Join-Path $PSScriptRoot 'aws-common.ps1')

$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $PSScriptRoot $EnvFile }
if (-not (Test-Path $envPath)) {
    throw "Arquivo de ambiente não encontrado: $envPath"
}
Import-DotEnvFile -Path $envPath

# O prefixo pode vir do arquivo de ambiente
$SsmPrefix = (Get-EnvOrDefault -Name 'SSM_PREFIX' -Default '/safeid/prod').TrimEnd('/')

function Get-SecretValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    # Montada a partir do RDS_ENDPOINT e com os limites do pool do Prisma (I.6)
    if ($Name -eq 'DATABASE_URL') {
        return Get-ProductionDatabaseUrl
    }

    return [Environment]::GetEnvironmentVariable($Name, 'Process')
}

function Test-PlaceholderValue {
    param(
        [AllowEmptyString()]
        [string]$Value
    )

    return ($Value -match '(?i)(your_.*_here|change_me|changeme|^test-key$)')
}

$toSend = @()
$skipped = @()

foreach ($name in @($SsmRequiredSecrets + $SsmOptionalSecrets)) {
    $isRequired = $SsmRequiredSecrets -contains $name
    $value = Get-SecretValue -Name $name

    # Opcional vazio ou com o valor de exemplo: não vai para o SSM
    if ([string]::IsNullOrWhiteSpace($value) -or (Test-PlaceholderValue -Value $value)) {
        if ($isRequired) {
            throw "Segredo obrigatório vazio ou com o valor de exemplo do .env.example: $name."
        }
        $skipped += $name
        continue
    }

    if (Test-LocalOnlyValue -Value $value) {
        throw "$name aponta para um endereço local. Use os valores de produção (ex.: -EnvFile .env.prod)."
    }

    $toSend += @{ Name = $name; Value = $value.Trim() }
}

foreach ($secret in $toSend) {
    $parameterName = "$SsmPrefix/$($secret.Name)"

    if ($DryRun) {
        Write-Host "[dry-run] $parameterName"
        continue
    }

    aws ssm put-parameter `
        --name $parameterName `
        --type SecureString `
        --tier Standard `
        --overwrite `
        --value $secret.Value > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao gravar $parameterName no SSM."
    }

    Write-Host "ok: $parameterName"
}

foreach ($name in $skipped) {
    Write-Host "pulado (opcional, vazio ou valor de exemplo): $SsmPrefix/$name"
}

if (-not $DryRun) {
    Write-Host ""
    Write-Host "Segredos gravados. Rode o deploy-ecs-fargate.ps1 para a task passar a usá-los."
}
