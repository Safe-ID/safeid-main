param(
    [ValidateSet("Create", "Delete")]
    [string]$Action = "Create"
)

$ErrorActionPreference = "Stop"


. (Join-Path $PSScriptRoot 'aws-common.ps1')
Import-DotEnvFile -Path (Join-Path $PSScriptRoot '.env')

$AwsRegion = if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }
$VpcId = Get-RequiredEnv -Name 'VPC_ID'
$PublicSubnetId = Get-RequiredEnv -Name 'NAT_PUBLIC_SUBNET_ID'
$PrivateSubnetId = Get-RequiredEnv -Name 'NAT_PRIVATE_SUBNET_ID'
$NatGatewayName = if ($env:NAT_GATEWAY_NAME) { $env:NAT_GATEWAY_NAME } else { "safeid-nat-gateway" }
$NatEipName = if ($env:NAT_EIP_NAME) { $env:NAT_EIP_NAME } else { "safeid-nat-eip" }
$NatRouteTableName = if ($env:NAT_ROUTE_TABLE_NAME) { $env:NAT_ROUTE_TABLE_NAME } else { "safeid-private-route-table" }

function Invoke-Aws {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = & aws @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao executar: aws $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }

    return $output
}

function Get-SubnetVpcId {
    $vpcId = aws ec2 describe-subnets --subnet-ids $PublicSubnetId --query "Subnets[0].VpcId" --output text
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vpcId) -or $vpcId -eq "None") {
        throw "Falha ao identificar a VPC do bastion/public subnet."
    }

    return $vpcId.Trim()
}

function Get-MainRouteTableId {
    $routeTableId = aws ec2 describe-route-tables `
        --filters "Name=vpc-id,Values=$VpcId" "Name=association.main,Values=true" `
        --query "RouteTables[0].RouteTableId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($routeTableId) -or $routeTableId -eq "None") {
        throw "Falha ao identificar a main route table da VPC."
    }

    return $routeTableId.Trim()
}

function Get-OrCreateRouteTable {
    $routeTableId = aws ec2 describe-route-tables `
        --filters "Name=vpc-id,Values=$VpcId" "Name=tag:Name,Values=$NatRouteTableName" `
        --query "RouteTables[0].RouteTableId" `
        --output text 2>$null

    if ($LASTEXITCODE -eq 0 -and $routeTableId -and $routeTableId -ne "None") {
        return $routeTableId.Trim()
    }

    $createdRouteTableId = aws ec2 create-route-table `
        --vpc-id $VpcId `
        --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$NatRouteTableName},{Key=Project,Value=SafeID},{Key=Component,Value=NAT}]" `
        --query "RouteTable.RouteTableId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($createdRouteTableId)) {
        throw "Falha ao criar a route table privada."
    }

    return $createdRouteTableId.Trim()
}

function Get-SubnetRouteTableId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SubnetId
    )

    $routeTableId = aws ec2 describe-route-tables `
        --filters "Name=association.subnet-id,Values=$SubnetId" `
        --query "RouteTables[0].RouteTableId" `
        --output text 2>$null

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($routeTableId) -or $routeTableId -eq "None") {
        return $null
    }

    return $routeTableId.Trim()
}

function Get-OrCreateEipAllocationId {
    $allocationId = aws ec2 describe-addresses `
        --filters "Name=tag:Name,Values=$NatEipName" "Name=domain,Values=vpc" `
        --query "Addresses[0].AllocationId" `
        --output text 2>$null

    if ($LASTEXITCODE -eq 0 -and $allocationId -and $allocationId -ne "None") {
        return $allocationId.Trim()
    }

    $createdAllocationId = aws ec2 allocate-address `
        --domain vpc `
        --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NatEipName},{Key=Project,Value=SafeID},{Key=Component,Value=NAT}]" `
        --query "AllocationId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($createdAllocationId)) {
        throw "Falha ao alocar o Elastic IP para o NAT Gateway."
    }

    return $createdAllocationId.Trim()
}

function Get-OrCreateNatGatewayId {
    $natGatewayId = aws ec2 describe-nat-gateways `
        --filter "Name=vpc-id,Values=$VpcId" "Name=tag:Name,Values=$NatGatewayName" `
        --query "NatGateways[0].NatGatewayId" `
        --output text 2>$null

    if ($LASTEXITCODE -eq 0 -and $natGatewayId -and $natGatewayId -ne "None") {
        return $natGatewayId.Trim()
    }

    $allocationId = Get-OrCreateEipAllocationId

    $createdNatGatewayId = aws ec2 create-nat-gateway `
        --subnet-id $PublicSubnetId `
        --allocation-id $allocationId `
        --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=$NatGatewayName},{Key=Project,Value=SafeID},{Key=Component,Value=NAT}]" `
        --query "NatGateway.NatGatewayId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($createdNatGatewayId)) {
        throw "Falha ao criar o NAT Gateway."
    }

    return $createdNatGatewayId.Trim()
}

function Wait-NatGatewayAvailable {
    param([Parameter(Mandatory = $true)][string]$NatGatewayId)

    aws ec2 wait nat-gateway-available --nat-gateway-ids $NatGatewayId
    if ($LASTEXITCODE -ne 0) {
        throw "O NAT Gateway não ficou disponível no tempo esperado."
    }
}

