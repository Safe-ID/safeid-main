import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ScanService } from '../../src/modules/scan/services/scan.service';

describe('ScanService integration slice', () => {
  const mockPrisma: any = {
    scanHistory: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
  };

  const mockCache: any = {
    get: jest.fn(),
    setex: jest.fn(),
  };

  const mockQueue: any = {
    add: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_API_KEY = '';
  });

  it('submits a scan and persists the resulting snapshot', async () => {
    const breaches = [
      {
        Name: 'Example breach',
        Title: 'Example breach',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Passwords'],
        IsVerified: true,
      },
    ];

    const job = {
      id: 'job-123',
      getState: jest.fn() as any,
      queue: {
        getJob: jest.fn() as any,
      },
    };

    job.getState.mockResolvedValue('completed');
    job.queue.getJob.mockResolvedValue({ returnvalue: breaches });

    mockCache.get.mockResolvedValue(null);
    mockQueue.add.mockResolvedValue(job);
    mockPrisma.scanHistory.create.mockResolvedValue({
      jobId: 'job-123',
      riskScore: 15,
      classification: 'LOW',
      breachesFound: 1,
      breachData: JSON.stringify(breaches),
      recommendation: 'Troque a senha imediatamente.',
      isVerified: true,
      processedAt: new Date('2026-09-10T00:00:00.000Z'),
    });
    mockPrisma.scanHistory.findFirst.mockResolvedValue({
      jobId: 'job-123',
      riskScore: 15,
      classification: 'LOW',
      breachesFound: 1,
      breachData: JSON.stringify(breaches),
      recommendation: 'Troque a senha imediatamente.',
      isVerified: true,
      processedAt: new Date('2026-09-10T00:00:00.000Z'),
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
    });
    mockPrisma.user.update.mockResolvedValue({});

    const scanService = new ScanService(mockPrisma, mockCache, mockQueue);
    const result = await scanService.submitScan(7, { email: 'user@example.com' });

    expect(result).toMatchObject({
      jobId: expect.any(String),
      riskScore: 15,
      classification: 'LOW',
      breachesFound: 1,
      isVerified: true,
    });
    expect(mockQueue.add).toHaveBeenCalledWith('check-hibp', {
      email: 'user@example.com',
      emailHash: expect.any(String),
    });
    expect(mockPrisma.scanHistory.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
    expect(mockCache.setex).toHaveBeenCalledTimes(1);
  });

  it('returns history and details using the persistence layer', async () => {
    mockPrisma.scanHistory.findMany.mockResolvedValue([
      {
        jobId: 'job-1',
        riskScore: 42,
        classification: 'MODERATE',
        breachesFound: 3,
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
      },
    ]);
    mockPrisma.scanHistory.findFirst.mockResolvedValue({
      jobId: 'job-1',
      riskScore: 42,
      classification: 'MODERATE',
      breachesFound: 3,
      recommendation: 'Revise suas senhas.',
      breachData: JSON.stringify([{ Name: 'Example breach' }]),
      processedAt: new Date('2026-09-10T00:00:00.000Z'),
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
    });

    const scanService = new ScanService(mockPrisma, mockCache, mockQueue);

    await expect(scanService.getUserHistory(7)).resolves.toEqual([
      {
        id: 'job-1',
        riskScore: 42,
        classification: 'MODERATE',
        breachesFound: 3,
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
      },
    ]);

    await expect(scanService.getScanDetail(7, 'job-1')).resolves.toMatchObject({
      jobId: 'job-1',
      riskScore: 42,
      classification: 'MODERATE',
      breachesFound: 3,
      recommendation: 'Revise suas senhas.',
    });
  });
});