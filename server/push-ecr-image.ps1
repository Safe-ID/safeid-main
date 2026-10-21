# Build da imagem do backend e envio para o Amazon ECR.
#
# Uso:
#   .\push-ecr-image.ps1                       # tag = commit atual (ex.: 3f2a1b9c0d4e)
#   .\push-ecr-image.ps1 -ImageTag v1.2.0      # tag escolhida
#   .\push-ecr-image.ps1 -Action Delete        # apaga o repositório e todas as imagens
#
# Se a tag já existe no ECR, o build é pulado (redeploy do mesmo commit é imediato).
param(
    [ValidateSet("Create", "Delete")]
    [string]$Action = "Create",

    [string]$EnvFile = ".env.production",
    [string]$ImageTag = "",
    [switch]$Force
)

. (Join-Path $PSScriptRoot 'aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot

$RepositoryName = Get-EcrRepositoryName
$RepositoryUri = Get-EcrRepositoryUri -Aws $aws
$Registry = $RepositoryUri.Split('/')[0]
# Quantas imagens o ECR guarda; as mais antigas são apagadas sozinhas (custo de armazenamento)
$KeepImages = [int](Get-EnvOrDefault -Name 'ECR_KEEP_IMAGES' -Default '15')

if ([string]::IsNullOrWhiteSpace($ImageTag)) {
    $ImageTag = Get-DeployImageTag -RepoDir $PSScriptRoot
}

function Test-EcrRepositoryExists {
    $result = Invoke-AwsQuiet -Arguments @(
        'ecr', 'describe-repositories',
        '--repository-names', $RepositoryName,
        '--query', 'repositories[0].repositoryName',
        '--output', 'text'
    )

    return ($LASTEXITCODE -eq 0 -and "$result".Trim() -eq $RepositoryName)
}

function Test-ImageTagExists {
    $digest = Invoke-AwsQuiet -Arguments @(
        'ecr', 'describe-images',
        '--repository-name', $RepositoryName,
        '--image-ids', "imageTag=$ImageTag",
        '--query', 'imageDetails[0].imageDigest',
        '--output', 'text'
    )

    return ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($digest) -and "$digest".Trim() -ne 'None')
}

function Ensure-EcrRepository {
    if (Test-EcrRepositoryExists) {
        Write-Host "Repositório ECR '$RepositoryName' já existe."
    }
    else {
        Write-Host "Criando o repositório ECR '$RepositoryName'..."
        # Tags imutáveis: a tag é o commit, então nunca deve apontar para outra imagem
        aws ecr create-repository `
            --repository-name $RepositoryName `
            --image-scanning-configuration scanOnPush=true `
            --image-tag-mutability IMMUTABLE > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o repositório ECR."
        }
    }

    $lifecyclePolicy = @{
        rules = @(
            @{
                rulePriority = 1
                description  = "Guarda só as $KeepImages imagens mais recentes"
                selection    = @{
                    tagStatus   = "any"
                    countType   = "imageCountMoreThan"
                    countNumber = $KeepImages
                }
                action       = @{ type = "expire" }
            }
        )
    }

    aws ecr put-lifecycle-policy `
        --repository-name $RepositoryName `
        --lifecycle-policy-text (Write-TempJson -Name "$RepositoryName-lifecycle.json" -InputObject $lifecyclePolicy) > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao aplicar a política de retenção do ECR."
    }
}

# Configuração do Docker só para este push. Com credenciais do "aws login", o token do ECR passa
# de 2,5 mil caracteres e não cabe no cofre do Windows (wincred); aqui ele fica num arquivo
# temporário, apagado no final.
$DockerConfigDir = Join-Path ([System.IO.Path]::GetTempPath()) "safeid-docker-$([guid]::NewGuid().ToString('N'))"

function Connect-EcrRegistry {
    $password = aws ecr get-login-password
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($password)) {
        throw "Falha ao obter a credencial de login do ECR."
    }

    # Mesmo formato que o docker login gravaria, mas sem passar pelo cofre do Windows nem pelo pipe
    # do PowerShell 5.1 (que altera o texto e faz o ECR responder 400)
    $auth = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes("AWS:$("$password".Trim())"))
    $config = @{ auths = @{ $Registry = @{ auth = $auth } } } | ConvertTo-Json -Depth 5 -Compress

    New-Item -ItemType Directory -Path $DockerConfigDir -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $DockerConfigDir 'config.json'), $config, [System.Text.UTF8Encoding]::new($false))
    $env:DOCKER_CONFIG = $DockerConfigDir
}

function Disconnect-EcrRegistry {
    Remove-Item Env:DOCKER_CONFIG -ErrorAction SilentlyContinue
    Remove-Item $DockerConfigDir -Recurse -Force -ErrorAction SilentlyContinue
}

function Push-Image {
    Assert-CommandExists -CommandName 'docker' -Hint 'Instale o Docker Desktop e deixe-o aberto.'
    $null = Invoke-Quiet -FilePath 'docker' -Arguments @('info')
    if ($LASTEXITCODE -ne 0) {
        throw "O Docker não está rodando. Abra o Docker Desktop e rode de novo."
    }

    Ensure-EcrRepository
    $remoteImage = "${RepositoryUri}:$ImageTag"

    if (Test-ImageTagExists) {
        Write-Host "A imagem $remoteImage já está no ECR. Pulando o build."
        return
    }

    Connect-EcrRegistry
    try {
        Build-AndPush -RemoteImage $remoteImage
    }
    finally {
        Disconnect-EcrRegistry
    }
}

function Build-AndPush {
    param([Parameter(Mandatory = $true)][string]$RemoteImage)

    $remoteImage = $RemoteImage
    Write-Host "Gerando a imagem $remoteImage..."
    # Fargate roda em x86_64: sem --platform, um build num Mac com chip Apple geraria arm64
    docker build --platform linux/amd64 -t $remoteImage $PSScriptRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Falha no build da imagem Docker."
    }

    Write-Host "Enviando para o ECR..."
    docker push $remoteImage
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao enviar a imagem para o ECR."
    }

    Write-Host "Imagem publicada: $remoteImage"
}

function Delete-EcrRepository {
    if (-not (Test-EcrRepositoryExists)) {
        Write-Host "Repositório ECR '$RepositoryName' não existe. Nada a remover."
        return
    }

    Confirm-Destructive -Resource $RepositoryName -Description "apaga o repositório ECR '$RepositoryName' e todas as imagens." -Force:$Force

    aws ecr delete-repository --repository-name $RepositoryName --force > $null
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao remover o repositório ECR."
    }

    Write-Host "Repositório ECR removido."
}

switch ($Action) {
    "Create" { Push-Image }
    "Delete" { Delete-EcrRepository }
}
