import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AdminTokenGuard } from '../../src/api/guards/admin-token.guard';
import { JobsHealthService } from '../../src/modules/monitoring/services/jobs-health.service';
import { JobsHealthController } from '../../src/modules/monitoring/jobs-health.controller';
import { createFakeRedis, FakeQueue } from '../helpers/in-memory-prisma';

const contextWith = (headers: Record<string, unknown>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

describe('AdminTokenGuard', () => {
  const guard = new AdminTokenGuard();

  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
  });

  it('is disabled (403) when ADMIN_TOKEN is not configured', () => {
    expect(() => guard.canActivate(contextWith({ 'x-admin-token': 'anything' }))).toThrow(ForbiddenException);
  });

  it('accepts only the configured token', () => {
    process.env.ADMIN_TOKEN = 'admin-secret';

    expect(guard.canActivate(contextWith({ 'x-admin-token': 'admin-secret' }))).toBe(true);
    expect(guard.canActivate(contextWith({ 'x-admin-token': ' admin-secret ' }))).toBe(true);
    expect(() => guard.canActivate(contextWith({ 'x-admin-token': 'wrong' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextWith({ 'x-admin-token': ['admin-secret'] }))).toThrow(UnauthorizedException);
  });
});

describe('JobsHealthService', () => {
  let redis: ReturnType<typeof createFakeRedis>;
  let hibpQueue: FakeQueue;
  let monitoringQueue: FakeQueue;
  let emailQueue: FakeQueue;
  let catalog: any;
  let plan: any;
  let service: JobsHealthService;

  beforeEach(async () => {
    redis = createFakeRedis();
    hibpQueue = new FakeQueue('hibp-check');
    monitoringQueue = new FakeQueue('monitoring');
    emailQueue = new FakeQueue('email');
    catalog = { getLastSyncAt: jest.fn(async () => new Date('2026-10-15T12:00:00.000Z')) };
    plan = {
      getPlan: jest.fn(async () => ({
        name: 'Pwned 1',
        rpm: 10,
        authOk: true,
        subscribedUntil: '2027-01-01T00:00:00',
        source: 'api',
        checkedAt: 'x',
      })),
    };
    service = new JobsHealthService(catalog, plan, redis as any, hibpQueue as any, monitoringQueue as any, emailQueue as any);

    await redis.set('monitoring:catalog:lastProbeAt', '2026-10-15T12:05:00.000Z');
    await redis.set('worker:heartbeat:task-b', JSON.stringify({ ts: '2026-10-15T12:10:00.000Z', pid: 7 }));
    await redis.set('worker:heartbeat:task-a', 'not-json');
    await monitoringQueue.upsertJobScheduler('catalog-sync', { pattern: '0 */6 * * *', tz: 'America/Sao_Paulo' }, { name: 'catalog-sync' });
    await hibpQueue.add('monitor-check', { userId: 1 }, { priority: 10 });
  });

  it('reports catalog, plan, queues, schedulers and heartbeats', async () => {
    const report = await service.getReport();

    expect(report).toMatchObject({
      checkedAt: expect.any(String),
      lastCatalogSyncAt: '2026-10-15T12:00:00.000Z',
      lastProbeAt: '2026-10-15T12:05:00.000Z',
      plan: { name: 'Pwned 1', rpm: 10, authOk: true, subscribedUntil: '2027-01-01T00:00:00', source: 'api' },
      queues: {
        hibp: expect.objectContaining({ waiting: 1, failed: 0 }),
        monitoring: expect.objectContaining({ waiting: 0 }),
        email: expect.objectContaining({ waiting: 0 }),
      },
      schedulers: [
        { id: 'catalog-sync', job: 'catalog-sync', pattern: '0 */6 * * *', tz: 'America/Sao_Paulo', next: '2026-10-15T13:05:00.000Z' },
      ],
      heartbeats: [
        { host: 'task-a', ts: null, pid: null },
        { host: 'task-b', ts: '2026-10-15T12:10:00.000Z', pid: 7 },
      ],
    });
    expect(report.plan).not.toHaveProperty('checkedAt');
  });

  it('keeps reporting when a part is unavailable', async () => {
    jest.spyOn(redis, 'scan').mockRejectedValue(new Error('redis down'));
    jest.spyOn(monitoringQueue, 'getJobSchedulers').mockRejectedValue(new Error('redis down'));
    catalog.getLastSyncAt.mockResolvedValue(null);
    plan.getPlan.mockRejectedValue(new Error(''));

    const report = await service.getReport();

    expect(report.heartbeats).toEqual({ error: 'redis down' });
    expect(report.schedulers).toEqual({ error: 'redis down' });
    expect(report.plan).toEqual({ error: 'unavailable' });
    expect(report.lastCatalogSyncAt).toBeNull();
    expect(report.queues.hibp).toMatchObject({ waiting: 1 });
  });

  it('is exposed by the controller', async () => {
    await expect(new JobsHealthController(service).jobs()).resolves.toMatchObject({ lastProbeAt: '2026-10-15T12:05:00.000Z' });
  });
});
