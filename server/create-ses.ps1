# Amazon SES para os e-mails do SafeID (verificação de conta e alertas de vazamento).
# O domínio é verificado por DNS (Easy DKIM); o DNS continua no Registro.br.
#
# Uso:
#   .\create-ses.ps1                  # cria/atualiza identidade, MAIL FROM, configuration set e suppression list
#   .\create-ses.ps1 -Action Status   # mostra se o domínio já está verificado e se a conta saiu do sandbox
#   .\create-ses.ps1 -Action Delete   # remove a identidade e o configuration set
#
# Depois de criar: cadastre os registros impressos no Registro.br (Domínio → DNS → Editar zona,
# modo avançado) e peça a liberação de produção no console (SES → Account dashboard).
param(
    [ValidateSet("Create", "Status", "Delete")]
    [string]$Action = "Create"
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

. (Join-Path $PSScriptRoot 'aws-common.ps1')
Import-DotEnvFile -Path (Join-Path $PSScriptRoot '.env')

# ===== Configurações =====
$AwsRegion = Get-EnvOrDefault -Name 'AWS_SES_REGION' -Default (Get-EnvOrDefault -Name 'AWS_REGION' -Default 'us-east-1')
$SesDomain = Get-EnvOrDefault -Name 'SES_DOMAIN' -Default 'safeid.app.br'
$MailFromSubdomain = Get-EnvOrDefault -Name 'SES_MAIL_FROM_SUBDOMAIN' -Default 'mail'
$ConfigurationSet = Get-EnvOrDefault -Name 'SES_CONFIGURATION_SET' -Default 'safeid-default'
$MailFromDomain = "$MailFromSubdomain.$SesDomain"

function Test-IdentityExists {
    aws sesv2 get-email-identity --email-identity $SesDomain --region $AwsRegion > $null 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Test-ConfigurationSetExists {
    aws sesv2 get-configuration-set --configuration-set-name $ConfigurationSet --region $AwsRegion > $null 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Ensure-Identity {
    if (Test-IdentityExists) {
        Write-Host "Identidade '$SesDomain' já existe."
        return
    }

    Write-Host "Criando a identidade de domínio '$SesDomain' (Easy DKIM)..."
    aws sesv2 create-email-identity --email-identity $SesDomain --region $AwsRegion > $null
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar a identidade '$SesDomain'."
    }
}

# MAIL FROM no próprio domínio alinha o SPF (sem isso o envelope sai como amazonses.com)
function Ensure-MailFrom {
    aws sesv2 put-email-identity-mail-from-attributes `
        --email-identity $SesDomain `
        --mail-from-domain $MailFromDomain `
        --behavior-on-mx-failure USE_DEFAULT_VALUE `
        --region $AwsRegion

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao configurar o MAIL FROM '$MailFromDomain'."
    }
}

function Ensure-ConfigurationSet {
    if (-not (Test-ConfigurationSetExists)) {
        Write-Host "Criando o configuration set '$ConfigurationSet'..."
        aws sesv2 create-configuration-set `
            --configuration-set-name $ConfigurationSet `
            --reputation-options ReputationMetricsEnabled=true `
            --sending-options SendingEnabled=true `
            --region $AwsRegion

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o configuration set '$ConfigurationSet'."
        }
    }
    else {
        # Reputação ligada alimenta os alarmes de bounce/complaint (create-alerts.ps1)
        aws sesv2 put-configuration-set-reputation-options `
            --configuration-set-name $ConfigurationSet `
            --reputation-metrics-enabled `
            --region $AwsRegion

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao ligar as métricas de reputação do configuration set."
        }
        Write-Host "Configuration set '$ConfigurationSet' já existe (métricas de reputação ligadas)."
    }
}

# Endereços que deram bounce ou reclamação não recebem mais nada (protege a reputação)
function Ensure-SuppressionList {
    aws sesv2 put-account-suppression-attributes `
        --suppressed-reasons BOUNCE COMPLAINT `
        --region $AwsRegion

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao configurar a suppression list da conta."
    }
}

function Get-DkimTokens {
    $tokens = aws sesv2 get-email-identity `
        --email-identity $SesDomain `
        --region $AwsRegion `
        --query "DkimAttributes.Tokens" `
        --output text

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao obter os tokens DKIM de '$SesDomain'."
    }

    return @("$tokens" -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Show-DnsRecords {
    $tokens = Get-DkimTokens
    $records = @()

    foreach ($token in $tokens) {
        $records += [PSCustomObject]@{ Tipo = 'CNAME'; Nome = "$token._domainkey"; Valor = "$token.dkim.amazonses.com" }
    }

    $records += [PSCustomObject]@{ Tipo = 'MX'; Nome = $MailFromSubdomain; Valor = "10 feedback-smtp.$AwsRegion.amazonses.com" }
    $records += [PSCustomObject]@{ Tipo = 'TXT'; Nome = $MailFromSubdomain; Valor = 'v=spf1 include:amazonses.com ~all' }
    $records += [PSCustomObject]@{ Tipo = 'TXT'; Nome = '_dmarc'; Valor = 'v=DMARC1; p=none;' }

    Write-Host ""
    Write-Host "Cadastre no Registro.br (nomes relativos a $SesDomain):"
    $records | Format-Table -AutoSize | Out-String | Write-Host
    Write-Host "O DMARC começa com p=none. Depois de algumas semanas sem problemas, endureça para p=quarantine."
}

function Show-Status {
    $identity = aws sesv2 get-email-identity `
        --email-identity $SesDomain `
        --region $AwsRegion `
        --query "{Verificado: VerifiedForSendingStatus, DKIM: DkimAttributes.Status, MailFrom: MailFromAttributes.MailFromDomainStatus}" `
        --output json | ConvertFrom-Json

    if ($LASTEXITCODE -ne 0) {
        throw "A identidade '$SesDomain' não existe. Rode .\create-ses.ps1 primeiro."
    }

    $account = aws sesv2 get-account `
        --region $AwsRegion `
        --query "{Producao: ProductionAccessEnabled, LimiteDiario: SendQuota.Max24HourSend, PorSegundo: SendQuota.MaxSendRate}" `
        --output json | ConvertFrom-Json

    Write-Host "Domínio $SesDomain"
    Write-Host "  Verificado para envio: $($identity.Verificado)"
    Write-Host "  DKIM:                  $($identity.DKIM) (esperado: SUCCESS)"
    Write-Host "  MAIL FROM:             $($identity.MailFrom) (esperado: SUCCESS)"
    Write-Host "Conta SES ($AwsRegion)"
    Write-Host "  Fora do sandbox:       $($account.Producao)"
    Write-Host "  Limite em 24 h:        $($account.LimiteDiario)"
    Write-Host "  Envios por segundo:    $($account.PorSegundo) (use este valor em SES_MAX_PER_SECOND)"

    if (-not $account.Producao) {
        Write-Host ""
        Write-Host "A conta ainda está no sandbox: só envia para endereços verificados (200/dia, 1/s)."
        Write-Host "Peça a liberação em SES → Account dashboard → Request production access."
    }
}

function Create-Ses {
    Ensure-Identity
    Ensure-MailFrom
    Ensure-ConfigurationSet
    Ensure-SuppressionList
    Show-DnsRecords

    Write-Host ""
    Write-Host "Depois que o DNS propagar (minutos a algumas horas), confira com: .\create-ses.ps1 -Action Status"
}

function Delete-Ses {
    if (Test-ConfigurationSetExists) {
        aws sesv2 delete-configuration-set --configuration-set-name $ConfigurationSet --region $AwsRegion
    }

    if (Test-IdentityExists) {
        aws sesv2 delete-email-identity --email-identity $SesDomain --region $AwsRegion
    }

    Write-Host "Identidade e configuration set removidos. Os registros DNS no Registro.br continuam lá."
}

switch ($Action) {
    "Create" { Create-Ses }
    "Status" { Show-Status }
    "Delete" { Delete-Ses }
}
