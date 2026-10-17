# Rede do SafeID do zero: VPC, internet gateway, 2 subnets públicas (ALB, NAT, bastion) e
# 2 privadas (tasks, RDS, Redis) em zonas diferentes, e os security groups do banco e do Redis.
# Ao final grava todos os IDs no server/.env.production, que os outros scripts leem.
# Pode rodar de novo: reaproveita o que já existe (procura pela tag Name).
#
# Uso:
#   .\create-network.ps1                  # cria a rede e grava os IDs
#   .\create-network.ps1 -Action Delete   # remove a rede (rode os outros Delete antes)
param(
    [ValidateSet("Create", "Delete")]
    [string]$Action = "Create",

    [string]$EnvFile = ".env.production",
    [string]$VpcCidr = "10.20.0.0/16",
    [switch]$Force
)

. (Join-Path $PSScriptRoot 'aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot

$Prefix = "safeid"
$cidrBase = ($VpcCidr -split '\.')[0..1] -join '.'
$SubnetPlan = @(
    @{ Name = "$Prefix-public-a"; Cidr = "$cidrBase.0.0/24"; Zone = 0; Public = $true },
    @{ Name = "$Prefix-public-b"; Cidr = "$cidrBase.1.0/24"; Zone = 1; Public = $true },
    @{ Name = "$Prefix-private-a"; Cidr = "$cidrBase.10.0/24"; Zone = 0; Public = $false },
    @{ Name = "$Prefix-private-b"; Cidr = "$cidrBase.11.0/24"; Zone = 1; Public = $false }
)

function Get-TagSpec {
    param([string]$ResourceType, [string]$Name)
    return "ResourceType=$ResourceType,Tags=[{Key=Name,Value=$Name},{Key=Project,Value=SafeID}]"
}

function Find-ByName {
    param([string[]]$DescribeArgs, [string]$Query)

    $id = aws @DescribeArgs --query $Query --output text
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao consultar: aws $($DescribeArgs -join ' ')"
    }
    if ([string]::IsNullOrWhiteSpace($id) -or "$id".Trim() -eq 'None') {
        return $null
    }

    return "$id".Trim()
}

function Get-VpcId {
    return Find-ByName -DescribeArgs @('ec2', 'describe-vpcs', '--filters', "Name=tag:Name,Values=$Prefix-vpc") -Query 'Vpcs[0].VpcId'
}

function Ensure-Vpc {
    $vpcId = Get-VpcId
    if ($vpcId) {
        Write-Host "VPC já existe: $vpcId"
        return $vpcId
    }

    $vpcId = (aws ec2 create-vpc `
            --cidr-block $VpcCidr `
            --tag-specifications (Get-TagSpec -ResourceType 'vpc' -Name "$Prefix-vpc") `
            --query 'Vpc.VpcId' `
            --output text).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar a VPC."
    }

    aws ec2 wait vpc-available --vpc-ids $vpcId
    # Nomes DNS na VPC: o endpoint do RDS e o SSM do bastion dependem disso
    aws ec2 modify-vpc-attribute --vpc-id $vpcId --enable-dns-support > $null
    aws ec2 modify-vpc-attribute --vpc-id $vpcId --enable-dns-hostnames > $null

    Write-Host "VPC criada: $vpcId ($VpcCidr)"
    return $vpcId
}

