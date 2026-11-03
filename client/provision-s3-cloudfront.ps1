# Cria (uma vez) o bucket S3 privado e a distribuição CloudFront do frontend.
# Pode rodar de novo: reaproveita o bucket e a distribuição que já existem.
#
# Uso:
#   .\provision-s3-cloudfront.ps1
#
# Lê client/.env.production. Opcional: FRONTEND_DOMAIN + FRONTEND_CERTIFICATE_ARN (certificado
# do ACM em us-east-1, exigência do CloudFront) para servir em um domínio próprio, e
# ROUTE53_HOSTED_ZONE_ID se o DNS estiver no Route 53. VITE_API_URL entra na Content-Security-Policy,
# aplicada pela política de cabeçalhos de segurança. Ao final grava S3_BUCKET_NAME e
# CLOUDFRONT_DISTRIBUTION_ID no próprio arquivo de ambiente, que o deploy-s3-cloudfront.ps1 usa.
param(
    [string]$EnvFile = ".env.production",
    [string]$DistributionComment = "SafeID Frontend"
)

. (Join-Path $PSScriptRoot '..\server\aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot
$EnvPath = $aws.EnvFile

$DomainName = Get-EnvOrDefault -Name 'FRONTEND_DOMAIN' -Default ''
$CertificateArn = Get-EnvOrDefault -Name 'FRONTEND_CERTIFICATE_ARN' -Default ''
$HostedZoneId = Get-EnvOrDefault -Name 'ROUTE53_HOSTED_ZONE_ID' -Default ''
foreach ($name in @('DomainName', 'CertificateArn', 'HostedZoneId')) {
    if (Test-PlaceholderValue -Value (Get-Variable -Name $name -ValueOnly)) {
        Set-Variable -Name $name -Value ''
    }
}

$ApiOrigin = ([Uri](Get-PublicUrlEnv -Name 'VITE_API_URL')).GetLeftPart([UriPartial]::Authority)

# Zona fixa da AWS para aliases que apontam para o CloudFront
$CloudFrontHostedZoneId = "Z2FDTNDATAQYW2"

$S3BucketName = Get-EnvOrDefault -Name 'S3_BUCKET_NAME' -Default ''
if ([string]::IsNullOrWhiteSpace($S3BucketName) -or (Test-PlaceholderValue -Value $S3BucketName)) {
    # Nome de bucket é global na AWS: o sufixo aleatório evita colisão com outras contas
    $S3BucketName = "safeid-frontend-$([guid]::NewGuid().ToString().Substring(0, 8))"
    Write-Host "S3_BUCKET_NAME não definido. Usando: $S3BucketName"
}

function Ensure-S3Bucket {
    $null = Invoke-AwsQuiet -Arguments @('s3api', 'head-bucket', '--bucket', $S3BucketName)
    if ($LASTEXITCODE -ne 0) {
        $createArgs = @("s3api", "create-bucket", "--bucket", $S3BucketName)
        if ($aws.Region -ne "us-east-1") {
            $createArgs += @("--create-bucket-configuration", "LocationConstraint=$($aws.Region)")
        }

        & aws @createArgs > $null
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o bucket S3 '$S3BucketName'."
        }
        Write-Host "Bucket S3 criado: $S3BucketName"
    }

    # O bucket é privado: só o CloudFront lê, pelo Origin Access Control
    aws s3api put-public-access-block `
        --bucket $S3BucketName `
        --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao bloquear o acesso público do bucket."
    }

    aws s3api put-bucket-versioning `
        --bucket $S3BucketName `
        --versioning-configuration Status=Enabled
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao ligar o versionamento do bucket."
    }

    $encryptionConfig = @{
        Rules = @(
            @{ ApplyServerSideEncryptionByDefault = @{ SSEAlgorithm = "AES256" } }
        )
    }

    aws s3api put-bucket-encryption `
        --bucket $S3BucketName `
        --server-side-encryption-configuration (Write-TempJson -Name "$S3BucketName-encryption.json" -InputObject $encryptionConfig)
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao configurar a criptografia do bucket S3."
    }

    Write-Host "Bucket S3 pronto: $S3BucketName"
}

