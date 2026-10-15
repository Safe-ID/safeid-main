import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { HibpAuthError } from './hibp.errors';
import { HibpClientLike } from './hibp.types';
import { HIBP_CLIENT, HIBP_PLAN_CHANGED_CHANNEL, REDIS_QUEUE_CONNECTION } from '../queue/queue.constants';
import { log } from '../../shared/utils/logger';

export interface HibpPlan {
  name: string;
  rpm: number;
  subscribedUntil: string | null;
  /** false quando a última consulta deu 401/403: o monitoramento não deve enfileirar nada */
  authOk: boolean;
  source: 'api' | 'cache' | 'fallback';
  checkedAt: string;
}

export interface HibpEffectiveLimits {
  rpm: number;
  concurrency: number;
  /** Intervalo do limiter: 1 chamada a cada limiterDurationMs */
  limiterDurationMs: number;
  planName: string;
}

const PLAN_CACHE_KEY = 'hibp:plan';
const EXPIRY_WARNING_DAYS = 7;
const MAX_CONCURRENCY = 20;

function readNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Limites do worker hibp-check a partir do RPM do plano:
 * - rpm = floor(planRpm × HIBP_RPM_SAFETY_FACTOR), ou HIBP_RPM_LIMIT se for menor (override manual)
 * - limiter = 1 chamada a cada ceil(60 000 / rpm) ms (chamadas espaçadas, menos risco de 429)
 * - concurrency = clamp(ceil(rpm / 60 × HIBP_EXPECTED_LATENCY_S), 1, 20)
 */
export function computeEffectiveLimits(planRpm: number, planName: string): HibpEffectiveLimits {
  const safetyFactor = readNumberEnv('HIBP_RPM_SAFETY_FACTOR', 0.9);
  const expectedLatencyS = readNumberEnv('HIBP_EXPECTED_LATENCY_S', 1.5);
  const override = Number(process.env.HIBP_RPM_LIMIT);

  let rpm = Math.floor(planRpm * safetyFactor);
  // O override só reduz: um valor acima do plano geraria 429
  if (Number.isFinite(override) && override > 0) {
    rpm = Math.min(rpm, Math.floor(override));
  }
  rpm = Math.max(1, rpm);

  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Math.ceil((rpm / 60) * expectedLatencyS)));

  return {
    rpm,
    concurrency,
    limiterDurationMs: Math.ceil(60_000 / rpm),
    planName,
  };
}

/**
 * Plano HIBP contratado (GET /subscription/status), com cache no Redis.
 * Trocar de plano (ex.: Core 1 → Core 2) não exige mudar código nem configuração.
 */
@Injectable()
export class HibpPlanService {
  private current: HibpPlan | null = null;

  constructor(
    @Inject(HIBP_CLIENT) private readonly hibpClient: HibpClientLike,
    @Inject(REDIS_QUEUE_CONNECTION) private readonly redis: Redis,
  ) {}

