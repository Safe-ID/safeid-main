import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ScanService } from '../../src/modules/scan/services/scan.service';

describe('ScanService', () => {
  let prismaMock: any;
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

    service = new ScanService(
      prismaMock as any,
      {} as any,
      {} as any,
    );

    (service as any).executeRiskScanUseCase = {
      execute: jest.fn(),
    };
  });

  it('scans only the email registered on the account', async () => {
    const submitSpy = jest.spyOn(service, 'submitScan').mockResolvedValue({ jobId: 'job-own' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ email: 'owner@example.com' });

    await expect(service.submitScanForUser(5)).resolves.toMatchObject({ jobId: 'job-own' });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { email: true },
    });
    expect(submitSpy).toHaveBeenCalledWith(5, { email: 'owner@example.com' });

    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(service.submitScanForUser(999)).rejects.toThrow('Usuário não encontrado');
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
});
