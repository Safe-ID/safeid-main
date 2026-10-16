/**
 * Authentication Controller
 * POST /auth/signup - Registra novo usuário (envia o link de verificação)
 * POST /auth/verify-email - Confirma o email e entra na conta
 * POST /auth/resend-verification - Reenvia o link de verificação
 * POST /auth/login - Faz login (403 se o email não foi verificado)
 * GET /auth/me - Retorna dados do usuário autenticado
 * GET /auth/google - Inicia login/cadastro com Google
 * GET /auth/google/callback - Finaliza OAuth do Google
 * DELETE /auth/me - Remove a conta do usuário autenticado
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  SignupDto,
  LoginDto,
  VerifyEmailDto,
  ResendVerificationDto,
  AuthResponseDto,
  JwtPayload,
  SignupResponseDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../api/decorators/current-user.decorator';
import { RATE_LIMITS } from '../../infra/rate-limit/rate-limit.module';

const authResponseSchema = {
  type: 'object',
  properties: {
    access_token: { type: 'string' },
    refresh_token: { type: 'string', nullable: true },
    user: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        email: { type: 'string' },
        emailVerified: { type: 'boolean' },
        monitoringEnabled: { type: 'boolean' },
        lastMonitoredAt: { type: 'string', nullable: true },
        scanSnapshotUpdatedAt: { type: 'string', nullable: true },
        scanSnapshot: {
          nullable: true,
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            riskScore: { type: 'number' },
            classification: { type: 'string' },
            breachesFound: { type: 'number' },
            recommendation: { type: 'string', nullable: true },
            mitigationSteps: { type: 'array', items: { type: 'string' }, nullable: true },
            urgencyLevel: { type: 'string', nullable: true },
            isVerified: { type: 'boolean' },
            processedAt: { type: 'string', nullable: true },
          },
        },
      },
      required: ['id', 'email'],
    },
  },
  required: ['access_token', 'user'],
};

const errorCodeSchema = (code: string) => ({
  type: 'object',
  properties: {
    code: { type: 'string', example: code },
    message: { type: 'string' },
  },
});

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  @Throttle(RATE_LIMITS.signup)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra novo usuário e envia o link de verificação do email' })
  @ApiResponse({
    status: 201,
    description: 'Conta criada; o acesso só é liberado depois da verificação do email',
    schema: {
      type: 'object',
      properties: {
        requiresEmailVerification: { type: 'boolean', example: true },
        email: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Email ou senha inválidos, ou Política de Privacidade não aceita',
  })
  @ApiResponse({
    status: 409,
    description: 'Email já registrado e verificado, ou cadastrado com o Google',
  })
  async signup(@Body() dto: SignupDto): Promise<SignupResponseDto> {
    return this.authService.signup(dto);
  }

  @Post('verify-email')
  @Throttle(RATE_LIMITS.verifyEmail)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirma o email pelo token do link e entra na conta' })
  @ApiResponse({ status: 200, description: 'Email verificado', schema: authResponseSchema })
  @ApiResponse({ status: 400, description: 'Token inválido', schema: errorCodeSchema('TOKEN_INVALID') })
  @ApiResponse({ status: 410, description: 'Token expirado ou já usado', schema: errorCodeSchema('TOKEN_EXPIRED') })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthResponseDto> {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Throttle(RATE_LIMITS.resendVerification)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Reenvia o link de verificação (mesma resposta exista a conta ou não)' })
  @ApiResponse({ status: 202, description: 'Pedido recebido' })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<{ message: string }> {
    return this.authService.resendVerification(dto.email);
  }

  @Post('login')
  @Throttle(RATE_LIMITS.login)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Faz login do usuário' })
  @ApiResponse({
    status: 200,
    description: 'Login realizado com sucesso',
    schema: authResponseSchema,
  })
  @ApiResponse({
    status: 401,
    description: 'Credenciais inválidas',
  })
  @ApiResponse({
    status: 403,
    description: 'Email não verificado (um novo link é enviado)',
    schema: errorCodeSchema('EMAIL_NOT_VERIFIED'),
  })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Get('google')
  @ApiOperation({ summary: 'Inicia autenticação com Google' })
  async googleAuth(@Res() res: Response) {
    const redirectUrl = await this.authService.getGoogleAuthUrl();
    return res.redirect(302, redirectUrl);
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Finaliza autenticação com Google' })
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.authService.handleGoogleCallback(code, state);
    return res.redirect(302, redirectUrl);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retorna dados do usuário autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Dados do usuário',
  })
  @ApiResponse({
    status: 401,
    description: 'Não autenticado',
  })
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getUserProfile(user.sub);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a conta do usuário autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Conta deletada com sucesso',
  })
  @ApiResponse({
    status: 401,
    description: 'Não autenticado',
  })
  async deleteMe(@CurrentUser() user: JwtPayload) {
    return this.authService.deleteAccount(user.sub);
  }
}
