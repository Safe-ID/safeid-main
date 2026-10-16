param(
    [ValidateSet("Create", "Delete", "EnableBackups", "Snapshot")]
    [string]$Action = "Create"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot 'aws-common.ps1')
Import-DotEnvFile -Path (Join-Path $PSScriptRoot '.env')

# ===== Configurações =====
$DB_INSTANCE_IDENTIFIER = "safeid-pg"
$DB_INSTANCE_CLASS      = "db.t3.micro"
$DB_ENGINE              = "postgres"
$DB_MASTER_USERNAME     = Get-EnvOrDefault -Name 'DB_USER' -Default 'safeid_user'
$DB_MASTER_PASSWORD     = Get-RequiredEnv -Name 'DB_PASSWORD'
$DB_ALLOCATED_STORAGE   = 20
# Backups automáticos de 7 dias: o banco guarda estado que não se recupera da HIBP
# (vazamentos conhecidos, notificações, consentimento). Gratuito até o tamanho do storage.
$DB_BACKUP_RETENTION    = 7
# 06:00-07:00 UTC = 03h-04h BRT, fora dos horários de varredura do monitoramento
$DB_BACKUP_WINDOW       = "06:00-07:00"
$DB_SUBNET_GROUP_NAME   = "safeid-db-subnet-group"
$DB_SUBNET_GROUP_DESC   = "Subnet group for SafeID PostgreSQL"
$DB_SECURITY_GROUP_ID   = Get-RequiredEnv -Name 'DATABASE_SECURITY_GROUP_ID'
$DB_NAME                = Get-EnvOrDefault -Name 'DB_NAME' -Default 'safeid_db'
$SUBNET_IDS             = Get-RequiredEnvList -Name 'DB_SUBNET_IDS'

function Test-DbSubnetGroupExists {
    try {
        $result = aws rds describe-db-subnet-groups `
            --db-subnet-group-name $DB_SUBNET_GROUP_NAME `
            --query "DBSubnetGroups[0].DBSubnetGroupName" `
            --output text 2>$null

        return ($LASTEXITCODE -eq 0 -and $result -eq $DB_SUBNET_GROUP_NAME)
    }
    catch {
        return $false
    }
}

function Test-DbInstanceExists {
    try {
        $result = aws rds describe-db-instances `
            --db-instance-identifier $DB_INSTANCE_IDENTIFIER `
            --query "DBInstances[0].DBInstanceIdentifier" `
            --output text 2>$null

        return ($LASTEXITCODE -eq 0 -and $result -eq $DB_INSTANCE_IDENTIFIER)
    }
    catch {
        return $false
    }
}

function Ensure-SubnetGroup {
    if (-not (Test-DbSubnetGroupExists)) {
        Write-Host "DB Subnet Group não encontrado. Criando..."
        aws rds create-db-subnet-group `
            --db-subnet-group-name $DB_SUBNET_GROUP_NAME `
            --db-subnet-group-description $DB_SUBNET_GROUP_DESC `
            --subnet-ids $SUBNET_IDS

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o DB Subnet Group."
        }
    }
    else {
        Write-Host "DB Subnet Group já existe."
    }
}

function Create-Database {
    if (Test-DbInstanceExists) {
        Write-Host "A instância '$DB_INSTANCE_IDENTIFIER' já existe. Abortando criação."
        return
    }

    Ensure-SubnetGroup

    Write-Host "Criando instância PostgreSQL..."
    aws rds create-db-instance `
        --db-instance-identifier $DB_INSTANCE_IDENTIFIER `
        --db-instance-class $DB_INSTANCE_CLASS `
        --engine $DB_ENGINE `
        --master-username $DB_MASTER_USERNAME `
        --master-user-password $DB_MASTER_PASSWORD `
        --allocated-storage $DB_ALLOCATED_STORAGE `
        --db-subnet-group-name $DB_SUBNET_GROUP_NAME `
        --vpc-security-group-ids $DB_SECURITY_GROUP_ID `
        --no-publicly-accessible `
        --backup-retention-period $DB_BACKUP_RETENTION `
        --preferred-backup-window $DB_BACKUP_WINDOW `
        --storage-type gp2 `
        --db-name $DB_NAME

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar a instância PostgreSQL."
    }

    Write-Host "Aguardando a instância ficar disponível..."
    aws rds wait db-instance-available `
        --db-instance-identifier $DB_INSTANCE_IDENTIFIER

    if ($LASTEXITCODE -ne 0) {
        throw "A instância não ficou disponível no tempo esperado."
    }

    $endpoint = aws rds describe-db-instances `
        --db-instance-identifier $DB_INSTANCE_IDENTIFIER `
        --query "DBInstances[0].Endpoint.Address" `
        --output text

    Write-Host "PostgreSQL pronto!"
    Write-Host "Endpoint: $endpoint"
    Write-Host "Porta: 5432"
    Write-Host "Banco: $DB_NAME"
    Write-Host "Usuário: $DB_MASTER_USERNAME"
}

