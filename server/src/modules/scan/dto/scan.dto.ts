import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateScanDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email to scan for breaches',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ScanResultDto {
  @ApiProperty()
  jobId!: string;

  @ApiProperty()
  riskScore!: number;

  @ApiProperty()
  classification!: 'LOW' | 'MODERATE' | 'CRITICAL';

  @ApiProperty()
  breachesFound!: number;

  @ApiProperty({ nullable: true })
  recommendation?: string;

  @ApiProperty({ type: [String], nullable: true })
  mitigationSteps?: string[];

  @ApiProperty({ enum: ['HIGH', 'MEDIUM', 'LOW'], nullable: true })
  urgencyLevel?: string;

  @ApiProperty()
  isVerified!: boolean;
}

export class ScanHistoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  riskScore!: number;

  @ApiProperty()
  classification!: 'LOW' | 'MODERATE' | 'CRITICAL';

  @ApiProperty()
  breachesFound!: number;

  @ApiProperty()
  createdAt!: Date;
}