function Ensure-InternetGateway {
    param([string]$VpcId)

    $igwId = Find-ByName -DescribeArgs @('ec2', 'describe-internet-gateways', '--filters', "Name=tag:Name,Values=$Prefix-igw") -Query 'InternetGateways[0].InternetGatewayId'
    if (-not $igwId) {
        $igwId = (aws ec2 create-internet-gateway `
                --tag-specifications (Get-TagSpec -ResourceType 'internet-gateway' -Name "$Prefix-igw") `
                --query 'InternetGateway.InternetGatewayId' `
                --output text).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o internet gateway."
        }
    }

    $attachedVpc = Find-ByName -DescribeArgs @('ec2', 'describe-internet-gateways', '--internet-gateway-ids', $igwId) -Query 'InternetGateways[0].Attachments[0].VpcId'
    if ($attachedVpc -ne $VpcId) {
        aws ec2 attach-internet-gateway --internet-gateway-id $igwId --vpc-id $VpcId
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao ligar o internet gateway à VPC."
        }
    }

    return $igwId
}

function Ensure-Subnets {
    param([string]$VpcId)

    $zones = @((aws ec2 describe-availability-zones `
                --filters Name=state,Values=available Name=zone-type,Values=availability-zone `
                --query 'AvailabilityZones[].ZoneName' `
                --output text) -split '\s+' | Where-Object { $_ })
    if ($zones.Count -lt 2) {
        throw "A região $($aws.Region) precisa de pelo menos 2 zonas de disponibilidade."
    }

    $ids = @{}
    foreach ($subnet in $SubnetPlan) {
        $id = Find-ByName -DescribeArgs @('ec2', 'describe-subnets', '--filters', "Name=vpc-id,Values=$VpcId", "Name=tag:Name,Values=$($subnet.Name)") -Query 'Subnets[0].SubnetId'
        if (-not $id) {
            $id = (aws ec2 create-subnet `
                    --vpc-id $VpcId `
                    --cidr-block $subnet.Cidr `
                    --availability-zone $zones[$subnet.Zone] `
                    --tag-specifications (Get-TagSpec -ResourceType 'subnet' -Name $subnet.Name) `
                    --query 'Subnet.SubnetId' `
                    --output text).Trim()
            if ($LASTEXITCODE -ne 0) {
                throw "Falha ao criar a subnet $($subnet.Name)."
            }
            Write-Host "Subnet criada: $($subnet.Name) ($($subnet.Cidr), $($zones[$subnet.Zone]))"
        }
        $ids[$subnet.Name] = $id
    }

    return $ids
}

# Subnets públicas saem pela internet gateway; as privadas ganham a rota pela NAT no create-nat-gateway.ps1
function Ensure-PublicRouteTable {
    param([string]$VpcId, [string]$IgwId, [string[]]$PublicSubnetIds)

    $routeTableId = Find-ByName -DescribeArgs @('ec2', 'describe-route-tables', '--filters', "Name=vpc-id,Values=$VpcId", "Name=tag:Name,Values=$Prefix-public-rt") -Query 'RouteTables[0].RouteTableId'
    if (-not $routeTableId) {
        $routeTableId = (aws ec2 create-route-table `
                --vpc-id $VpcId `
                --tag-specifications (Get-TagSpec -ResourceType 'route-table' -Name "$Prefix-public-rt") `
                --query 'RouteTable.RouteTableId' `
                --output text).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar a route table pública."
        }
    }

    $null = Invoke-AwsQuiet -Arguments @('ec2', 'create-route', '--route-table-id', $routeTableId, '--destination-cidr-block', '0.0.0.0/0', '--gateway-id', $IgwId)

    foreach ($subnetId in $PublicSubnetIds) {
        $current = Find-ByName -DescribeArgs @('ec2', 'describe-route-tables', '--filters', "Name=association.subnet-id,Values=$subnetId") -Query 'RouteTables[0].RouteTableId'
        if ($current -ne $routeTableId) {
            aws ec2 associate-route-table --route-table-id $routeTableId --subnet-id $subnetId > $null
            if ($LASTEXITCODE -ne 0) {
                throw "Falha ao associar a subnet $subnetId à route table pública."
            }
        }
    }
}

# Sem regras de entrada: o deploy-ecs-fargate.ps1 libera 5432/6379 só para o security group das tasks
function Ensure-SecurityGroup {
    param([string]$VpcId, [string]$Name, [string]$Description)

    $groupId = Find-ByName -DescribeArgs @('ec2', 'describe-security-groups', '--filters', "Name=vpc-id,Values=$VpcId", "Name=group-name,Values=$Name") -Query 'SecurityGroups[0].GroupId'
    if ($groupId) {
        return $groupId
    }

    $groupId = (aws ec2 create-security-group `
            --group-name $Name `
            --description $Description `
            --vpc-id $VpcId `
            --tag-specifications (Get-TagSpec -ResourceType 'security-group' -Name $Name) `
            --query 'GroupId' `
            --output text).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar o security group $Name."
    }

    return $groupId
}

