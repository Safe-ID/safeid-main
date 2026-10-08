import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ExecuteRiskScanUseCase } from '../../src/core/use-cases/execute-risk-scan.usecase';
import { RiskEngine } from '../../src/core/engines/risk.engine';
import { AIEngine } from '../../src/core/engines/ai.engine';

describe('ExecuteRiskScanUseCase', () => {
  let repository: any;
  let cacheService: any;
  let hibpQueue: any;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  beforeEach(() => {
    repository = {
      create: jest.fn(async () => ({})),
    };

    cacheService = {
      get: jest.fn(async () => null),
      setex: jest.fn(async () => undefined),
    };

    hibpQueue = {
      add: jest.fn(async () => undefined),
    };
  });

  it('clears the cached scan of an email using the same hashed key', async () => {
    cacheService.del = jest.fn(async () => 1);

    const useCase = new ExecuteRiskScanUseCase(repository, cacheService, hibpQueue, 'test-key');
    await useCase.clearCachedResult('User@Example.com');

    const expectedHash = require('crypto').createHash('sha256').update('user@example.com').digest('hex');
    expect(cacheService.del).toHaveBeenCalledWith(`scan:${expectedHash}`);
  });

  it('returns the cached result without enqueuing a new HIBP job', async () => {
    const cached = {
      riskScore: 58,
      classification: 'MODERATE',
      breachesFound: 3,
      recommendation: 'Review your exposed breaches.',
    };

    cacheService.get.mockResolvedValue(JSON.stringify(cached));

    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );

    const result = await useCase.execute({ email: 'user@example.com', userId: 12 });

    expect(result).toMatchObject({
      jobId: expect.any(String),
      riskScore: 58,
      classification: 'MODERATE',
      breachesFound: 3,
      recommendation: 'Review your exposed breaches.',
      isVerified: false,
    });

    expect(hibpQueue.add).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('hashes the email with HMAC when EMAIL_HASH_SECRET is set', async () => {
    const { createHash, createHmac } = require('crypto');
    const useCase = new ExecuteRiskScanUseCase(repository, cacheService, hibpQueue, 'test-key');
    const original = process.env.EMAIL_HASH_SECRET;

    process.env.EMAIL_HASH_SECRET = 'hash-secret';
    const withSecret = (useCase as any).hashEmail('User@Example.com');
    expect(withSecret).toBe(createHmac('sha256', 'hash-secret').update('user@example.com').digest('hex'));
    expect(withSecret).not.toBe(createHash('sha256').update('user@example.com').digest('hex'));

    delete process.env.EMAIL_HASH_SECRET;
    expect((useCase as any).hashEmail('User@Example.com')).toBe(
      createHash('sha256').update('user@example.com').digest('hex'),
    );

    if (original === undefined) {
      delete process.env.EMAIL_HASH_SECRET;
    } else {
      process.env.EMAIL_HASH_SECRET = original;
    }
  });

  it('runs the full scan flow for a cache miss and persists the result', async () => {
    const breaches = [
      {
        Name: 'Recent leak',
        Title: 'Recent leak',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Passwords'],
        IsVerified: true,
      },
    ];

    cacheService.get.mockResolvedValue(null);

    const job = {
      id: 'job-123',
      data: { result: breaches },
      getState: jest.fn(async () => 'completed'),
      queue: {
        getJob: jest.fn(async () => ({
          data: { result: breaches },
          returnvalue: breaches,
        })),
      },
    };

    hibpQueue.add.mockResolvedValue(job);
    jest.spyOn(RiskEngine.prototype, 'calculate').mockReturnValue({
      totalScore: 42,
      classification: 'MODERATE',
      breachesFound: 1,
      subscores: [],
    } as any);
    jest.spyOn(AIEngine.prototype, 'generateRecommendation').mockResolvedValue({
      executive_summary: 'Rotate your password and enable MFA.',
      urgency_level: 'HIGH',
      mitigation_steps: [],
    } as any);

    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );

    const result = await useCase.execute({ email: 'user@example.com', userId: 12 });

    expect(hibpQueue.add).toHaveBeenCalledWith('check-hibp', {
      email: 'user@example.com',
      emailHash: expect.any(String),
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: result.jobId,
        userId: 12,
        riskScore: 42,
        classification: 'MODERATE',
        breachesFound: 1,
        recommendation: 'Rotate your password and enable MFA.',
        isVerified: true,
      }),
    );
    expect(cacheService.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^scan:/),
      12 * 60 * 60,
      expect.stringContaining('"riskScore":42'),
    );
  });

  it('falls back gracefully when AI recommendation generation fails', async () => {
    const breaches = [
      {
        Name: 'Recent leak',
        Title: 'Recent leak',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Passwords'],
        IsVerified: true,
      },
    ];

    cacheService.get.mockResolvedValue(null);

    const job = {
      id: 'job-999',
      data: { result: breaches },
      getState: jest.fn(async () => 'completed'),
      queue: {
        getJob: jest.fn(async () => ({
          data: { result: breaches },
          returnvalue: breaches,
        })),
      },
    };

    hibpQueue.add.mockResolvedValue(job);
    jest.spyOn(RiskEngine.prototype, 'calculate').mockReturnValue({
      totalScore: 71,
      classification: 'CRITICAL',
      breachesFound: 1,
      subscores: [],
    } as any);
    jest.spyOn(AIEngine.prototype, 'generateRecommendation').mockRejectedValue(
      new Error('AI unavailable'),
    );

    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );

    const result = await useCase.execute({ email: 'user@example.com', userId: 12 });

    expect(result.recommendation).toBeUndefined();
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recommendation: undefined,
        riskScore: 71,
        isVerified: true,
      }),
    );
  });

  it('does not call AI when the scan result has no breaches', async () => {
    const job = {
      id: 'job-empty',
      data: { result: [] },
      getState: jest.fn(async () => 'completed'),
      queue: {
        getJob: jest.fn(async () => ({
          data: { result: [] },
          returnvalue: [],
        })),
      },
    };

    cacheService.get.mockResolvedValue(null);
    hibpQueue.add.mockResolvedValue(job);

    const aiSpy = jest.spyOn(AIEngine.prototype, 'generateRecommendation');
    jest.spyOn(RiskEngine.prototype, 'calculate').mockReturnValue({
      totalScore: 0,
      classification: 'LOW',
      breachesFound: 0,
      subscores: [],
    } as any);

    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );

    const result = await useCase.execute({ email: 'safe@example.com', userId: 12 });

    expect(result.recommendation).toBeUndefined();
    expect(aiSpy).not.toHaveBeenCalled();
    expect(cacheService.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^scan:/),
      24 * 60 * 60,
      expect.stringContaining('"breachesFound":0'),
    );
  });

  it('throws when the HIBP job fails', async () => {
    const job = {
      id: 'job-456',
      data: { error: { message: 'Connection refused' } },
      getState: jest.fn(async () => 'failed'),
      queue: {
        getJob: jest.fn(async () => ({
          failedReason: 'Connection refused',
        })),
      },
    };

    cacheService.get.mockResolvedValue(null);
    hibpQueue.add.mockResolvedValue(job);

    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );

    await expect(
      useCase.execute({ email: 'user@example.com', userId: 12 }),
    ).rejects.toThrow('Job failed: Connection refused');
  });

  it('uses the available completed job result fallbacks', async () => {
    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );
    const breach = { Name: 'Fallback breach' };

    const returnValueJob = {
      id: 'job-returnvalue',
      data: { result: null },
      getState: jest.fn(async () => 'completed'),
      queue: {
        getJob: jest.fn(async () => ({ returnvalue: [breach] })),
      },
    };
    await expect((useCase as any).waitForJobCompletion(returnValueJob, 1000)).resolves.toEqual([
      breach,
    ]);

    const jobDataJob = {
      id: 'job-data',
      data: { result: [breach] },
      getState: jest.fn(async () => 'completed'),
      queue: {
        getJob: jest.fn(async () => ({ data: { result: null }, returnvalue: null })),
      },
    };
    await expect((useCase as any).waitForJobCompletion(jobDataJob, 1000)).resolves.toEqual([
      breach,
    ]);

    const emptyJob = {
      id: 'job-empty-result',
      data: { result: null },
      getState: jest.fn(async () => 'completed'),
      queue: {
        getJob: jest.fn(async () => ({ data: {}, returnvalue: null })),
      },
    };
    await expect((useCase as any).waitForJobCompletion(emptyJob, 1000)).resolves.toBeNull();
  });

  it('resolves after an active job becomes completed', async () => {
    jest.useFakeTimers();
    const job = {
      id: 'job-eventually-completed',
      data: { result: [] },
      getState: jest
        .fn(async (): Promise<string> => 'active')
        .mockResolvedValueOnce('active')
        .mockResolvedValueOnce('completed'),
      queue: {
        getJob: jest.fn(async () => ({ returnvalue: [] })),
      },
    };
    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );

    const completion = (useCase as any).waitForJobCompletion(job, 1000);
    await jest.advanceTimersByTimeAsync(100);

    await expect(completion).resolves.toEqual([]);
  });

  it('uses each available failure reason fallback', async () => {
    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );
    const createFailedJob = (id: string, refreshed: any, job: any) => ({
      id,
      data: job.data,
      failedReason: job.failedReason,
      getState: jest.fn(async () => 'failed'),
      queue: { getJob: jest.fn(async () => refreshed) },
    });

    await expect(
      (useCase as any).waitForJobCompletion(
        createFailedJob('refreshed-data-error', { failedReason: '', data: { error: { message: 'refreshed error' } } }, { data: {} }),
        1000,
      ),
    ).rejects.toThrow('Job failed: refreshed error');
    await expect(
      (useCase as any).waitForJobCompletion(
        createFailedJob('job-failed-reason', null, { failedReason: 'job error', data: {} }),
        1000,
      ),
    ).rejects.toThrow('Job failed: job error');
    await expect(
      (useCase as any).waitForJobCompletion(
        createFailedJob('job-data-error', null, { data: { error: { message: 'data error' } } }),
        1000,
      ),
    ).rejects.toThrow('Job failed: data error');
    await expect(
      (useCase as any).waitForJobCompletion(
        createFailedJob('unknown-error', null, { data: {} }),
        1000,
      ),
    ).rejects.toThrow('Job failed: Unknown error');
  });

  it('times out when the HIBP job never reaches a terminal state', async () => {
    const job = {
      id: 'job-timeout',
      data: { result: [] },
      getState: jest.fn(async () => 'active'),
      queue: {
        getJob: jest.fn(async () => null),
      },
    };

    const useCase = new ExecuteRiskScanUseCase(
      repository,
      cacheService,
      hibpQueue,
      'test-key',
    );

    await expect(
      (useCase as any).waitForJobCompletion(job, 0),
    ).rejects.toThrow('Job timeout after 0ms');
  });

  describe('AI recommendation cache', () => {
    const breaches = [
      {
        Name: 'Recent leak',
        Title: 'Recent leak',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Passwords'],
        IsVerified: true,
      },
    ];

    const buildJob = () => ({
      id: 'job-cache',
      data: { result: breaches },
      getState: jest.fn(async () => 'completed'),
      queue: {
        getJob: jest.fn(async () => ({
          data: { result: breaches },
          returnvalue: breaches,
        })),
      },
    });

    beforeEach(() => {
      hibpQueue.add.mockResolvedValue(buildJob());
      jest.spyOn(RiskEngine.prototype, 'calculate').mockReturnValue({
        totalScore: 42,
        classification: 'MODERATE',
        breachesFound: 1,
        subscores: [],
      } as any);
    });

    it('reuses a cached recommendation without calling the model', async () => {
      const cachedRecommendation = {
        executive_summary: 'Resumo em cache.',
        mitigation_steps: ['Passo em cache'],
        urgency_level: 'MEDIUM',
        source: 'ai',
      };
      cacheService.get.mockImplementation(async (key: string) =>
        key.startsWith('ai-recommendation:') ? JSON.stringify(cachedRecommendation) : null,
      );
      const aiSpy = jest.spyOn(AIEngine.prototype, 'generateRecommendation');

      const useCase = new ExecuteRiskScanUseCase(repository, cacheService, hibpQueue, 'test-key');
      const result = await useCase.execute({ email: 'user@example.com', userId: 12 });

      expect(aiSpy).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        recommendation: 'Resumo em cache.',
        mitigationSteps: ['Passo em cache'],
        urgencyLevel: 'MEDIUM',
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mitigationSteps: ['Passo em cache'],
          urgencyLevel: 'MEDIUM',
        }),
      );
    });

    it('caches model answers but not fallback answers', async () => {
      const aiSpy = jest.spyOn(AIEngine.prototype, 'generateRecommendation').mockResolvedValue({
        executive_summary: 'Resumo do modelo.',
        mitigation_steps: ['Passo 1'],
        urgency_level: 'MEDIUM',
        source: 'ai',
      });

      const useCase = new ExecuteRiskScanUseCase(repository, cacheService, hibpQueue, 'test-key');
      await useCase.execute({ email: 'user@example.com', userId: 12 });

      expect(cacheService.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^ai-recommendation:[a-f0-9]{64}$/),
        7 * 24 * 60 * 60,
        expect.stringContaining('Resumo do modelo.'),
      );

      cacheService.setex.mockClear();
      hibpQueue.add.mockResolvedValue(buildJob());
      aiSpy.mockResolvedValue({
        executive_summary: 'Resumo padrão.',
        mitigation_steps: ['Passo padrão'],
        urgency_level: 'MEDIUM',
        source: 'fallback',
      });

      await useCase.execute({ email: 'user@example.com', userId: 12 });

      const cachedKeys = cacheService.setex.mock.calls.map((call: any) => call[0]);
      expect(cachedKeys.some((key: string) => key.startsWith('ai-recommendation:'))).toBe(false);
    });

    it('still calls the model when the cache read fails', async () => {
      cacheService.get.mockImplementation(async (key: string) => {
        if (key.startsWith('ai-recommendation:')) throw new Error('Redis down');
        return null;
      });
      const aiSpy = jest.spyOn(AIEngine.prototype, 'generateRecommendation').mockResolvedValue({
        executive_summary: 'Resumo do modelo.',
        mitigation_steps: ['Passo 1'],
        urgency_level: 'MEDIUM',
        source: 'ai',
      });
      cacheService.setex.mockImplementation(async (key: string) => {
        if (key.startsWith('ai-recommendation:')) throw new Error('Redis down');
      });

      const useCase = new ExecuteRiskScanUseCase(repository, cacheService, hibpQueue, 'test-key');
      const result = await useCase.execute({ email: 'user@example.com', userId: 12 });

      expect(aiSpy).toHaveBeenCalledTimes(1);
      expect(result.recommendation).toBe('Resumo do modelo.');
    });
  });
});
