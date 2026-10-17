/**
 * Authentication DTOs
 * Using interfaces instead of classes to avoid strict initialization requirements
 */

import { IsEmail, IsOptional, IsString, Length, MinLength } from 'class-validator';
import { StrictBoolean } from '../../../shared/validation/strict-boolean';

export interface ScanSnapshotDto {
  jobId: string;
  riskScore: number;
  classification: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
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
  emailVerified: boolean;
  monitoringEnabled: boolean;
  lastMonitoredAt?: string | Date | null;
  scanSnapshot?: ScanSnapshotDto | null;
  scanSnapshotUpdatedAt?: string | Date | null;
}

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // Aceite da Política de Privacidade (consentimento exigido pela LGPD)
  @StrictBoolean()
  acceptTerms!: boolean;

  // Alertas por e-mail quando o e-mail aparecer em vazamentos novos (padrão: sim)
  @IsOptional()
  @StrictBoolean()
  acceptMonitoring?: boolean;
}

export class VerifyEmailDto {
  // base64url de 32 bytes
  @IsString()
  @Length(43, 43)
  token!: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

export interface SignupResponseDto {
  requiresEmailVerification: true;
  email: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(20)
  refresh_token!: string;
}

export interface TokenPairDto {
  access_token: string;
  refresh_token: string;
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
  typ?: 'refresh'; // só no refresh token: impede usar um token no lugar do outro
  iat?: number;
  exp?: number;
}

