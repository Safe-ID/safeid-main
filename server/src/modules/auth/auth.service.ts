/**
 * Authentication Service
 * Gerencia signup, login, validação de credentials
 */

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infra/database/prisma.service';
import { ScanService } from '../scan/services/scan.service';
import { openBreachData } from '../../shared/crypto/breach-data.cipher';
import { getFrontendUrl } from '../../shared/config/urls';
import { log } from '../../shared/utils/logger';
import { EmailVerificationService } from './email-verification.service';
import {
  SignupDto,
  LoginDto,
  AuthResponseDto,
  JwtPayload,
  AuthUserDto,
  ScanSnapshotDto,
  SignupResponseDto,
  TokenPairDto,
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
    private emailVerification: EmailVerificationService,
  ) {}

  private getGoogleOAuthConfig() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL;

    if (!clientId || !clientSecret || !callbackUrl) {
      throw new BadRequestException('Google OAuth não configurado');
    }

    return {
      clientId,
      clientSecret,
      callbackUrl,
      frontendUrl: getFrontendUrl(),
    };
  }

  private createGoogleOAuthState() {
    const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'safeid-google-state';
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('hex');
    const payload = `${timestamp}:${nonce}`;
    // codeql[js/insufficient-password-hash]: HMAC signs OAuth state; it is not password storage.
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
  // codeql[js/insufficient-password-hash]: HMAC verifies OAuth state; it is not password storage.
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

    // Conta que nunca teve scan (nova ou vinda de um cadastro por senha não verificado):
    // roda o scan inicial, como o link de verificação faz no cadastro por email
    if (!user.scanSnapshotUpdatedAt) {
      await this.runInitialScan(user.id, user.email);
    }

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
      const emailChanged = existingByGoogleId.email !== input.email;
      if (!emailChanged && existingByGoogleId.emailVerifiedAt) {
        return existingByGoogleId;
      }

      return this.prisma.user.update({
        where: { id: existingByGoogleId.id },
        data: {
          email: input.email,
          emailVerifiedAt: existingByGoogleId.emailVerifiedAt ?? new Date(),
        },
      });
    }

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingByEmail) {
      // O Google comprovou que a pessoa é dona do email. Se o email da conta ainda não foi
      // verificado, a senha pode ter sido criada por outra pessoa: ela é apagada e a conta
      // passa a entrar pelo Google. Conta já verificada mantém a senha.
      return this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          googleId: input.googleId,
          emailVerifiedAt: existingByEmail.emailVerifiedAt ?? new Date(),
          ...(existingByEmail.emailVerifiedAt ? {} : { passwordHash: null }),
        },
      });
    }

    // A tela de login avisa que continuar com o Google é aceitar a Política de Privacidade
    // e os alertas de vazamento (que podem ser desligados no painel)
    const now = new Date();
    return this.prisma.user.create({
      data: {
        email: input.email,
        googleId: input.googleId,
        passwordHash: null,
        termsAcceptedAt: now,
        emailVerifiedAt: now,
        monitoringEnabled: true,
        monitoringConsentAt: now,
      },
    });
  }

  /**
   * Registra novo usuário por senha. A conta só é ativada depois da verificação do email:
   * aqui não roda o scan nem emite tokens, só envia o link de verificação.
   */
  async signup(dto: SignupDto): Promise<SignupResponseDto> {
    // Validar email
    if (!dto.email || !dto.email.includes('@')) {
      throw new BadRequestException('Email inválido');
    }

    // Validar password (mínimo 8 caracteres)
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException(
        'Senha deve ter no mínimo 8 caracteres',
      );
    }

    // Consentimento da LGPD: sem aceitar a Política de Privacidade não cria a conta
    if (dto.acceptTerms !== true) {
      throw new BadRequestException(
        'É preciso aceitar a Política de Privacidade para criar a conta',
      );
    }

    const email = dto.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    // Contas criadas pelo Google não recebem senha pelo cadastro,
    // senão qualquer pessoa poderia definir uma senha para o email de outra
    if (existingUser && !existingUser.passwordHash) {
      throw new ConflictException('Este email já está cadastrado com o Google. Entre usando o Google.');
    }

    if (existingUser?.emailVerifiedAt) {
      throw new ConflictException('Email já registrado');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const acceptMonitoring = dto.acceptMonitoring ?? true;
    const now = new Date();
    const accountData = {
      passwordHash,
      termsAcceptedAt: now,
      monitoringEnabled: acceptMonitoring,
      monitoringConsentAt: acceptMonitoring ? now : null,
    };

    if (existingUser) {
      // Cadastro anterior nunca verificado: quem controla a caixa de entrada fica com a conta.
      // A senha é trocada e um link novo é enviado (respeitando o limite de reenvio;
      // dentro dele, o link anterior continua valendo).
      await this.prisma.user.update({ where: { id: existingUser.id }, data: accountData });
      if (await this.emailVerification.canResend(email)) {
        await this.emailVerification.sendVerificationEmail(existingUser.id);
      }
      log('info', 'AuthService', 'signup.unverified_resubmitted', { userId: existingUser.id });
    } else {
      const user = await this.prisma.user.create({
        data: { email, ...accountData },
      });
      // Conta o envio inicial no limite de reenvio
      await this.emailVerification.canResend(email);
      await this.emailVerification.sendVerificationEmail(user.id);
      log('info', 'AuthService', 'signup.created', { userId: user.id, monitoring: acceptMonitoring });
    }

    return { requiresEmailVerification: true, email };
  }

  /**
   * Confirma o email pelo token do link, roda o scan inicial e entra na conta
   */
  async verifyEmail(token: string): Promise<AuthResponseDto> {
    const user = await this.emailVerification.consumeToken(token);
    await this.runInitialScan(user.id, user.email);

    const tokens = this.generateTokens(user.id, user.email);
    const profile = await this.getUserProfile(user.id);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: profile,
    };
  }

  /**
   * Scan da entrada na conta (verificação do email ou primeiro login pelo Google).
   * Se a HIBP ou a IA falharem, grava um resultado padrão para o painel não ficar vazio.
   */
  private async runInitialScan(userId: number, email: string): Promise<void> {
    try {
      await this.scanService.submitScan(userId, { email }, 'SIGNUP');
    } catch (error) {
      console.error('[AuthService] Initial scan failed:', error);
      await this.scanService.persistFallbackSnapshot(userId, email);
    }
  }

  /**
   * Reenvia o link de verificação. Sempre responde a mesma mensagem, exista o email ou não,
   * para não revelar quais emails têm conta.
   */
  async resendVerification(email: string): Promise<{ message: string }> {
    const normalizedEmail = (email || '').toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, emailVerifiedAt: true, passwordHash: true },
    });

    if (user && !user.emailVerifiedAt && user.passwordHash && (await this.emailVerification.canResend(normalizedEmail))) {
      await this.emailVerification.sendVerificationEmail(user.id);
    }

    return {
      message: 'Se houver uma conta aguardando verificação com este email, enviamos um novo link.',
    };
  }

  /**
   * Login de usuário
   * Valida credentials, gera JWT. Conta sem email verificado recebe 403 e um novo link.
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Email e senha são obrigatórios');
    }

    // Buscar usuário
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Email ou senha inválidos');
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
      throw new UnauthorizedException('Email ou senha inválidos');
    }

    if (!user.emailVerifiedAt) {
      if (await this.emailVerification.canResend(user.email)) {
        await this.emailVerification.sendVerificationEmail(user.id);
      }
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Confirme seu email para entrar. Enviamos um link para a sua caixa de entrada.',
      });
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
      throw new UnauthorizedException('Usuário não encontrado');
    }

    // Cobre tokens emitidos antes da verificação de email passar a ser obrigatória
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException({ code: 'EMAIL_NOT_VERIFIED', message: 'Email não verificado' });
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

    // O banco apaga o histórico em cascata; o cache do scan fica no Redis e é apagado aqui
    try {
      await this.scanService.clearCachedScan(user.email);
    } catch (error) {
      console.warn('[AuthService] Could not clear cached scan after account deletion:', error);
    }

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
        emailVerifiedAt: true,
        monitoringEnabled: true,
        lastMonitoredAt: true,
        scanSnapshot: true,
        scanSnapshotUpdatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const snapshot = user.scanSnapshot as ScanSnapshotDto | null;

    return {
      id: user.id,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      monitoringEnabled: user.monitoringEnabled,
      lastMonitoredAt: user.lastMonitoredAt,
      // Os vazamentos ficam criptografados no banco e são abertos só na resposta
      scanSnapshot: snapshot
        ? { ...snapshot, breachData: openBreachData(snapshot.breachData) }
        : null,
      scanSnapshotUpdatedAt: user.scanSnapshotUpdatedAt,
    };
  }

  /**
   * Troca um refresh token válido por um par novo (o refresh token também é renovado).
   * A conta precisa existir e estar verificada, como no JwtStrategy.
   */
  async refreshTokens(refreshToken: string): Promise<TokenPairDto> {
    const invalid = () =>
      new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'Sessão expirada. Entre novamente.' });

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, { secret: process.env.REFRESH_TOKEN_SECRET });
    } catch {
      throw invalid();
    }

    // Um access token nunca vale como refresh token
    if (payload.typ !== 'refresh' || !payload.sub) {
      throw invalid();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (!user || !user.emailVerifiedAt) {
      throw invalid();
    }

    log('info', 'AuthService', 'auth.refreshed', { userId: user.id });
    return this.generateTokens(user.id, user.email);
  }

  /**
   * Gera access_token e refresh_token
   */
  private generateTokens(userId: number, email: string) {
    const payload = { sub: userId, email };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_EXPIRES_IN as any) || '24h',
    });

    const refresh_token = this.jwtService.sign({ ...payload, typ: 'refresh' }, {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN as any) || '7d',
      secret: process.env.REFRESH_TOKEN_SECRET,
    });

    return { access_token, refresh_token };
  }
}
