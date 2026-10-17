# Certificados HTTPS (ACM) da API e do frontend, validados por DNS.
#   API      (host do APP_URL)      -> na região do ALB, grava ALB_HTTPS_CERTIFICATE_ARN no server/.env.production
#   Frontend (host do FRONTEND_URL) -> em us-east-1 (exigência do CloudFront), grava FRONTEND_DOMAIN e
#                                      FRONTEND_CERTIFICATE_ARN no client/.env.production
#
# Uso:
#   .\create-certificates.ps1                  # pede (ou reaproveita) os certificados e mostra os CNAMEs de validação
#   .\create-certificates.ps1 -Action Status   # mostra se já foram emitidos
#
# Cadastre os CNAMEs impressos no DNS do domínio (Registro.br: Domínio > DNS > Editar zona).
# A emissão leva de minutos a algumas horas depois que o DNS propaga.
param(
    [ValidateSet("Request", "Status")]
    [string]$Action = "Request",

    [string]$EnvFile = ".env.production",
    [string]$ClientEnvFile = "..\client\.env.production"
)

. (Join-Path $PSScriptRoot 'aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot

$ClientEnvPath = if ([System.IO.Path]::IsPathRooted($ClientEnvFile)) { $ClientEnvFile } else { Join-Path $PSScriptRoot $ClientEnvFile }

$Certificates = @(
    @{
        Label  = "API"
        Domain = ([Uri](Get-PublicUrlEnv -Name 'APP_URL')).Host
        Region = $aws.Region
        Save   = @{ Path = $aws.EnvFile; Name = 'ALB_HTTPS_CERTIFICATE_ARN' }
    },
    @{
        Label  = "Frontend"
        Domain = ([Uri](Get-PublicUrlEnv -Name 'FRONTEND_URL')).Host
        Region = "us-east-1"
        Save   = @{ Path = $ClientEnvPath; Name = 'FRONTEND_CERTIFICATE_ARN' }
    }
)

function Find-Certificate {
    param([string]$Domain, [string]$Region)

    $arn = aws acm list-certificates `
        --region $Region `
        --certificate-statuses PENDING_VALIDATION ISSUED `
        --query "CertificateSummaryList[?DomainName=='$Domain'].CertificateArn | [0]" `
        --output text

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao listar os certificados do ACM em $Region."
    }
    if ([string]::IsNullOrWhiteSpace($arn) -or "$arn".Trim() -eq 'None') {
        return $null
    }

    return "$arn".Trim()
}

function Get-CertificateInfo {
    param([string]$Arn, [string]$Region)

    # O registro de validação aparece alguns segundos depois do pedido
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        $info = aws acm describe-certificate `
            --certificate-arn $Arn `
            --region $Region `
            --query "Certificate.{Status: Status, Name: DomainValidationOptions[0].ResourceRecord.Name, Value: DomainValidationOptions[0].ResourceRecord.Value}" `
            --output json | ConvertFrom-Json

        if ($info.Name -or $info.Status -eq 'ISSUED') {
            return $info
        }
        Start-Sleep -Seconds 3
    }

    return $info
}

function Request-Certificates {
    foreach ($cert in $Certificates) {
        $arn = Find-Certificate -Domain $cert.Domain -Region $cert.Region
        if ($arn) {
            Write-Host "$($cert.Label): certificado de $($cert.Domain) já existe em $($cert.Region)."
        }
        else {
            $arn = (aws acm request-certificate `
                    --domain-name $cert.Domain `
                    --validation-method DNS `
                    --region $cert.Region `
                    --query CertificateArn `
                    --output text).Trim()

            if ($LASTEXITCODE -ne 0) {
                throw "Falha ao pedir o certificado de $($cert.Domain)."
            }
            Write-Host "$($cert.Label): certificado de $($cert.Domain) pedido em $($cert.Region)."
        }

        $info = Get-CertificateInfo -Arn $arn -Region $cert.Region
        $cert.Arn = $arn
        $cert.Info = $info

        if (Test-Path $cert.Save.Path) {
            Set-DotEnvValue -Path $cert.Save.Path -Name $cert.Save.Name -Value $arn
            if ($cert.Label -eq 'Frontend') {
                Set-DotEnvValue -Path $cert.Save.Path -Name 'FRONTEND_DOMAIN' -Value $cert.Domain
            }
        }
        else {
            Write-Host "  Defina $($cert.Save.Name)=$arn em $($cert.Save.Path)"
        }
    }

    Write-Host ""
    Write-Host "Cadastre no DNS (CNAME, nomes completos; no Registro.br use só a parte antes do domínio):"
    foreach ($cert in $Certificates) {
        if ($cert.Info.Status -eq 'ISSUED') {
            Write-Host "  $($cert.Label): já emitido, nada a cadastrar."
        }
        else {
            Write-Host "  $($cert.Label):"
            Write-Host "    Nome:  $($cert.Info.Name)"
            Write-Host "    Valor: $($cert.Info.Value)"
        }
    }

    Write-Host ""
    Write-Host "Depois confira com: .\create-certificates.ps1 -Action Status"
}

function Show-Status {
    foreach ($cert in $Certificates) {
        $arn = Find-Certificate -Domain $cert.Domain -Region $cert.Region
        if (-not $arn) {
            Write-Host "$($cert.Label) ($($cert.Domain)): não pedido. Rode .\create-certificates.ps1"
            continue
        }

        $info = Get-CertificateInfo -Arn $arn -Region $cert.Region
        Write-Host "$($cert.Label) ($($cert.Domain), $($cert.Region)): $($info.Status) (esperado: ISSUED)"
    }
}

switch ($Action) {
    "Request" { Request-Certificates }
    "Status" { Show-Status }
}