function Delete-Database {
    if (Test-DbInstanceExists) {
        Write-Host "Removendo instância PostgreSQL..."
        aws rds delete-db-instance `
            --db-instance-identifier $DB_INSTANCE_IDENTIFIER `
            --skip-final-snapshot `
            --delete-automated-backups

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao solicitar remoção da instância PostgreSQL."
        }

        Write-Host "Aguardando remoção da instância..."
        aws rds wait db-instance-deleted `
            --db-instance-identifier $DB_INSTANCE_IDENTIFIER

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao aguardar a remoção da instância."
        }
    }
    else {
        Write-Host "A instância '$DB_INSTANCE_IDENTIFIER' não existe. Pulando remoção da instância."
    }

    if (Test-DbSubnetGroupExists) {
        Write-Host "Removendo DB Subnet Group..."
        aws rds delete-db-subnet-group `
            --db-subnet-group-name $DB_SUBNET_GROUP_NAME

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao remover o DB Subnet Group."
        }
    }
    else {
        Write-Host "DB Subnet Group não existe. Nada a remover."
    }

    Write-Host "PostgreSQL removido completamente."
}

function Enable-Backups {
    if (-not (Test-DbInstanceExists)) {
        throw "A instância '$DB_INSTANCE_IDENTIFIER' não existe."
    }

    Write-Host "Ativando backups automáticos ($DB_BACKUP_RETENTION dias, janela $DB_BACKUP_WINDOW UTC)..."
    aws rds modify-db-instance `
        --db-instance-identifier $DB_INSTANCE_IDENTIFIER `
        --backup-retention-period $DB_BACKUP_RETENTION `
        --preferred-backup-window $DB_BACKUP_WINDOW `
        --apply-immediately > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao ativar os backups da instância."
    }

    Write-Host "Backups ativados. Confira com:"
    Write-Host "  aws rds describe-db-instances --db-instance-identifier $DB_INSTANCE_IDENTIFIER --query 'DBInstances[0].[BackupRetentionPeriod,LatestRestorableTime]'"
}

# Snapshot manual: rodar antes de toda migration em produção
function New-DatabaseSnapshot {
    if (-not (Test-DbInstanceExists)) {
        throw "A instância '$DB_INSTANCE_IDENTIFIER' não existe."
    }

    $snapshotId = "safeid-pre-" + (Get-Date -Format "yyyyMMdd-HHmm")
    Write-Host "Criando snapshot manual '$snapshotId'..."
    aws rds create-db-snapshot `
        --db-instance-identifier $DB_INSTANCE_IDENTIFIER `
        --db-snapshot-identifier $snapshotId > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar o snapshot '$snapshotId'."
    }

    Write-Host "Aguardando o snapshot ficar disponível..."
    aws rds wait db-snapshot-available `
        --db-snapshot-identifier $snapshotId

    if ($LASTEXITCODE -ne 0) {
        throw "O snapshot '$snapshotId' não ficou disponível no tempo esperado."
    }

    Write-Host "Snapshot pronto: $snapshotId"
}

switch ($Action) {
    "Create" { Create-Database }
    "Delete" { Delete-Database }
    "EnableBackups" { Enable-Backups }
    "Snapshot" { New-DatabaseSnapshot }
}