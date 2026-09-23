import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../../src/modules/auth/auth.service';

jest.mock('axios');

describe('AuthService', () => {
  let prismaMock: any;
  let jwtServiceMock: any;
  let scanServiceMock: any;
  let service: AuthService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/v1/auth/google/callback';
    process.env.FRONTEND_URL = 'http://localhost:5173';

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
    };

    scanServiceMock = {
      submitScan: jest.fn(),
      persistFallbackSnapshot: jest.fn(),
    };

    service = new AuthService(prismaMock as any, jwtServiceMock as any, scanServiceMock as any);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('creates a new user and runs an initial scan on signup', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 11,
        email: 'new@example.com',
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
      });
    prismaMock.user.create.mockResolvedValue({
      id: 11,
      email: 'new@example.com',
      passwordHash: 'hashed-password',
    });
    scanServiceMock.submitScan.mockResolvedValue(undefined);

    const result = await service.signup({
      email: 'new@example.com',
      password: 'StrongPass123',
    });

    expect(result.access_token).toBe('token-11-access');
    expect(result.user.email).toBe('new@example.com');
    expect(scanServiceMock.submitScan).toHaveBeenCalledWith(11, {
      email: 'new@example.com',
    });
  });

  it('logs in an existing user when the password is valid', async () => {
    const passwordHash = await bcrypt.hash('StrongPass123', 10);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 7,
        email: 'alice@example.com',
        passwordHash,
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
      })
      .mockResolvedValueOnce({
        id: 7,
        email: 'alice@example.com',
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
      });

    const result = await service.login({
      email: 'alice@example.com',
      password: 'StrongPass123',
    });

    expect(result.user.id).toBe(7);
    expect(result.access_token).toBe('token-7-access');
  });

  it('rejects invalid credentials on login', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 9,
      email: 'bob@example.com',
      passwordHash: await bcrypt.hash('AnotherPass123', 10),
      scanSnapshot: null,
      scanSnapshotUpdatedAt: null,
    });

    await expect(
      service.login({ email: 'bob@example.com', password: 'WrongPass123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deletes an authenticated account and returns a success message', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 33,
      email: 'delete@example.com',
    });
    prismaMock.user.delete.mockResolvedValue({
      id: 33,
      email: 'delete@example.com',
    });

    const result = await service.deleteAccount(33);

    expect(result).toEqual({ message: 'Conta deletada com sucesso' });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 33 } });
  });

  it('returns a valid Google auth URL with state', async () => {
    const redirectUrl = await service.getGoogleAuthUrl();

    expect(redirectUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(redirectUrl).toContain('state=');
    expect(redirectUrl).toContain('client_id=google-client-id');
  });

  it('handles a successful Google callback and redirects with token hash', async () => {
    const state = (service as any).createGoogleOAuthState();
    const axiosPostMock = axios.post as any;
    const axiosGetMock = axios.get as any;

    axiosPostMock.mockResolvedValue({
      data: { access_token: 'google-access-token' },
    });
    axiosGetMock.mockResolvedValue({
      data: {
        sub: 'google-user-123',
        email: 'google-user@example.com',
        email_verified: true,
      },
    });

    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
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
  });

  it('validates JWT payloads and rejects missing users', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(service.validateJwt({ sub: 100, email: 'ghost@example.com' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('covers fallback signup and profile failure branches', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 19,
        email: 'fallback@example.com',
        passwordHash: null,
      })
      .mockResolvedValueOnce({
        id: 19,
        email: 'fallback@example.com',
        passwordHash: null,
      });
    prismaMock.user.update.mockResolvedValue({
      id: 19,
      email: 'fallback@example.com',
      passwordHash: 'hash',
    });
    scanServiceMock.submitScan.mockRejectedValue(new Error('scan fail'));
    scanServiceMock.persistFallbackSnapshot.mockResolvedValue(undefined);

    const result = await service.signup({
      email: 'fallback@example.com',
      password: 'StrongPass123',
    });

    expect(result.user.email).toBe('fallback@example.com');
    expect(scanServiceMock.persistFallbackSnapshot).toHaveBeenCalledWith(19, 'fallback@example.com');

    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.getUserProfile(999)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('handles Google user upsert and invalid state branches', async () => {
    const existingByGoogleId = {
      id: 21,
      email: 'same@example.com',
    };
    prismaMock.user.findUnique.mockResolvedValueOnce(existingByGoogleId);
    await expect((service as any).upsertGoogleUser({ googleId: 'g-1', email: 'same@example.com' })).resolves.toEqual(existingByGoogleId);

    prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 22,
      email: 'linked@example.com',
    });
    prismaMock.user.update.mockResolvedValueOnce({
      id: 22,
      email: 'linked@example.com',
      googleId: 'g-2',
    });
    await expect((service as any).upsertGoogleUser({ googleId: 'g-2', email: 'linked@example.com' })).resolves.toMatchObject({ id: 22, googleId: 'g-2' });

    const validState = (service as any).createGoogleOAuthState();
    expect(() => (service as any).verifyGoogleOAuthState(`${validState}x`)).toThrow('State inválido');
    await expect(service.handleGoogleCallback('', 'state')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oauth-only login and missing deletion target', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 77,
      email: 'oauth@example.com',
      passwordHash: null,
      scanSnapshot: null,
      scanSnapshotUpdatedAt: null,
    });

    await expect(service.login({
      email: 'oauth@example.com',
      password: 'StrongPass123',
    })).rejects.toBeInstanceOf(UnauthorizedException);

    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.deleteAccount(999)).rejects.toBeInstanceOf(Error);
  });

  it('rejects missing Google callback params', async () => {
    await expect(service.handleGoogleCallback('', 'state')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
