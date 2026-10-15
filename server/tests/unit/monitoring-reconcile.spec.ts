import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MonitoringReconcileService } from '../../src/modules/monitoring/services/monitoring-reconcile.service';
import {
  HEARTBEAT_KEY_PREFIX,
  MonitoringSchedulerService,
  SCHEDULES,
} from '../../src/modules/monitoring/services/monitoring-scheduler.service';
import { createFakeRedis, createInMemoryPrisma, FakeQueue } from '../helpers/in-memory-prisma';

describe('MonitoringReconcileService', () => {
  const now = new Date('2026-10-15T12:30:00.000Z');
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 3600 * 1000);

  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let emailQueue: FakeQueue;
  let monitoringQueue: FakeQueue;
  let hibpQueue: FakeQueue;
  let catalog: any;
  let monitoring: any;
  let plan: any;
  let service: MonitoringReconcileService;
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    process.env.MONITORING_ENABLED = 'true';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma = createInMemoryPrisma();
    emailQueue = new FakeQueue('email');
    monitoringQueue = new FakeQueue('monitoring');
    hibpQueue = new FakeQueue('hibp-check');
    catalog = { getLastSyncAt: jest.fn(async () => minutesAgo(60)) };
    monitoring = { enqueueCheck: jest.fn(async () => undefined) };
    plan = { getPlan: jest.fn(async () => ({ authOk: true })) };
    service = new MonitoringReconcileService(
      prisma as any,
      catalog,
      monitoring,
      plan,
      emailQueue as any,
      monitoringQueue as any,
      hibpQueue as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MONITORING_ENABLED;
  });

  it('does nothing when everything is up to date', async () => {
    await prisma.user.create({ data: { email: 'a@example.com', emailVerifiedAt: daysAgo(30), lastMonitoredAt: daysAgo(2) } });

    await expect(service.run(now)).resolves.toEqual({
      pendingEmails: 0,
      catalogOverdue: false,
      overdueUsers: 0,
      hibpQueueWaiting: 0,
      monitoringQueueFailed: 0,
    });
    expect(emailQueue.jobs).toHaveLength(0);
    expect(monitoringQueue.jobs).toHaveLength(0);
    expect(monitoring.enqueueCheck).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({ event: 'reconcile.report' });
  });

  it('re-enqueues alert e-mails stuck as PENDING for more than 15 minutes', async () => {
    const base = { userId: 1, type: 'NEW_BREACH', title: 't', body: 'b', payload: {} };
    const stuck = await prisma.notification.create({ data: { ...base, dedupeKey: 'k1', createdAt: minutesAgo(30) } });
    await prisma.notification.create({ data: { ...base, dedupeKey: 'k2', createdAt: minutesAgo(5) } });
    await prisma.notification.create({ data: { ...base, dedupeKey: 'k3', createdAt: minutesAgo(60), emailStatus: 'SENT' } });

    const report = await service.run(now);

    expect(report.pendingEmails).toBe(1);
    expect(emailQueue.jobs).toEqual([
      expect.objectContaining({
        name: 'send-new-breach-alert',
        data: { notificationId: stuck.id },
        opts: expect.objectContaining({ jobId: `email-notif-${stuck.id}` }),
      }),
    ]);
  });

  it('alerts and triggers a catalog sync when the last sync is older than 7 hours (or missing)', async () => {
    catalog.getLastSyncAt.mockResolvedValueOnce(minutesAgo(8 * 60));

    await expect(service.run(now)).resolves.toMatchObject({ catalogOverdue: true });

    expect(JSON.parse(errorSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({ event: 'catalog.sync.overdue' });
    expect(monitoringQueue.jobs[0]).toMatchObject({
      name: 'catalog-sync',
      data: { origin: 'reconcile' },
      opts: expect.objectContaining({ jobId: 'catalog-sync-reconcile-2026101509' }),
    });

    catalog.getLastSyncAt.mockResolvedValueOnce(null);
    await expect(service.run(new Date(now.getTime() + 3600 * 1000))).resolves.toMatchObject({ catalogOverdue: true });
    expect(monitoringQueue.jobs).toHaveLength(2);
  });

  it('re-enqueues users not checked in 8 days and verified users never checked', async () => {
    const stale = await prisma.user.create({ data: { email: 'stale@example.com', emailVerifiedAt: daysAgo(30), lastMonitoredAt: daysAgo(9) } });
    const never = await prisma.user.create({ data: { email: 'never@example.com', emailVerifiedAt: minutesAgo(120) } });
    await prisma.user.create({ data: { email: 'fresh@example.com', emailVerifiedAt: minutesAgo(10) } });
    await prisma.user.create({ data: { email: 'recent@example.com', emailVerifiedAt: daysAgo(30), lastMonitoredAt: daysAgo(1) } });
    await prisma.user.create({ data: { email: 'optout@example.com', emailVerifiedAt: daysAgo(30), monitoringEnabled: false } });
    await prisma.user.create({ data: { email: 'pending@example.com' } });

    await expect(service.run(now)).resolves.toMatchObject({ overdueUsers: 2 });

    expect(monitoring.enqueueCheck.mock.calls).toEqual([
      [stale.id, 'RECONCILE'],
      [never.id, 'RECONCILE'],
    ]);
  });

  it('skips overdue users when monitoring is disabled or the HIBP key is unauthorized', async () => {
    await prisma.user.create({ data: { email: 'stale@example.com', emailVerifiedAt: daysAgo(30), lastMonitoredAt: daysAgo(9) } });

    process.env.MONITORING_ENABLED = 'false';
    await expect(service.run(now)).resolves.toMatchObject({ overdueUsers: 0 });

    process.env.MONITORING_ENABLED = 'true';
    plan.getPlan.mockResolvedValue({ authOk: false });
    await expect(service.run(now)).resolves.toMatchObject({ overdueUsers: 0 });

    expect(monitoring.enqueueCheck).not.toHaveBeenCalled();
  });

  it('reports queue metrics', async () => {
    jest.spyOn(hibpQueue, 'getJobCounts').mockResolvedValue({ waiting: 3, prioritized: 40, delayed: 1 });
    jest.spyOn(monitoringQueue, 'getJobCounts').mockResolvedValue({ failed: 2 });

    await expect(service.run(now)).resolves.toMatchObject({ hibpQueueWaiting: 44, monitoringQueueFailed: 2 });
  });
});

