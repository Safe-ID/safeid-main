import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { computeEffectiveLimits, HibpPlanService } from '../../src/infra/http/hibp-plan.service';
import { HibpAuthError, HibpUnavailableError } from '../../src/infra/http/hibp.errors';

const ENV_KEYS = ['HIBP_RPM_LIMIT', 'HIBP_RPM_SAFETY_FACTOR', 'HIBP_EXPECTED_LATENCY_S', 'HIBP_RPM_FALLBACK'];

function createRedis(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    publish: jest.fn(async () => 1),
  };
}

function parseLogs(spy: jest.SpiedFunction<any>) {
  return spy.mock.calls.map(call => JSON.parse(call[0] as string));
}

describe('computeEffectiveLimits', () => {
  beforeEach(() => ENV_KEYS.forEach(key => delete process.env[key]));
  afterEach(() => ENV_KEYS.forEach(key => delete process.env[key]));

  it.each([
    ['Core 1', 10, 9, 1, 6667],
    ['Core 2', 50, 45, 2, 1334],
    ['Core 3', 100, 90, 3, 667],
    ['Core 4', 500, 450, 12, 134],
  ])('derives the limits of %s from its RPM', (planName, planRpm, rpm, concurrency, limiterDurationMs) => {
    expect(computeEffectiveLimits(planRpm as number, planName as string)).toEqual({
      planName,
      rpm,
      concurrency,
      limiterDurationMs,
    });
  });

  it('caps the concurrency at 20', () => {
    expect(computeEffectiveLimits(5000, 'Huge').concurrency).toBe(20);
  });

  it('only lets HIBP_RPM_LIMIT reduce the rate, never exceed the plan', () => {
    process.env.HIBP_RPM_LIMIT = '5';
    expect(computeEffectiveLimits(50, 'Core 2').rpm).toBe(5);

    process.env.HIBP_RPM_LIMIT = '400';
    expect(computeEffectiveLimits(50, 'Core 2').rpm).toBe(45);

    process.env.HIBP_RPM_LIMIT = 'abc';
    expect(computeEffectiveLimits(50, 'Core 2').rpm).toBe(45);
  });

  it('honors the safety factor and latency settings and never goes below 1 rpm', () => {
    process.env.HIBP_RPM_SAFETY_FACTOR = '0.5';
    process.env.HIBP_EXPECTED_LATENCY_S = '6';
    expect(computeEffectiveLimits(100, 'Core 3')).toMatchObject({ rpm: 50, concurrency: 5 });

    expect(computeEffectiveLimits(1, 'Tiny')).toMatchObject({ rpm: 1, limiterDurationMs: 60000 });
  });
});

