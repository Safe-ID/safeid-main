/**
 * Authentication Controller
 * POST /auth/signup - Registra novo usuário
 * POST /auth/login - Faz login
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
import { AuthService } from './auth.service';
import { SignupDto, LoginDto } from './dto/auth.dto';
import { AuthResponseDto, JwtPayload } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../api/decorators/current-user.decorator';

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

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra novo usuário' })
  @ApiResponse({
    status: 201,
    description: 'Usuário registrado com sucesso',
    schema: authResponseSchema,
  })
  @ApiResponse({
    status: 400,
    description: 'Email ou senha inválidos',
  })
  @ApiResponse({
    status: 409,
    description: 'Email já registrado',
  })
  async signup(@Body() dto: SignupDto): Promise<AuthResponseDto> {
    return this.authService.signup(dto);
  }

  @Post('login')
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
