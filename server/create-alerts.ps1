# Tópico de alertas (SNS por e-mail), alarmes de infraestrutura (Redis, RDS) e alarmes do
# monitoramento de vazamentos: metric filters sobre os logs JSON da aplicação + reputação do SES.
#
# Uso:
#   .\create-alerts.ps1                 # cria/atualiza o tópico, a assinatura e os alarmes
#   .\create-alerts.ps1 -Action Test    # publica uma mensagem de teste no tópico
#   .\create-alerts.ps1 -Action Delete  # remove os alarmes e o tópico
#
# Depois de criar, confirme a assinatura pelo link que chega no ALERTS_EMAIL.
param(
    [ValidateSet("Create", "Delete", "Test")]
    [string]$Action = "Create",

    [string]$EnvFile = ".env.production",
    [switch]$Force
)

. (Join-Path $PSScriptRoot 'aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot

# ===== Configurações =====
$AwsRegion = $aws.Region
$TopicName = "safeid-alerts"
$RedisClusterId = Get-RedisClusterId
$RedisNodeId = Get-EnvOrDefault -Name 'REDIS_NODE_ID' -Default '0001'
$DbInstanceIdentifier = Get-DbInstanceIdentifier

$ClusterName = Get-EnvOrDefault -Name 'ECS_CLUSTER_NAME' -Default 'safeid-cluster'
$LogGroupName = "/ecs/$ClusterName"
$MetricNamespace = "SafeID"

$RedisMemoryAlarm = "safeid-redis-memory"
$RdsStorageAlarm = "safeid-rds-storage"
$CatalogSyncAlarm = "safeid-catalog-sync-stale"
$HibpAuthAlarm = "safeid-hibp-auth-failed"
$EmailFailedAlarm = "safeid-email-failed"
$SesBounceAlarm = "safeid-ses-bounce-rate"
$SesComplaintAlarm = "safeid-ses-complaint-rate"
$AlarmNames = @(
    $RedisMemoryAlarm, $RdsStorageAlarm, $CatalogSyncAlarm, $HibpAuthAlarm,
    $EmailFailedAlarm, $SesBounceAlarm, $SesComplaintAlarm
)

# Metric filters sobre os eventos do logger estruturado (uma linha JSON por evento)
$MetricFilters = @(
    @{ Name = "safeid-catalog-sync-done"; Metric = "CatalogSyncDone"; Event = "catalog.sync.done" },
    @{ Name = "safeid-hibp-auth-failed"; Metric = "HibpAuthFailed"; Event = "hibp.auth_failed" },
    @{ Name = "safeid-email-failed"; Metric = "EmailFailed"; Event = "email.failed" }
)

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
    if (Test-PlaceholderValue -Value $alertsEmail) {
        throw "ALERTS_EMAIL ainda está com o valor de exemplo."
    }

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
        [string[]]$Dimensions = @(),
        [Parameter(Mandatory = $true)] [string]$Statistic,
        [Parameter(Mandatory = $true)] [int]$PeriodSeconds,
        [Parameter(Mandatory = $true)] [int]$EvaluationPeriods,
        [Parameter(Mandatory = $true)] [double]$Threshold,
        [Parameter(Mandatory = $true)] [string]$ComparisonOperator,
        [Parameter(Mandatory = $true)] [string]$TopicArn,
        [ValidateSet("notBreaching", "breaching", "missing", "ignore")]
        [string]$TreatMissingData = "notBreaching"
    )

    $arguments = @(
        "cloudwatch", "put-metric-alarm",
        "--alarm-name", $Name,
        "--alarm-description", $Description,
        "--namespace", $Namespace,
        "--metric-name", $MetricName,
        "--statistic", $Statistic,
        "--period", "$PeriodSeconds",
        "--evaluation-periods", "$EvaluationPeriods",
        "--threshold", "$Threshold",
        "--comparison-operator", $ComparisonOperator,
        "--treat-missing-data", $TreatMissingData,
        "--alarm-actions", $TopicArn,
        "--ok-actions", $TopicArn,
        "--region", $AwsRegion
    )
    if ($Dimensions.Count -gt 0) {
        $arguments += @("--dimensions") + $Dimensions
    }

    # put-metric-alarm cria ou substitui: seguro para rodar de novo
    & aws @arguments

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar o alarme '$Name'."
    }

    Write-Host "Alarme pronto: $Name"
}

