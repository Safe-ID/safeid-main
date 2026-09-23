import { describe, expect, it, jest } from '@jest/globals';
import { HealthService } from '../../src/modules/health/health.service';

describe('HealthService', () => {
  it('returns ok when the database is healthy', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ '1': 1 }]),
    } as any;

    const service = new HealthService(prisma);
    const result = await service.getHealth();

    expect(result.status).toBe('ok');
    expect(result.database).toMatchObject({ status: 'ok' });
  });

  it('returns error status when the database is unavailable', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => {
        throw new Error('db down');
      }),
    } as any;

    const service = new HealthService(prisma);
    const result = await service.getHealth();

    expect(result.status).toBe('error');
    expect(result.database).toMatchObject({
      status: 'error',
      message: 'Database connection failed',
    });
  });
});