function Ensure-PrivateRouting {
    param(
        [Parameter(Mandatory = $true)][string]$NatGatewayId,
        [Parameter(Mandatory = $true)][string]$RouteTableId
    )

    aws ec2 create-route `
        --route-table-id $RouteTableId `
        --destination-cidr-block 0.0.0.0/0 `
        --nat-gateway-id $NatGatewayId 2>$null

    if ($LASTEXITCODE -ne 0) {
        aws ec2 replace-route `
            --route-table-id $RouteTableId `
            --destination-cidr-block 0.0.0.0/0 `
            --nat-gateway-id $NatGatewayId 2>$null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar ou atualizar a rota padrão para o NAT Gateway."
        }
    }

    $currentRouteTableId = Get-SubnetRouteTableId -SubnetId $PrivateSubnetId

    if ($currentRouteTableId -eq $RouteTableId) {
        return
    }

    if (-not [string]::IsNullOrWhiteSpace($currentRouteTableId)) {
        $associationId = aws ec2 describe-route-tables `
            --filters "Name=association.subnet-id,Values=$PrivateSubnetId" `
            --query "RouteTables[0].Associations[0].RouteTableAssociationId" `
            --output text 2>$null

        if ($LASTEXITCODE -eq 0 -and $associationId -and $associationId -ne "None") {
            aws ec2 replace-route-table-association `
                --association-id $associationId `
                --route-table-id $RouteTableId 2>$null

            if ($LASTEXITCODE -ne 0) {
                throw "Falha ao atualizar a associação da subnet privada à route table do NAT."
            }

            return
        }
    }

    aws ec2 associate-route-table `
        --route-table-id $RouteTableId `
        --subnet-id $PrivateSubnetId 2>$null

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao associar a subnet privada à route table do NAT."
    }
}

function Create-NatGateway {
    $existingNatGatewayId = aws ec2 describe-nat-gateways `
        --filter "Name=vpc-id,Values=$VpcId" "Name=tag:Name,Values=$NatGatewayName" `
        --query "NatGateways[0].NatGatewayId" `
        --output text 2>$null

    if ($LASTEXITCODE -eq 0 -and $existingNatGatewayId -and $existingNatGatewayId -ne "None") {
        Write-Host "NAT Gateway já existe: $existingNatGatewayId"
        $routeTableId = Get-OrCreateRouteTable
        Ensure-PrivateRouting -NatGatewayId $existingNatGatewayId.Trim() -RouteTableId $routeTableId
        return
    }

    $natGatewayId = Get-OrCreateNatGatewayId
    Wait-NatGatewayAvailable -NatGatewayId $natGatewayId

    $routeTableId = Get-OrCreateRouteTable
    Ensure-PrivateRouting -NatGatewayId $natGatewayId -RouteTableId $routeTableId

    $allocationId = aws ec2 describe-addresses `
        --filters "Name=tag:Name,Values=$NatEipName" "Name=domain,Values=vpc" `
        --query "Addresses[0].AllocationId" `
        --output text

    $natInfo = aws ec2 describe-nat-gateways `
        --nat-gateway-ids $natGatewayId `
        --query "NatGateways[0].NatGatewayAddresses[0].PublicIp" `
        --output text

    Write-Host "NAT Gateway criado com sucesso."
    Write-Host "NatGatewayId: $natGatewayId"
    Write-Host "Elastic IP: $natInfo"
    Write-Host "RouteTableId: $routeTableId"
    Write-Host "Private subnet: $PrivateSubnetId"
}

function Delete-NatGateway {
    $natGatewayId = aws ec2 describe-nat-gateways `
        --filter "Name=vpc-id,Values=$VpcId" "Name=tag:Name,Values=$NatGatewayName" `
        --query "NatGateways[0].NatGatewayId" `
        --output text 2>$null

    if ($natGatewayId -and $natGatewayId -ne "None") {
        $natGatewayId = $natGatewayId.Trim()

        $routeTableId = aws ec2 describe-route-tables `
            --filters "Name=vpc-id,Values=$VpcId" "Name=tag:Name,Values=$NatRouteTableName" `
            --query "RouteTables[0].RouteTableId" `
            --output text 2>$null

        if ($routeTableId -and $routeTableId -ne "None") {
            $mainRouteTableId = Get-MainRouteTableId
            $associationId = aws ec2 describe-route-tables `
                --filters "Name=vpc-id,Values=$VpcId" "Name=association.subnet-id,Values=$PrivateSubnetId" `
                --query "RouteTables[0].Associations[0].RouteTableAssociationId" `
                --output text 2>$null

            if ($associationId -and $associationId -ne "None") {
                aws ec2 replace-route-table-association `
                    --association-id $associationId `
                    --route-table-id $mainRouteTableId 2>$null
            }

            aws ec2 delete-route-table --route-table-id $routeTableId 2>$null
        }

        aws ec2 delete-nat-gateway --nat-gateway-id $natGatewayId 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao solicitar remoção do NAT Gateway."
        }

        aws ec2 wait nat-gateway-deleted --nat-gateway-ids $natGatewayId 2>$null
    }

    $allocationId = aws ec2 describe-addresses `
        --filters "Name=tag:Name,Values=$NatEipName" "Name=domain,Values=vpc" `
        --query "Addresses[0].AllocationId" `
        --output text 2>$null

    if ($allocationId -and $allocationId -ne "None") {
        aws ec2 release-address --allocation-id $allocationId 2>$null
    }

    Write-Host "NAT Gateway removido."
}

switch ($Action) {
    "Create" { Create-NatGateway }
    "Delete" { Delete-NatGateway }
}