  /**
   * Consulta o plano na HIBP e grava no Redis. Em falha usa o último valor do Redis
   * e, sem cache, o HIBP_RPM_FALLBACK. Se o RPM mudou, avisa as tasks pelo pub/sub.
   */
  async refresh(): Promise<HibpPlan> {
    const previous = await this.readCache();
    const now = new Date().toISOString();

    try {
      const status = await this.hibpClient.getSubscriptionStatus();
      const rpm = Number(status?.Rpm);
      if (!Number.isFinite(rpm) || rpm <= 0) {
        throw new Error('Invalid Rpm in /subscription/status');
      }

      const plan: HibpPlan = {
        name: String(status.SubscriptionName || 'unknown'),
        rpm,
        subscribedUntil: status.SubscribedUntil ? String(status.SubscribedUntil) : null,
        authOk: true,
        source: 'api',
        checkedAt: now,
      };

      await this.writeCache(plan);
      this.current = plan;

      log('info', 'HibpPlan', 'hibp.plan', { name: plan.name, rpm: plan.rpm, subscribedUntil: plan.subscribedUntil });
      this.warnAboutExpiry(plan);

      if (previous && previous.rpm !== plan.rpm) {
        log('warn', 'HibpPlan', 'hibp.plan_changed', { previousRpm: previous.rpm, rpm: plan.rpm });
        await this.publishChange(plan);
      }

      return plan;
    } catch (error) {
      const authFailed = error instanceof HibpAuthError;
      log(authFailed ? 'error' : 'warn', 'HibpPlan', authFailed ? 'hibp.auth_failed' : 'hibp.plan_refresh_failed', {
        err: error,
        usingCache: Boolean(previous),
      });

      const fallback: HibpPlan = previous
        ? { ...previous, source: 'cache', authOk: authFailed ? false : previous.authOk }
        : { ...this.fallbackPlan(now), authOk: !authFailed };

      if (authFailed) {
        // Guarda o estado de "sem autorização" para todas as tasks verem
        await this.writeCache({ ...fallback, checkedAt: now });
      }

      this.current = fallback;
      return fallback;
    }
  }

  /** Plano em uso: o último refresh, o cache do Redis ou o fallback */
  async getPlan(): Promise<HibpPlan> {
    if (this.current) {
      return this.current;
    }

    const cached = await this.readCache();
    this.current = cached ? { ...cached, source: 'cache' } : this.fallbackPlan(new Date().toISOString());
    return this.current;
  }

  /** Relê o plano do Redis (outra task fez o refresh e avisou pelo pub/sub) */
  async reload(): Promise<HibpPlan> {
    this.current = null;
    return this.getPlan();
  }

  async getEffectiveLimits(): Promise<HibpEffectiveLimits> {
    const plan = await this.getPlan();
    return computeEffectiveLimits(plan.rpm, plan.name);
  }

  private fallbackPlan(checkedAt: string): HibpPlan {
    return {
      name: 'fallback',
      rpm: readNumberEnv('HIBP_RPM_FALLBACK', 10),
      subscribedUntil: null,
      authOk: true,
      source: 'fallback',
      checkedAt,
    };
  }

  private warnAboutExpiry(plan: HibpPlan): void {
    if (!plan.subscribedUntil) {
      return;
    }

    const until = new Date(plan.subscribedUntil).getTime();
    if (Number.isNaN(until)) {
      return;
    }

    const daysLeft = (until - Date.now()) / (24 * 3600 * 1000);
    if (daysLeft < 0) {
      log('error', 'HibpPlan', 'hibp.plan_expired', { name: plan.name, subscribedUntil: plan.subscribedUntil });
    } else if (daysLeft < EXPIRY_WARNING_DAYS) {
      log('warn', 'HibpPlan', 'hibp.plan_expiring', {
        name: plan.name,
        subscribedUntil: plan.subscribedUntil,
        daysLeft: Math.floor(daysLeft),
      });
    }
  }

  private async readCache(): Promise<HibpPlan | null> {
    try {
      const raw = await this.redis.get(PLAN_CACHE_KEY);
      return raw ? (JSON.parse(raw) as HibpPlan) : null;
    } catch (error) {
      log('warn', 'HibpPlan', 'hibp.plan_cache_read_failed', { err: error });
      return null;
    }
  }

  private async writeCache(plan: HibpPlan): Promise<void> {
    try {
      await this.redis.set(PLAN_CACHE_KEY, JSON.stringify(plan));
    } catch (error) {
      log('warn', 'HibpPlan', 'hibp.plan_cache_write_failed', { err: error });
    }
  }

  private async publishChange(plan: HibpPlan): Promise<void> {
    try {
      await this.redis.publish(HIBP_PLAN_CHANGED_CHANNEL, JSON.stringify({ rpm: plan.rpm, name: plan.name }));
    } catch (error) {
      log('warn', 'HibpPlan', 'hibp.plan_publish_failed', { err: error });
    }
  }
}