function Create-Network {
    $vpcId = Ensure-Vpc
    $igwId = Ensure-InternetGateway -VpcId $vpcId
    $subnets = Ensure-Subnets -VpcId $vpcId
    Ensure-PublicRouteTable -VpcId $vpcId -IgwId $igwId -PublicSubnetIds @($subnets["$Prefix-public-a"], $subnets["$Prefix-public-b"])

    $dbSg = Ensure-SecurityGroup -VpcId $vpcId -Name "$Prefix-db-sg" -Description "SafeID PostgreSQL (acesso so pelas tasks e pelo bastion)"
    $redisSg = Ensure-SecurityGroup -VpcId $vpcId -Name "$Prefix-redis-sg" -Description "SafeID Redis (acesso so pelas tasks e pelo bastion)"

    $publicA = $subnets["$Prefix-public-a"]
    $publicB = $subnets["$Prefix-public-b"]
    $privateA = $subnets["$Prefix-private-a"]
    $privateB = $subnets["$Prefix-private-b"]

    $values = [ordered]@{
        VPC_ID                     = $vpcId
        ALB_SUBNET_IDS             = "$publicA,$publicB"
        NAT_PUBLIC_SUBNET_ID       = $publicA
        BASTION_SUBNET_ID          = $publicA
        # As tasks ficam na subnet privada que sai pela NAT
        BACKEND_SUBNET_IDS         = $privateA
        NAT_PRIVATE_SUBNET_ID      = $privateA
        REDIS_SUBNET_IDS           = $privateA
        # O RDS exige subnets em 2 zonas
        DB_SUBNET_IDS              = "$privateA,$privateB"
        DATABASE_SECURITY_GROUP_ID = $dbSg
        REDIS_SECURITY_GROUP_ID    = $redisSg
        ASSIGN_PUBLIC_IP           = "DISABLED"
    }

    foreach ($name in $values.Keys) {
        Set-DotEnvValue -Path $aws.EnvFile -Name $name -Value $values[$name]
    }

    Write-Host ""
    Write-Host "Rede pronta. IDs gravados em $($aws.EnvFile):"
    foreach ($name in $values.Keys) {
        Write-Host "  $name=$($values[$name])"
    }
    Write-Host "Próximo passo: .\create-nat-gateway.ps1"
}

function Delete-Network {
    $vpcId = Get-VpcId
    if (-not $vpcId) {
        Write-Host "VPC '$Prefix-vpc' não existe. Nada a remover."
        return
    }

    Confirm-Destructive -Resource "$Prefix-vpc" -Description "remove a VPC '$Prefix-vpc', as subnets e os security groups. Rode antes o Delete do deploy, banco, Redis, NAT e bastion." -Force:$Force

    foreach ($name in @("$Prefix-db-sg", "$Prefix-redis-sg")) {
        $groupId = Find-ByName -DescribeArgs @('ec2', 'describe-security-groups', '--filters', "Name=vpc-id,Values=$vpcId", "Name=group-name,Values=$name") -Query 'SecurityGroups[0].GroupId'
        if ($groupId) {
            $null = Invoke-AwsQuiet -Arguments @('ec2', 'delete-security-group', '--group-id', $groupId)
        }
    }

    $subnetIds = @((aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpcId" --query 'Subnets[].SubnetId' --output text) -split '\s+' | Where-Object { $_ })
    foreach ($subnetId in $subnetIds) {
        $null = Invoke-AwsQuiet -Arguments @('ec2', 'delete-subnet', '--subnet-id', $subnetId)
        if ($LASTEXITCODE -ne 0) {
            Write-Host "A subnet $subnetId ainda tem recursos (RDS, Redis, NAT, ALB?). Remova-os e rode de novo."
        }
    }

    $routeTables = @((aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$vpcId" --query 'RouteTables[?Associations[0].Main!=`true`].RouteTableId' --output text) -split '\s+' | Where-Object { $_ })
    foreach ($routeTableId in $routeTables) {
        $null = Invoke-AwsQuiet -Arguments @('ec2', 'delete-route-table', '--route-table-id', $routeTableId)
    }

    $igwId = Find-ByName -DescribeArgs @('ec2', 'describe-internet-gateways', '--filters', "Name=attachment.vpc-id,Values=$vpcId") -Query 'InternetGateways[0].InternetGatewayId'
    if ($igwId) {
        $null = Invoke-AwsQuiet -Arguments @('ec2', 'detach-internet-gateway', '--internet-gateway-id', $igwId, '--vpc-id', $vpcId)
        $null = Invoke-AwsQuiet -Arguments @('ec2', 'delete-internet-gateway', '--internet-gateway-id', $igwId)
    }

    $null = Invoke-AwsQuiet -Arguments @('ec2', 'delete-vpc', '--vpc-id', $vpcId)
    if ($LASTEXITCODE -ne 0) {
        throw "A VPC ainda tem dependências. Confira no console (VPC > Your VPCs) e rode de novo."
    }

    Write-Host "Rede removida."
}

switch ($Action) {
    "Create" { Create-Network }
    "Delete" { Delete-Network }
}
