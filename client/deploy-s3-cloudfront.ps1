# Build do frontend e publicação no S3 + CloudFront.
#
# Uso:
#   .\deploy-s3-cloudfront.ps1                    # build com o VITE_API_URL de produção, sync e invalidação
#   .\deploy-s3-cloudfront.ps1 -SkipBuild         # publica o dist/ que já existe
#   .\deploy-s3-cloudfront.ps1 -SkipInvalidation  # não limpa o cache do CloudFront
#
# Lê client/.env.production (S3_BUCKET_NAME, CLOUDFRONT_DISTRIBUTION_ID, VITE_API_URL).
# O bucket e a distribuição são criados uma vez com provision-s3-cloudfront.ps1.
param(
    [string]$EnvFile = ".env.production",
    [switch]$SkipBuild,
    [switch]$SkipInvalidation
)

. (Join-Path $PSScriptRoot '..\server\aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot

$S3BucketName = Get-RequiredEnv -Name 'S3_BUCKET_NAME'
$CloudFrontDistributionId = Get-EnvOrDefault -Name 'CLOUDFRONT_DISTRIBUTION_ID' -Default ''
if (Test-PlaceholderValue -Value $CloudFrontDistributionId) {
    $CloudFrontDistributionId = ''
}

# O frontend é servido em HTTPS: uma API em HTTP seria bloqueada pelo navegador (mixed content)
$ApiBaseUrl = Get-PublicUrlEnv -Name 'VITE_API_URL'
if ($ApiBaseUrl -notmatch '^https://') {
    throw "VITE_API_URL precisa usar https:// (está '$ApiBaseUrl'). Configure o certificado no ALB (ALB_HTTPS_CERTIFICATE_ARN)."
}

function Invoke-Build {
    Assert-CommandExists -CommandName 'npm' -Hint 'Instale o Node.js 20.'

    Push-Location $PSScriptRoot
    try {
        if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
            Write-Host "Instalando dependências do frontend..."
            npm ci
            if ($LASTEXITCODE -ne 0) {
                throw "Falha no npm ci do frontend."
            }
        }

        # A variável do processo tem prioridade sobre o .env de desenvolvimento no build do Vite
        $previousApiUrl = $env:VITE_API_URL
        $env:VITE_API_URL = $ApiBaseUrl
        try {
            npm run build
            if ($LASTEXITCODE -ne 0) {
                throw "Falha no build do frontend."
            }
        }
        finally {
            $env:VITE_API_URL = $previousApiUrl
        }
    }
    finally {
        Pop-Location
    }
}

function Sync-Assets {
    $distPath = Join-Path $PSScriptRoot "dist"
    if (-not (Test-Path (Join-Path $distPath 'index.html'))) {
        throw "dist/index.html não encontrado. Rode sem -SkipBuild."
    }

    # Arquivos com hash no nome: cache de 1 ano
    aws s3 sync (Join-Path $distPath "assets") "s3://$S3BucketName/assets" `
        --delete `
        --only-show-errors `
        --cache-control "public,max-age=31536000,immutable"

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao enviar os assets versionados para o S3."
    }

    # index.html e demais arquivos: sempre revalidados, para a versão nova aparecer na hora
    aws s3 sync $distPath "s3://$S3BucketName" `
        --delete `
        --only-show-errors `
        --exclude "assets/*" `
        --cache-control "public,max-age=0,must-revalidate"

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao enviar o restante do build para o S3."
    }
}

function Invalidate-CloudFront {
    if ($SkipInvalidation) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($CloudFrontDistributionId)) {
        Write-Host "CLOUDFRONT_DISTRIBUTION_ID não definido. Pulando a invalidação."
        return
    }

    aws cloudfront create-invalidation `
        --distribution-id $CloudFrontDistributionId `
        --paths "/*" > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar a invalidação do CloudFront."
    }

    Write-Host "Invalidação do CloudFront enviada ($CloudFrontDistributionId)."
}

if (-not $SkipBuild) {
    Write-Host "Gerando o build do frontend (VITE_API_URL=$ApiBaseUrl)..."
    Invoke-Build
}

Write-Host "Enviando para s3://$S3BucketName..."
Sync-Assets
Invalidate-CloudFront

$frontendUrl = Get-EnvOrDefault -Name 'FRONTEND_URL' -Default ''
if ([string]::IsNullOrWhiteSpace($frontendUrl) -and $CloudFrontDistributionId) {
    $domain = Invoke-AwsQuiet -Arguments @('cloudfront', 'get-distribution', '--id', $CloudFrontDistributionId, '--query', 'Distribution.DomainName', '--output', 'text')
    if ($LASTEXITCODE -eq 0 -and $domain) {
        $frontendUrl = "https://$("$domain".Trim())"
    }
}

Write-Host "Frontend publicado. $frontendUrl"
