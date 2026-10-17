# Deploy de produção do SafeID em um comando: segredos, imagem, backend e frontend.
#
# Pré-requisitos: AWS CLI v2 com login feito (aws configure ou aws sso login), Docker Desktop
# aberto, Node.js 20, e os arquivos server/.env.production e client/.env.production preenchidos
# (modelos em .env.production.example). A infraestrutura base (RDS, Redis, NAT, SES, CloudFront)
# é criada uma vez pelos scripts de provisionamento: veja docs/Backend/DEPLOY_PRODUCAO.md.
#
# Uso:
#   .\deploy.ps1                 # publica o commit atual (backend + frontend)
#   .\deploy.ps1 -DryRun         # só confere a configuração e o login, sem mudar nada
#   .\deploy.ps1 -SkipFrontend   # só o backend
#   .\deploy.ps1 -SkipBackend    # só o frontend
#   .\deploy.ps1 -Snapshot       # snapshot do banco antes (recomendado quando há migration nova)
#   .\deploy.ps1 -AllowDirty     # permite publicar com alterações não commitadas
param(
    [switch]$DryRun,
    [switch]$SkipBackend,
    [switch]$SkipFrontend,
    [switch]$Snapshot,
    [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
$ServerDir = Join-Path $RepoRoot 'server'
$ClientDir = Join-Path $RepoRoot 'client'
$ServerEnv = Join-Path $ServerDir '.env.production'
$ClientEnv = Join-Path $ClientDir '.env.production'

. (Join-Path $ServerDir 'aws-common.ps1')

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

$startedAt = Get-Date

# ===== 1. Conferências antes de mexer em qualquer coisa =====
Write-Step "Conferindo pré-requisitos"

Assert-CommandExists -CommandName 'git'
if (-not $SkipBackend) {
    Assert-CommandExists -CommandName 'docker' -Hint 'Instale o Docker Desktop.'
    $null = Invoke-Quiet -FilePath 'docker' -Arguments @('info')
    if ($LASTEXITCODE -ne 0) {
        if (-not $DryRun) {
            throw "O Docker não está rodando. Abra o Docker Desktop e rode de novo."
        }
        Write-Host "Aviso: o Docker não está rodando; abra o Docker Desktop antes do deploy de verdade." -ForegroundColor Yellow
    }
}
if (-not $SkipFrontend) {
    Assert-CommandExists -CommandName 'npm' -Hint 'Instale o Node.js 20.'
}

# Publica sempre um commit identificável: a tag da imagem é o hash do commit
$dirty = Invoke-Quiet -FilePath 'git' -Arguments @('-C', $RepoRoot, 'status', '--porcelain', '--untracked-files=no')
if (-not [string]::IsNullOrWhiteSpace(($dirty -join '')) -and -not $AllowDirty) {
    throw "Há alterações não commitadas. Faça o commit (ou rode com -AllowDirty para publicar mesmo assim)."
}

$branch = (Invoke-Quiet -FilePath 'git' -Arguments @('-C', $RepoRoot, 'rev-parse', '--abbrev-ref', 'HEAD') | Out-String).Trim()
if ($branch -ne 'main') {
    Write-Host "Aviso: publicando a branch '$branch', não a main." -ForegroundColor Yellow
}

$null = Invoke-Quiet -FilePath 'git' -Arguments @('-C', $RepoRoot, 'fetch', '--quiet', 'origin', 'main')
$behind = (Invoke-Quiet -FilePath 'git' -Arguments @('-C', $RepoRoot, 'rev-list', '--count', 'HEAD..origin/main') | Out-String).Trim()
if ($behind -match '^\d+$' -and [int]$behind -gt 0) {
    Write-Host "Aviso: a cópia local está $behind commit(s) atrás da origin/main. Rode git pull se quiser a versão mais nova." -ForegroundColor Yellow
}

$imageTag = Get-DeployImageTag -RepoDir $RepoRoot

# Login e arquivo de ambiente do backend; as URLs públicas são validadas aqui
$aws = Initialize-AwsScript -EnvFile $ServerEnv -BaseDir $ServerDir
$apiUrl = Get-PublicUrlEnv -Name 'APP_URL'
$frontendUrl = Get-PublicUrlEnv -Name 'FRONTEND_URL'

$accountLabel = "****" + $aws.AccountId.Substring([Math]::Max(0, $aws.AccountId.Length - 4))
Write-Host "Conta AWS $accountLabel, região $($aws.Region)"
Write-Host "Commit $imageTag ($branch)"
Write-Host "API $apiUrl  |  Frontend $frontendUrl"

if (-not $SkipBackend) {
    Write-Step "Conferindo os segredos (nenhum valor é impresso)"
    & (Join-Path $ServerDir 'put-ssm-secrets.ps1') -EnvFile $ServerEnv -DryRun

    Write-Step "Conferindo a configuração do ECS"
    & (Join-Path $ServerDir 'deploy-ecs-fargate.ps1') -EnvFile $ServerEnv -ValidateOnly
}

if (-not $SkipFrontend) {
    if (-not (Test-Path $ClientEnv)) {
        throw "Arquivo não encontrado: $ClientEnv. Copie client/.env.production.example e rode client/provision-s3-cloudfront.ps1 uma vez."
    }

    $clientValues = @{}
    Get-Content -Path $ClientEnv -Encoding UTF8 | ForEach-Object {
        if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $clientValues[$Matches[1]] = $Matches[2].Trim().Trim('"') }
    }
    foreach ($name in @('S3_BUCKET_NAME', 'VITE_API_URL')) {
        if ([string]::IsNullOrWhiteSpace($clientValues[$name]) -or (Test-PlaceholderValue -Value $clientValues[$name])) {
            throw "Defina $name em $ClientEnv (rode client/provision-s3-cloudfront.ps1 uma vez para criar o bucket)."
        }
    }
    if ($clientValues['VITE_API_URL'].TrimEnd('/') -ne $apiUrl) {
        Write-Host "Aviso: VITE_API_URL do frontend ($($clientValues['VITE_API_URL'])) é diferente do APP_URL da API ($apiUrl)." -ForegroundColor Yellow
    }
}

if ($DryRun) {
    Write-Host ""
    Write-Host "Dry-run concluído: configuração e login conferidos, nada foi alterado." -ForegroundColor Green
    return
}

# ===== 2. Backend =====
if (-not $SkipBackend) {
    if ($Snapshot) {
        Write-Step "Snapshot do banco antes do deploy (as migrations rodam na subida do contêiner)"
        & (Join-Path $ServerDir 'create-database.ps1') -Action Snapshot -EnvFile $ServerEnv
    }

    Write-Step "Enviando os segredos para o SSM"
    & (Join-Path $ServerDir 'put-ssm-secrets.ps1') -EnvFile $ServerEnv

    Write-Step "Imagem Docker $imageTag no ECR"
    & (Join-Path $ServerDir 'push-ecr-image.ps1') -EnvFile $ServerEnv -ImageTag $imageTag

    Write-Step "Publicando no ECS Fargate"
    & (Join-Path $ServerDir 'deploy-ecs-fargate.ps1') -EnvFile $ServerEnv -ImageTag $imageTag

    Write-Step "Conferindo $apiUrl/api/health"
    $healthy = $false
    for ($attempt = 1; $attempt -le 10 -and -not $healthy; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri "$apiUrl/api/health" -UseBasicParsing -TimeoutSec 10
            $healthy = ($response.StatusCode -eq 200)
        }
        catch {
            Start-Sleep -Seconds 6
        }
    }

    if ($healthy) {
        Write-Host "API respondendo: $apiUrl/api/health" -ForegroundColor Green
    }
    else {
        # O ALB já confirmou a saúde da task; aqui o problema costuma ser DNS ou certificado do domínio
        Write-Host "Aviso: $apiUrl/api/health não respondeu 200. Confira se o DNS da API aponta para o ALB." -ForegroundColor Yellow
    }
}

# ===== 3. Frontend =====
if (-not $SkipFrontend) {
    Write-Step "Publicando o frontend"
    & (Join-Path $ClientDir 'deploy-s3-cloudfront.ps1') -EnvFile $ClientEnv
}

$elapsed = (Get-Date) - $startedAt
Write-Host ""
Write-Host "Deploy do commit $imageTag concluído em $([int]$elapsed.TotalMinutes) min $($elapsed.Seconds) s." -ForegroundColor Green
Write-Host "Frontend: $frontendUrl"
Write-Host "API:      $apiUrl"
