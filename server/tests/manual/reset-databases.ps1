# Apaga e recria o PostgreSQL e o Redis LOCAIS (docker compose), com as migrations aplicadas.
# Uso: .\server\tests\manual\reset-databases.ps1
$ErrorActionPreference = "Stop"

$serverDir = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Push-Location $serverDir
try {
    Write-Host "Parando os containers e apagando os volumes (PostgreSQL e Redis)..." -ForegroundColor Yellow
    docker compose down --volumes
    if ($LASTEXITCODE -ne 0) { throw "Falha no docker compose down." }

    Write-Host "Subindo PostgreSQL e Redis vazios..." -ForegroundColor Yellow
    docker compose up -d --wait postgres redis
    if ($LASTEXITCODE -ne 0) { throw "Falha ao subir os containers." }

    Write-Host "Aplicando as migrations..." -ForegroundColor Yellow
    npx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar as migrations." }

    Write-Host "Bancos resetados. Suba a API com: npm run dev" -ForegroundColor Green
}
finally {
    Pop-Location
}
