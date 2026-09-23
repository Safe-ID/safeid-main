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
});
