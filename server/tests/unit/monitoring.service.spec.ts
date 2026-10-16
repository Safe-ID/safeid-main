import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { diffNewBreaches } from '../../src/core/engines/breach-diff';
import { UserBreachRepository } from '../../src/modules/breaches/user-breach.repository';
import { MonitoringService } from '../../src/modules/monitoring/services/monitoring.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createInMemoryPrisma, FakeQueue } from '../helpers/in-memory-prisma';

describe('diffNewBreaches', () => {
  it('keeps only unknown names, unique and in order', () => {
    expect(diffNewBreaches(new Set(['Adobe']), ['LinkedIn', 'Adobe', 'Canva', 'LinkedIn', ''])).toEqual(['LinkedIn', 'Canva']);
  });

  it('ignores names that disappeared from the lookup', () => {
    expect(diffNewBreaches(new Set(['Adobe', 'Retired']), ['Adobe'])).toEqual([]);
  });
});

describe('MonitoringService', () => {
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let hibpQueue: FakeQueue;
  let emailQueue: FakeQueue;
  let catalog: any;
  let scanService: any;
  let plan: any;
  let service: MonitoringService;

  const checkedAt = new Date('2026-10-15T12:00:00.000Z');

  beforeEach(() => {
    process.env.MONITORING_ENABLED = 'true';
    delete process.env.MONITORING_MAX_SWEEP_HOURS;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    prisma = createInMemoryPrisma();
    hibpQueue = new FakeQueue('hibp-check');
    emailQueue = new FakeQueue('email');
    catalog = {
      getByNames: jest.fn(async (names: string[]) => names.map(name => ({ Name: name, Title: `${name} title` }))),
    };
    scanService = {
      scoreBreaches: jest.fn(async () => ({ jobId: 'scan-1', riskScore: 64, classification: 'MODERATE', breachNames: [] })),
    };
    plan = {
      getPlan: jest.fn(async () => ({ authOk: true })),
      getEffectiveLimits: jest.fn(async () => ({ rpm: 9, planName: 'Core 1' })),
    };

    const userBreaches = new UserBreachRepository(prisma as any);
    const notifications = new NotificationsService(prisma as any, userBreaches, emailQueue as any);
    service = new MonitoringService(prisma as any, userBreaches, catalog, scanService, notifications, plan, hibpQueue as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MONITORING_ENABLED;
  });

  async function createUser(data: Record<string, unknown> = {}) {
    return prisma.user.create({
      data: { email: `u${prisma.user.rows.length + 1}@example.com`, emailVerifiedAt: checkedAt, ...data },
    });
  }

  describe('processCheckResult', () => {
    it('defines the baseline silently for a user without one', async () => {
      const user = await createUser();

      await expect(service.processCheckResult(user.id, ['Adobe', 'LinkedIn'], checkedAt)).resolves.toBe('baseline');

      const stored = (await prisma.user.findUnique({ where: { id: user.id } }))!;
      expect(stored).toMatchObject({ breachBaselineAt: checkedAt, lastMonitoredAt: checkedAt });
      expect(prisma.userBreach.rows.map(row => [row.breachName, row.source])).toEqual([
        ['Adobe', 'BASELINE'],
        ['LinkedIn', 'BASELINE'],
      ]);
      // Atualiza o painel, mas não avisa
      expect(scanService.scoreBreaches).toHaveBeenCalledWith(user.id, stored.email, expect.any(Array), 'MONITORING');
      expect(prisma.notification.rows).toHaveLength(0);
    });

    it('does not rescore a baseline without breaches', async () => {
      const user = await createUser();

      await expect(service.processCheckResult(user.id, [], checkedAt)).resolves.toBe('baseline');
      expect(scanService.scoreBreaches).not.toHaveBeenCalled();
    });

    it('records new breaches, rescores and creates one notification', async () => {
      const user = await createUser({ breachBaselineAt: checkedAt, scanSnapshot: { riskScore: 20 } });
      await prisma.userBreach.create({ data: { userId: user.id, breachName: 'Adobe', source: 'SIGNUP' } });

      await expect(service.processCheckResult(user.id, ['Adobe', 'MegaLeak', 'Canva'], checkedAt)).resolves.toBe('notified');

      expect(catalog.getByNames).toHaveBeenCalledWith(['Adobe', 'MegaLeak', 'Canva']);
      expect(scanService.scoreBreaches).toHaveBeenCalledTimes(1);
      expect(prisma.notification.rows).toHaveLength(1);
      expect(prisma.notification.rows[0]).toMatchObject({
        title: 'Seu e-mail apareceu em 2 novos vazamentos',
        body: 'MegaLeak title, Canva title',
        payload: { breachNames: ['MegaLeak', 'Canva'], riskScoreBefore: 20, riskScoreAfter: 64, scanJobId: 'scan-1' },
      });
      expect(prisma.userBreach.rows.filter(row => row.source === 'MONITORING').every(row => row.notifiedAt)).toBe(true);
    });

    it('does nothing when there is nothing new (re-execution is idempotent)', async () => {
      const user = await createUser({ breachBaselineAt: checkedAt });
      await service.processCheckResult(user.id, ['MegaLeak'], checkedAt);

      await expect(service.processCheckResult(user.id, ['MegaLeak'], checkedAt)).resolves.toBe('no_change');

      expect(prisma.notification.rows).toHaveLength(1);
      expect(scanService.scoreBreaches).toHaveBeenCalledTimes(1);
    });

    it('falls back to the breach name when the catalog has no title', async () => {
      const user = await createUser({ breachBaselineAt: checkedAt });
      catalog.getByNames.mockResolvedValue([]);

      await service.processCheckResult(user.id, ['Unknown'], checkedAt);

      expect(prisma.notification.rows[0].body).toBe('Unknown');
    });

    it('skips deleted users without touching anything', async () => {
      await expect(service.processCheckResult(999, ['Adobe'], checkedAt)).resolves.toBe('user_not_found');
      expect(prisma.userBreach.rows).toHaveLength(0);
    });
  });

  describe('runSweep', () => {
    it('enqueues one deduplicated, low-priority check per monitored verified user', async () => {
      const first = await createUser();
      await createUser({ monitoringEnabled: false });
      await createUser({ emailVerifiedAt: null });
      const last = await createUser();

      await expect(service.runSweep('WEEKLY')).resolves.toEqual({ enqueued: 2 });

      expect(hibpQueue.jobs.map(job => job.data)).toEqual([
        { userId: first.id, reason: 'WEEKLY' },
        { userId: last.id, reason: 'WEEKLY' },
      ]);
      expect(hibpQueue.jobs[0]).toMatchObject({
        name: 'monitor-check',
        opts: {
          priority: 10,
          deduplication: { id: `monitor-${first.id}` },
          attempts: 5,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
          removeOnFail: { age: 604800 },
        },
      });

      // Uma segunda varredura não duplica quem ainda está na fila
      await service.runSweep('CATALOG_CHANGE');
      expect(hibpQueue.jobs).toHaveLength(2);
    });

    it('pages through more than 500 users', async () => {
      for (let i = 0; i < 520; i++) {
        await createUser();
      }

      await expect(service.runSweep('WEEKLY')).resolves.toEqual({ enqueued: 520 });
    });

    it('does nothing when monitoring is disabled or the HIBP key is unauthorized', async () => {
      await createUser();

      process.env.MONITORING_ENABLED = 'false';
      await expect(service.runSweep('WEEKLY')).resolves.toEqual({ enqueued: 0, skipped: 'disabled' });

      process.env.MONITORING_ENABLED = 'true';
      plan.getPlan.mockResolvedValue({ authOk: false });
      await expect(service.runSweep('WEEKLY')).resolves.toEqual({ enqueued: 0, skipped: 'hibp_auth' });

      expect(hibpQueue.jobs).toHaveLength(0);
    });

    it('warns when the sweep would take longer than MONITORING_MAX_SWEEP_HOURS', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.MONITORING_MAX_SWEEP_HOURS = '0.01';
      for (let i = 0; i < 10; i++) {
        await createUser();
      }

      await service.runSweep('WEEKLY');

      expect(JSON.parse(warnSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({
        event: 'sweep.too_slow',
        users: 10,
        rpm: 9,
        planName: 'Core 1',
      });
    });
  });
});

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let emailQueue: FakeQueue;
  let service: NotificationsService;

  const input = (userId: number) => ({
    userId,
    breaches: [{ name: 'MegaLeak', title: 'Mega Leak' }],
    scan: { jobId: 'scan-1', riskScore: 64, classification: 'MODERATE' },
    riskScoreBefore: null,
  });

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    prisma = createInMemoryPrisma();
    emailQueue = new FakeQueue('email');
    service = new NotificationsService(prisma as any, new UserBreachRepository(prisma as any), emailQueue as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates the notification and enqueues the alert e-mail', async () => {
    const user = await prisma.user.create({ data: { email: 'a@example.com', emailVerifiedAt: new Date() } });

    const notification = await service.createNewBreach(input(user.id));

    expect(notification).toMatchObject({ title: 'Seu e-mail apareceu em 1 novo vazamento', emailStatus: 'PENDING' });
    expect(emailQueue.jobs[0]).toMatchObject({
      name: 'send-new-breach-alert',
      data: { notificationId: notification!.id },
      opts: { jobId: `email-notif-${notification!.id}`, attempts: 5 },
    });
  });

  it('skips the e-mail when the user opted out', async () => {
    const user = await prisma.user.create({
      data: { email: 'b@example.com', emailVerifiedAt: new Date(), monitoringEnabled: false },
    });

    await expect(service.createNewBreach(input(user.id))).resolves.toMatchObject({ emailStatus: 'SKIPPED' });
    expect(emailQueue.jobs).toHaveLength(0);
  });

  it('returns null for the same set of breaches (dedupe) and still marks them as notified', async () => {
    const user = await prisma.user.create({ data: { email: 'c@example.com', emailVerifiedAt: new Date() } });
    await prisma.userBreach.create({ data: { userId: user.id, breachName: 'MegaLeak', source: 'MONITORING' } });
    await service.createNewBreach(input(user.id));
    prisma.userBreach.rows[0].notifiedAt = null;

    await expect(service.createNewBreach(input(user.id))).resolves.toBeNull();

    expect(prisma.notification.rows).toHaveLength(1);
    expect(emailQueue.jobs).toHaveLength(1);
    expect(prisma.userBreach.rows[0].notifiedAt).toEqual(expect.any(Date));
  });

  it('builds a dedupe key independent of the order of the names', () => {
    expect(NotificationsService.dedupeKey('NEW_BREACH', ['B', 'A'])).toBe(NotificationsService.dedupeKey('NEW_BREACH', ['A', 'B']));
  });

  it('propagates unexpected database errors', async () => {
    jest.spyOn(prisma.notification, 'create').mockRejectedValueOnce(new Error('db down'));

    await expect(service.createNewBreach(input(1))).rejects.toThrow('db down');
  });
});
