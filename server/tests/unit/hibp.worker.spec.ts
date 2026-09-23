import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHibpWorker } from '../../src/infra/queue/hibp.worker';

jest.mock('bullmq', () => {
  const WorkerMock = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  }));

  return {
    Worker: WorkerMock,
  };
});

describe('createHibpWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validates missing email and updates job data with breach results', async () => {
    const bullmq = jest.requireMock('bullmq') as any;
    const WorkerMock = bullmq.Worker as any;

    const hibpClient = {
      checkAccount: jest.fn(async () => [
        { Name: 'LinkedIn', Title: 'LinkedIn breach' },
      ]),
    } as any;

    const redis = {} as any;
    const worker = createHibpWorker(redis, hibpClient);

    expect(WorkerMock).toHaveBeenCalledWith(
      'hibp-check',
      expect.any(Function),
      expect.objectContaining({ connection: redis, concurrency: 1 })
    );

    const processor = WorkerMock.mock.calls[0][1] as any;

    const job = {
      data: { email: 'user@example.com' },
      updateData: jest.fn(),
    };

    const result = await processor(job);

    expect(hibpClient.checkAccount).toHaveBeenCalledWith('user@example.com');
    expect(job.updateData).toHaveBeenCalledWith({
      email: 'user@example.com',
      result: [{ Name: 'LinkedIn', Title: 'LinkedIn breach' }],
    });
    expect(result).toEqual([{ Name: 'LinkedIn', Title: 'LinkedIn breach' }]);
    expect(worker).toBeDefined();

    await expect(processor({ data: {} })).rejects.toThrow('Job missing email');
  });
});
