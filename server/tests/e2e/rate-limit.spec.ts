import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { RateLimitModule } from '../../src/infra/rate-limit/rate-limit.module';
import { PrismaService } from '../../src/infra/database/prisma.service';
import { ScanService } from '../../src/modules/scan/services/scan.service';

describe('Rate limit E2E', () => {
  let app: INestApplication;
  let baseUrl = '';

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';

    const prismaMock = {
      user: {
        findUnique: jest.fn(async () => null),
      },
    } as any;

    const moduleRef = await Test.createTestingModule({
      imports: [RateLimitModule, AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ScanService)
      .useValue({})
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

  it('blocks login attempts after the limit is reached', async () => {
    const attempt = () =>
      fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'victim@example.com', password: 'wrong-password' }),
      });

    for (let i = 0; i < 5; i++) {
      const response = await attempt();
      expect(response.status).toBe(401);
    }

    const blocked = await attempt();
    const body = (await blocked.json()) as any;

    expect(blocked.status).toBe(429);
    expect(body.message).toContain('Muitas requisições');
  });

  it('counts each client separately when the API is behind a proxy', async () => {
    const attemptFrom = (clientIp: string) =>
      fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `${clientIp}, 10.0.0.1` },
        body: JSON.stringify({ email: 'user@example.com', password: 'wrong-password' }),
      });

    for (let i = 0; i < 5; i++) {
      expect((await attemptFrom('203.0.113.10')).status).toBe(401);
    }

    expect((await attemptFrom('203.0.113.10')).status).toBe(429);
    expect((await attemptFrom('198.51.100.20')).status).toBe(401);
  });
});
