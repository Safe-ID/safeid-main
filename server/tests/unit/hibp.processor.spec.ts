import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const rateLimitError = new Error('bullmq:rateLimitExceeded');

jest.mock('bullmq', () => {
  const Worker: any = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(async () => undefined),
    rateLimit: jest.fn(async () => undefined),
  }));
  Worker.RateLimitError = jest.fn(() => rateLimitError);
  return { Worker };
});

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(function (this: any) {
    this.handlers = {} as Record<string, (...args: any[]) => void>;
    this.on = jest.fn((event: string, handler: (...args: any[]) => void) => {
      this.handlers[event] = handler;
      return this;
    });
    this.subscribe = jest.fn(async () => 1);
    this.quit = jest.fn(async () => 'OK');
  }),
);

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { HibpProcessor } from '../../src/modules/monitoring/processors/hibp.processor';
import { HibpRateLimitError } from '../../src/infra/http/hibp.errors';

const WorkerMock = Worker as unknown as jest.Mock & { RateLimitError: jest.Mock };
const RedisMock = Redis as unknown as jest.Mock;

function createPlan(limits = { rpm: 9, concurrency: 1, limiterDurationMs: 6667, planName: 'Core 1' }) {
  return {
    refresh: jest.fn(async () => ({})),
    reload: jest.fn(async () => ({})),
    getEffectiveLimits: jest.fn(async () => limits),
  };
}

function lastWorker() {
  return WorkerMock.mock.results.at(-1)?.value as any;
}

describe('HibpProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_ROLE;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.APP_ROLE;
  });

  it('creates the worker with the limiter and concurrency derived from the plan', async () => {
    const plan = createPlan();
    const processor = new HibpProcessor({ checkAccount: jest.fn() } as any, plan as any);

    await processor.onModuleInit();

    expect(plan.refresh).toHaveBeenCalledTimes(1);
    expect(WorkerMock).toHaveBeenCalledWith('hibp-check', expect.any(Function), expect.objectContaining({
      concurrency: 1,
      limiter: { max: 1, duration: 6667 },
    }));
    // Conexão do worker + assinante do pub/sub do plano
    expect(RedisMock).toHaveBeenCalledTimes(2);
    expect((RedisMock.mock.instances[1] as any).subscribe).toHaveBeenCalledWith('hibp:plan:changed');
  });

  it('does not start workers when APP_ROLE=api', async () => {
    process.env.APP_ROLE = 'api';
    const plan = createPlan();
    const processor = new HibpProcessor({ checkAccount: jest.fn() } as any, plan as any);

    await processor.onModuleInit();
    await processor.onModuleDestroy();

    expect(WorkerMock).not.toHaveBeenCalled();
    expect(plan.refresh).not.toHaveBeenCalled();
  });

  it('keeps the check-hibp contract: stores the breaches in job.data.result', async () => {
    const hibpClient = { checkAccount: jest.fn(async () => [{ Name: 'Adobe' }]) };
    const processor = new HibpProcessor(hibpClient as any, createPlan() as any);
    const job = { name: 'check-hibp', data: { email: 'user@example.com', emailHash: 'abc' }, updateData: jest.fn() };

    await expect(processor.process(job as any)).resolves.toEqual([{ Name: 'Adobe' }]);

    expect(hibpClient.checkAccount).toHaveBeenCalledWith('user@example.com');
    expect(job.updateData).toHaveBeenCalledWith({ email: 'user@example.com', emailHash: 'abc', result: [{ Name: 'Adobe' }] });
  });

  it('rejects jobs without e-mail and unknown job names', async () => {
    const processor = new HibpProcessor({ checkAccount: jest.fn() } as any, createPlan() as any);

    await expect(processor.process({ name: 'check-hibp', data: {} } as any)).rejects.toThrow('Job missing email');
    await expect(processor.process({ name: 'other', data: {} } as any)).rejects.toThrow("Unknown job 'other'");
  });

  it('pauses the queue for retry-after and returns the job to the queue on 429', async () => {
    const hibpClient = {
      checkAccount: jest.fn(async () => {
        throw new HibpRateLimitError(3000);
      }),
    };
    const processor = new HibpProcessor(hibpClient as any, createPlan() as any);
    await processor.onModuleInit();

    const job = { name: 'check-hibp', data: { email: 'user@example.com' }, updateData: jest.fn() };
    await expect(processor.process(job as any)).rejects.toBe(rateLimitError);

    expect(lastWorker().rateLimit).toHaveBeenCalledWith(3000);
    expect(job.updateData).not.toHaveBeenCalled();
  });

  it('propagates other errors so BullMQ retries the job', async () => {
    const hibpClient = {
      checkAccount: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    const processor = new HibpProcessor(hibpClient as any, createPlan() as any);

    await expect(processor.process({ name: 'check-hibp', data: { email: 'a@b.com' } } as any)).rejects.toThrow('boom');
  });

  it('logs failed jobs without the e-mail', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const processor = new HibpProcessor({ checkAccount: jest.fn() } as any, createPlan() as any);
    await processor.onModuleInit();

    const failedHandler = lastWorker().on.mock.calls.find((call: any[]) => call[0] === 'failed')[1];
    failedHandler({ id: '7', name: 'check-hibp', attemptsMade: 1, data: { email: 'user@example.com' } }, new Error('x'));

    const line = warnSpy.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(line)).toMatchObject({ event: 'hibp.job_failed', jobId: '7', attemptsMade: 1 });
    expect(line).not.toContain('user@example.com');
  });

  it('rebuilds the worker with the new limits when the plan changes', async () => {
    const plan = createPlan();
    const processor = new HibpProcessor({ checkAccount: jest.fn() } as any, plan as any);
    await processor.onModuleInit();
    const firstWorker = lastWorker();

    plan.getEffectiveLimits.mockResolvedValue({ rpm: 45, concurrency: 2, limiterDurationMs: 1334, planName: 'Core 2' });
    const subscriber = RedisMock.mock.instances[1] as any;
    subscriber.handlers.message('hibp:plan:changed', '{"rpm":50}');
    subscriber.handlers.message('other-channel', '{}');
    await new Promise(resolve => setImmediate(resolve));
    await processor.rebuildWorker();

    expect(plan.reload).toHaveBeenCalledTimes(1);
    expect(firstWorker.close).toHaveBeenCalledTimes(1);
    expect(WorkerMock).toHaveBeenLastCalledWith('hibp-check', expect.any(Function), expect.objectContaining({
      concurrency: 2,
      limiter: { max: 1, duration: 1334 },
    }));
  });

  it('logs when the rebuild after a plan change fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const plan = createPlan();
    const processor = new HibpProcessor({ checkAccount: jest.fn() } as any, plan as any);
    await processor.onModuleInit();

    plan.reload.mockRejectedValueOnce(new Error('redis down'));
    (RedisMock.mock.instances[1] as any).handlers.message('hibp:plan:changed', '{}');
    await new Promise(resolve => setImmediate(resolve));

    expect(JSON.parse(errorSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({ event: 'hibp.worker_rebuild_failed' });
  });

  it('closes the subscriber, the worker and its connection on shutdown', async () => {
    const processor = new HibpProcessor({ checkAccount: jest.fn() } as any, createPlan() as any);
    await processor.onModuleInit();
    const worker = lastWorker();
    const [workerConnection, subscriber] = RedisMock.mock.instances as any[];

    await processor.onModuleDestroy();

    expect(subscriber.quit).toHaveBeenCalledTimes(1);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(workerConnection.quit).toHaveBeenCalledTimes(1);
  });
});
