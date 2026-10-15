# Tópico de alertas (SNS por e-mail) e alarmes de infraestrutura do SafeID (I.7).
# Os alarmes da feature de monitoramento (T7.11) entram neste mesmo script.
#
# Uso:
#   .\create-alerts.ps1                 # cria/atualiza o tópico, a assinatura e os alarmes
#   .\create-alerts.ps1 -Action Test    # publica uma mensagem de teste no tópico
#   .\create-alerts.ps1 -Action Delete  # remove os alarmes e o tópico
#
# Depois de criar, confirme a assinatura pelo link que chega no ALERTS_EMAIL.
param(
    [ValidateSet("Create", "Delete", "Test")]
    [string]$Action = "Create"
)

$ErrorActionPreference = "Stop"
$env:AWS_PAGER = ""

. (Join-Path $PSScriptRoot 'aws-common.ps1')
Import-DotEnvFile -Path (Join-Path $PSScriptRoot '.env')

# ===== Configurações =====
$AwsRegion = Get-EnvOrDefault -Name 'AWS_REGION' -Default 'us-east-1'
$TopicName = "safeid-alerts"
$RedisClusterId = Get-EnvOrDefault -Name 'REDIS_CLUSTER_ID' -Default 'safeid-redis'
$RedisNodeId = Get-EnvOrDefault -Name 'REDIS_NODE_ID' -Default '0001'
$DbInstanceIdentifier = Get-EnvOrDefault -Name 'DB_INSTANCE_IDENTIFIER' -Default 'safeid-pg'

$RedisMemoryAlarm = "safeid-redis-memory"
$RdsStorageAlarm = "safeid-rds-storage"
$AlarmNames = @($RedisMemoryAlarm, $RdsStorageAlarm)

function Ensure-Topic {
    # create-topic é idempotente: devolve o ARN do tópico se ele já existir
    $topicArn = aws sns create-topic `
        --name $TopicName `
        --region $AwsRegion `
        --query "TopicArn" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($topicArn)) {
        throw "Falha ao criar o tópico SNS '$TopicName'."
    }

    return $topicArn.Trim()
}

function Get-TopicArn {
    $accountId = Get-AwsAccountId
    return "arn:aws:sns:${AwsRegion}:${accountId}:$TopicName"
}

function Ensure-EmailSubscription {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TopicArn
    )

    $alertsEmail = Get-RequiredEnv -Name 'ALERTS_EMAIL'

    $existing = aws sns list-subscriptions-by-topic `
        --topic-arn $TopicArn `
        --region $AwsRegion `
        --query "Subscriptions[?Protocol=='email' && Endpoint=='$alertsEmail'].SubscriptionArn | [0]" `
        --output text

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao listar as assinaturas do tópico."
    }

    if (-not [string]::IsNullOrWhiteSpace($existing) -and $existing.Trim() -ne 'None') {
        if ($existing.Trim() -eq 'PendingConfirmation') {
            Write-Host "Assinatura de e-mail aguardando confirmação. Confira a caixa de entrada do ALERTS_EMAIL."
        }
        else {
            Write-Host "Assinatura de e-mail já confirmada."
        }
        return
    }

    aws sns subscribe `
        --topic-arn $TopicArn `
        --protocol email `
        --notification-endpoint $alertsEmail `
        --region $AwsRegion > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao assinar o e-mail de alertas no tópico."
    }

    Write-Host "Assinatura criada. Confirme pelo link enviado ao ALERTS_EMAIL."
}

function Set-Alarm {
    param(
        [Parameter(Mandatory = $true)] [string]$Name,
        [Parameter(Mandatory = $true)] [string]$Description,
        [Parameter(Mandatory = $true)] [string]$Namespace,
        [Parameter(Mandatory = $true)] [string]$MetricName,
        [Parameter(Mandatory = $true)] [string[]]$Dimensions,
        [Parameter(Mandatory = $true)] [string]$Statistic,
        [Parameter(Mandatory = $true)] [int]$PeriodSeconds,
        [Parameter(Mandatory = $true)] [int]$EvaluationPeriods,
        [Parameter(Mandatory = $true)] [double]$Threshold,
        [Parameter(Mandatory = $true)] [string]$ComparisonOperator,
        [Parameter(Mandatory = $true)] [string]$TopicArn
    )

    # put-metric-alarm cria ou substitui: seguro para rodar de novo
    aws cloudwatch put-metric-alarm `
        --alarm-name $Name `
        --alarm-description $Description `
        --namespace $Namespace `
        --metric-name $MetricName `
        --dimensions $Dimensions `
        --statistic $Statistic `
        --period $PeriodSeconds `
        --evaluation-periods $EvaluationPeriods `
        --threshold $Threshold `
        --comparison-operator $ComparisonOperator `
        --treat-missing-data notBreaching `
        --alarm-actions $TopicArn `
        --ok-actions $TopicArn `
        --region $AwsRegion

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar o alarme '$Name'."
    }

    Write-Host "Alarme pronto: $Name"
}

function Create-Alerts {
    $topicArn = Ensure-Topic
    Ensure-EmailSubscription -TopicArn $topicArn

    # Memória do Redis: com noeviction, encher a memória faz o Redis recusar escritas
    Set-Alarm `
        -Name $RedisMemoryAlarm `
        -Description "Memória do Redis (filas BullMQ + cache) acima de 80% por 15 min" `
        -Namespace "AWS/ElastiCache" `
        -MetricName "DatabaseMemoryUsagePercentage" `
        -Dimensions @("Name=CacheClusterId,Value=$RedisClusterId", "Name=CacheNodeId,Value=$RedisNodeId") `
        -Statistic "Average" `
        -PeriodSeconds 300 `
        -EvaluationPeriods 3 `
        -Threshold 80 `
        -ComparisonOperator "GreaterThanThreshold" `
        -TopicArn $topicArn

    # Espaço livre do RDS abaixo de 2 GB (de 20 GB provisionados)
    Set-Alarm `
        -Name $RdsStorageAlarm `
        -Description "Espaço livre do PostgreSQL abaixo de 2 GB" `
        -Namespace "AWS/RDS" `
        -MetricName "FreeStorageSpace" `
        -Dimensions @("Name=DBInstanceIdentifier,Value=$DbInstanceIdentifier") `
        -Statistic "Minimum" `
        -PeriodSeconds 300 `
        -EvaluationPeriods 2 `
        -Threshold 2147483648 `
        -ComparisonOperator "LessThanThreshold" `
        -TopicArn $topicArn

    Write-Host ""
    Write-Host "Tópico: $topicArn"
    Write-Host "Teste o envio com: .\create-alerts.ps1 -Action Test"
}

function Test-Alerts {
    $topicArn = Get-TopicArn

    aws sns publish `
        --topic-arn $topicArn `
        --subject "SafeID - teste de alertas" `
        --message "Mensagem de teste do create-alerts.ps1. Se chegou, o tópico de alertas está funcionando." `
        --region $AwsRegion > $null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao publicar no tópico '$topicArn'. Ele já foi criado?"
    }

    Write-Host "Mensagem de teste publicada em $topicArn."
}

function Delete-Alerts {
    aws cloudwatch delete-alarms `
        --alarm-names $AlarmNames `
        --region $AwsRegion

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao remover os alarmes."
    }

    $topicArn = Get-TopicArn
    aws sns delete-topic `
        --topic-arn $topicArn `
        --region $AwsRegion 2>$null

    Write-Host "Alarmes e tópico de alertas removidos."
}

switch ($Action) {
    "Create" { Create-Alerts }
    "Test" { Test-Alerts }
    "Delete" { Delete-Alerts }
}
