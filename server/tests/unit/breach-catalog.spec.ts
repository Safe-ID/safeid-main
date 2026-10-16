import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { resolve } from 'path';
import { MockHibpCatalogClient } from '../../src/infra/http/hibp-catalog.mock';
import {
  BreachCatalogService,
  CATALOG_LAST_SYNC_KEY,
  isRelevantBreach,
} from '../../src/modules/monitoring/services/breach-catalog.service';
import {
  CATALOG_LAST_PROBE_KEY,
  CATALOG_LATEST_NAME_KEY,
  CatalogMonitorService,
} from '../../src/modules/monitoring/services/catalog-monitor.service';
import { formatHourKey, toJobIdPart } from '../../src/shared/utils/time';

const FIXTURE = resolve(__dirname, '../fixtures/hibp-breaches.json');

type Row = Record<string, any>;

/** Prisma em memória para a tabela breach_catalog (syncedAt imita o @updatedAt) */
function createPrisma() {
  const rows = new Map<string, Row>();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 15, 12, 0, clock++));

  const prisma: any = {
    rows,
    breachCatalog: {
      findMany: jest.fn(async ({ where, select }: any = {}) => {
        let list = Array.from(rows.values());
        if (where?.name?.in) list = list.filter(row => where.name.in.includes(row.name));
        return list.map(row => (select ? Object.fromEntries(Object.keys(select).map(key => [key, row[key]])) : { ...row }));
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const current = rows.get(where.name);
        const next = current ? { ...current, ...update, syncedAt: stamp() } : { ...create, syncedAt: stamp() };
        rows.set(where.name, next);
        return next;
      }),
      aggregate: jest.fn(async () => {
        const dates = Array.from(rows.values()).map(row => row.syncedAt.getTime());
        return { _max: { syncedAt: dates.length ? new Date(Math.max(...dates)) : null } };
      }),
    },
    syncState: null as Row | null,
    catalogSyncState: {
      findUnique: jest.fn(async () => (prisma.syncState ? { ...prisma.syncState } : null)),
      upsert: jest.fn(async ({ create, update }: any) => {
        prisma.syncState = prisma.syncState ? { ...prisma.syncState, ...update } : { ...create };
        return prisma.syncState;
      }),
    },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  return prisma;
}

function createRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
  };
}

const newBreach = (overrides: Record<string, unknown> = {}) => ({
  Name: 'BrandNew',
  Title: 'Brand New',
  Domain: 'brandnew.example.com',
  BreachDate: '2026-09-30',
  AddedDate: '2026-10-15T10:00:00Z',
  ModifiedDate: '2026-10-15T10:00:00Z',
  PwnCount: 1200,
  DataClasses: ['Email addresses', 'Passwords'],
  IsVerified: true,
  IsFabricated: false,
  IsSensitive: false,
  IsRetired: false,
  IsSpamList: false,
  IsMalware: false,
  IsStealerLog: false,
  ...overrides,
});

