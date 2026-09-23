import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { ScanModule } from '../../src/modules/scan/scan.module';
import { ScanService } from '../../src/modules/scan/services/scan.service';
import { PrismaService } from '../../src/infra/database/prisma.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';

describe('Scan API E2E', () => {
  let app: INestApplication;
  let baseUrl = '';
  let scanServiceMock: any;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';

    scanServiceMock = {
      submitScan: jest.fn(async () => ({
        jobId: 'scan-job-123',
        riskScore: 42,
        classification: 'MODERATE',
        breachesFound: 1,
        recommendation: 'Change your password and enable 2FA.',
        isVerified: true,
      })),
      getUserHistory: jest.fn(async () => [
        {
          id: 'scan-job-123',
          riskScore: 42,
          classification: 'MODERATE',
          breachesFound: 1,
          createdAt: new Date('2026-09-10T00:00:00.000Z'),
        },
      ]),
      getScanDetail: jest.fn(async () => ({
        jobId: 'scan-job-123',
        riskScore: 42,
        classification: 'MODERATE',
        breachesFound: 1,
        recommendation: 'Change your password and enable 2FA.',
        breachData: [{ source: 'public-breach' }],
        processedAt: new Date('2026-09-10T00:00:00.000Z'),
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
      })),
    };

    const prismaMock = {
      $connect: jest.fn(async () => undefined),
      $disconnect: jest.fn(async () => undefined),
    } as any;

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, ScanModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const request = context.switchToHttp().getRequest();
          request.user = { sub: 7, email: 'user@example.com' };
          return true;
        },
      })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ScanService)
      .useValue(scanServiceMock)
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

  it('submits a scan through POST /api/v1/scan', async () => {
    const response = await fetch(`${baseUrl}/api/v1/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'user@example.com' }),
    });

    expect(response.status).toBe(201);

    const body = (await response.json()) as any;
    expect(body).toMatchObject({
      jobId: 'scan-job-123',
      riskScore: 42,
      classification: 'MODERATE',
      breachesFound: 1,
      recommendation: 'Change your password and enable 2FA.',
      isVerified: true,
    });

    expect(scanServiceMock.submitScan).toHaveBeenCalledWith(7, {
      email: 'user@example.com',
    });
  });

  it('returns scan history through GET /api/v1/scan/history', async () => {
    const response = await fetch(`${baseUrl}/api/v1/scan/history`, {
      headers: {},
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body).toEqual([
      {
        id: 'scan-job-123',
        riskScore: 42,
        classification: 'MODERATE',
        breachesFound: 1,
        createdAt: '2026-09-10T00:00:00.000Z',
      },
    ]);

    expect(scanServiceMock.getUserHistory).toHaveBeenCalledWith(7);
  });

  it('returns a scan detail through GET /api/v1/scan/:jobId', async () => {
    const response = await fetch(`${baseUrl}/api/v1/scan/scan-job-123`, {
      headers: {},
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body).toMatchObject({
      jobId: 'scan-job-123',
      riskScore: 42,
      classification: 'MODERATE',
      breachesFound: 1,
      recommendation: 'Change your password and enable 2FA.',
    });

    expect(scanServiceMock.getScanDetail).toHaveBeenCalledWith(7, 'scan-job-123');
  });
});
