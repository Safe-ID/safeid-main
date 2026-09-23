import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { PrismaService } from '../../src/infra/database/prisma.service';
import { ScanService } from '../../src/modules/scan/services/scan.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';

describe('Auth API E2E', () => {
  let app: INestApplication;
  let baseUrl = '';
  let prismaMock: any;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';

    prismaMock = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const scanMock = {
      submitScan: jest.fn(async () => undefined),
      persistFallbackSnapshot: jest.fn(async () => undefined),
    } as any;

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const request = context.switchToHttp().getRequest();
          request.user = { sub: 303, email: 'delete@example.com' };
          return true;
        },
      })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ScanService)
      .useValue(scanMock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('registers a new user through POST /api/v1/auth/signup', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 101,
        email: 'jane@example.com',
        passwordHash: 'hashed-password',
        scanSnapshot: null,
        scanSnapshotUpdatedAt: null,
      });
    prismaMock.user.create.mockResolvedValue({
      id: 101,
      email: 'jane@example.com',
      passwordHash: 'hashed-password',
      scanSnapshot: null,
      scanSnapshotUpdatedAt: null,
    });

    const response = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'jane@example.com',
        password: 'StrongPass123',
      }),
    });

    expect(response.status).toBe(201);

    const body = (await response.json()) as any;
    expect(body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      user: {
        id: 101,
        email: 'jane@example.com',
      },
    });

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: {
        email: 'jane@example.com',
        passwordHash: expect.any(String),
      },
    });
  });

  it('logs in an existing user through POST /api/v1/auth/login', async () => {
    const passwordHash = await bcrypt.hash('StrongPass123', 10);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 202,
      email: 'alice@example.com',
      passwordHash,
      scanSnapshot: null,
      scanSnapshotUpdatedAt: null,
    });

    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'StrongPass123',
      }),
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      user: {
        id: 202,
        email: 'alice@example.com',
      },
    });
  });

  it('deletes the authenticated user through DELETE /api/v1/auth/me', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 303,
      email: 'delete@example.com',
      passwordHash: 'hashed-password',
      scanSnapshot: null,
      scanSnapshotUpdatedAt: null,
    });
    prismaMock.user.delete.mockResolvedValue({
      id: 303,
      email: 'delete@example.com',
      passwordHash: 'hashed-password',
      scanSnapshot: null,
      scanSnapshotUpdatedAt: null,
    });

    const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body).toMatchObject({
      message: 'Conta deletada com sucesso',
    });

    expect(prismaMock.user.delete).toHaveBeenCalledWith({
      where: { id: 303 },
    });
  });
});