describe('BreachCatalogService', () => {
  let prisma: any;
  let redis: ReturnType<typeof createRedis>;
  let catalogClient: MockHibpCatalogClient;
  let service: BreachCatalogService;
  const now = new Date('2026-10-15T12:30:00.000Z');

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    prisma = createPrisma();
    redis = createRedis();
    catalogClient = new MockHibpCatalogClient(FIXTURE);
    service = new BreachCatalogService(prisma, catalogClient, redis as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('populates the catalog on the first sync and records the sync time', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await service.sync(now);

    expect(result.firstSync).toBe(true);
    expect(result.total).toBe(5);
    expect(result.changed).toHaveLength(5);
    expect(prisma.rows.size).toBe(5);
    expect(redis.store.get(CATALOG_LAST_SYNC_KEY)).toBe(now.toISOString());
    expect(JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      event: 'catalog.sync.done',
      total: 5,
      changed: 5,
      firstSync: true,
    });
  });

  it('maps the HIBP payload to the catalog row', async () => {
    await service.sync(now);

    expect(prisma.rows.get('LinkedIn')).toMatchObject({
      name: 'LinkedIn',
      title: 'LinkedIn Data Exposure',
      domain: 'linkedin.com',
      breachDate: new Date('2021-06-22'),
      addedDate: new Date('2021-10-02T00:00:00Z'),
      modifiedDate: new Date('2021-10-02T00:00:00Z'),
      pwnCount: BigInt(125698496),
      dataClasses: ['Email addresses', 'Phone numbers'],
      isVerified: true,
      isSensitive: false,
      raw: expect.objectContaining({ Name: 'LinkedIn', Description: 'Mock fixture breach.' }),
    });
    expect(prisma.rows.get('PrivateForum').isSensitive).toBe(true);
  });

  it('fills missing optional fields with safe defaults', async () => {
    catalogClient.addBreach({ Name: 'Sparse', Title: '', BreachDate: 'not-a-date', DataClasses: undefined as any, IsVerified: false });

    await service.sync(now);

    expect(prisma.rows.get('Sparse')).toMatchObject({
      title: 'Sparse',
      domain: null,
      breachDate: null,
      addedDate: now,
      modifiedDate: now,
      pwnCount: BigInt(0),
      dataClasses: [],
      isStealerLog: false,
    });
  });

  it('reports nothing on a sync without changes', async () => {
    await service.sync(now);
    prisma.breachCatalog.upsert.mockClear();

    const result = await service.sync(now);

    expect(result).toMatchObject({ firstSync: false, total: 5, changed: [] });
    expect(prisma.breachCatalog.upsert).not.toHaveBeenCalled();
  });

  it('detects new breaches and breaches with a newer ModifiedDate', async () => {
    await service.sync(now);

    catalogClient.addBreach(newBreach());
    catalogClient.updateBreach('LinkedIn', { ModifiedDate: '2026-10-15T09:00:00Z', DataClasses: ['Email addresses', 'Passwords'] });
    // Data mais antiga que a do banco não conta como alteração
    catalogClient.updateBreach('Equifax', { ModifiedDate: '2010-01-01T00:00:00Z' });

    const result = await service.sync(now);

    expect(result.changed.map(breach => breach.Name).sort()).toEqual(['BrandNew', 'LinkedIn']);
    expect(prisma.rows.get('LinkedIn').dataClasses).toEqual(['Email addresses', 'Passwords']);
  });

  it('upserts in batches of 100 inside transactions', async () => {
    for (let i = 0; i < 230; i++) {
      catalogClient.addBreach(newBreach({ Name: `Bulk${i}` }));
    }

    await service.sync(now);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.rows.size).toBe(235);
  });

  it('returns breaches by name in order, fetching and storing the missing ones', async () => {
    await service.sync(now);
    jest.spyOn(catalogClient, 'getBreach');
    catalogClient.addBreach(newBreach({ Name: 'OnlyOnHibp' }));

    const result = await service.getByNames(['LinkedIn', 'OnlyOnHibp', 'Ghost', 'LinkedIn', 'Equifax'], now);

    expect(result.map(breach => breach.Name)).toEqual(['LinkedIn', 'OnlyOnHibp', 'Equifax']);
    expect(catalogClient.getBreach).toHaveBeenCalledTimes(2);
    expect(prisma.rows.has('OnlyOnHibp')).toBe(true);
    await expect(service.getByNames([])).resolves.toEqual([]);
  });

  it('reads the last sync time from Redis and falls back to the database', async () => {
    await expect(service.getLastSyncAt()).resolves.toBeNull();

    await service.sync(now);
    await expect(service.getLastSyncAt()).resolves.toEqual(now);

    redis.store.delete(CATALOG_LAST_SYNC_KEY);
    await expect(service.getLastSyncAt()).resolves.toEqual(now);
  });

  it('does not count rows stored by getByNames as a completed sync', async () => {
    await service.getByNames(['ShopBR', 'LinkedIn'], now);
    expect(prisma.rows.size).toBe(2);

    // Sem catalog-sync concluído não há data de sincronização, nem pelo fallback do banco
    await expect(service.getLastSyncAt()).resolves.toBeNull();

    const result = await service.sync(now);

    expect(result.firstSync).toBe(true);
    expect(result.changed.map(breach => breach.Name).sort()).toEqual(['Equifax', 'PrivateForum', 'TestBreach']);
    expect(prisma.syncState).toEqual({ id: 1, lastSyncAt: now, total: 5 });
  });

  it('is not a first sync once a sync has completed, even with the catalog emptied', async () => {
    await service.sync(now);
    prisma.rows.clear();

    const result = await service.sync(now);

    expect(result).toMatchObject({ firstSync: false, total: 5 });
    expect(result.changed).toHaveLength(5);
  });

  it('treats only non-sensitive, non-retired breaches as relevant', () => {
    expect(isRelevantBreach({ IsSensitive: false, IsRetired: false })).toBe(true);
    expect(isRelevantBreach({ IsSensitive: true, IsRetired: false })).toBe(false);
    expect(isRelevantBreach({ IsSensitive: false, IsRetired: true })).toBe(false);
  });
});

