import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ScanService } from '../../src/modules/scan/services/scan.service';

describe('ScanService', () => {
  let prismaMock: any;
  let userBreachesMock: any;
  let service: ScanService;

  beforeEach(() => {
    prismaMock = {
      user: {
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      scanHistory: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    userBreachesMock = {
      recordSeenByUser: jest.fn(async () => ({ inserted: ['Adobe'], baselineDefined: true })),
    };

    service = new ScanService(
      prismaMock as any,
      {} as any,
      {} as any,
      userBreachesMock,
    );

    (service as any).executeRiskScanUseCase = {
      execute: jest.fn(),
    };
  });

  describe('retryInitialScan', () => {
    const verifiedAt = new Date('2026-10-20T10:00:00.000Z');

    it('scans again the account email when the signup scan failed', async () => {
      const submitSpy = jest.spyOn(service, 'submitScan').mockResolvedValue({ jobId: 'job-own' } as any);
      prismaMock.user.findUnique.mockResolvedValue({
        email: 'owner@example.com',
        emailVerifiedAt: verifiedAt,
        scanSnapshot: { isVerified: false },
      });

      await expect(service.retryInitialScan(5)).resolves.toEqual({ status: 'scanned' });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 5 },
        select: { email: true, emailVerifiedAt: true, scanSnapshot: true },
      });
      expect(submitSpy).toHaveBeenCalledWith(5, { email: 'owner@example.com' }, 'SIGNUP');
    });

    it('scans an account that never got a result', async () => {
      const submitSpy = jest.spyOn(service, 'submitScan').mockResolvedValue({ jobId: 'job-new' } as any);
      prismaMock.user.findUnique.mockResolvedValue({ email: 'new@example.com', emailVerifiedAt: verifiedAt, scanSnapshot: null });

      await expect(service.retryInitialScan(6)).resolves.toEqual({ status: 'scanned' });
      expect(submitSpy).toHaveBeenCalledWith(6, { email: 'new@example.com' }, 'SIGNUP');
    });

    it('skips accounts that already have a valid result, are unverified or no longer exist', async () => {
      const submitSpy = jest.spyOn(service, 'submitScan');

      prismaMock.user.findUnique.mockResolvedValueOnce({
        email: 'ok@example.com',
        emailVerifiedAt: verifiedAt,
        scanSnapshot: { isVerified: true },
      });
      await expect(service.retryInitialScan(7)).resolves.toEqual({ status: 'skipped' });

      prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'pending@example.com', emailVerifiedAt: null, scanSnapshot: null });
      await expect(service.retryInitialScan(8)).resolves.toEqual({ status: 'skipped' });

      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.retryInitialScan(999)).resolves.toEqual({ status: 'skipped' });

      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('lets the error bubble up so the next reconcile retries', async () => {
      jest.spyOn(service, 'submitScan').mockRejectedValue(new Error('hibp down'));
      prismaMock.user.findUnique.mockResolvedValue({
        email: 'owner@example.com',
        emailVerifiedAt: verifiedAt,
        scanSnapshot: { isVerified: false },
      });

      await expect(service.retryInitialScan(5)).rejects.toThrow('hibp down');
    });
  });

  it('executes a scan and persists the user snapshot', async () => {
    const result = {
      jobId: 'job-1',
      riskScore: 40,
      classification: 'MODERATE',
      breachesFound: 2,
      recommendation: 'Rotate credentials and enable 2FA.',
      isVerified: true,
    };

    (service as any).executeRiskScanUseCase.execute.mockResolvedValue(result);
    prismaMock.scanHistory.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockResolvedValue({ id: 5 });

    await service.submitScan(5, { email: 'user@example.com' });

    expect((service as any).executeRiskScanUseCase.execute).toHaveBeenCalledWith({
      email: 'user@example.com',
      userId: 5,
      source: 'MANUAL',
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        scanSnapshot: expect.objectContaining({
          jobId: 'job-1',
          riskScore: 40,
          classification: 'MODERATE',
        }),
      }),
    });
  });

  it('persists a fallback snapshot when the initial scan fails', async () => {
    prismaMock.user.update.mockResolvedValue({ id: 12 });

    await service.persistFallbackSnapshot(12, 'fallback@example.com');

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: expect.objectContaining({
        scanSnapshot: expect.objectContaining({
          jobId: expect.any(String),
          riskScore: 0,
          classification: 'LOW',
          breachesFound: 0,
          recommendation: expect.any(String),
          isVerified: false,
          email: 'fallback@example.com',
        }),
      }),
    });
  });

  it('delegates cache cleanup to the use case', async () => {
    (service as any).executeRiskScanUseCase.clearCachedResult = jest.fn(async () => undefined);

    await service.clearCachedScan('user@example.com');

    expect((service as any).executeRiskScanUseCase.clearCachedResult).toHaveBeenCalledWith('user@example.com');
  });

  it('returns the user scan history mapped to the external DTO format', async () => {
    prismaMock.scanHistory.findMany.mockResolvedValue([
      {
        jobId: 'job-9',
        riskScore: 71,
        classification: 'CRITICAL',
        breachesFound: 4,
        source: 'MONITORING',
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
      },
    ]);

    const result = await service.getUserHistory(8);

    expect(result).toEqual([
      {
        id: 'job-9',
        riskScore: 71,
        classification: 'CRITICAL',
        breachesFound: 4,
        source: 'MONITORING',
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
      },
    ]);
  });

  it('maps missing breach counts to zero in scan history', async () => {
    prismaMock.scanHistory.findMany.mockResolvedValue([
      {
        jobId: 'job-empty-breaches',
        riskScore: 0,
        classification: 'LOW',
        breachesFound: null,
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
      },
    ]);

    await expect(service.getUserHistory(8)).resolves.toEqual([
      expect.objectContaining({ id: 'job-empty-breaches', breachesFound: 0 }),
    ]);
  });

  it('returns null when a scan detail is not found for the user', async () => {
    prismaMock.scanHistory.findFirst.mockResolvedValue(null);

    await expect(service.getScanDetail(2, 'missing-job')).resolves.toBeNull();
  });

  it('returns the stored scan detail for a valid job id', async () => {
    prismaMock.scanHistory.findFirst.mockResolvedValue({
      jobId: 'job-7',
      riskScore: 90,
      classification: 'CRITICAL',
      breachesFound: 3,
      recommendation: 'Urgent review',
      breachData: '{"source":"public-breach"}',
      processedAt: new Date('2026-09-10T00:00:00.000Z'),
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
      userId: 2,
    });

    const result = await service.getScanDetail(2, 'job-7');

    expect(result).toMatchObject({
      jobId: 'job-7',
      riskScore: 90,
      classification: 'CRITICAL',
      breachesFound: 3,
      recommendation: 'Urgent review',
      breachData: { source: 'public-breach' },
    });
  });

  it('persists a snapshot based on the latest history and exercises repository update/delete paths', async () => {
    const repo = (service as any).createRepository();
    prismaMock.scanHistory.create.mockResolvedValue({ jobId: 'job-8' });
    prismaMock.scanHistory.findUnique.mockResolvedValue({ jobId: 'job-8' });
    prismaMock.scanHistory.findMany.mockResolvedValue([{ jobId: 'job-8' }]);
    prismaMock.scanHistory.update.mockResolvedValue({ jobId: 'job-8' });
    prismaMock.scanHistory.delete.mockResolvedValue({});

    await expect(repo.create({
      jobId: 'job-8',
      userId: 5,
      emailHash: 'hash',
      riskScore: 25,
      classification: 'LOW',
      breachesFound: 1,
      breachData: { source: 'unit' },
      recommendation: 'Rotate password',
      isVerified: false,
      processedAt: new Date('2026-09-10T00:00:00.000Z'),
    })).resolves.toMatchObject({ jobId: 'job-8' });

    await expect(repo.findById('job-8')).resolves.toMatchObject({ jobId: 'job-8' });
    await expect(repo.findByUserId(5)).resolves.toMatchObject([{ jobId: 'job-8' }]);
    await expect(repo.update('job-8', { riskScore: 30 })).resolves.toMatchObject({ jobId: 'job-8' });
    await expect(repo.delete('job-8')).resolves.toBe(true);

    prismaMock.scanHistory.findFirst.mockResolvedValue({
      jobId: 'job-9',
      riskScore: 50,
      classification: 'MEDIUM',
      breachesFound: 2,
      recommendation: 'Review access',
      isVerified: true,
      processedAt: new Date('2026-09-10T00:00:00.000Z'),
      breachData: '{"source":"cache"}',
    });
    prismaMock.user.update.mockResolvedValue({ id: 5 });

    await service.persistFallbackSnapshot(5, 'snapshot@example.com');
    await (service as any).persistUserScanSnapshot(5, 'snapshot@example.com', {
      jobId: 'job-9',
      riskScore: 50,
      classification: 'MEDIUM',
      breachesFound: 2,
      recommendation: 'Review access',
      isVerified: true,
    });

    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('handles invalid JSON snapshots by returning null instead of crashing', async () => {
    prismaMock.scanHistory.findFirst.mockResolvedValue({
      jobId: 'job-corrupt',
      riskScore: 10,
      classification: 'LOW',
      breachesFound: 0,
      recommendation: 'Review later',
      isVerified: true,
      processedAt: new Date('2026-09-10T00:00:00.000Z'),
      breachData: '{broken-json',
    });
    prismaMock.user.update.mockResolvedValue({ id: 12 });

    await expect(
      (service as any).persistUserScanSnapshot(12, 'corrupt@example.com', {
        jobId: 'job-corrupt',
        riskScore: 10,
        classification: 'LOW',
        breachesFound: 0,
        recommendation: 'Review later',
        isVerified: true,
      }),
    ).resolves.toBeUndefined();

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scanSnapshot: expect.objectContaining({
            breachData: null,
          }),
        }),
      }),
    );
  });

  it('persists a snapshot without history and handles empty breach data', async () => {
    prismaMock.scanHistory.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockResolvedValue({ id: 13 });

    await (service as any).persistUserScanSnapshot(13, 'empty@example.com', {
      jobId: 'job-empty-history',
      riskScore: 0,
      classification: 'LOW',
      breachesFound: 0,
      recommendation: undefined,
      isVerified: false,
    });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 13 },
      data: expect.objectContaining({
        scanSnapshot: expect.objectContaining({
          jobId: 'job-empty-history',
          recommendation: null,
          breachData: null,
        }),
      }),
    });
  });

  it('creates repository records with null breach data', async () => {
    const repo = (service as any).createRepository();
    prismaMock.scanHistory.create.mockResolvedValue({ jobId: 'job-no-breach-data' });

    await expect(repo.create({
      jobId: 'job-no-breach-data',
      userId: 13,
      emailHash: 'hash',
      riskScore: 0,
      classification: 'LOW',
      breachesFound: 0,
      breachData: null,
      recommendation: undefined,
      isVerified: false,
      processedAt: new Date('2026-09-10T00:00:00.000Z'),
    })).resolves.toMatchObject({ jobId: 'job-no-breach-data' });

    expect(prismaMock.scanHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ breachData: null, recommendation: undefined }),
    });
  });

  describe('base de vazamentos conhecidos', () => {
    const scanResult = {
      jobId: 'job-9',
      riskScore: 30,
      classification: 'MODERATE',
      breachesFound: 2,
      isVerified: true,
    };

    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      prismaMock.scanHistory.findFirst.mockResolvedValue(null);
      prismaMock.user.update.mockResolvedValue({ id: 5 });
    });

    it('records the breaches the user just saw as MANUAL and hides the names from the response', async () => {
      (service as any).executeRiskScanUseCase.execute.mockResolvedValue({ ...scanResult, breachNames: ['Adobe', 'LinkedIn'] });

      const result = await service.submitScan(5, { email: 'user@example.com' });

      expect(userBreachesMock.recordSeenByUser).toHaveBeenCalledWith(5, ['Adobe', 'LinkedIn'], 'MANUAL');
      expect(result).toEqual(scanResult);
    });

    it('records the signup scan as SIGNUP', async () => {
      (service as any).executeRiskScanUseCase.execute.mockResolvedValue({ ...scanResult, breachNames: [] });

      await service.submitScan(5, { email: 'user@example.com' }, 'SIGNUP');

      expect((service as any).executeRiskScanUseCase.execute).toHaveBeenCalledWith({
        email: 'user@example.com',
        userId: 5,
        source: 'SIGNUP',
      });
      // Sem vazamentos também define a base: a partir daqui qualquer vazamento é novo
      expect(userBreachesMock.recordSeenByUser).toHaveBeenCalledWith(5, [], 'SIGNUP');
    });

    it('does not touch the base on a cache hit', async () => {
      (service as any).executeRiskScanUseCase.execute.mockResolvedValue({ ...scanResult, isVerified: false, breachNames: null });

      await service.submitScan(5, { email: 'user@example.com' });

      expect(userBreachesMock.recordSeenByUser).not.toHaveBeenCalled();
    });

    it('still returns the scan when recording the base fails', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      (service as any).executeRiskScanUseCase.execute.mockResolvedValue({ ...scanResult, breachNames: ['Adobe'] });
      userBreachesMock.recordSeenByUser.mockRejectedValue(new Error('db down'));

      await expect(service.submitScan(5, { email: 'user@example.com' })).resolves.toEqual(scanResult);
      expect(JSON.parse(errorSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({
        event: 'breaches.record_failed',
        userId: 5,
      });
    });
  });

  it('rescores known breaches and refreshes the dashboard snapshot (monitoring)', async () => {
    const result = {
      jobId: 'job-mon',
      riskScore: 70,
      classification: 'CRITICAL',
      breachesFound: 1,
      isVerified: true,
      breachNames: ['MegaLeak'],
    };
    (service as any).executeRiskScanUseCase.scoreAndPersist = jest.fn(async () => result);
    prismaMock.scanHistory.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockResolvedValue({ id: 5 });

    await expect(service.scoreBreaches(5, 'user@example.com', [{ Name: 'MegaLeak' }], 'MONITORING')).resolves.toEqual(result);

    expect((service as any).executeRiskScanUseCase.scoreAndPersist).toHaveBeenCalledWith({
      userId: 5,
      email: 'user@example.com',
      breaches: [{ Name: 'MegaLeak' }],
      source: 'MONITORING',
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ scanSnapshot: expect.objectContaining({ riskScore: 70 }) }) }),
    );
  });
});
