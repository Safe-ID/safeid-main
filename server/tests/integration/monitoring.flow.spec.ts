import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { resolve } from 'path';
import { MockHibpClient } from '../../src/infra/http/hibp.mock';
import { MockHibpCatalogClient } from '../../src/infra/http/hibp-catalog.mock';
import { UserBreachRepository } from '../../src/modules/breaches/user-breach.repository';
import { ScanService } from '../../src/modules/scan/services/scan.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { BreachCatalogService } from '../../src/modules/monitoring/services/breach-catalog.service';
import { CatalogMonitorService } from '../../src/modules/monitoring/services/catalog-monitor.service';
import { MonitoringService } from '../../src/modules/monitoring/services/monitoring.service';
import { HibpProcessor } from '../../src/modules/monitoring/processors/hibp.processor';
import { MonitoringProcessor } from '../../src/modules/monitoring/processors/monitoring.processor';
import { createFakeRedis, createInMemoryPrisma, FakeQueue } from '../helpers/in-memory-prisma';

const FIXTURE = resolve(__dirname, '../fixtures/hibp-breaches.json');

const NEW_BREACH = {
  Name: 'MegaLeak2026',
  Title: 'Mega Leak 2026',
  Domain: 'megaleak.example.com',
  BreachDate: '2026-09-28',
  AddedDate: '2026-10-15T08:00:00Z',
  ModifiedDate: '2026-10-15T08:00:00Z',
  PwnCount: 3200000,
  DataClasses: ['Email addresses', 'Passwords', 'Phone numbers'],
  IsVerified: true,
  IsFabricated: false,
  IsSensitive: false,
  IsRetired: false,
  IsSpamList: false,
  IsMalware: false,
  IsStealerLog: false,
};

/**
 * Fluxo completo do monitoramento, sem PostgreSQL/Redis: catálogo → sync → varredura →
 * monitor-check (HIBP mock) → monitor-process → rescore → notificação.
 */
