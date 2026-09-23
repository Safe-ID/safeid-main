/**
 * Authentication Service
 * Gerencia signup, login, valida��o de credentials
 */

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infra/database/prisma.service';
import { ScanService } from '../scan/services/scan.service';
import {
  SignupDto,
  LoginDto,
  AuthResponseDto,
  JwtPayload,
  AuthUserDto,
  ScanSnapshotDto,
} from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { createHmac, randomBytes } from 'crypto';

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private scanService: ScanService,
  ) {}

  private getGoogleOAuthConfig() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL;
    const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || process.env.APP_URL;

    if (!clientId || !clientSecret || !callbackUrl) {
      throw new BadRequestException('Google OAuth não configurado');
    }

    return {
      clientId,
      clientSecret,
      callbackUrl,
      frontendUrl: frontendUrl || 'http://localhost:5173',
    };
  }

  private createGoogleOAuthState() {
    const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'safeid-google-state';
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('hex');
    const payload = `${timestamp}:${nonce}`;
    const signature = createHmac('sha256', secret).update(payload).digest('hex');

    return `${payload}:${signature}`;
  }

  private verifyGoogleOAuthState(state: string) {
    const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'safeid-google-state';
    const [timestamp, nonce, signature] = state.split(':');

    if (!timestamp || !nonce || !signature) {
      throw new UnauthorizedException('State inválido');
    }

    const payload = `${timestamp}:${nonce}`;
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');

    if (expectedSignature !== signature) {
      throw new UnauthorizedException('State inválido');
    }

    const ageMs = Date.now() - Number(timestamp);
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10 * 60 * 1000) {
      throw new UnauthorizedException('State expirado');
    }
  }

  private buildGoogleAuthUrl(state: string) {
    const { clientId, callbackUrl } = this.getGoogleOAuthConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async getGoogleAuthUrl() {
    return this.buildGoogleAuthUrl(this.createGoogleOAuthState());
  }

  async handleGoogleCallback(code: string, state: string) {
    if (!code || !state) {
      throw new BadRequestException('Código de autorização ausente');
    }

    this.verifyGoogleOAuthState(state);

    const { clientId, clientSecret, callbackUrl, frontendUrl } = this.getGoogleOAuthConfig();
    const tokenParams = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await axios.post<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      tokenParams.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      throw new UnauthorizedException('Falha ao autenticar com Google');
    }

    const userInfoResponse = await axios.get<GoogleUserInfo>(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const googleUser = userInfoResponse.data;
    if (!googleUser?.sub || !googleUser?.email) {
      throw new UnauthorizedException('Perfil do Google incompleto');
    }

    if (googleUser.email_verified === false) {
      throw new UnauthorizedException('Email do Google não verificado');
    }

    const user = await this.upsertGoogleUser({
      googleId: googleUser.sub,
      email: googleUser.email.toLowerCase(),
    });

    const tokens = this.generateTokens(user.id, user.email);
    const redirectUrl = new URL(frontendUrl);
    redirectUrl.hash = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      provider: 'google',
    }).toString();

    return redirectUrl.toString();
  }

  private async upsertGoogleUser(input: { googleId: string; email: string }) {
    const existingByGoogleId = await this.prisma.user.findUnique({
      where: { googleId: input.googleId },
    });

    if (existingByGoogleId) {
      if (existingByGoogleId.email === input.email) {
        return existingByGoogleId;
      }

      return this.prisma.user.update({
        where: { id: existingByGoogleId.id },
        data: { email: input.email },
      });
    }

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingByEmail) {
      return this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: { googleId: input.googleId },
      });
    }

    return this.prisma.user.create({
      data: {
        email: input.email,
        googleId: input.googleId,
        passwordHash: null,
      },
    });
  }

  /**
   * Registra novo usu�rio
   * Valida email, hash password, cria usu�rio
   */
  async signup(dto: SignupDto): Promise<AuthResponseDto> {
    // Validar email
    if (!dto.email || !dto.email.includes('@')) {
      throw new BadRequestException('Email inv�lido');
    }

    // Validar password (m�nimo 8 caracteres)
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException(
        'Senha deve ter no m�nimo 8 caracteres',
      );
    }

    // Verificar se email j� existe
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser?.passwordHash) {
      throw new ConflictException('Email j� registrado');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = existingUser
      ? await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            passwordHash,
          },
        })
      : await this.prisma.user.create({
          data: {
            email: dto.email.toLowerCase(),
            passwordHash,
          },
        });

    let scanFailure: unknown = null;
    try {
      await this.scanService.submitScan(user.id, { email: user.email });
    } catch (error) {
      scanFailure = error;
      console.error('[AuthService] Initial scan failed:', error);
      await this.scanService.persistFallbackSnapshot(user.id, user.email);
    }

    // Gerar tokens
    const tokens = this.generateTokens(user.id, user.email);

    const profile = await this.getUserProfile(user.id);

    if (scanFailure) {
      console.warn('[AuthService] Returning account without scan snapshot because the initial scan failed.');
    }

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: profile,
    };
  }

  /**
   * Login de usu�rio
   * Valida credentials, gera JWT
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Email e senha s�o obrigat�rios');
    }

    // Buscar usu�rio
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Email ou senha inv�lidos');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Use o login com Google para esta conta');
    }

    // Validar password
    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Email ou senha inv�lidos');
    }

    // Gerar tokens
    const tokens = this.generateTokens(user.id, user.email);

    const profile = await this.getUserProfile(user.id);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: profile,
    };
  }

  /**
   * Valida JWT e retorna payload
   * Usado por JwtStrategy
   */
  async validateJwt(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Usu�rio n�o encontrado');
    }

    return { id: user.id, email: user.email };
  }

  async deleteAccount(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    await this.prisma.user.delete({
      where: { id: userId },
    });

    return {
      message: 'Conta deletada com sucesso',
    };
  }

  async getUserProfile(userId: number): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        scanSnapshot: true,
        scanSnapshotUpdatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return {
      id: user.id,
      email: user.email,
      scanSnapshot: user.scanSnapshot as ScanSnapshotDto | null,
      scanSnapshotUpdatedAt: user.scanSnapshotUpdatedAt,
    };
  }

  /**
   * Gera access_token e refresh_token
   */
  private generateTokens(userId: number, email: string) {
    const payload = { sub: userId, email };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_EXPIRES_IN as any) || '24h',
    });

    const refresh_token = this.jwtService.sign(payload, {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN as any) || '7d',
      secret: process.env.REFRESH_TOKEN_SECRET,
    });

    return { access_token, refresh_token };
  }
}
