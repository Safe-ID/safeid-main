import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { HibpPlanService } from '../../../infra/http/hibp-plan.service';
import { EMAIL_QUEUE, HIBP_QUEUE, MONITORING_QUEUE } from '../../../infra/queue/queue.constants';
import { BreachCatalogService } from './breach-catalog.service';
import { CATALOG_LAST_PROBE_KEY } from './catalog-monitor.service';
import { HEARTBEAT_KEY_PREFIX } from './monitoring-scheduler.service';

const COUNT_TYPES = ['waiting', 'prioritized', 'active', 'delayed', 'failed', 'completed'] as const;

type Section<T> = T | { error: string };

export interface JobsHealthReport {
  checkedAt: string;
  lastCatalogSyncAt: Section<string | null>;
  lastProbeAt: Section<string | null>;
  plan: Section<{ name: string; rpm: number; authOk: boolean; subscribedUntil: string | null; source: string }>;
  queues: Record<'hibp' | 'monitoring' | 'email', Section<Record<string, number>>>;
  schedulers: Section<Array<{ id: string; job: string; pattern: string | null; tz: string | null; next: string | null }>>;
  heartbeats: Section<Array<{ host: string; ts: string | null; pid: number | null }>>;
}

/**
 * Estado das cargas em segundo plano para operação (T7.12). Cada parte é lida de forma
 * independente: uma falha (ex.: Redis fora) aparece como { error } sem derrubar o relatório.
 * Não faz parte do health check do ALB: fila atrasada não deve tirar a API do ar.
 */
@Injectable()
export class JobsHealthService {
  constructor(
    private readonly catalog: BreachCatalogService,
    private readonly hibpPlan: HibpPlanService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Inject(HIBP_QUEUE) private readonly hibpQueue: Queue,
    @Inject(MONITORING_QUEUE) private readonly monitoringQueue: Queue,
    @Inject(EMAIL_QUEUE) private readonly emailQueue: Queue,
  ) {}

  async getReport(): Promise<JobsHealthReport> {
    const [lastCatalogSyncAt, lastProbeAt, plan, hibp, monitoring, email, schedulers, heartbeats] = await Promise.all([
      this.safely(async () => (await this.catalog.getLastSyncAt())?.toISOString() ?? null),
      this.safely(() => this.redis.get(CATALOG_LAST_PROBE_KEY)),
      this.safely(async () => {
        const current = await this.hibpPlan.getPlan();
        return {
          name: current.name,
          rpm: current.rpm,
          authOk: current.authOk,
          subscribedUntil: current.subscribedUntil,
          source: current.source,
        };
      }),
      this.safely(() => this.counts(this.hibpQueue)),
      this.safely(() => this.counts(this.monitoringQueue)),
      this.safely(() => this.counts(this.emailQueue)),
      this.safely(() => this.schedulers()),
      this.safely(() => this.heartbeats()),
    ]);

    return {
      checkedAt: new Date().toISOString(),
      lastCatalogSyncAt,
      lastProbeAt,
      plan,
      queues: { hibp, monitoring, email },
      schedulers,
      heartbeats,
    };
  }

  private async safely<T>(read: () => Promise<T>): Promise<Section<T>> {
    try {
      return await read();
    } catch (error) {
      return { error: (error as Error)?.message || 'unavailable' };
    }
  }

  private async counts(queue: Queue): Promise<Record<string, number>> {
    return queue.getJobCounts(...COUNT_TYPES);
  }

  private async schedulers() {
    const schedulers = await this.monitoringQueue.getJobSchedulers(0, -1, true);
    return schedulers.map(scheduler => ({
      id: scheduler.key,
      job: scheduler.name,
      pattern: scheduler.pattern ?? null,
      tz: scheduler.tz ?? null,
      next: scheduler.next ? new Date(scheduler.next).toISOString() : null,
    }));
  }

  /** Heartbeats vivos (TTL 90 s): um por task com workers */
  private async heartbeats() {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${HEARTBEAT_KEY_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');

    const result = [];
    for (const key of keys.sort()) {
      const raw = await this.redis.get(key);
      let parsed: { ts?: string; pid?: number } = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      result.push({ host: key.slice(HEARTBEAT_KEY_PREFIX.length), ts: parsed.ts ?? null, pid: parsed.pid ?? null });
    }
    return result;
  }
}
