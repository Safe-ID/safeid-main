import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { HealthModule } from '../../src/modules/health/health.module';
import { PrismaService } from '../../src/infra/database/prisma.service';

describe('Health API E2E', () => {
  let app: INestApplication;
  let baseUrl = '';

  beforeEach(async () => {
    const prismaMock = {
      $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
    } as any;

    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
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

  it('responds to GET /api/health with database status ok', async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as any;

    expect(body).toMatchObject({
      status: 'ok',
      database: {
        status: 'ok',
      },
    });
    expect(typeof body.timestamp).toBe('string');
  });
});
