import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { CurrentUser } from '../../src/api/decorators/current-user.decorator';
import { ScanController } from '../../src/modules/scan/scan.controller';
import { HealthController } from '../../src/modules/health/health.controller';

describe('controller and guard unit coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('auth controller delegates signup, login, me and delete flows', async () => {
    const authService = {
      signup: jest.fn(async () => ({ requiresEmailVerification: true, email: 'a@b.com' })),
      verifyEmail: jest.fn(async () => ({ access_token: 'verified-token', user: { id: 1, email: 'a@b.com' } })),
      resendVerification: jest.fn(async () => ({ message: 'ok' })),
      login: jest.fn(async () => ({ access_token: 'login-token', user: { id: 2, email: 'b@c.com' } })),
      refreshTokens: jest.fn(async () => ({ access_token: 'new-access', refresh_token: 'new-refresh' })),
      getUserProfile: jest.fn(async () => ({ id: 3, email: 'c@d.com' })),
      deleteAccount: jest.fn(async () => ({ deleted: true })),
      getGoogleAuthUrl: jest.fn(async () => 'https://example.com/google'),
      handleGoogleCallback: jest.fn(async () => 'https://example.com/callback'),
    } as any;

    const controller = new AuthController(authService);
    const signupDto = { email: 'a@b.com', password: 'Strong123!', acceptTerms: true };
    const loginDto = { email: 'b@c.com', password: 'Strong123!' };
    const response = { redirect: jest.fn() } as any;

    await expect(controller.signup(signupDto)).resolves.toEqual({ requiresEmailVerification: true, email: 'a@b.com' });
    await expect(controller.verifyEmail({ token: 't'.repeat(43) })).resolves.toMatchObject({ access_token: 'verified-token' });
    await expect(controller.resendVerification({ email: 'a@b.com' })).resolves.toEqual({ message: 'ok' });
    await expect(controller.login(loginDto)).resolves.toMatchObject({ access_token: 'login-token' });
    await expect(controller.refresh({ refresh_token: 'r'.repeat(30) })).resolves.toEqual({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    });
    await expect(controller.getMe({ sub: 3 } as any)).resolves.toMatchObject({ id: 3, email: 'c@d.com' });
    await expect(controller.deleteMe({ sub: 9 } as any)).resolves.toEqual({ deleted: true });
    await controller.googleAuth(response);
    await controller.googleCallback('code-123', 'state-456', response);

    expect(authService.signup).toHaveBeenCalledWith(signupDto);
    expect(authService.verifyEmail).toHaveBeenCalledWith('t'.repeat(43));
    expect(authService.resendVerification).toHaveBeenCalledWith('a@b.com');
    expect(authService.login).toHaveBeenCalledWith(loginDto);
    expect(authService.refreshTokens).toHaveBeenCalledWith('r'.repeat(30));
    expect(authService.getUserProfile).toHaveBeenCalledWith(3);
    expect(authService.deleteAccount).toHaveBeenCalledWith(9);
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://example.com/google');
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://example.com/callback');
  });

  it('scan controller delegates history and detail to the scan service', async () => {
    const service = {
      getUserHistory: jest.fn(async () => [{ id: 'job-1', riskScore: 5, classification: 'LOW' }]),
      getScanDetail: jest.fn(async () => ({ jobId: 'job-1', riskScore: 10, classification: 'MODERATE' })),
    } as any;

    const controller = new ScanController(service);

    await expect(controller.getHistory(12)).resolves.toEqual([{ id: 'job-1', riskScore: 5, classification: 'LOW' }]);
    await expect(controller.getScanDetail(12, 'job-1')).resolves.toMatchObject({ jobId: 'job-1' });

    // O scan só roda no cadastro e no monitoramento: não há rota para o usuário disparar
    expect((controller as any).submitScan).toBeUndefined();
    expect(service.getUserHistory).toHaveBeenCalledWith(12);
    expect(service.getScanDetail).toHaveBeenCalledWith(12, 'job-1');
  });

  it('health controller exposes application status', async () => {
    const service = {
      getHealth: jest.fn(async () => ({ status: 'ok', timestamp: '2026-01-01T00:00:00.000Z' })),
    } as any;

    const controller = new HealthController(service);
    await expect(controller.check()).resolves.toMatchObject({ status: 'ok' });
    expect(service.getHealth).toHaveBeenCalledTimes(1);

    service.getHealth.mockResolvedValueOnce({ status: 'error', timestamp: '2026-01-01T00:00:00.000Z' });
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('jwt strategy validates payloads and only accepts existing verified accounts', async () => {
    // Não depende de outra suíte ter definido o segredo antes no mesmo processo
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
    const findUnique = jest.fn<(args: any) => Promise<any>>();
    const strategy = new JwtStrategy({ user: { findUnique } } as any);

    findUnique.mockResolvedValueOnce({ emailVerifiedAt: new Date() });
    await expect(strategy.validate({ sub: 15, email: 'x@y.com' } as any)).resolves.toEqual({ sub: 15, email: 'x@y.com' });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 15 }, select: { emailVerifiedAt: true } });

    await expect(strategy.validate({ sub: 0, email: '' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({ sub: null } as any)).rejects.toThrow('Invalid token');
    // Refresh token não serve como token de acesso
    await expect(strategy.validate({ sub: 15, email: 'x@y.com', typ: 'refresh' } as any)).rejects.toThrow('Invalid token');

    findUnique.mockResolvedValueOnce(null);
    await expect(strategy.validate({ sub: 16, email: 'gone@y.com' } as any)).rejects.toThrow('Usuário não encontrado');

    findUnique.mockResolvedValueOnce({ emailVerifiedAt: null });
    const error = await strategy.validate({ sub: 17, email: 'pending@y.com' } as any).catch(err => err);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('current user decorator is exposed as a Nest parameter decorator factory', () => {
    expect(typeof CurrentUser).toBe('function');
    expect(typeof (CurrentUser as any)('sub')).toBe('function');
    expect(typeof (CurrentUser as any)('email')).toBe('function');
  });
});
