import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(async () => undefined),
  })),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(function (this: any) {
    this.quit = jest.fn(async () => 'OK');
  }),
);

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { MonitoringProcessor } from '../../src/modules/monitoring/processors/monitoring.processor';

const WorkerMock = Worker as unknown as jest.Mock;
const RedisMock = Redis as unknown as jest.Mock;

describe('MonitoringProcessor', () => {
  let catalogMonitor: any;
  let monitoring: any;
  let reconcile: any;
  let emailVerification: any;
  let hibpPlan: any;
  let scanService: any;
  const build = () => new MonitoringProcessor(catalogMonitor, monitoring, reconcile, emailVerification, hibpPlan, scanService);

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_ROLE;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    catalogMonitor = {
      handleCatalogProbe: jest.fn(async () => ({ latestName: 'X', syncEnqueued: false })),
      handleCatalogSync: jest.fn(async () => ({ sweepEnqueued: false })),
    };
    monitoring = {
      runSweep: jest.fn(async () => ({ enqueued: 3 })),
      processCheckResult: jest.fn(async () => 'notified'),
    };
    reconcile = { run: jest.fn(async () => ({ pendingEmails: 0 })) };
    emailVerification = { cleanupUnverified: jest.fn(async () => ({ users: 1, tokens: 2 })) };
    hibpPlan = { refresh: jest.fn(async () => ({ rpm: 10 })) };
    scanService = { retryInitialScan: jest.fn(async () => ({ status: 'scanned' })) };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.APP_ROLE;
  });

  it('starts the monitoring worker with concurrency 2 and no limiter', () => {
    build().onModuleInit();

    expect(WorkerMock).toHaveBeenCalledWith('monitoring', expect.any(Function), expect.objectContaining({ concurrency: 2 }));
    expect((WorkerMock.mock.calls[0] as any[])[2]).not.toHaveProperty('limiter');
  });

  it('does not start with APP_ROLE=api', async () => {
    process.env.APP_ROLE = 'api';
    const processor = build();

    processor.onModuleInit();
    await processor.onModuleDestroy();

    expect(WorkerMock).not.toHaveBeenCalled();
  });

  it('routes the catalog jobs', async () => {
    const processor = build();

    await processor.process({ name: 'catalog-probe', data: {} } as any);
    await processor.process({ name: 'catalog-sync', data: { origin: 'probe' } } as any);
    await processor.process({ name: 'catalog-sync', data: undefined } as any);

    expect(catalogMonitor.handleCatalogProbe).toHaveBeenCalledTimes(1);
    expect(catalogMonitor.handleCatalogSync).toHaveBeenNthCalledWith(1, 'probe');
    expect(catalogMonitor.handleCatalogSync).toHaveBeenNthCalledWith(2, 'cron');
  });

  it('rejects unknown jobs', async () => {
    await expect(build().process({ name: 'other' } as any)).rejects.toThrow(
      "Unknown job 'other' in queue monitoring",
    );
  });

  it('logs failed jobs and closes on shutdown', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const processor = build();
    processor.onModuleInit();
    const worker = WorkerMock.mock.results.at(-1)?.value as any;
    const connection = RedisMock.mock.instances.at(-1) as any;

    const failed = worker.on.mock.calls.find((call: any[]) => call[0] === 'failed')[1];
    failed({ id: 'j1', name: 'catalog-sync', attemptsMade: 3 }, new Error('hibp down'));
    expect(JSON.parse(warnSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      event: 'monitoring.job_failed',
      job: 'catalog-sync',
      err: { message: 'hibp down' },
    });

    await processor.onModuleDestroy();
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(connection.quit).toHaveBeenCalledTimes(1);
  });

  it('routes sweep, process, cleanup, plan check, reconcile and scan retry jobs', async () => {
    const processor = build();

    await processor.process({ name: 'monitor-sweep', data: { reason: 'CATALOG_CHANGE', breachNames: ['X'] } } as any);
    await processor.process({ name: 'monitor-sweep', data: {} } as any);
    await processor.process({
      name: 'monitor-process',
      data: { userId: '7', breachNames: ['Adobe'], checkedAt: '2026-10-15T12:00:00.000Z' },
    } as any);
    await processor.process({ name: 'monitor-process', data: { userId: 8 } } as any);
    await processor.process({ name: 'cleanup-unverified', data: {} } as any);
    await processor.process({ name: 'hibp-plan-check', data: {} } as any);
    await processor.process({ name: 'monitoring-reconcile', data: {} } as any);
    await processor.process({ name: 'retry-initial-scan', data: { userId: '12' } } as any);

    expect(monitoring.runSweep).toHaveBeenNthCalledWith(1, 'CATALOG_CHANGE');
    expect(monitoring.runSweep).toHaveBeenNthCalledWith(2, 'WEEKLY');
    expect(monitoring.processCheckResult).toHaveBeenNthCalledWith(1, 7, ['Adobe'], new Date('2026-10-15T12:00:00.000Z'));
    expect(monitoring.processCheckResult).toHaveBeenNthCalledWith(2, 8, [], expect.any(Date));
    expect(emailVerification.cleanupUnverified).toHaveBeenCalledTimes(1);
    expect(hibpPlan.refresh).toHaveBeenCalledTimes(1);
    expect(reconcile.run).toHaveBeenCalledTimes(1);
    expect(scanService.retryInitialScan).toHaveBeenCalledWith(12);
  });
});