describe('HibpPlanService', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    ENV_KEYS.forEach(key => delete process.env[key]);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reads the plan from the HIBP, caches it and logs it', async () => {
    const redis = createRedis();
    const client = {
      getSubscriptionStatus: jest.fn(async () => ({
        SubscriptionName: 'Pwned 2',
        SubscribedUntil: '2027-01-01T00:00:00',
        Rpm: 50,
      })),
    } as any;
    const service = new HibpPlanService(client, redis as any);

    const plan = await service.refresh();

    expect(plan).toMatchObject({ name: 'Pwned 2', rpm: 50, authOk: true, source: 'api' });
    expect(JSON.parse(redis.store.get('hibp:plan')!)).toMatchObject({ name: 'Pwned 2', rpm: 50 });
    expect(parseLogs(logSpy)).toContainEqual(expect.objectContaining({ event: 'hibp.plan', rpm: 50 }));
    await expect(service.getEffectiveLimits()).resolves.toMatchObject({ rpm: 45, concurrency: 2 });
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('publishes a change when the RPM differs from the cached plan', async () => {
    const redis = createRedis({ 'hibp:plan': JSON.stringify({ name: 'Pwned 1', rpm: 10, authOk: true }) });
    const client = { getSubscriptionStatus: jest.fn(async () => ({ SubscriptionName: 'Pwned 2', Rpm: 50 })) } as any;

    await new HibpPlanService(client, redis as any).refresh();

    expect(redis.publish).toHaveBeenCalledWith('hibp:plan:changed', JSON.stringify({ rpm: 50, name: 'Pwned 2' }));
    expect(parseLogs(warnSpy)).toContainEqual(expect.objectContaining({ event: 'hibp.plan_changed', previousRpm: 10 }));
  });

  it('warns when the subscription is about to expire and errors when it expired', async () => {
    const redis = createRedis();
    const client = {
      getSubscriptionStatus: jest
        .fn<() => Promise<any>>()
        .mockResolvedValueOnce({ SubscriptionName: 'Pwned 1', SubscribedUntil: '2026-10-18T00:00:00Z', Rpm: 10 })
        .mockResolvedValueOnce({ SubscriptionName: 'Pwned 1', SubscribedUntil: '2026-10-01T00:00:00Z', Rpm: 10 }),
    } as any;
    const service = new HibpPlanService(client, redis as any);

    await service.refresh();
    expect(parseLogs(warnSpy)).toContainEqual(expect.objectContaining({ event: 'hibp.plan_expiring', daysLeft: 2 }));

    await service.refresh();
    expect(parseLogs(errorSpy)).toContainEqual(expect.objectContaining({ event: 'hibp.plan_expired' }));
  });

  it('falls back to the cached plan when the HIBP is unavailable', async () => {
    const redis = createRedis({ 'hibp:plan': JSON.stringify({ name: 'Pwned 2', rpm: 50, authOk: true }) });
    const client = {
      getSubscriptionStatus: jest.fn(async () => {
        throw new HibpUnavailableError('down');
      }),
    } as any;

    const plan = await new HibpPlanService(client, redis as any).refresh();

    expect(plan).toMatchObject({ name: 'Pwned 2', rpm: 50, source: 'cache', authOk: true });
    expect(parseLogs(warnSpy)).toContainEqual(expect.objectContaining({ event: 'hibp.plan_refresh_failed', usingCache: true }));
  });

  it('falls back to HIBP_RPM_FALLBACK without cache and on invalid responses', async () => {
    process.env.HIBP_RPM_FALLBACK = '20';
    const redis = createRedis();
    const client = { getSubscriptionStatus: jest.fn(async () => ({ SubscriptionName: 'Broken', Rpm: 0 })) } as any;

    const plan = await new HibpPlanService(client, redis as any).refresh();

    expect(plan).toMatchObject({ name: 'fallback', rpm: 20, source: 'fallback', authOk: true });
  });

  it('marks the plan as unauthorized on 401 so the monitoring can stop', async () => {
    const redis = createRedis({ 'hibp:plan': JSON.stringify({ name: 'Pwned 1', rpm: 10, authOk: true }) });
    const client = {
      getSubscriptionStatus: jest.fn(async () => {
        throw new HibpAuthError('unauthorized', 401);
      }),
    } as any;

    const plan = await new HibpPlanService(client, redis as any).refresh();

    expect(plan).toMatchObject({ rpm: 10, authOk: false });
    expect(JSON.parse(redis.store.get('hibp:plan')!)).toMatchObject({ authOk: false });
    expect(parseLogs(errorSpy)).toContainEqual(expect.objectContaining({ event: 'hibp.auth_failed' }));
  });

  it('keeps working when Redis fails', async () => {
    const redis = {
      get: jest.fn(async () => {
        throw new Error('redis down');
      }),
      set: jest.fn(async () => {
        throw new Error('redis down');
      }),
      publish: jest.fn(),
    };
    const client = { getSubscriptionStatus: jest.fn(async () => ({ SubscriptionName: 'Pwned 1', Rpm: 10 })) } as any;

    const plan = await new HibpPlanService(client, redis as any).refresh();

    expect(plan).toMatchObject({ rpm: 10, source: 'api' });
    expect(parseLogs(warnSpy).map(entry => entry.event)).toEqual(
      expect.arrayContaining(['hibp.plan_cache_read_failed', 'hibp.plan_cache_write_failed']),
    );
  });

  it('uses the cache or the fallback before the first refresh and reloads from Redis', async () => {
    const redis = createRedis();
    const service = new HibpPlanService({ getSubscriptionStatus: jest.fn() } as any, redis as any);

    await expect(service.getPlan()).resolves.toMatchObject({ source: 'fallback', rpm: 10 });

    redis.store.set('hibp:plan', JSON.stringify({ name: 'Pwned 3', rpm: 100, authOk: true }));
    await expect(service.getPlan()).resolves.toMatchObject({ source: 'fallback' });
    await expect(service.reload()).resolves.toMatchObject({ name: 'Pwned 3', rpm: 100, source: 'cache' });
    await expect(service.getEffectiveLimits()).resolves.toMatchObject({ rpm: 90, concurrency: 3 });
  });
});
