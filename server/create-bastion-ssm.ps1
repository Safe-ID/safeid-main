# Bastion sem porta aberta (acesso só pelo SSM Session Manager) para chegar ao RDS,
# ao Redis e ao ALB interno a partir da sua máquina. Veja connect-bastion-ssm.ps1.
#
# Uso:
#   .\create-bastion-ssm.ps1                  # cria (ou liga, se estiver parado) o bastion
#   .\create-bastion-ssm.ps1 -Action Delete   # remove o bastion, a role e o security group
param(
    [ValidateSet("Create", "Delete")]
    [string]$Action = "Create",

    [string]$EnvFile = ".env.production",
    [switch]$Force
)

. (Join-Path $PSScriptRoot 'aws-common.ps1')
$aws = Initialize-AwsScript -EnvFile $EnvFile -BaseDir $PSScriptRoot
$AwsRegion = $aws.Region
$BastionSubnetId = Get-RequiredEnv -Name 'BASTION_SUBNET_ID'
$BastionInstanceName = if ($env:BASTION_INSTANCE_NAME) { $env:BASTION_INSTANCE_NAME } else { "safeid-bastion" }
$BastionInstanceType = if ($env:BASTION_INSTANCE_TYPE) { $env:BASTION_INSTANCE_TYPE } else { "t3.micro" }
$BastionSecurityGroupName = if ($env:BASTION_SECURITY_GROUP_NAME) { $env:BASTION_SECURITY_GROUP_NAME } else { "safeid-bastion-sg" }
$BastionRoleName = if ($env:BASTION_ROLE_NAME) { $env:BASTION_ROLE_NAME } else { "safeid-bastion-role" }
$BastionProfileName = if ($env:BASTION_PROFILE_NAME) { $env:BASTION_PROFILE_NAME } else { "safeid-bastion-profile" }
$BastionPolicyArn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
$AmiParameterName = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"

