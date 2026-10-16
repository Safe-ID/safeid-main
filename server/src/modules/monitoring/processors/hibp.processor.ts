import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { HibpAuthError, HibpRateLimitError } from '../../../infra/http/hibp.errors';
import { PrismaService } from '../../../infra/database/prisma.service';
import { HibpPlanService } from '../../../infra/http/hibp-plan.service';
import { HibpClientLike } from '../../../infra/http/hibp.types';
import {
  HIBP_CLIENT,
  HIBP_PLAN_CHANGED_CHANNEL,
  JOB_CHECK_HIBP,
  JOB_MONITOR_CHECK,
  JOB_MONITOR_PROCESS,
  MONITORING_QUEUE,
  QUEUE_HIBP,
} from '../../../infra/queue/queue.constants';
import { createBullConnection } from '../../../infra/queue/redis-connection';
import { runsWorkers } from '../../../shared/config/app-role';
import { log } from '../../../shared/utils/logger';
import { closeQuietly } from '../../../shared/utils/shutdown';

/**
 * Worker da fila hibp-check: única porta de saída para consultas autenticadas na HIBP.
 * O limiter do BullMQ é global (via Redis), então o RPM vale para todas as tasks juntas.
 * Limite e concorrência vêm do plano contratado (HibpPlanService), sem valores fixos.
 */
@Injectable()
export class HibpProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private workerConnection: Redis | null = null;
  private subscriber: Redis | null = null;
  private lifecycle: Promise<void> = Promise.resolve();

  constructor(
    @Inject(HIBP_CLIENT) private readonly hibpClient: HibpClientLike,
    private readonly hibpPlan: HibpPlanService,
    private readonly prisma: PrismaService,
    @Inject(MONITORING_QUEUE) private readonly monitoringQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!runsWorkers()) {
      log('info', 'HibpProcessor', 'worker.disabled', { queue: QUEUE_HIBP, reason: 'APP_ROLE=api' });
      return;
    }

    await this.hibpPlan.refresh();
    await this.startWorker();
    await this.subscribeToPlanChanges();
  }

  async onModuleDestroy(): Promise<void> {
    await this.lifecycle;
    if (this.subscriber) {
      const subscriber = this.subscriber;
      this.subscriber = null;
      await closeQuietly('hibp-plan-subscriber', () => subscriber.quit());
    }
    await this.stopWorker();
  }

  /** Recria o worker com os limites atuais do plano (chamado quando o RPM muda) */
  rebuildWorker(): Promise<void> {
    this.lifecycle = this.lifecycle.then(async () => {
      await this.stopWorker();
      await this.startWorker();
    });
    return this.lifecycle;
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB_CHECK_HIBP:
        return this.handleCheck(job);
      case JOB_MONITOR_CHECK:
        return this.handleMonitorCheck(job);
      default:
        throw new Error(`Unknown job '${job.name}' in queue ${QUEUE_HIBP}`);
    }
  }

  /** Scan manual/cadastro: mesmo contrato de antes (resultado em job.data.result) */
  private async handleCheck(job: Job): Promise<unknown[]> {
    const { email } = job.data || {};

    if (!email) {
      throw new Error('Job missing email');
    }

    try {
      const breaches = await this.hibpClient.checkAccount(email);
      await job.updateData({ ...job.data, result: breaches });
      return breaches;
    } catch (error) {
      if (error instanceof HibpRateLimitError) {
        await this.applyRateLimit(error);
      }
      throw error;
    }
  }

  /**
   * T4.3 Monitoramento: consulta estrita (erro da HIBP nunca vira "sem vazamentos";
   * propaga para o BullMQ tentar de novo) e passa só userId + nomes para a fila monitoring.
   */
  private async handleMonitorCheck(job: Job): Promise<{ skipped: true } | { breaches: number }> {
    const userId = Number(job.data?.userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, monitoringEnabled: true, emailVerifiedAt: true },
    });

    // Conta apagada, opt-out ou e-mail não verificado desde o enfileiramento
    if (!user || !user.monitoringEnabled || !user.emailVerifiedAt) {
      return { skipped: true };
    }

    let result: unknown[];
    try {
      result = await this.hibpClient.getBreachedAccountStrict(user.email, { truncate: true });
    } catch (error) {
      if (error instanceof HibpRateLimitError) {
        await this.applyRateLimit(error);
      }
      if (error instanceof HibpAuthError) {
        log('error', 'HibpProcessor', 'hibp.auth_failed', { job: job.name, status: error.status });
      }
      throw error;
    }

    const breachNames = Array.from(
      new Set(
        result
          .map(item => (item as { Name?: unknown } | null)?.Name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0),
      ),
    );

    await this.monitoringQueue.add(
      JOB_MONITOR_PROCESS,
      { userId, breachNames, checkedAt: new Date().toISOString() },
      { jobId: `process-${job.id}`, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
    );

    return { breaches: breachNames.length };
  }

  /** 429: pausa a fila inteira pelo retry-after e devolve o job para a fila sem gastar tentativa */
  private async applyRateLimit(error: HibpRateLimitError): Promise<never> {
    log('warn', 'HibpProcessor', 'hibp.rate_limited', { retryAfterMs: error.retryAfterMs });
    if (this.worker) {
      await this.worker.rateLimit(error.retryAfterMs);
    }
    throw Worker.RateLimitError();
  }

  private async startWorker(): Promise<void> {
    const limits = await this.hibpPlan.getEffectiveLimits();
    const connection = createBullConnection();

    const worker = new Worker(QUEUE_HIBP, (job: Job) => this.process(job), {
      connection,
      concurrency: limits.concurrency,
      limiter: { max: 1, duration: limits.limiterDurationMs },
    });

    worker.on('failed', (job: Job | undefined, error: Error) => {
      log('warn', 'HibpProcessor', 'hibp.job_failed', {
        jobId: job?.id,
        job: job?.name,
        attemptsMade: job?.attemptsMade,
        err: error,
      });
    });

    this.worker = worker;
    this.workerConnection = connection;

    log('info', 'HibpProcessor', 'hibp.worker_started', {
      planName: limits.planName,
      rpm: limits.rpm,
      concurrency: limits.concurrency,
      limiterDurationMs: limits.limiterDurationMs,
    });
  }

  private async stopWorker(): Promise<void> {
    const worker = this.worker;
    const connection = this.workerConnection;
    this.worker = null;
    this.workerConnection = null;

    if (worker) {
      // Espera o job em andamento terminar e não pega jobs novos
      await closeQuietly('hibp-worker', () => worker.close());
    }
    if (connection) {
      await closeQuietly('redis-hibp-worker', () => connection.quit());
    }
  }

  private async subscribeToPlanChanges(): Promise<void> {
    const subscriber = createBullConnection();
    this.subscriber = subscriber;

    subscriber.on('message', (channel: string) => {
      if (channel !== HIBP_PLAN_CHANGED_CHANNEL) {
        return;
      }

      void this.hibpPlan
        .reload()
        .then(() => this.rebuildWorker())
        .catch(error => log('error', 'HibpProcessor', 'hibp.worker_rebuild_failed', { err: error }));
    });

    await subscriber.subscribe(HIBP_PLAN_CHANGED_CHANNEL);
  }
}
