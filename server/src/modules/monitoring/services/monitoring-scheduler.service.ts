import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import Redis from 'ioredis';
import { hostname } from 'os';
import {
  JOB_CATALOG_PROBE,
  JOB_CATALOG_SYNC,
  JOB_CLEANUP_UNVERIFIED,
  JOB_HIBP_PLAN_CHECK,
  JOB_MONITOR_SWEEP,
  JOB_MONITORING_RECONCILE,
  MONITORING_QUEUE,
} from '../../../infra/queue/queue.constants';
import { runsWorkers } from '../../../shared/config/app-role';
import { log } from '../../../shared/utils/logger';
import { getSchedulerTimeZone } from '../../../shared/utils/time';

const WATCHDOG_INTERVAL_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const HEARTBEAT_TTL_S = 90;

export const HEARTBEAT_KEY_PREFIX = 'worker:heartbeat:';

interface ScheduleDefinition {
  id: string;
  envVar: string;
  defaultPattern: string;
  jobName: string;
  data?: Record<string, unknown>;
  opts?: Omit<JobsOptions, 'jobId' | 'repeat' | 'delay'>;
}

/** Horários em SCHEDULER_TZ (BRT). Os padrões seguem o .env.example. */
export const SCHEDULES: ScheduleDefinition[] = [
  { id: 'catalog-probe', envVar: 'HIBP_CATALOG_PROBE_CRON', defaultPattern: '5 * * * *', jobName: JOB_CATALOG_PROBE },
  {
    id: 'catalog-sync',
    envVar: 'HIBP_CATALOG_SYNC_CRON',
    defaultPattern: '0 */6 * * *',
    jobName: JOB_CATALOG_SYNC,
    data: { origin: 'cron' },
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
  },
  {
    id: 'weekly-sweep',
    envVar: 'MONITORING_WEEKLY_SWEEP_CRON',
    defaultPattern: '0 3 * * 1',
    jobName: JOB_MONITOR_SWEEP,
    data: { reason: 'WEEKLY' },
  },
  { id: 'cleanup-unverified', envVar: 'UNVERIFIED_CLEANUP_CRON', defaultPattern: '30 4 * * *', jobName: JOB_CLEANUP_UNVERIFIED },
  { id: 'hibp-plan-check', envVar: 'HIBP_PLAN_CHECK_CRON', defaultPattern: '0 2 * * *', jobName: JOB_HIBP_PLAN_CHECK },
  {
    id: 'monitoring-reconcile',
    envVar: 'MONITORING_RECONCILE_CRON',
    defaultPattern: '20 * * * *',
    jobName: JOB_MONITORING_RECONCILE,
  },
];

/**
 * T4.5: agendamentos do monitoramento (Job Schedulers do BullMQ, idempotentes: várias tasks
 * registrando ao subir não duplicam nada). Os agendamentos vivem no Redis; se o nó reiniciar
 * sem persistência eles somem, por isso o watchdog em processo refaz o registro a cada 10 min.
 * O heartbeat (worker:heartbeat:{host}, TTL 90 s) é a base do health check de um worker separado.
 */
@Injectable()
export class MonitoringSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private watchdog: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly host = hostname();

  constructor(
    @Inject(MONITORING_QUEUE) private readonly monitoringQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!runsWorkers()) {
      log('info', 'MonitoringScheduler', 'scheduler.disabled', { reason: 'APP_ROLE=api' });
      return;
    }

    await this.registerSchedulers();
    await this.beat();

    this.watchdog = setInterval(() => void this.registerSchedulers(), WATCHDOG_INTERVAL_MS);
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.watchdog = null;
    this.heartbeat = null;
  }

  /** Registra (ou atualiza) todos os agendamentos. Falha no Redis não derruba a aplicação. */
  async registerSchedulers(): Promise<number> {
    const tz = getSchedulerTimeZone();
    let registered = 0;

    for (const schedule of SCHEDULES) {
      const pattern = (process.env[schedule.envVar] || '').trim() || schedule.defaultPattern;
      try {
        await this.monitoringQueue.upsertJobScheduler(
          schedule.id,
          { pattern, tz },
          { name: schedule.jobName, data: schedule.data ?? {}, opts: schedule.opts },
        );
        registered++;
      } catch (error) {
        log('error', 'MonitoringScheduler', 'scheduler.register_failed', { scheduler: schedule.id, err: error });
      }
    }

    log('info', 'MonitoringScheduler', 'scheduler.registered', { count: registered, tz });
    return registered;
  }

  private async beat(): Promise<void> {
    try {
      await this.redis.set(
        `${HEARTBEAT_KEY_PREFIX}${this.host}`,
        JSON.stringify({ ts: new Date().toISOString(), pid: process.pid }),
        'EX',
        HEARTBEAT_TTL_S,
      );
    } catch (error) {
      log('warn', 'MonitoringScheduler', 'heartbeat.failed', { err: error });
    }
  }
}
