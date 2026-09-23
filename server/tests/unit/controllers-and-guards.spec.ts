import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { DevAuthGuard } from '../../src/api/guards/dev-auth.guard';
import { CurrentUser } from '../../src/api/decorators/current-user.decorator';
import { ScanController } from '../../src/modules/scan/scan.controller';
import { HealthController } from '../../src/modules/health/health.controller';

describe('controller and guard unit coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('auth controller delegates signup, login, me and delete flows', async () => {
    const authService = {
      signup: jest.fn(async () => ({ access_token: 'token', user: { id: 1, email: 'a@b.com' } })),
      login: jest.fn(async () => ({ access_token: 'login-token', user: { id: 2, email: 'b@c.com' } })),
      getUserProfile: jest.fn(async () => ({ id: 3, email: 'c@d.com' })),
      deleteAccount: jest.fn(async () => ({ deleted: true })),
      getGoogleAuthUrl: jest.fn(async () => 'https://example.com/google'),
      handleGoogleCallback: jest.fn(async () => 'https://example.com/callback'),
    } as any;

    const controller = new AuthController(authService);
    const signupDto = { email: 'a@b.com', password: 'Strong123!' };
    const loginDto = { email: 'b@c.com', password: 'Strong123!' };
    const response = { redirect: jest.fn() } as any;

    await expect(controller.signup(signupDto)).resolves.toMatchObject({ access_token: 'token' });
    await expect(controller.login(loginDto)).resolves.toMatchObject({ access_token: 'login-token' });
    await expect(controller.getMe({ sub: 3 } as any)).resolves.toMatchObject({ id: 3, email: 'c@d.com' });
    await expect(controller.deleteMe({ sub: 9 } as any)).resolves.toEqual({ deleted: true });
    await controller.googleAuth(response);
    await controller.googleCallback('code-123', 'state-456', response);

    expect(authService.signup).toHaveBeenCalledWith(signupDto);
    expect(authService.login).toHaveBeenCalledWith(loginDto);
    expect(authService.getUserProfile).toHaveBeenCalledWith(3);
    expect(authService.deleteAccount).toHaveBeenCalledWith(9);
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://example.com/google');
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://example.com/callback');
  });

  it('scan controller delegates to the scan service for submit, history and detail', async () => {
    const service = {
      submitScan: jest.fn(async () => ({ jobId: 'job-1', riskScore: 5, classification: 'LOW' })),
      getUserHistory: jest.fn(async () => [{ id: 'job-1', riskScore: 5, classification: 'LOW' }]),
      getScanDetail: jest.fn(async () => ({ jobId: 'job-1', riskScore: 10, classification: 'MODERATE' })),
    } as any;

    const controller = new ScanController(service);
    const dto = { email: 'user@example.com' };

    await expect(controller.submitScan(12, dto)).resolves.toMatchObject({ jobId: 'job-1' });
    await expect(controller.getHistory(12)).resolves.toEqual([{ id: 'job-1', riskScore: 5, classification: 'LOW' }]);
    await expect(controller.getScanDetail(12, 'job-1')).resolves.toMatchObject({ jobId: 'job-1' });

    expect(service.submitScan).toHaveBeenCalledWith(12, dto);
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
  });

  it('jwt strategy validates payloads and rejects invalid token data', () => {
    const strategy = new JwtStrategy();

    expect(strategy.validate({ sub: 15, email: 'x@y.com' } as any)).toEqual({ sub: 15, email: 'x@y.com' });
    expect(() => strategy.validate({ sub: 0, email: '' } as any)).toThrow(UnauthorizedException);
    expect(() => strategy.validate({ sub: null } as any)).toThrow('Invalid token');
  });

  it('dev auth guard assigns a fake user only in development and keeps header-auth requests valid', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const guard = new DevAuthGuard();
    const requestWithNoAuth = { headers: {} } as any;
    const contextNoAuth = { switchToHttp: () => ({ getRequest: () => requestWithNoAuth }) } as any;
    expect(guard.canActivate(contextNoAuth)).toBe(true);
    expect(requestWithNoAuth.user).toEqual({ id: 1, email: 'dev-test@localhost', role: 'user' });

    const requestWithAuth = { headers: { authorization: 'Bearer token' } } as any;
    const contextWithAuth = { switchToHttp: () => ({ getRequest: () => requestWithAuth }) } as any;
    expect(guard.canActivate(contextWithAuth)).toBe(true);

    process.env.NODE_ENV = originalNodeEnv;
  });

  it('current user decorator is exposed as a Nest parameter decorator factory', () => {
    expect(typeof CurrentUser).toBe('function');
    expect(typeof (CurrentUser as any)('sub')).toBe('function');
    expect(typeof (CurrentUser as any)('email')).toBe('function');
  });
});