describe('MonitoringSchedulerService', () => {
  let queue: { upsertJobScheduler: jest.Mock<any> };
  let redis: ReturnType<typeof createFakeRedis>;
  let service: MonitoringSchedulerService;

  beforeEach(() => {
    jest.useFakeTimers();
    delete process.env.APP_ROLE;
    delete process.env.SCHEDULER_TZ;
    delete process.env.HIBP_CATALOG_SYNC_CRON;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    queue = { upsertJobScheduler: jest.fn(async () => ({})) };
    redis = createFakeRedis();
    service = new MonitoringSchedulerService(queue as any, redis as any);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.APP_ROLE;
    delete process.env.HIBP_CATALOG_SYNC_CRON;
  });

  it('registers the six schedulers in BRT with the configured patterns', async () => {
    process.env.HIBP_CATALOG_SYNC_CRON = '0 */3 * * *';

    await service.onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(6);
    expect(queue.upsertJobScheduler.mock.calls.map(call => call[0])).toEqual([
      'catalog-probe',
      'catalog-sync',
      'weekly-sweep',
      'cleanup-unverified',
      'hibp-plan-check',
      'monitoring-reconcile',
    ]);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'catalog-sync',
      { pattern: '0 */3 * * *', tz: 'America/Sao_Paulo' },
      { name: 'catalog-sync', data: { origin: 'cron' }, opts: { attempts: 3, backoff: { type: 'exponential', delay: 60000 } } },
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'weekly-sweep',
      { pattern: '0 3 * * 1', tz: 'America/Sao_Paulo' },
      { name: 'monitor-sweep', data: { reason: 'WEEKLY' }, opts: undefined },
    );
    expect(SCHEDULES).toHaveLength(6);
  });

  it('writes a heartbeat with a 90 s TTL and refreshes it every 30 s', async () => {
    const setSpy = jest.spyOn(redis, 'set');

    await service.onApplicationBootstrap();
    const [key, value, mode, ttl] = setSpy.mock.calls[0] as any[];
    expect(key.startsWith(HEARTBEAT_KEY_PREFIX)).toBe(true);
    expect(JSON.parse(value)).toMatchObject({ pid: process.pid });
    expect([mode, ttl]).toEqual(['EX', 90]);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(setSpy).toHaveBeenCalledTimes(2);
  });

  it('re-registers the schedulers every 10 minutes (watchdog)', async () => {
    await service.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(12);
  });

  it('keeps running when Redis fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    queue.upsertJobScheduler.mockRejectedValue(new Error('redis down'));
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('redis down'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(JSON.parse(errorSpy.mock.calls[0][0] as string)).toMatchObject({ event: 'scheduler.register_failed' });
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({ event: 'heartbeat.failed' });
  });

  it('does not schedule anything with APP_ROLE=api and stops the timers on shutdown', async () => {
    process.env.APP_ROLE = 'api';
    await service.onApplicationBootstrap();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();

    delete process.env.APP_ROLE;
    await service.onApplicationBootstrap();
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(6);
  });
});