function Get-OrCreateOriginAccessControl {
    $name = "$S3BucketName-oac"
    $existing = aws cloudfront list-origin-access-controls `
        --query "OriginAccessControlList.Items[?Name=='$name'].Id | [0]" `
        --output text

    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existing) -and $existing -ne "None") {
        return $existing.Trim()
    }

    $oacConfig = @{
        Name                          = $name
        Description                   = "OAC for SafeID frontend"
        SigningProtocol               = "sigv4"
        SigningBehavior               = "always"
        OriginAccessControlOriginType = "s3"
    }

    $oacId = aws cloudfront create-origin-access-control `
        --origin-access-control-config (Write-TempJson -Name "$name.json" -InputObject $oacConfig) `
        --query "OriginAccessControl.Id" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($oacId) -or $oacId -eq "None") {
        throw "Falha ao criar o Origin Access Control."
    }

    return $oacId.Trim()
}

function New-DistributionConfig {
    param(
        [Parameter(Mandatory = $true)][string]$OacId
    )

    $distributionConfig = @{
        CallerReference      = "safeid-frontend-$([DateTime]::UtcNow.Ticks)"
        Comment              = $DistributionComment
        Enabled              = $true
        IsIPV6Enabled        = $true
        DefaultRootObject    = "index.html"
        Origins              = @{
            Quantity = 1
            Items    = @(
                @{
                    Id                    = "safeid-s3-origin"
                    DomainName            = "$S3BucketName.s3.$($aws.Region).amazonaws.com"
                    OriginAccessControlId = $OacId
                    S3OriginConfig        = @{ OriginAccessIdentity = "" }
                }
            )
        }
        DefaultCacheBehavior = @{
            TargetOriginId       = "safeid-s3-origin"
            ViewerProtocolPolicy = "redirect-to-https"
            AllowedMethods       = @{
                Quantity      = 2
                Items         = @("GET", "HEAD")
                CachedMethods = @{ Quantity = 2; Items = @("GET", "HEAD") }
            }
            Compress             = $true
            ForwardedValues      = @{
                QueryString = $false
                Cookies     = @{ Forward = "none" }
            }
            MinTTL               = 0
            DefaultTTL           = 86400
            MaxTTL               = 31536000
        }
        # SPA: rotas do React que não existem no bucket voltam o index.html
        CustomErrorResponses = @{
            Quantity = 2
            Items    = @(
                @{ ErrorCode = 403; ResponseCode = "200"; ResponsePagePath = "/index.html"; ErrorCachingMinTTL = 0 },
                @{ ErrorCode = 404; ResponseCode = "200"; ResponsePagePath = "/index.html"; ErrorCachingMinTTL = 0 }
            )
        }
        PriceClass           = "PriceClass_100"
        ViewerCertificate    = @{
            CloudFrontDefaultCertificate = $true
            MinimumProtocolVersion       = "TLSv1.2_2021"
        }
        Restrictions         = @{
            GeoRestriction = @{ RestrictionType = "none"; Quantity = 0 }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($DomainName)) {
        if ([string]::IsNullOrWhiteSpace($CertificateArn)) {
            throw "Defina FRONTEND_CERTIFICATE_ARN (ACM em us-east-1) para usar FRONTEND_DOMAIN."
        }

        $distributionConfig.Aliases = @{ Quantity = 1; Items = @($DomainName) }
        $distributionConfig.ViewerCertificate = @{
            ACMCertificateArn      = $CertificateArn
            SSLSupportMethod       = "sni-only"
            MinimumProtocolVersion = "TLSv1.2_2021"
        }
    }

    return $distributionConfig
}

function Get-ExistingDistributionId {
    $configured = Get-EnvOrDefault -Name 'CLOUDFRONT_DISTRIBUTION_ID' -Default ''
    if (-not [string]::IsNullOrWhiteSpace($configured) -and -not (Test-PlaceholderValue -Value $configured)) {
        $null = Invoke-AwsQuiet -Arguments @('cloudfront', 'get-distribution', '--id', $configured)
        if ($LASTEXITCODE -eq 0) {
            return $configured
        }
        Write-Host "A distribuição $configured do arquivo de ambiente não existe mais. Procurando pelo comentário..."
    }

    # Sem isso, cada execução criaria uma distribuição nova
    $byComment = aws cloudfront list-distributions `
        --query "DistributionList.Items[?Comment=='$DistributionComment'].Id | [0]" `
        --output text

    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($byComment) -and $byComment -ne "None") {
        return $byComment.Trim()
    }

    return ""
}