describe('Monitoring flow (in-memory)', () => {
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let hibpQueue: FakeQueue;
  let monitoringQueue: FakeQueue;
  let emailQueue: FakeQueue;
  let hibpClient: MockHibpClient;
  let catalogClient: MockHibpCatalogClient;
  let catalogMonitor: CatalogMonitorService;
  let hibpProcessor: HibpProcessor;
  let monitoringProcessor: MonitoringProcessor;

  /** Executa os jobs das filas até esvaziar, como os workers fariam */
  async function drain(): Promise<void> {
    for (let guard = 0; guard < 1000; guard++) {
      const hibpJob = hibpQueue.take();
      if (hibpJob) {
        await hibpProcessor.process(hibpJob as any);
        continue;
      }
      const monitoringJob = monitoringQueue.take();
      if (monitoringJob) {
        await monitoringProcessor.process(monitoringJob as any);
        continue;
      }
      return;
    }
    throw new Error('Queues did not drain');
  }

  beforeEach(async () => {
    process.env.MONITORING_ENABLED = 'true';
    process.env.AI_API_KEY = '';
    process.env.AI_ENDPOINT = '';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    prisma = createInMemoryPrisma();
    const redis = createFakeRedis();
    hibpQueue = new FakeQueue('hibp-check');
    monitoringQueue = new FakeQueue('monitoring');
    emailQueue = new FakeQueue('email');
    hibpClient = new MockHibpClient(0);
    catalogClient = new MockHibpCatalogClient(FIXTURE);

    const plan = {
      getPlan: async () => ({ name: 'Mock', rpm: 10, authOk: true }),
      getEffectiveLimits: async () => ({ rpm: 9, concurrency: 1, limiterDurationMs: 6667, planName: 'Mock' }),
      refresh: async () => ({}),
    };

    const userBreaches = new UserBreachRepository(prisma as any);
    const scanService = new ScanService(prisma as any, redis as any, hibpQueue as any, userBreaches);
    const notifications = new NotificationsService(prisma as any, userBreaches, emailQueue as any);
    const catalog = new BreachCatalogService(prisma as any, catalogClient, redis as any);
    catalogMonitor = new CatalogMonitorService(catalog, catalogClient, monitoringQueue as any, redis as any);
    const monitoring = new MonitoringService(
      prisma as any,
      userBreaches,
      catalog,
      scanService,
      notifications,
      plan as any,
      hibpQueue as any,
    );
    hibpProcessor = new HibpProcessor(hibpClient, plan as any, prisma as any, monitoringQueue as any);
    monitoringProcessor = new MonitoringProcessor(
      catalogMonitor,
      monitoring,
      { run: async () => ({}) } as any,
      { cleanupUnverified: async () => ({}) } as any,
      plan as any,
    );

    const verifiedAt = new Date('2026-09-01T00:00:00Z');
    // Ana: cadastrou com o email limpo (base definida e vazia)
    await prisma.user.create({
      data: { email: 'clean@example.com', emailVerifiedAt: verifiedAt, breachBaselineAt: verifiedAt },
    });
    // Bruno: conta antiga, sem base (sem scan antes do monitoramento)
    await prisma.user.create({ data: { email: 'breached@example.com', emailVerifiedAt: verifiedAt } });
    // Carla: desligou os alertas
    await prisma.user.create({
      data: { email: 'test@example.com', emailVerifiedAt: verifiedAt, breachBaselineAt: verifiedAt, monitoringEnabled: false },
    });
    // Davi: não verificou o email
    await prisma.user.create({ data: { email: 'pending@example.com' } });

    // Primeiro sync: só popula o catálogo
    await expect(catalogMonitor.handleCatalogSync('cron')).resolves.toMatchObject({ firstSync: true, sweepEnqueued: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MONITORING_ENABLED;
  });

  it('defines silent baselines, then notifies once when a new breach is published', async () => {
    // Varredura semanal: Bruno ganha a base em silêncio (vazamentos antigos não geram alerta)
    await monitoringQueue.add('monitor-sweep', { reason: 'WEEKLY' });
    await drain();

    expect(hibpQueue.history.filter(job => job.name === 'monitor-check').map(job => job.data.userId)).toEqual([1, 2]);
    expect(prisma.notification.rows).toHaveLength(0);
    const bruno = (await prisma.user.findUnique({ where: { id: 2 } }))!;
    expect(bruno.breachBaselineAt).toEqual(expect.any(Date));
    expect(bruno.lastMonitoredAt).toEqual(expect.any(Date));
    expect(prisma.userBreach.rows.filter(row => row.userId === 2).map(row => [row.breachName, row.source])).toEqual([
      ['Equifax', 'BASELINE'],
      ['LinkedIn', 'BASELINE'],
    ]);
    // O painel do Bruno foi atualizado (rescore silencioso)
    expect(prisma.scanHistory.rows.filter(row => row.userId === 2 && row.source === 'MONITORING')).toHaveLength(1);

    // A HIBP publica um vazamento novo que inclui Ana, Bruno e Carla
    catalogClient.addBreach(NEW_BREACH);
    for (const email of ['clean@example.com', 'breached@example.com', 'test@example.com']) {
      hibpClient.addBreachForTesting(email, NEW_BREACH);
    }
    const scansBefore = prisma.scanHistory.rows.length;

    // Sync detecta a inclusão e dispara a varredura
    await expect(catalogMonitor.handleCatalogSync('probe')).resolves.toMatchObject({ sweepEnqueued: true });
    await drain();

    const notifications = prisma.notification.rows;
    expect(notifications.map(row => row.userId).sort()).toEqual([1, 2]);
    const ana = notifications.find(row => row.userId === 1)!;
    expect(ana).toMatchObject({
      type: 'NEW_BREACH',
      title: 'Seu e-mail apareceu em 1 novo vazamento',
      body: 'Mega Leak 2026',
      emailStatus: 'PENDING',
      payload: expect.objectContaining({ breachNames: ['MegaLeak2026'], riskScoreBefore: null }),
    });

    // Um ScanHistory MONITORING novo para cada usuário notificado
    const newScans = prisma.scanHistory.rows.slice(scansBefore);
    expect(newScans.map(row => [row.userId, row.source])).toEqual([
      [1, 'MONITORING'],
      [2, 'MONITORING'],
    ]);
    const anaSnapshot = (await prisma.user.findUnique({ where: { id: 1 } }))!.scanSnapshot;
    expect(anaSnapshot.riskScore).toBeGreaterThan(0);

    // E-mails de alerta enfileirados (envio na F5) e vazamentos marcados como notificados
    expect(emailQueue.history.map(job => [job.name, job.opts.jobId])).toEqual([
      ['send-new-breach-alert', `email-notif-${notifications[0].id}`],
      ['send-new-breach-alert', `email-notif-${notifications[1].id}`],
    ]);
    expect(prisma.userBreach.rows.filter(row => row.breachName === 'MegaLeak2026').every(row => row.notifiedAt)).toBe(true);

    // Carla (opt-out) e Davi (não verificado) nem foram consultados na HIBP
    expect(hibpQueue.history.some(job => job.data.userId === 3 || job.data.userId === 4)).toBe(false);

    // Reprocessar a mesma varredura não duplica nada
    await monitoringQueue.add('monitor-sweep', { reason: 'WEEKLY' });
    await drain();
    expect(prisma.notification.rows).toHaveLength(2);
    expect(prisma.scanHistory.rows.length).toBe(scansBefore + 2);
  });

  it('recovers the notification when processing fails after recording the breach', async () => {
    catalogClient.addBreach(NEW_BREACH);
    hibpClient.addBreachForTesting('clean@example.com', NEW_BREACH);
    await catalogMonitor.handleCatalogSync('cron');

    // Primeira tentativa: o rescore falha depois de gravar o vazamento na base
    const scoreSpy = jest
      .spyOn(ScanService.prototype, 'scoreBreaches')
      .mockRejectedValueOnce(new Error('AI timeout'));

    // O sync enfileirou a varredura; ela enfileira um monitor-check por usuário (Ana primeiro)
    const sweepJob = monitoringQueue.take()!;
    expect(sweepJob.name).toBe('monitor-sweep');
    await monitoringProcessor.process(sweepJob as any);

    const checkJob = hibpQueue.take();
    expect(checkJob).toMatchObject({ name: 'monitor-check', data: { userId: 1 } });
    await hibpProcessor.process(checkJob as any);
    const processJob = monitoringQueue.take()!;
    await expect(monitoringProcessor.process(processJob as any)).rejects.toThrow('AI timeout');
    expect(prisma.userBreach.rows.find(row => row.breachName === 'MegaLeak2026')?.notifiedAt).toBeNull();
    expect(prisma.notification.rows).toHaveLength(0);

    // Retry do mesmo job: o vazamento já é "conhecido", mas continua pendente de aviso
    await monitoringProcessor.process(processJob as any);
    expect(scoreSpy).toHaveBeenCalledTimes(2);
    expect(prisma.notification.rows).toHaveLength(1);
    expect(prisma.notification.rows[0].payload.breachNames).toEqual(['MegaLeak2026']);
  });
});
