param(
    [ValidateSet("Create", "Delete")]
    [string]$Action = "Create",

    [string]$AwsRegion = "us-east-1",
    [string]$RepositoryName = "safeid-backend",
    [string]$ImageTag = "latest"
)

$ErrorActionPreference = "Stop"

function Get-AccountId {
    $accountId = aws sts get-caller-identity `
        --query "Account" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($accountId)) {
        throw "Falha ao obter a conta AWS atual."
    }

    return $accountId.Trim()
}

function Get-RepositoryUri {
    $accountId = Get-AccountId
    return "${accountId}.dkr.ecr.$AwsRegion.amazonaws.com/$RepositoryName"
}

function Test-EcrRepositoryExists {
    try {
        $result = aws ecr describe-repositories `
            --repository-names $RepositoryName `
            --region $AwsRegion `
            --query "repositories[0].repositoryName" `
            --output text 2>$null

        return ($LASTEXITCODE -eq 0 -and $result -eq $RepositoryName)
    }
    catch {
        return $false
    }
}

function Ensure-EcrRepository {
    if (-not (Test-EcrRepositoryExists)) {
        Write-Host "Repositório ECR não encontrado. Criando..."
        aws ecr create-repository `
            --repository-name $RepositoryName `
            --region $AwsRegion `
            --image-scanning-configuration scanOnPush=true `
            --image-tag-mutability MUTABLE

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o repositório ECR."
        }
    }
    else {
        Write-Host "Repositório ECR já existe."
    }
}

function Connect-EcrRegistry {
    $registry = "$(Get-AccountId).dkr.ecr.$AwsRegion.amazonaws.com"
    $password = aws ecr get-login-password --region $AwsRegion

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($password)) {
        throw "Falha ao obter credencial de login do ECR."
    }

    $password | docker login --username AWS --password-stdin $registry

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao autenticar no registro ECR."
    }
}

function Push-Image {
    Ensure-EcrRepository
    Connect-EcrRegistry

    $repositoryUri = Get-RepositoryUri
    $localImage = "${RepositoryName}:$ImageTag"
    $remoteImage = "${repositoryUri}:$ImageTag"

    Write-Host "Gerando imagem local..."
    docker build -t $localImage .

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao buildar a imagem Docker."
    }

    Write-Host "Marcando imagem para o ECR..."
    docker tag $localImage $remoteImage

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao marcar a imagem para o ECR."
    }

    Write-Host "Enviando imagem para $remoteImage..."
    docker push $remoteImage

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao enviar a imagem para o ECR."
    }

    Write-Host "Imagem publicada com sucesso."
    Write-Host "Image URI: $remoteImage"
}

function Delete-EcrRepository {
    if (Test-EcrRepositoryExists) {
        Write-Host "Removendo repositório ECR e todas as imagens..."
        aws ecr delete-repository `
            --repository-name $RepositoryName `
            --region $AwsRegion `
            --force

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao remover o repositório ECR."
        }
    }
    else {
        Write-Host "Repositório ECR '$RepositoryName' não existe. Nada a remover."
    }
}

switch ($Action) {
    "Create" { Push-Image }
    "Delete" { Delete-EcrRepository }
}