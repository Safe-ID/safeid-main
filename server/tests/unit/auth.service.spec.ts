import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../../src/modules/auth/auth.service';

jest.mock('axios');

describe('AuthService', () => {
  let prismaMock: any;
  let jwtServiceMock: any;
  let scanServiceMock: any;
  let emailVerificationMock: any;
  let service: AuthService;

  const verifiedAt = new Date('2026-10-01T00:00:00.000Z');

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/v1/auth/google/callback';
    process.env.FRONTEND_URL = 'http://localhost:5173';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    prismaMock = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    jwtServiceMock = {
      sign: jest.fn((payload: any, options?: any) => {
        const suffix = options?.secret ? '-refresh' : '-access';
        return `token-${payload.sub}${suffix}`;
      }),
      verify: jest.fn(),
    };

    scanServiceMock = {
      submitScan: jest.fn(),
      persistFallbackSnapshot: jest.fn(),
      clearCachedScan: jest.fn(),
    };

    emailVerificationMock = {
      canResend: jest.fn(async () => true),
      sendVerificationEmail: jest.fn(async () => undefined),
      consumeToken: jest.fn(),
    };

    service = new AuthService(
      prismaMock as any,
      jwtServiceMock as any,
      scanServiceMock as any,
      emailVerificationMock as any,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
    jest.restoreAllMocks();
  });

  describe('signup', () => {
    it('creates an unverified user and only sends the verification link (no tokens, no scan)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValue({ id: 11, email: 'new@example.com' });

      const result = await service.signup({
        email: 'New@Example.com',
        password: 'StrongPass123',
        acceptTerms: true,
      });

      expect(result).toEqual({ requiresEmailVerification: true, email: 'new@example.com' });
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          email: 'new@example.com',
          passwordHash: expect.any(String),
          termsAcceptedAt: expect.any(Date),
          monitoringEnabled: true,
          monitoringConsentAt: expect.any(Date),
        },
      });
      expect((prismaMock.user.create.mock.calls[0][0] as any).data).not.toHaveProperty('emailVerifiedAt');
      expect(emailVerificationMock.canResend).toHaveBeenCalledWith('new@example.com');
      expect(emailVerificationMock.sendVerificationEmail).toHaveBeenCalledWith(11);
      expect(scanServiceMock.submitScan).not.toHaveBeenCalled();
      expect(jwtServiceMock.sign).not.toHaveBeenCalled();
    });

    it('records the monitoring opt-out', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValue({ id: 12, email: 'optout@example.com' });

      await service.signup({
        email: 'optout@example.com',
        password: 'StrongPass123',
        acceptTerms: true,
        acceptMonitoring: false,
      });

      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ monitoringEnabled: false, monitoringConsentAt: null }),
      });
    });

    it('requires the privacy policy to be accepted', async () => {
      await expect(service.signup({
        email: 'no-consent@example.com',
        password: 'StrongPass123',
        acceptTerms: false,
      })).rejects.toThrow('É preciso aceitar a Política de Privacidade para criar a conta');
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('lets whoever controls the inbox take over an unverified account', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 15,
        email: 'pending@example.com',
        passwordHash: 'old-hash',
        emailVerifiedAt: null,
      });

      const result = await service.signup({
        email: 'pending@example.com',
        password: 'NewStrongPass123',
        acceptTerms: true,
      });

      expect(result).toEqual({ requiresEmailVerification: true, email: 'pending@example.com' });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      const update = prismaMock.user.update.mock.calls[0][0] as any;
      expect(update.where).toEqual({ id: 15 });
      expect(update.data.passwordHash).not.toBe('old-hash');
      await expect(bcrypt.compare('NewStrongPass123', update.data.passwordHash)).resolves.toBe(true);
      expect(emailVerificationMock.sendVerificationEmail).toHaveBeenCalledWith(15);
    });

    it('does not issue a new link inside the resend cooldown (the previous link keeps working)', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 16,
        email: 'pending@example.com',
        passwordHash: 'old-hash',
        emailVerifiedAt: null,
      });
      emailVerificationMock.canResend.mockResolvedValue(false);

      await service.signup({ email: 'pending@example.com', password: 'StrongPass123', acceptTerms: true });

      expect(prismaMock.user.update).toHaveBeenCalled();
      expect(emailVerificationMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('rejects verified password accounts and Google-only accounts', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 55,
        email: 'duplicate@example.com',
        passwordHash: 'already-hashed',
        emailVerifiedAt: verifiedAt,
      });
      await expect(
        service.signup({ email: 'duplicate@example.com', password: 'StrongPass123', acceptTerms: true }),
      ).rejects.toThrow('Email já registrado');

      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 18,
        email: 'google-only@example.com',
        googleId: 'google-18',
        passwordHash: null,
        emailVerifiedAt: verifiedAt,
      });
      await expect(service.signup({
        email: 'google-only@example.com',
        password: 'AttackerPass123',
        acceptTerms: true,
      })).rejects.toBeInstanceOf(ConflictException);

      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(emailVerificationMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('rejects invalid signup and login inputs before querying the database', async () => {
      await expect(service.signup({ email: 'invalid-email', password: 'StrongPass123', acceptTerms: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.signup({ email: 'user@example.com', password: 'short', acceptTerms: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.login({ email: '', password: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('consumes the token, runs the initial scan as SIGNUP and signs in', async () => {
      emailVerificationMock.consumeToken.mockResolvedValue({ id: 11, email: 'new@example.com', emailVerifiedAt: verifiedAt });
      scanServiceMock.submitScan.mockResolvedValue(undefined);
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 11,
        email: 'new@example.com',
        emailVerifiedAt: verifiedAt,
        monitoringEnabled: true,
        lastMonitoredAt: null,
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
      });

      const result = await service.verifyEmail('a'.repeat(43));

      expect(emailVerificationMock.consumeToken).toHaveBeenCalledWith('a'.repeat(43));
      expect(scanServiceMock.submitScan).toHaveBeenCalledWith(11, { email: 'new@example.com' }, 'SIGNUP');
      expect(result.access_token).toBe('token-11-access');
      expect(result.refresh_token).toBe('token-11-refresh');
      expect(result.user).toMatchObject({ id: 11, emailVerified: true, monitoringEnabled: true });
    });

    it('keeps the fallback snapshot when the initial scan fails', async () => {
      emailVerificationMock.consumeToken.mockResolvedValue({ id: 19, email: 'fallback@example.com', emailVerifiedAt: verifiedAt });
      scanServiceMock.submitScan.mockRejectedValue(new Error('scan fail'));
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 19,
        email: 'fallback@example.com',
        emailVerifiedAt: verifiedAt,
        monitoringEnabled: true,
        lastMonitoredAt: null,
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
      });

      const result = await service.verifyEmail('b'.repeat(43));

      expect(scanServiceMock.persistFallbackSnapshot).toHaveBeenCalledWith(19, 'fallback@example.com');
      expect(result.user.email).toBe('fallback@example.com');
    });

    it('propagates invalid and expired tokens without signing in', async () => {
      emailVerificationMock.consumeToken.mockRejectedValue(new GoneException({ code: 'TOKEN_EXPIRED' }));

      await expect(service.verifyEmail('c'.repeat(43))).rejects.toBeInstanceOf(GoneException);
      expect(scanServiceMock.submitScan).not.toHaveBeenCalled();
      expect(jwtServiceMock.sign).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    const message = 'Se houver uma conta aguardando verificação com este email, enviamos um novo link.';

    it('sends a new link to an unverified password account', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 20, emailVerifiedAt: null, passwordHash: 'hash' });

      await expect(service.resendVerification('Pending@Example.com')).resolves.toEqual({ message });

      expect(emailVerificationMock.canResend).toHaveBeenCalledWith('pending@example.com');
      expect(emailVerificationMock.sendVerificationEmail).toHaveBeenCalledWith(20);
    });

    it('answers the same way for unknown, verified, Google and rate-limited accounts', async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 21, emailVerifiedAt: verifiedAt, passwordHash: 'hash' })
        .mockResolvedValueOnce({ id: 22, emailVerifiedAt: null, passwordHash: null })
        .mockResolvedValueOnce({ id: 23, emailVerifiedAt: null, passwordHash: 'hash' });
      emailVerificationMock.canResend.mockResolvedValue(false);

      for (const email of ['ghost@example.com', 'verified@example.com', 'google@example.com', 'limited@example.com']) {
        await expect(service.resendVerification(email)).resolves.toEqual({ message });
      }

      expect(emailVerificationMock.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('logs in a verified user when the password is valid', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123', 10);
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ id: 7, email: 'alice@example.com', passwordHash, emailVerifiedAt: verifiedAt })
        .mockResolvedValueOnce({
          id: 7,
          email: 'alice@example.com',
          emailVerifiedAt: verifiedAt,
          monitoringEnabled: false,
          lastMonitoredAt: null,
          scanSnapshot: null,
          scanSnapshotUpdatedAt: null,
        });

      const result = await service.login({ email: 'alice@example.com', password: 'StrongPass123' });

      expect(result.user).toMatchObject({ id: 7, emailVerified: true, monitoringEnabled: false });
      expect(result.access_token).toBe('token-7-access');
    });

    it('answers 403 EMAIL_NOT_VERIFIED and resends the link for unverified accounts', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123', 10);
      prismaMock.user.findUnique.mockResolvedValue({ id: 8, email: 'pending@example.com', passwordHash, emailVerifiedAt: null });

      const error = await service.login({ email: 'pending@example.com', password: 'StrongPass123' }).catch(err => err);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(emailVerificationMock.sendVerificationEmail).toHaveBeenCalledWith(8);
      expect(jwtServiceMock.sign).not.toHaveBeenCalled();

      emailVerificationMock.canResend.mockResolvedValue(false);
      await expect(service.login({ email: 'pending@example.com', password: 'StrongPass123' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(emailVerificationMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('checks the password before revealing that the email is unverified', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 9,
        email: 'bob@example.com',
        passwordHash: await bcrypt.hash('AnotherPass123', 10),
        emailVerifiedAt: null,
      });

      await expect(
        service.login({ email: 'bob@example.com', password: 'WrongPass123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(emailVerificationMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('rejects unknown users and oauth-only accounts', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.login({ email: 'unknown@example.com', password: 'StrongPass123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 77, email: 'oauth@example.com', passwordHash: null });
      await expect(service.login({
        email: 'oauth@example.com',
        password: 'StrongPass123',
      })).rejects.toThrow('Use o login com Google para esta conta');
    });
  });

  describe('refreshTokens', () => {
    const verifiedUser = { id: 7, email: 'jane@example.com', emailVerifiedAt: verifiedAt };

    it('issues a new token pair for a valid refresh token', async () => {
      jwtServiceMock.verify.mockReturnValue({ sub: 7, email: 'jane@example.com', typ: 'refresh' });
      prismaMock.user.findUnique.mockResolvedValue(verifiedUser);

      await expect(service.refreshTokens('a-valid-refresh-token')).resolves.toEqual({
        access_token: 'token-7-access',
        refresh_token: 'token-7-refresh',
      });
      expect(jwtServiceMock.verify).toHaveBeenCalledWith('a-valid-refresh-token', { secret: 'test-refresh-secret' });
      // O refresh token novo também leva a marca typ
      expect(jwtServiceMock.sign).toHaveBeenCalledWith(
        { sub: 7, email: 'jane@example.com', typ: 'refresh' },
        expect.objectContaining({ secret: 'test-refresh-secret' }),
      );
    });

    it.each([
      ['an invalid or expired token', () => jwtServiceMock.verify.mockImplementation(() => { throw new Error('jwt expired'); })],
      ['an access token', () => jwtServiceMock.verify.mockReturnValue({ sub: 7, email: 'jane@example.com' })],
      ['a deleted account', () => {
        jwtServiceMock.verify.mockReturnValue({ sub: 7, email: 'jane@example.com', typ: 'refresh' });
        prismaMock.user.findUnique.mockResolvedValue(null);
      }],
      ['an unverified account', () => {
        jwtServiceMock.verify.mockReturnValue({ sub: 7, email: 'jane@example.com', typ: 'refresh' });
        prismaMock.user.findUnique.mockResolvedValue({ ...verifiedUser, emailVerifiedAt: null });
      }],
    ])('rejects %s with REFRESH_INVALID', async (_label, arrange) => {
      arrange();

      await expect(service.refreshTokens('some-refresh-token')).rejects.toMatchObject({
        status: 401,
        response: { code: 'REFRESH_INVALID' },
      });
      expect(jwtServiceMock.sign).not.toHaveBeenCalled();
    });
  });

  describe('validateJwt', () => {
    it('accepts verified users', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 88, email: 'valid@example.com', emailVerifiedAt: verifiedAt });

      await expect(service.validateJwt({ sub: 88, email: 'valid@example.com' })).resolves.toEqual({
        id: 88,
        email: 'valid@example.com',
      });
    });

    it('rejects missing and unverified users', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.validateJwt({ sub: 100, email: 'ghost@example.com' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 101, email: 'pending@example.com', emailVerifiedAt: null });
      await expect(service.validateJwt({ sub: 101, email: 'pending@example.com' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('account deletion and profile', () => {
    it('deletes an authenticated account and returns a success message', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 33, email: 'delete@example.com' });
      prismaMock.user.delete.mockResolvedValue({ id: 33, email: 'delete@example.com' });

      const result = await service.deleteAccount(33);

      expect(result).toEqual({ message: 'Conta deletada com sucesso' });
      expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 33 } });
      expect(scanServiceMock.clearCachedScan).toHaveBeenCalledWith('delete@example.com');
    });

    it('still deletes the account when the cached scan cannot be cleared', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      prismaMock.user.findUnique.mockResolvedValue({ id: 34, email: 'redis-down@example.com' });
      prismaMock.user.delete.mockResolvedValue({ id: 34 });
      scanServiceMock.clearCachedScan.mockRejectedValue(new Error('Redis down'));

      await expect(service.deleteAccount(34)).resolves.toEqual({ message: 'Conta deletada com sucesso' });
    });

    it('rejects missing deletion targets and missing profiles', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.deleteAccount(999)).rejects.toBeInstanceOf(Error);

      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.getUserProfile(999)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('exposes verification and monitoring fields in the profile', async () => {
      const lastMonitoredAt = new Date('2026-10-14T03:00:00.000Z');
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 40,
        email: 'p@example.com',
        emailVerifiedAt: null,
        monitoringEnabled: true,
        lastMonitoredAt,
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
      });

      await expect(service.getUserProfile(40)).resolves.toEqual({
        id: 40,
        email: 'p@example.com',
        emailVerified: false,
        monitoringEnabled: true,
        lastMonitoredAt,
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
      });
    });
  });

  describe('Google OAuth', () => {
    it('returns a valid Google auth URL with state', async () => {
      const redirectUrl = await service.getGoogleAuthUrl();

      expect(redirectUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(redirectUrl).toContain('state=');
      expect(redirectUrl).toContain('client_id=google-client-id');
    });

    it('creates a verified Google user and redirects with the token hash', async () => {
      const state = (service as any).createGoogleOAuthState();
      (axios.post as any).mockResolvedValue({ data: { access_token: 'google-access-token' } });
      (axios.get as any).mockResolvedValue({
        data: { sub: 'google-user-123', email: 'google-user@example.com', email_verified: true },
      });

      prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValue({
        id: 44,
        email: 'google-user@example.com',
        googleId: 'google-user-123',
        passwordHash: null,
      });

      const redirectUrl = await service.handleGoogleCallback('test-code', state);

      expect(redirectUrl).toContain('http://localhost:5173/#');
      expect(redirectUrl).toContain('access_token=token-44-access');
      expect(redirectUrl).toContain('provider=google');
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          emailVerifiedAt: expect.any(Date),
          monitoringEnabled: true,
          monitoringConsentAt: expect.any(Date),
          termsAcceptedAt: expect.any(Date),
        }),
      });
      // Conta nova pelo Google entra no painel já com o scan inicial, como no cadastro por email
      expect(scanServiceMock.submitScan).toHaveBeenCalledWith(44, { email: 'google-user@example.com' }, 'SIGNUP');
    });

    it('does not scan again when a Google user who already has a scan signs in', async () => {
      const state = (service as any).createGoogleOAuthState();
      (axios.post as any).mockResolvedValue({ data: { access_token: 'google-access-token' } });
      (axios.get as any).mockResolvedValue({
        data: { sub: 'google-user-77', email: 'returning@example.com', email_verified: true },
      });
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 77,
        email: 'returning@example.com',
        googleId: 'google-user-77',
        emailVerifiedAt: verifiedAt,
        scanSnapshotUpdatedAt: new Date('2026-10-01T00:00:00.000Z'),
      });

      await service.handleGoogleCallback('test-code', state);

      expect(scanServiceMock.submitScan).not.toHaveBeenCalled();
    });

    it('stores the fallback snapshot when the first Google scan fails', async () => {
      const state = (service as any).createGoogleOAuthState();
      (axios.post as any).mockResolvedValue({ data: { access_token: 'google-access-token' } });
      (axios.get as any).mockResolvedValue({
        data: { sub: 'google-user-45', email: 'fail@example.com', email_verified: true },
      });
      prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prismaMock.user.create.mockResolvedValue({ id: 45, email: 'fail@example.com', googleId: 'google-user-45' });
      scanServiceMock.submitScan.mockRejectedValue(new Error('hibp down'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const redirectUrl = await service.handleGoogleCallback('test-code', state);

      expect(redirectUrl).toContain('access_token=token-45-access');
      expect(scanServiceMock.persistFallbackSnapshot).toHaveBeenCalledWith(45, 'fail@example.com');
    });

    it('returns a verified Google user unchanged and marks an unverified one as verified', async () => {
      const verifiedGoogleUser = { id: 21, email: 'same@example.com', emailVerifiedAt: verifiedAt };
      prismaMock.user.findUnique.mockResolvedValueOnce(verifiedGoogleUser);
      await expect((service as any).upsertGoogleUser({ googleId: 'g-1', email: 'same@example.com' })).resolves.toEqual(
        verifiedGoogleUser,
      );
      expect(prismaMock.user.update).not.toHaveBeenCalled();

      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 24, email: 'same@example.com', emailVerifiedAt: null });
      prismaMock.user.update.mockResolvedValueOnce({ id: 24 });
      await (service as any).upsertGoogleUser({ googleId: 'g-4', email: 'same@example.com' });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 24 },
        data: { email: 'same@example.com', emailVerifiedAt: expect.any(Date) },
      });
    });

    it('updates a Google user when the Google email changes', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 90,
        email: 'old@example.com',
        googleId: 'google-90',
        emailVerifiedAt: verifiedAt,
      });
      prismaMock.user.update.mockResolvedValue({ id: 90, email: 'new@example.com', googleId: 'google-90' });

      await expect(
        (service as any).upsertGoogleUser({ googleId: 'google-90', email: 'new@example.com' }),
      ).resolves.toMatchObject({ id: 90, email: 'new@example.com' });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 90 },
        data: { email: 'new@example.com', emailVerifiedAt: verifiedAt },
      });
    });

    it('drops the password when linking Google to an unverified account', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 22,
        email: 'linked@example.com',
        passwordHash: 'maybe-set-by-someone-else',
        emailVerifiedAt: null,
      });
      prismaMock.user.update.mockResolvedValueOnce({ id: 22, email: 'linked@example.com', googleId: 'g-2' });

      await expect((service as any).upsertGoogleUser({ googleId: 'g-2', email: 'linked@example.com' })).resolves.toMatchObject({
        id: 22,
        googleId: 'g-2',
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 22 },
        data: { googleId: 'g-2', emailVerifiedAt: expect.any(Date), passwordHash: null },
      });
    });

    it('keeps the password when linking Google to an already verified account', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 23,
        email: 'verified@example.com',
        passwordHash: 'owner-hash',
        emailVerifiedAt: verifiedAt,
      });
      prismaMock.user.update.mockResolvedValueOnce({ id: 23 });

      await (service as any).upsertGoogleUser({ googleId: 'g-3', email: 'verified@example.com' });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 23 },
        data: { googleId: 'g-3', emailVerifiedAt: verifiedAt },
      });
    });

    it('rejects missing Google callback params and tampered states', async () => {
      await expect(service.handleGoogleCallback('', 'state')).rejects.toBeInstanceOf(BadRequestException);

      const validState = (service as any).createGoogleOAuthState();
      expect(() => (service as any).verifyGoogleOAuthState(`${validState}x`)).toThrow('State inválido');
    });

    it('rejects incomplete and unverified Google profiles', async () => {
      const state = (service as any).createGoogleOAuthState();
      (axios.post as any).mockResolvedValue({ data: { access_token: 'google-token' } });

      (axios.get as any).mockResolvedValueOnce({ data: { sub: 'missing-email' } });
      await expect(service.handleGoogleCallback('code', state)).rejects.toThrow(
        'Perfil do Google incompleto',
      );

      const verifiedState = (service as any).createGoogleOAuthState();
      (axios.get as any).mockResolvedValueOnce({
        data: { sub: 'unverified', email: 'unverified@example.com', email_verified: false },
      });
      await expect(service.handleGoogleCallback('code', verifiedState)).rejects.toThrow(
        'Email do Google não verificado',
      );
    });

    it('rejects a Google callback when the token response has no access token', async () => {
      const state = (service as any).createGoogleOAuthState();
      (axios.post as any).mockResolvedValue({ data: {} });

      await expect(service.handleGoogleCallback('code', state)).rejects.toThrow(
        'Falha ao autenticar com Google',
      );
    });

    it('rejects malformed and expired OAuth states', async () => {
      expect(() => (service as any).verifyGoogleOAuthState('malformed')).toThrow('State inválido');

      const expiredTimestamp = Date.now() - 11 * 60 * 1000;
      const nonce = 'expired-nonce';
      const expiredPayload = `${expiredTimestamp}:${nonce}`;
      const crypto = require('crypto');
      const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'safeid-google-state';
      const expiredSignature = crypto
        .createHmac('sha256', secret)
        .update(expiredPayload)
        .digest('hex');
      expect(() =>
        (service as any).verifyGoogleOAuthState(`${expiredTimestamp}:${nonce}:${expiredSignature}`),
      ).toThrow('State expirado');
    });
  });
});