function New-CloudFrontDistribution {
    param(
        [Parameter(Mandatory = $true)][string]$OacId
    )

    $config = New-DistributionConfig -OacId $OacId

    $distributionId = aws cloudfront create-distribution `
        --distribution-config (Write-TempJson -Name "safeid-frontend-distribution.json" -InputObject $config) `
        --query "Distribution.Id" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($distributionId) -or $distributionId -eq "None") {
        throw "Falha ao criar a distribuição CloudFront."
    }

    return $distributionId.Trim()
}

function Get-OrUpdateResponseHeadersPolicy {
    $name = "safeid-frontend-security-headers"

    # Só o que o front usa de fora: a API e os logos da HIBP. O Tailwind e o React pedem estilo inline
    $contentSecurityPolicy = @(
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://logos.haveibeenpwned.com",
        "font-src 'self'",
        "connect-src 'self' $ApiOrigin",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
    ) -join '; '

    $policyConfig = @{
        Name                  = $name
        Comment               = "Cabecalhos de seguranca do frontend do SafeID"
        SecurityHeadersConfig = @{
            StrictTransportSecurity = @{ Override = $true; AccessControlMaxAgeSec = 31536000; IncludeSubdomains = $true; Preload = $false }
            ContentTypeOptions      = @{ Override = $true }
            FrameOptions            = @{ Override = $true; FrameOption = "DENY" }
            ReferrerPolicy          = @{ Override = $true; ReferrerPolicy = "strict-origin-when-cross-origin" }
            ContentSecurityPolicy   = @{ Override = $true; ContentSecurityPolicy = $contentSecurityPolicy }
        }
        CustomHeadersConfig   = @{
            Quantity = 1
            Items    = @(
                @{ Header = "Permissions-Policy"; Value = "camera=(), microphone=(), geolocation=()"; Override = $true }
            )
        }
    }
    $configFile = Write-TempJson -Name "$name.json" -InputObject $policyConfig

    $existing = aws cloudfront list-response-headers-policies --type custom `
        --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='$name'].ResponseHeadersPolicy.Id | [0]" `
        --output text
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao listar as políticas de cabeçalhos do CloudFront."
    }

    if (-not [string]::IsNullOrWhiteSpace($existing) -and $existing -ne "None") {
        $policyId = $existing.Trim()
        $etag = aws cloudfront get-response-headers-policy-config --id $policyId --query "ETag" --output text
        aws cloudfront update-response-headers-policy --id $policyId --if-match $etag.Trim() --response-headers-policy-config $configFile > $null
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao atualizar a política de cabeçalhos do CloudFront."
        }
        return $policyId
    }

    $policyId = aws cloudfront create-response-headers-policy `
        --response-headers-policy-config $configFile `
        --query "ResponseHeadersPolicy.Id" `
        --output text
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($policyId) -or $policyId -eq "None") {
        throw "Falha ao criar a política de cabeçalhos do CloudFront."
    }

    return $policyId.Trim()
}

function Set-DistributionResponseHeadersPolicy {
    param(
        [Parameter(Mandatory = $true)][string]$DistributionId,
        [Parameter(Mandatory = $true)][string]$PolicyId
    )

    $current = (aws cloudfront get-distribution-config --id $DistributionId --output json) -join "`n" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $current) {
        throw "Falha ao ler a configuração da distribuição $DistributionId."
    }

    $behavior = $current.DistributionConfig.DefaultCacheBehavior
    if ($behavior.ResponseHeadersPolicyId -eq $PolicyId) {
        return
    }

    $behavior | Add-Member -NotePropertyName 'ResponseHeadersPolicyId' -NotePropertyValue $PolicyId -Force
    aws cloudfront update-distribution --id $DistributionId --if-match $current.ETag `
        --distribution-config (Write-TempJson -Name "safeid-frontend-distribution-update.json" -InputObject $current.DistributionConfig -Depth 30) > $null
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao aplicar os cabeçalhos de segurança na distribuição $DistributionId."
    }
}

function Update-BucketPolicy {
    param(
        [Parameter(Mandatory = $true)][string]$DistributionId
    )

    $policy = @{
        Version   = "2012-10-17"
        Statement = @(
            @{
                Sid       = "AllowCloudFrontServiceReadOnly"
                Effect    = "Allow"
                Principal = @{ Service = "cloudfront.amazonaws.com" }
                Action    = @("s3:GetObject")
                Resource  = "arn:aws:s3:::$S3BucketName/*"
                Condition = @{
                    StringEquals = @{
                        "AWS:SourceArn" = "arn:aws:cloudfront::$($aws.AccountId):distribution/$DistributionId"
                    }
                }
            }
        )
    }

    aws s3api put-bucket-policy `
        --bucket $S3BucketName `
        --policy (Write-TempJson -Name "safeid-frontend-bucket-policy.json" -InputObject $policy -Depth 10)

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao aplicar a bucket policy para o CloudFront."
    }
}

function Add-Route53Alias {
    param(
        [Parameter(Mandatory = $true)][string]$DistributionDomainName
    )

    $changes = foreach ($recordType in @("A", "AAAA")) {
        @{
            Action            = "UPSERT"
            ResourceRecordSet = @{
                Name        = $DomainName
                Type        = $recordType
                AliasTarget = @{
                    HostedZoneId         = $CloudFrontHostedZoneId
                    DNSName              = $DistributionDomainName
                    EvaluateTargetHealth = $false
                }
            }
        }
    }

    aws route53 change-resource-record-sets `
        --hosted-zone-id $HostedZoneId `
        --change-batch (Write-TempJson -Name "safeid-frontend-route53.json" -InputObject @{ Comment = "SafeID frontend alias"; Changes = @($changes) }) > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar os registros no Route 53."
    }
}

Ensure-S3Bucket
$oacId = Get-OrCreateOriginAccessControl

$distributionId = Get-ExistingDistributionId
if ([string]::IsNullOrWhiteSpace($distributionId)) {
    Write-Host "Criando a distribuição CloudFront (leva alguns minutos para propagar)..."
    $distributionId = New-CloudFrontDistribution -OacId $oacId
}
else {
    Write-Host "Distribuição CloudFront já existe: $distributionId"
}

Update-BucketPolicy -DistributionId $distributionId

$responseHeadersPolicyId = Get-OrUpdateResponseHeadersPolicy
Set-DistributionResponseHeadersPolicy -DistributionId $distributionId -PolicyId $responseHeadersPolicyId
Write-Host "Cabeçalhos de segurança aplicados: $responseHeadersPolicyId"

$distributionDomainName = (aws cloudfront get-distribution `
        --id $distributionId `
        --query "Distribution.DomainName" `
        --output text).Trim()

if (-not [string]::IsNullOrWhiteSpace($DomainName)) {
    if (-not [string]::IsNullOrWhiteSpace($HostedZoneId)) {
        Add-Route53Alias -DistributionDomainName $distributionDomainName
        Write-Host "Route 53: $DomainName -> $distributionDomainName"
    }
    else {
        Write-Host "Cadastre no DNS do domínio (ex.: Registro.br): CNAME $DomainName -> $distributionDomainName"
    }
}

Set-DotEnvValue -Path $EnvPath -Name 'S3_BUCKET_NAME' -Value $S3BucketName
Set-DotEnvValue -Path $EnvPath -Name 'CLOUDFRONT_DISTRIBUTION_ID' -Value $distributionId

Write-Host ""
Write-Host "=== Provisionamento concluído ==="
Write-Host "S3 bucket:     $S3BucketName"
Write-Host "Distribuição:  $distributionId"
Write-Host "Domínio:       https://$distributionDomainName"
Write-Host "Gravados em:   $EnvPath (S3_BUCKET_NAME e CLOUDFRONT_DISTRIBUTION_ID)"
Write-Host "Próximo passo: .\deploy-s3-cloudfront.ps1"
