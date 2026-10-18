# Envia os segredos de produção para o SSM Parameter Store (SecureString, tier standard).
# O deploy-ecs-fargate.ps1 referencia esses parâmetros e o ECS os injeta na task:
# nenhum segredo fica em texto na task definition.
#
# Uso:
#   .\put-ssm-secrets.ps1                          # lê o server/.env.production
#   .\put-ssm-secrets.ps1 -EnvFile outro.env       # lê outro arquivo
#   .\put-ssm-secrets.ps1 -DryRun                  # só valida e mostra o que seria enviado (sem valores)
#
# Os valores nunca são impressos.
param(
    [string]$EnvFile = ".env.production",
    [switch]$DryRun
)

. (Join-Path $PSScriptRoot 'aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot
$SsmPrefix = Get-SsmPrefix

function Get-SecretValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    # Montada a partir do RDS e com os limites do pool do Prisma (I.6)
    if ($Name -eq 'DATABASE_URL') {
        return Get-ProductionDatabaseUrl
    }

    return [Environment]::GetEnvironmentVariable($Name, 'Process')
}

# Mesma regra do normalizeKey (src/shared/crypto/aes-256-gcm.ts): a chave precisa virar
# exatamente 32 bytes, em hex (64 caracteres), base64 (44) ou texto (32). Outra coisa faz todo scan falhar.
function Test-Aes256Key {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ($Value -match '^[0-9a-fA-F]{64}$') {
        return $true
    }
    if ([System.Text.Encoding]::UTF8.GetByteCount($Value) -eq 32) {
        return $true
    }
    if ($Value.Length % 4 -eq 0) {
        try {
            return ([Convert]::FromBase64String($Value).Length -eq 32)
        }
        catch {
            return $false
        }
    }

    return $false
}

$toSend = @()
$skipped = @()

foreach ($name in @($SsmRequiredSecrets + $SsmOptionalSecrets)) {
    $isRequired = $SsmRequiredSecrets -contains $name
    $value = Get-SecretValue -Name $name

    # Opcional vazio ou com o valor de exemplo: não vai para o SSM
    if ([string]::IsNullOrWhiteSpace($value) -or (Test-PlaceholderValue -Value $value)) {
        if ($isRequired) {
            throw "Segredo obrigatório vazio ou com o valor de exemplo: $name. Gere um com: openssl rand -base64 48"
        }
        $skipped += $name
        continue
    }

    $value = $value.Trim()

    if (Test-LocalOnlyValue -Value $value) {
        throw "$name aponta para um endereço local. Use os valores de produção em $(Get-EnvFileLabel)."
    }

    if ($SsmSecretMinLength.ContainsKey($name) -and $value.Length -lt $SsmSecretMinLength[$name]) {
        throw "$name precisa ter pelo menos $($SsmSecretMinLength[$name]) caracteres. Gere um com: openssl rand -base64 48"
    }

    if ($name -eq 'ENCRYPTION_KEY' -and -not (Test-Aes256Key -Value $value)) {
        throw "ENCRYPTION_KEY precisa ter exatamente 32 bytes. Gere com: openssl rand -base64 32"
    }

    # O PowerShell 5.1 corta aspas em argumentos de executáveis: o valor chegaria errado ao SSM
    if ($value.Contains('"')) {
        throw "$name contém aspas duplas, que o PowerShell não repassa corretamente ao AWS CLI. Gere um valor sem aspas."
    }

    $toSend += @{ Name = $name; Value = $value }
}

# Com o mesmo segredo, o refresh token funcionaria como access token
if ((Get-SecretValue -Name 'JWT_SECRET') -eq (Get-SecretValue -Name 'REFRESH_TOKEN_SECRET')) {
    throw "REFRESH_TOKEN_SECRET precisa ser diferente de JWT_SECRET."
}

Write-Host "Segredos em $SsmPrefix (região $($aws.Region)):"

foreach ($secret in $toSend) {
    $parameterName = "$SsmPrefix/$($secret.Name)"

    if ($DryRun) {
        Write-Host "  [dry-run] $parameterName"
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

    Write-Host "  ok: $parameterName"
}

foreach ($name in $skipped) {
    Write-Host "  pulado (opcional, vazio ou valor de exemplo): $SsmPrefix/$name"
}

if (-not $DryRun) {
    Write-Host "Segredos gravados. O próximo deploy-ecs-fargate.ps1 passa a usá-los."
}