describe('CatalogMonitorService', () => {
  let prisma: any;
  let redis: ReturnType<typeof createRedis>;
  let catalogClient: MockHibpCatalogClient;
  let queue: { add: jest.Mock<any> };
  let monitor: CatalogMonitorService;
  // 12:30 UTC = 09:30 BRT
  const now = new Date('2026-10-15T12:30:00.000Z');

  beforeEach(() => {
    delete process.env.SCHEDULER_TZ;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    prisma = createPrisma();
    redis = createRedis();
    catalogClient = new MockHibpCatalogClient(FIXTURE);
    queue = { add: jest.fn(async () => ({})) };
    const catalog = new BreachCatalogService(prisma, catalogClient, redis as any);
    monitor = new CatalogMonitorService(catalog, catalogClient, queue as any, redis as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('catalog-sync', () => {
    it('only populates on the first sync (no sweep)', async () => {
      await expect(monitor.handleCatalogSync('cron', now)).resolves.toEqual({
        total: 5,
        changed: 5,
        firstSync: true,
        sweepEnqueued: false,
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does not sweep on the first real sync after getByNames stored some rows', async () => {
      // Ex.: alerta montado antes do primeiro catalog-sync grava os vazamentos que usou
      await new BreachCatalogService(prisma, catalogClient, redis as any).getByNames(['ShopBR'], now);

      const result = await monitor.handleCatalogSync('cron', now);

      expect(result).toMatchObject({ firstSync: true, changed: 4, sweepEnqueued: false });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueues a sweep when a new breach is published', async () => {
      await monitor.handleCatalogSync('cron', now);
      catalogClient.addBreach(newBreach());

      const result = await monitor.handleCatalogSync('probe', now);

      expect(result.sweepEnqueued).toBe(true);
      expect(queue.add).toHaveBeenCalledWith(
        'monitor-sweep',
        { reason: 'CATALOG_CHANGE', breachNames: ['BrandNew'] },
        { jobId: expect.stringMatching(/^sweep-CATALOG_CHANGE-2026101509-[0-9a-f]{12}$/) },
      );
    });

    it('enqueues a sweep when an existing breach is modified', async () => {
      await monitor.handleCatalogSync('cron', now);
      catalogClient.updateBreach('TestBreach', { ModifiedDate: '2026-10-15T08:00:00Z' });

      await monitor.handleCatalogSync('cron', now);

      expect(queue.add).toHaveBeenCalledWith('monitor-sweep', { reason: 'CATALOG_CHANGE', breachNames: ['TestBreach'] }, expect.anything());
    });

    it.each([
      ['sensitive', { IsSensitive: true }],
      ['retired', { IsRetired: true }],
    ])('does not sweep for a %s breach alone', async (_label, flags) => {
      await monitor.handleCatalogSync('cron', now);
      catalogClient.addBreach(newBreach({ Name: 'Hidden', ...flags }));

      const result = await monitor.handleCatalogSync('cron', now);

      expect(result).toMatchObject({ changed: 1, sweepEnqueued: false });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('lists only the relevant breaches and dedupes the same change set', async () => {
      await monitor.handleCatalogSync('cron', now);
      catalogClient.addBreach(newBreach({ Name: 'Visible' }));
      catalogClient.addBreach(newBreach({ Name: 'Hidden', IsSensitive: true }));
      await monitor.handleCatalogSync('cron', now);

      const [, data, options] = queue.add.mock.calls[0] as any[];
      expect(data.breachNames).toEqual(['Visible']);

      // Outra mudança na mesma hora gera outra varredura (jobId diferente)
      catalogClient.addBreach(newBreach({ Name: 'Another' }));
      await monitor.handleCatalogSync('cron', now);
      const [, , secondOptions] = queue.add.mock.calls[1] as any[];
      expect(secondOptions.jobId).not.toBe(options.jobId);
      expect(secondOptions.jobId.startsWith('sweep-CATALOG_CHANGE-2026101509-')).toBe(true);
    });
  });

  describe('catalog-probe', () => {
    it('only records the latest breach on the first run', async () => {
      await expect(monitor.handleCatalogProbe(now)).resolves.toEqual({ latestName: 'ShopBR', syncEnqueued: false });

      expect(redis.store.get(CATALOG_LATEST_NAME_KEY)).toBe('ShopBR');
      expect(redis.store.get(CATALOG_LAST_PROBE_KEY)).toBe(now.toISOString());
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does nothing when the latest breach did not change', async () => {
      await monitor.handleCatalogProbe(now);

      await expect(monitor.handleCatalogProbe(now)).resolves.toEqual({ latestName: 'ShopBR', syncEnqueued: false });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueues a catalog sync when a new breach is published', async () => {
      await monitor.handleCatalogProbe(now);
      catalogClient.addBreach(newBreach({ Name: 'Fresh.Leak', AddedDate: '2026-10-15T11:00:00Z' }));

      await expect(monitor.handleCatalogProbe(now)).resolves.toEqual({ latestName: 'Fresh.Leak', syncEnqueued: true });
      expect(queue.add).toHaveBeenCalledWith(
        'catalog-sync',
        { origin: 'probe' },
        { jobId: 'catalog-sync-probe-Fresh_Leak', attempts: 3, backoff: { type: 'exponential', delay: 60000 } },
      );
      expect(redis.store.get(CATALOG_LATEST_NAME_KEY)).toBe('Fresh.Leak');
    });

    it('handles an empty latest breach response', async () => {
      jest.spyOn(catalogClient, 'getLatestBreach').mockResolvedValue(null);

      await expect(monitor.handleCatalogProbe(now)).resolves.toEqual({ latestName: null, syncEnqueued: false });
      expect(redis.store.get(CATALOG_LAST_PROBE_KEY)).toBe(now.toISOString());
    });
  });
});

describe('time helpers', () => {
  afterEach(() => {
    delete process.env.SCHEDULER_TZ;
  });

  it('formats the hour key in the scheduler time zone (BRT by default)', () => {
    expect(formatHourKey(new Date('2026-10-15T12:30:00.000Z'))).toBe('2026101509');
    expect(formatHourKey(new Date('2026-10-16T02:10:00.000Z'))).toBe('2026101523');

    process.env.SCHEDULER_TZ = 'UTC';
    expect(formatHourKey(new Date('2026-10-16T02:10:00.000Z'))).toBe('2026101602');
  });

  it('keeps only characters accepted in BullMQ job ids', () => {
    expect(toJobIdPart('Fresh.Leak:2026 (BR)')).toBe('Fresh_Leak_2026__BR_');
  });
});
