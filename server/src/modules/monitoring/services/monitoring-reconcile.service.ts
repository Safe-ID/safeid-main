import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../infra/database/prisma.service';
import { HibpPlanService } from '../../../infra/http/hibp-plan.service';
import {
  EMAIL_QUEUE,
  HIBP_QUEUE,
  JOB_CATALOG_SYNC,
  JOB_RETRY_INITIAL_SCAN,
  JOB_SEND_NEW_BREACH_ALERT,
  MONITORING_QUEUE,
} from '../../../infra/queue/queue.constants';
import { log } from '../../../shared/utils/logger';
import { formatHourKey } from '../../../shared/utils/time';
import { BreachCatalogService } from './breach-catalog.service';
import { MonitoringService } from './monitoring.service';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const PENDING_EMAIL_AGE_MS = 15 * MINUTE_MS;
const CATALOG_SYNC_MAX_AGE_MS = 7 * HOUR_MS;
const USER_CHECK_MAX_AGE_MS = 8 * DAY_MS;
const NEW_USER_GRACE_MS = HOUR_MS;
const BATCH_LIMIT = 1000;
// Espera o scan do cadastro terminar antes de considerar que ele falhou
const FAILED_SCAN_GRACE_MS = 15 * MINUTE_MS;
// Cada nova tentativa consulta a HIBP e a IA: poucas por hora, sem disputar a cota com o monitoramento
const FAILED_SCAN_BATCH = 20;

export interface ReconcileReport {
  pendingEmails: number;
  catalogOverdue: boolean;
  overdueUsers: number;
  failedScans: number;
  hibpQueueWaiting: number;
  monitoringQueueFailed: number;
}

function isMonitoringEnabled(): boolean {
  return (process.env.MONITORING_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * T4.9: reconstrói a partir do banco o que pode ter se perdido no Redis (reinício do nó,
 * job que falhou de vez). Roda de hora em hora.
 */
@Injectable()
export class MonitoringReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: BreachCatalogService,
    private readonly monitoring: MonitoringService,
    private readonly hibpPlan: HibpPlanService,
    @Inject(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @Inject(MONITORING_QUEUE) private readonly monitoringQueue: Queue,
    @Inject(HIBP_QUEUE) private readonly hibpQueue: Queue,
  ) {}

  async run(now = new Date()): Promise<ReconcileReport> {
    const pendingEmails = await this.requeuePendingEmails(now);
    const catalogOverdue = await this.checkCatalogSync(now);
    const overdueUsers = await this.requeueOverdueUsers(now);
    const failedScans = await this.retryFailedScans(now);

    const hibpCounts = await this.hibpQueue.getJobCounts('waiting', 'prioritized', 'delayed');
    const monitoringCounts = await this.monitoringQueue.getJobCounts('failed');

    const report: ReconcileReport = {
      pendingEmails,
      catalogOverdue,
      overdueUsers,
      failedScans,
      hibpQueueWaiting: (hibpCounts.waiting ?? 0) + (hibpCounts.prioritized ?? 0) + (hibpCounts.delayed ?? 0),
      monitoringQueueFailed: monitoringCounts.failed ?? 0,
    };

    log('info', 'MonitoringReconcile', 'reconcile.report', { ...report });
    return report;
  }

  /** 1. Alertas que ficaram PENDING (o jobId fixo evita duplicar se o job ainda existir) */
  private async requeuePendingEmails(now: Date): Promise<number> {
    const pending = await this.prisma.notification.findMany({
      where: { emailStatus: 'PENDING', createdAt: { lt: new Date(now.getTime() - PENDING_EMAIL_AGE_MS) } },
      select: { id: true },
      take: BATCH_LIMIT,
    });

    for (const notification of pending) {
      await this.emailQueue.add(
        JOB_SEND_NEW_BREACH_ALERT,
        { notificationId: notification.id },
        {
          jobId: `email-notif-${notification.id}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
    }

    return pending.length;
  }

  /** 2. Sync do catálogo atrasado: alerta e dispara um sync */
  private async checkCatalogSync(now: Date): Promise<boolean> {
    const lastSyncAt = await this.catalog.getLastSyncAt();
    const overdue = !lastSyncAt || now.getTime() - lastSyncAt.getTime() > CATALOG_SYNC_MAX_AGE_MS;

    if (overdue) {
      log('error', 'MonitoringReconcile', 'catalog.sync.overdue', {
        lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
      });
      await this.monitoringQueue.add(
        JOB_CATALOG_SYNC,
        { origin: 'reconcile' },
        {
          jobId: `catalog-sync-reconcile-${formatHourKey(now)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
    }

    return overdue;
  }

  /** 3. Usuários sem checagem há mais de 8 dias (ou nunca checados e verificados há mais de 1 h) */
  private async requeueOverdueUsers(now: Date): Promise<number> {
    if (!isMonitoringEnabled()) {
      return 0;
    }

    const plan = await this.hibpPlan.getPlan();
    if (!plan.authOk) {
      return 0;
    }

    const users = await this.prisma.user.findMany({
      where: {
        monitoringEnabled: true,
        emailVerifiedAt: { not: null },
        OR: [
          { lastMonitoredAt: { lt: new Date(now.getTime() - USER_CHECK_MAX_AGE_MS) } },
          { lastMonitoredAt: null, emailVerifiedAt: { lt: new Date(now.getTime() - NEW_USER_GRACE_MS) } },
        ],
      },
      orderBy: { id: 'asc' },
      select: { id: true },
      take: BATCH_LIMIT,
    });

    for (const user of users) {
      await this.monitoring.enqueueCheck(user.id, 'RECONCILE');
    }

    return users.length;
  }

  /**
   * 4. Contas verificadas sem resultado válido: o scan do cadastro falhou (resultado padrão,
   * isVerified false) ou nunca rodou. Não depende dos alertas: o scan foi aceito no cadastro.
   * O jobId por hora evita duplicar; o que falhar de novo volta na próxima hora.
   */
  private async retryFailedScans(now: Date): Promise<number> {
    const plan = await this.hibpPlan.getPlan();
    if (!plan.authOk) {
      return 0;
    }

    const cutoff = new Date(now.getTime() - FAILED_SCAN_GRACE_MS);
    const users = await this.prisma.user.findMany({
      where: {
        emailVerifiedAt: { not: null },
        OR: [
          { scanSnapshotUpdatedAt: null, emailVerifiedAt: { lt: cutoff } },
          { scanSnapshotUpdatedAt: { lt: cutoff }, scanSnapshot: { path: ['isVerified'], equals: false } },
        ],
      },
      orderBy: { id: 'asc' },
      select: { id: true },
      take: FAILED_SCAN_BATCH,
    });

    const hourKey = formatHourKey(now);
    for (const user of users) {
      await this.monitoringQueue.add(
        JOB_RETRY_INITIAL_SCAN,
        { userId: user.id },
        { jobId: `retry-scan-${user.id}-${hourKey}`, removeOnComplete: true, removeOnFail: { age: 24 * 3600 } },
      );
    }

    if (users.length > 0) {
      log('info', 'MonitoringReconcile', 'scan.retry_enqueued', { users: users.length });
    }
    return users.length;
  }
}
