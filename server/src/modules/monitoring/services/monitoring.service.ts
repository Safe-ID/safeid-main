import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../infra/database/prisma.service';
import { HibpPlanService } from '../../../infra/http/hibp-plan.service';
import { HibpBreach } from '../../../infra/http/hibp.types';
import { HIBP_QUEUE, JOB_MONITOR_CHECK, MONITOR_CHECK_PRIORITY } from '../../../infra/queue/queue.constants';
import { diffNewBreaches } from '../../../core/engines/breach-diff';
import { UserBreachRepository } from '../../breaches/user-breach.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import { ScanService } from '../../scan/services/scan.service';
import { log } from '../../../shared/utils/logger';
import { BreachCatalogService } from './breach-catalog.service';

const SWEEP_PAGE_SIZE = 500;
const SEVEN_DAYS_S = 7 * 24 * 3600;

export type SweepReason = 'CATALOG_CHANGE' | 'WEEKLY' | 'RECONCILE' | 'OPT_IN' | string;

export type CheckResultStatus = 'user_not_found' | 'baseline' | 'no_change' | 'notified';

function isMonitoringEnabled(): boolean {
  return (process.env.MONITORING_ENABLED || '').trim().toLowerCase() === 'true';
}

function maxSweepHours(): number {
  const value = Number(process.env.MONITORING_MAX_SWEEP_HOURS);
  return Number.isFinite(value) && value > 0 ? value : 6;
}

/**
 * Varredura e reprocessamento do monitoramento contínuo.
 * O banco é a fonte da verdade (UserBreach); as filas são só transporte.
 */
@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userBreaches: UserBreachRepository,
    private readonly catalog: BreachCatalogService,
    private readonly scanService: ScanService,
    private readonly notifications: NotificationsService,
    private readonly hibpPlan: HibpPlanService,
    @Inject(HIBP_QUEUE) private readonly hibpQueue: Queue,
  ) {}

  /**
   * Enfileira a checagem de um usuário. Prioridade 10 (o scan interativo passa na frente)
   * e deduplicação por usuário: enquanto houver um monitor-check dele na fila, outro não entra.
   */
  async enqueueCheck(userId: number, reason: SweepReason): Promise<void> {
    await this.hibpQueue.add(
      JOB_MONITOR_CHECK,
      { userId, reason },
      {
        priority: MONITOR_CHECK_PRIORITY,
        deduplication: { id: `monitor-${userId}` },
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: { age: SEVEN_DAYS_S },
      },
    );
  }

  /** T4.2: enfileira um monitor-check para cada usuário monitorado e verificado */
  async runSweep(reason: SweepReason): Promise<{ enqueued: number; skipped?: string }> {
    if (!isMonitoringEnabled()) {
      log('info', 'Monitoring', 'sweep.skipped', { reason, cause: 'MONITORING_ENABLED' });
      return { enqueued: 0, skipped: 'disabled' };
    }

    // Sem chave válida na HIBP, milhares de checagens só gerariam falhas
    const plan = await this.hibpPlan.getPlan();
    if (!plan.authOk) {
      log('error', 'Monitoring', 'sweep.skipped', { reason, cause: 'hibp_auth' });
      return { enqueued: 0, skipped: 'hibp_auth' };
    }

    let enqueued = 0;
    let cursor = 0;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { id: { gt: cursor }, monitoringEnabled: true, emailVerifiedAt: { not: null } },
        orderBy: { id: 'asc' },
        take: SWEEP_PAGE_SIZE,
        select: { id: true },
      });

      if (users.length === 0) {
        break;
      }

      for (const user of users) {
        await this.enqueueCheck(user.id, reason);
        enqueued++;
      }
      cursor = users[users.length - 1].id;
    }

    log('info', 'Monitoring', 'sweep.enqueued', { reason, users: enqueued });

    // Sinal para subir de plano: a varredura não cabe mais na janela esperada
    const limits = await this.hibpPlan.getEffectiveLimits();
    const estimatedHours = enqueued / limits.rpm / 60;
    if (estimatedHours > maxSweepHours()) {
      log('warn', 'Monitoring', 'sweep.too_slow', {
        users: enqueued,
        rpm: limits.rpm,
        planName: limits.planName,
        estimatedHours: Number(estimatedHours.toFixed(1)),
        maxHours: maxSweepHours(),
      });
    }

    return { enqueued };
  }

  /**
   * T4.4: compara o resultado da HIBP com a base do usuário.
   * - Sem base: define a base em silêncio (atualiza o painel se houver vazamento novo, sem avisar).
   * - Com base: registra os novos, recalcula o score e cria a notificação.
   * Os pendentes de aviso (MONITORING sem notifiedAt) incluem os de uma execução anterior que
   * falhou depois de registrar: assim um erro no meio não perde o aviso.
   */
  async processCheckResult(userId: number, currentNames: string[], checkedAt = new Date()): Promise<CheckResultStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, breachBaselineAt: true, scanSnapshot: true },
    });

    if (!user) {
      log('info', 'Monitoring', 'monitor.skipped', { userId, reason: 'user_not_found' });
      return 'user_not_found';
    }

    await this.prisma.user.update({ where: { id: userId }, data: { lastMonitoredAt: checkedAt } });

    const known = await this.userBreaches.getKnownNames(userId);
    const newNames = diffNewBreaches(known, currentNames);

    if (!user.breachBaselineAt) {
      await this.userBreaches.recordSeenByUser(userId, currentNames, 'BASELINE', checkedAt);
      if (newNames.length > 0) {
        await this.rescore(user, currentNames);
      }
      log('info', 'Monitoring', 'monitor.baseline', { userId, breaches: currentNames.length });
      return 'baseline';
    }

    if (newNames.length > 0) {
      await this.userBreaches.recordKnown(userId, newNames, 'MONITORING');
    }

    const pending = await this.userBreaches.getPendingNotification(userId);
    if (pending.length === 0) {
      return 'no_change';
    }

    const riskScoreBefore = (user.scanSnapshot as { riskScore?: number } | null)?.riskScore ?? null;
    const { scan, breaches } = await this.rescore(user, Array.from(new Set([...currentNames, ...pending])));
    const titles = new Map(breaches.map(breach => [breach.Name, breach.Title || breach.Name]));

    await this.notifications.createNewBreach({
      userId,
      breaches: pending.map(name => ({ name, title: titles.get(name) || name })),
      scan,
      riskScoreBefore,
    });

    log('info', 'Monitoring', 'monitor.new_breach', { userId, count: pending.length });
    return 'notified';
  }

  /** Recalcula score + IA a partir do catálogo local, grava o ScanHistory (MONITORING) e o snapshot */
  private async rescore(user: { id: number; email: string }, names: string[]) {
    const breaches: HibpBreach[] = await this.catalog.getByNames(names);
    const scan = await this.scanService.scoreBreaches(user.id, user.email, breaches, 'MONITORING');
    return { scan, breaches };
  }
}