# Conta cada linha de log com o evento: 1 quando acontece, 0 nas outras linhas
function Ensure-MetricFilters {
    aws logs describe-log-groups --log-group-name-prefix $LogGroupName --query "logGroups[?logGroupName=='$LogGroupName'] | length(@)" --output text > $null
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao consultar o log group '$LogGroupName'. Rode o deploy-ecs-fargate.ps1 antes."
    }

    foreach ($filter in $MetricFilters) {
        # Via arquivo JSON: no PowerShell 5.1, aspas dentro de argumentos de executáveis se perdem
        $filterInput = @{
            logGroupName          = $LogGroupName
            filterName            = $filter.Name
            filterPattern         = '{ $.event = "' + $filter.Event + '" }'
            metricTransformations = @(
                @{
                    metricName      = $filter.Metric
                    metricNamespace = $MetricNamespace
                    metricValue     = "1"
                    defaultValue    = 0
                }
            )
        }
        $filterInputPath = Join-Path ([System.IO.Path]::GetTempPath()) "$($filter.Name)-metric-filter.json"
        [System.IO.File]::WriteAllText($filterInputPath, ($filterInput | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))

        aws logs put-metric-filter `
            --cli-input-json ("file://" + ($filterInputPath -replace '\\', '/')) `
            --region $AwsRegion

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o metric filter '$($filter.Name)'."
        }

        Write-Host "Metric filter pronto: $($filter.Name) ($($filter.Event))"
    }
}

function Create-Alerts {
    $topicArn = Ensure-Topic
    Ensure-EmailSubscription -TopicArn $topicArn
    Ensure-MetricFilters

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

    # Monitoramento parado: nenhum catalog-sync concluído em 7 h (o normal é a cada 6 h).
    # Sem log nenhum também alarma (task fora do ar).
    Set-Alarm `
        -Name $CatalogSyncAlarm `
        -Description "Nenhum catalog-sync concluído nas últimas 7 horas: o monitoramento pode estar parado" `
        -Namespace $MetricNamespace `
        -MetricName "CatalogSyncDone" `
        -Statistic "Sum" `
        -PeriodSeconds 25200 `
        -EvaluationPeriods 1 `
        -Threshold 1 `
        -ComparisonOperator "LessThanThreshold" `
        -TreatMissingData "breaching" `
        -TopicArn $topicArn

    # Chave da HIBP inválida ou plano expirado: o monitoramento para de checar usuários
    Set-Alarm `
        -Name $HibpAuthAlarm `
        -Description "HIBP recusou a chave (401/403): plano expirado ou chave inválida" `
        -Namespace $MetricNamespace `
        -MetricName "HibpAuthFailed" `
        -Statistic "Sum" `
        -PeriodSeconds 300 `
        -EvaluationPeriods 1 `
        -Threshold 1 `
        -ComparisonOperator "GreaterThanOrEqualToThreshold" `
        -TopicArn $topicArn

    Set-Alarm `
        -Name $EmailFailedAlarm `
        -Description "5 ou mais e-mails (verificação/alerta) falharam em definitivo na última hora" `
        -Namespace $MetricNamespace `
        -MetricName "EmailFailed" `
        -Statistic "Sum" `
        -PeriodSeconds 3600 `
        -EvaluationPeriods 1 `
        -Threshold 5 `
        -ComparisonOperator "GreaterThanOrEqualToThreshold" `
        -TopicArn $topicArn

    # Reputação do SES (métricas da conta, sem dimensões). Acima de 5% de bounce ou 0,1% de
    # reclamação a AWS começa a revisar a conta e pode pausar o envio.
    Set-Alarm `
        -Name $SesBounceAlarm `
        -Description "Taxa de bounce do SES acima de 5%" `
        -Namespace "AWS/SES" `
        -MetricName "Reputation.BounceRate" `
        -Statistic "Maximum" `
        -PeriodSeconds 3600 `
        -EvaluationPeriods 1 `
        -Threshold 0.05 `
        -ComparisonOperator "GreaterThanThreshold" `
        -TopicArn $topicArn

    Set-Alarm `
        -Name $SesComplaintAlarm `
        -Description "Taxa de reclamação (spam) do SES acima de 0,1%" `
        -Namespace "AWS/SES" `
        -MetricName "Reputation.ComplaintRate" `
        -Statistic "Maximum" `
        -PeriodSeconds 3600 `
        -EvaluationPeriods 1 `
        -Threshold 0.001 `
        -ComparisonOperator "GreaterThanThreshold" `
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
    Confirm-Destructive -Resource $TopicName -Description "remove os alarmes e o tópico '$TopicName': nenhum alerta chega mais por e-mail." -Force:$Force

    aws cloudwatch delete-alarms `
        --alarm-names $AlarmNames `
        --region $AwsRegion

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao remover os alarmes."
    }

    foreach ($filter in $MetricFilters) {
        $null = Invoke-AwsQuiet -Arguments @('logs', 'delete-metric-filter', '--log-group-name', $LogGroupName, '--filter-name', $filter.Name, '--region', $AwsRegion)
    }

    $topicArn = Get-TopicArn
    $null = Invoke-AwsQuiet -Arguments @('sns', 'delete-topic', '--topic-arn', $topicArn, '--region', $AwsRegion)

    Write-Host "Alarmes e tópico de alertas removidos."
}

switch ($Action) {
    "Create" { Create-Alerts }
    "Test" { Test-Alerts }
    "Delete" { Delete-Alerts }
}
