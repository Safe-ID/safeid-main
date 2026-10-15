# Funções compartilhadas pelos scripts AWS do SafeID.
# Uso: . (Join-Path $PSScriptRoot 'aws-common.ps1')
#
# Os scripts são versionados: IDs de VPC/subnet/security group, senhas e e-mails
# vêm do .env (fora do git), nunca de valores fixos no código.

function Import-DotEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content $Path | ForEach-Object {
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

function Get-RequiredEnv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Defina $Name no server/.env (veja a seção 'Scripts AWS' do .env.example)."
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
        throw "Defina ao menos um valor em $Name no server/.env."
    }

    return $items
}

function Get-AwsAccountId {
    $accountId = aws sts get-caller-identity --query "Account" --output text
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accountId)) {
        throw "Falha ao obter o ID da conta AWS (aws sts get-caller-identity)."
    }

    return $accountId.Trim()
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

# DATABASE_URL de produção: montada a partir do RDS_ENDPOINT, nunca a DATABASE_URL
# do .env, que aponta para o banco local de desenvolvimento
function Get-ProductionDatabaseUrl {
    $rdsEndpoint = Get-RequiredEnv -Name 'RDS_ENDPOINT'
    $dbUser = Get-EnvOrDefault -Name 'DB_USER' -Default 'safeid_user'
    $dbPassword = Get-RequiredEnv -Name 'DB_PASSWORD'
    $dbName = Get-EnvOrDefault -Name 'DB_NAME' -Default 'safeid_db'

    $encodedUser = [System.Uri]::EscapeDataString($dbUser)
    $encodedPassword = [System.Uri]::EscapeDataString($dbPassword)

    return Add-PrismaPoolParams -DatabaseUrl "postgresql://$encodedUser`:$encodedPassword@$rdsEndpoint`:5432/$dbName?schema=public"
}

function Test-LocalOnlyValue {
    param(
        [AllowEmptyString()]
        [string]$Value
    )

    return ($Value -match '(?i)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)')
}

# ===== Segredos no SSM Parameter Store (I.4) =====
# SecureString em /safeid/prod/<NOME>. O ECS injeta cada um como variável de ambiente.
$SsmPrefix = (Get-EnvOrDefault -Name 'SSM_PREFIX' -Default '/safeid/prod').TrimEnd('/')

# Sem estes a aplicação não sobe em produção
$SsmRequiredSecrets = @(
    'DATABASE_URL',
    'JWT_SECRET',
    'REFRESH_TOKEN_SECRET',
    'SESSION_SECRET',
    'HIBP_API_KEY'
)

# Enviados só quando existem (ex.: os do monitoramento entram com a feature)
$SsmOptionalSecrets = @(
    'AI_API_KEY',
    'GOOGLE_CLIENT_SECRET',
    'MONITORING_UNSUBSCRIBE_SECRET',
    'ADMIN_TOKEN'
)
