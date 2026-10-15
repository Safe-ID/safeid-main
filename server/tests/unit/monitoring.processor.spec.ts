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

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_ROLE;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    catalogMonitor = {
      handleCatalogProbe: jest.fn(async () => ({ latestName: 'X', syncEnqueued: false })),
      handleCatalogSync: jest.fn(async () => ({ sweepEnqueued: false })),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.APP_ROLE;
  });

  it('starts the monitoring worker with concurrency 2 and no limiter', () => {
    new MonitoringProcessor(catalogMonitor).onModuleInit();

    expect(WorkerMock).toHaveBeenCalledWith('monitoring', expect.any(Function), expect.objectContaining({ concurrency: 2 }));
    expect((WorkerMock.mock.calls[0] as any[])[2]).not.toHaveProperty('limiter');
  });

  it('does not start with APP_ROLE=api', async () => {
    process.env.APP_ROLE = 'api';
    const processor = new MonitoringProcessor(catalogMonitor);

    processor.onModuleInit();
    await processor.onModuleDestroy();

    expect(WorkerMock).not.toHaveBeenCalled();
  });

  it('routes the catalog jobs', async () => {
    const processor = new MonitoringProcessor(catalogMonitor);

    await processor.process({ name: 'catalog-probe', data: {} } as any);
    await processor.process({ name: 'catalog-sync', data: { origin: 'probe' } } as any);
    await processor.process({ name: 'catalog-sync', data: undefined } as any);

    expect(catalogMonitor.handleCatalogProbe).toHaveBeenCalledTimes(1);
    expect(catalogMonitor.handleCatalogSync).toHaveBeenNthCalledWith(1, 'probe');
    expect(catalogMonitor.handleCatalogSync).toHaveBeenNthCalledWith(2, 'cron');
  });

  it('rejects unknown jobs', async () => {
    await expect(new MonitoringProcessor(catalogMonitor).process({ name: 'other' } as any)).rejects.toThrow(
      "Unknown job 'other' in queue monitoring",
    );
  });

  it('logs failed jobs and closes on shutdown', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const processor = new MonitoringProcessor(catalogMonitor);
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
});
