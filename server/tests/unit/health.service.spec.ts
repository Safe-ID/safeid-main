import { describe, expect, it, jest } from '@jest/globals';
import { HealthService } from '../../src/modules/health/health.service';

describe('HealthService', () => {
  const healthyRedis = () => ({ ping: jest.fn(async () => 'PONG') }) as any;

  it('returns ok when the database and Redis are healthy', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ '1': 1 }]),
    } as any;

    const service = new HealthService(prisma, healthyRedis());
    const result = await service.getHealth();

    expect(result.status).toBe('ok');
    expect(result.database).toMatchObject({ status: 'ok' });
    expect(result.redis).toMatchObject({ status: 'ok' });
  });

  it('returns error status when the database is unavailable', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => {
        throw new Error('db down');
      }),
    } as any;

    const service = new HealthService(prisma, healthyRedis());
    const result = await service.getHealth();

    expect(result.status).toBe('error');
    expect(result.database).toMatchObject({
      status: 'error',
      message: 'Database connection failed',
    });
  });

  it('returns error status when Redis is unavailable', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ '1': 1 }]),
    } as any;
    const redis = {
      ping: jest.fn(async () => {
        throw new Error('redis down');
      }),
    } as any;

    const service = new HealthService(prisma, redis);
    const result = await service.getHealth();

    expect(result.status).toBe('error');
    expect(result.database).toMatchObject({ status: 'ok' });
    expect(result.redis).toMatchObject({
      status: 'error',
      message: 'Redis connection failed',
    });
  });

  it('does not hang when Redis never answers', async () => {
    jest.useFakeTimers();
    const prisma = {
      $queryRaw: jest.fn(async () => [{ '1': 1 }]),
    } as any;
    const redis = {
      ping: jest.fn(() => new Promise(() => undefined)),
    } as any;

    const service = new HealthService(prisma, redis);
    const pending = service.getHealth();
    await jest.advanceTimersByTimeAsync(2000);
    const result = await pending;
    jest.useRealTimers();

    expect(result.status).toBe('error');
    expect(result.redis).toMatchObject({ status: 'error' });
  });
});
