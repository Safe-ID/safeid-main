/**
 * Authentication DTOs
 * Using interfaces instead of classes to avoid strict initialization requirements
 */

import { IsBoolean, IsEmail, IsString, MinLength } from 'class-validator';

export interface ScanSnapshotDto {
  jobId: string;
  riskScore: number;
  classification: 'LOW' | 'MODERATE' | 'CRITICAL';
  breachesFound: number;
  recommendation?: string | null;
  mitigationSteps?: string[] | null;
  urgencyLevel?: string | null;
  isVerified: boolean;
  processedAt?: string | Date | null;
  breachData?: unknown;
}

export interface AuthUserDto {
  id: number;
  email: string;
  scanSnapshot?: ScanSnapshotDto | null;
  scanSnapshotUpdatedAt?: string | Date | null;
}

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  // Aceite da Política de Privacidade (consentimento exigido pela LGPD)
  @IsBoolean()
  acceptTerms!: boolean;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export interface AuthResponseDto {
  access_token: string;
  refresh_token?: string;
  user: AuthUserDto;
}

export interface JwtPayload {
  sub: number; // user ID
  email: string;
  iat?: number;
  exp?: number;
}