function Test-BastionInstanceExists {
    $instance = aws ec2 describe-instances `
        --filters "Name=tag:Name,Values=$BastionInstanceName" "Name=instance-state-name,Values=pending,running,stopping,stopped" `
        --query "Reservations[0].Instances[0].{InstanceId:InstanceId,State:State.Name,PublicIp:PublicIpAddress}" `
        --output json 2>$null

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($instance) -or $instance -eq "null") {
        return $null
    }

    return $instance | ConvertFrom-Json
}

function Get-SubnetVpcId {
    $vpcId = aws ec2 describe-subnets `
        --subnet-ids $BastionSubnetId `
        --query "Subnets[0].VpcId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vpcId) -or $vpcId -eq "None") {
        throw "Falha ao identificar a VPC da subnet do bastion."
    }

    return $vpcId.Trim()
}

function Get-LatestAmiId {
    $amiId = aws ssm get-parameter `
        --name $AmiParameterName `
        --query "Parameter.Value" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($amiId) -or $amiId -eq "None") {
        throw "Falha ao obter a AMI do Amazon Linux 2023."
    }

    return $amiId.Trim()
}

function Get-OrCreateSecurityGroup {
    param(
        [Parameter(Mandatory = $true)]
        [string]$VpcId
    )

    $groupId = aws ec2 describe-security-groups `
        --filters "Name=group-name,Values=$BastionSecurityGroupName" "Name=vpc-id,Values=$VpcId" `
        --query "SecurityGroups[0].GroupId" `
        --output text 2>$null

    if ($LASTEXITCODE -eq 0 -and $groupId -and $groupId -ne "None") {
        return $groupId.Trim()
    }

    $createdGroupId = aws ec2 create-security-group `
        --group-name $BastionSecurityGroupName `
        --description "SafeID bastion SSM security group" `
        --vpc-id $VpcId `
        --query "GroupId" `
        --output text

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($createdGroupId)) {
        throw "Falha ao criar o security group do bastion."
    }

    return $createdGroupId.Trim()
}

function Test-IamRoleExists {
    $oldErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    try {
        $roleName = aws iam get-role --role-name "$BastionRoleName" --query "Role.RoleName" --output text 2>$null
        return ($LASTEXITCODE -eq 0 -and $roleName -eq $BastionRoleName)
    }
    finally {
        $ErrorActionPreference = $oldErrorAction
    }
}

function Test-IamPolicyAttached {
    $oldErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    try {
        $count = aws iam list-attached-role-policies --role-name "$BastionRoleName" --query "length(AttachedPolicies[?PolicyArn=='$BastionPolicyArn'])" --output text 2>$null
        return ($LASTEXITCODE -eq 0 -and $count -match '^[0-9]+$' -and [int]$count -gt 0)
    }
    finally {
        $ErrorActionPreference = $oldErrorAction
    }
}

function Test-InstanceProfileExists {
    $oldErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    try {
        $profileName = aws iam get-instance-profile --instance-profile-name "$BastionProfileName" --query "InstanceProfile.InstanceProfileName" --output text 2>$null
        return ($LASTEXITCODE -eq 0 -and $profileName -eq $BastionProfileName)
    }
    finally {
        $ErrorActionPreference = $oldErrorAction
    }
}

function Test-InstanceProfileHasRole {
    $oldErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'

    try {
        $count = aws iam get-instance-profile --instance-profile-name "$BastionProfileName" --query "length(InstanceProfile.Roles[?RoleName=='$BastionRoleName'])" --output text 2>$null
        return ($LASTEXITCODE -eq 0 -and $count -match '^[0-9]+$' -and [int]$count -gt 0)
    }
    finally {
        $ErrorActionPreference = $oldErrorAction
    }
}

function Ensure-IamResources {
    $trustPolicy = @{
        Version   = "2012-10-17"
        Statement = @(
            @{
                Effect    = "Allow"
                Principal = @{ Service = "ec2.amazonaws.com" }
                Action    = "sts:AssumeRole"
            }
        )
    }

    if (-not (Test-IamRoleExists)) {
        $trustPath = Join-Path ([System.IO.Path]::GetTempPath()) "$BastionRoleName-trust.json"
        [System.IO.File]::WriteAllText($trustPath, (($trustPolicy | ConvertTo-Json -Depth 10 -Compress)), [System.Text.UTF8Encoding]::new($false))

        aws iam create-role `
            --role-name $BastionRoleName `
            --assume-role-policy-document ("file://" + ($trustPath -replace '\\', '/')) > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar a role do bastion."
        }
    }

    if (-not (Test-IamPolicyAttached)) {
        aws iam attach-role-policy `
            --role-name $BastionRoleName `
            --policy-arn $BastionPolicyArn

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao anexar a policy SSM à role do bastion."
        }
    }

    if (-not (Test-InstanceProfileExists)) {
        aws iam create-instance-profile --instance-profile-name $BastionProfileName > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao criar o instance profile do bastion."
        }
    }

    if (-not (Test-InstanceProfileHasRole)) {
        aws iam add-role-to-instance-profile `
            --instance-profile-name $BastionProfileName `
            --role-name $BastionRoleName

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao associar a role ao instance profile do bastion."
        }
    }
}

function Create-Bastion {
    $existingInstance = Test-BastionInstanceExists
    if ($existingInstance) {
        if ($existingInstance.State -eq "stopped") {
            Write-Host "Bastion existe e está parado. Iniciando..."
            aws ec2 start-instances --instance-ids $existingInstance.InstanceId | Out-Null
            aws ec2 wait instance-running --instance-ids $existingInstance.InstanceId
        }

        Write-Host "Bastion já existe: $($existingInstance.InstanceId)"
        return
    }

    $vpcId = Get-SubnetVpcId
    $amiId = Get-LatestAmiId
    $securityGroupId = Get-OrCreateSecurityGroup -VpcId $vpcId

    Ensure-IamResources

    # O túnel do connect-bastion-ssm.ps1 sai do bastion: o banco e o Redis precisam aceitá-lo
    foreach ($target in @(@('DATABASE_SECURITY_GROUP_ID', 5432), @('REDIS_SECURITY_GROUP_ID', 6379))) {
        $targetGroupId = Get-EnvOrDefault -Name $target[0] -Default ''
        if (-not [string]::IsNullOrWhiteSpace($targetGroupId) -and -not (Test-PlaceholderValue -Value $targetGroupId)) {
            # Falha só quando a regra já existe (InvalidPermission.Duplicate)
            $null = Invoke-AwsQuiet -Arguments @(
                'ec2', 'authorize-security-group-ingress',
                '--group-id', $targetGroupId,
                '--protocol', 'tcp',
                '--port', "$($target[1])",
                '--source-group', $securityGroupId
            )
        }
    }

    Write-Host "Criando bastion SSM..."
    $null = aws ec2 run-instances `
        --image-id $amiId `
        --instance-type $BastionInstanceType `
        --subnet-id $BastionSubnetId `
        --security-group-ids $securityGroupId `
        --iam-instance-profile Name=$BastionProfileName `
        --associate-public-ip-address `
        --metadata-options HttpTokens=required,HttpEndpoint=enabled `
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$BastionInstanceName},{Key=Project,Value=SafeID},{Key=Component,Value=Bastion}]" `
        --count 1 `
        --query "Instances[0].InstanceId" `
        --output text

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao criar a instância bastion."
    }

    $instanceId = (Test-BastionInstanceExists).InstanceId

    Write-Host "Aguardando o bastion ficar running..."
    aws ec2 wait instance-running --instance-ids $instanceId

    if ($LASTEXITCODE -ne 0) {
        throw "O bastion não ficou disponível no tempo esperado."
    }

    $publicIp = aws ec2 describe-instances `
        --instance-ids $instanceId `
        --query "Reservations[0].Instances[0].PublicIpAddress" `
        --output text

    Write-Host "Bastion pronto!"
    Write-Host "InstanceId: $instanceId"
    Write-Host "Public IP: $publicIp"
    Write-Host "Use: .\connect-bastion-ssm.ps1 -Target Alb"
}

function Delete-Bastion {
    $existingInstance = Test-BastionInstanceExists

    if ($existingInstance) {
        Confirm-Destructive -Resource $BastionInstanceName -Description "remove a instância bastion '$BastionInstanceName'." -Force:$Force
        Write-Host "Removendo bastion..."
        aws ec2 terminate-instances --instance-ids $existingInstance.InstanceId > $null

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao solicitar a remoção do bastion."
        }

        aws ec2 wait instance-terminated --instance-ids $existingInstance.InstanceId

        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao aguardar a remoção do bastion."
        }
    }
    else {
        Write-Host "Bastion não encontrado."
    }

    $vpcId = Get-SubnetVpcId
    $securityGroupId = aws ec2 describe-security-groups `
        --filters "Name=group-name,Values=$BastionSecurityGroupName" "Name=vpc-id,Values=$vpcId" `
        --query "SecurityGroups[0].GroupId" `
        --output text 2>$null

    if ($securityGroupId -and $securityGroupId -ne "None") {
        $null = Invoke-AwsQuiet -Arguments @('ec2', 'delete-security-group', '--group-id', $securityGroupId.Trim())
    }

    if (Test-InstanceProfileExists) {
        if (Test-InstanceProfileHasRole) {
            $null = Invoke-AwsQuiet -Arguments @('iam', 'remove-role-from-instance-profile', '--instance-profile-name', $BastionProfileName, '--role-name', $BastionRoleName)
        }

        $null = Invoke-AwsQuiet -Arguments @('iam', 'delete-instance-profile', '--instance-profile-name', $BastionProfileName)
    }

    if (Test-IamPolicyAttached) {
        $null = Invoke-AwsQuiet -Arguments @('iam', 'detach-role-policy', '--role-name', $BastionRoleName, '--policy-arn', $BastionPolicyArn)
    }

    if (Test-IamRoleExists) {
        $null = Invoke-AwsQuiet -Arguments @('iam', 'delete-role', '--role-name', $BastionRoleName)
    }

    Write-Host "Bastion removido."
}

switch ($Action) {
    "Create" { Create-Bastion }
    "Delete" { Delete-Bastion }
}