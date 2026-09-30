import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../../infra/database/prisma.service';
import { ExecuteRiskScanUseCase } from '../../../core/use-cases/execute-risk-scan.usecase';
import { CreateScanDto, ScanResultDto, ScanHistoryDto } from '../dto/scan.dto';
import { openBreachData, sealBreachData } from '../../../shared/crypto/breach-data.cipher';

@Injectable()
export class ScanService {
  private executeRiskScanUseCase: ExecuteRiskScanUseCase;

  constructor(
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private cacheService: Redis,
    @Inject('HIBP_QUEUE') private hibpQueue: Queue,
  ) {
    // Inicializa o use case
    this.executeRiskScanUseCase = new ExecuteRiskScanUseCase(
      this.createRepository(),
      this.cacheService,
      this.hibpQueue,
      process.env.AI_API_KEY || '',
    );
  }

  /**
   * Inicia análise de vazamento para um email
   */
  async submitScan(userId: number, dto: CreateScanDto): Promise<ScanResultDto> {
    const result = await this.executeRiskScanUseCase.execute({
      email: dto.email,
      userId,
    });

    await this.persistUserScanSnapshot(userId, dto.email, result);

    return result;
  }

  /**
   * Inicia análise usando o email cadastrado na conta do usuário
   */
  async submitScanForUser(userId: number): Promise<ScanResultDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return this.submitScan(userId, { email: user.email });
  }

  async persistFallbackSnapshot(userId: number, email: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        scanSnapshot: {
          jobId: `fallback-${Date.now()}`,
          riskScore: 0,
          classification: 'LOW',
          breachesFound: 0,
          recommendation:
            'Initial scan could not be verified right now. We will retry in background.',
          isVerified: false,
          processedAt: new Date(),
          breachData: null,
          email,
        },
        scanSnapshotUpdatedAt: new Date(),
      },
    });
  }

  /**
   * Recupera histórico de scans do usuário
   */
  async getUserHistory(userId: number): Promise<ScanHistoryDto[]> {
    const scans = await this.prisma.scanHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return scans.map((scan: any) => ({
      id: scan.jobId,
      riskScore: scan.riskScore,
      classification: scan.classification as 'LOW' | 'MODERATE' | 'CRITICAL',
      breachesFound: scan.breachesFound || 0,
      createdAt: scan.createdAt,
    }));
  }

  /**
   * Recupera detalhe de um scan específico
   */
  async getScanDetail(userId: number, jobId: string): Promise<any> {
    const scan = await this.prisma.scanHistory.findFirst({
      where: {
        jobId,
        userId,
      },
    });

    if (!scan) {
      return null;
    }

    return {
      jobId: scan.jobId,
      riskScore: scan.riskScore,
      classification: scan.classification,
      breachesFound: scan.breachesFound,
      recommendation: scan.recommendation,
      mitigationSteps: scan.mitigationSteps,
      urgencyLevel: scan.urgencyLevel,
      breachData: openBreachData(scan.breachData),
      processedAt: scan.processedAt,
      createdAt: scan.createdAt,
    };
  }

  /**
   * Cria repository implementation em tempo de execução
   */
  private createRepository() {
    return {
      create: async (scan: any) => {
        console.log('[ScanRepository] Creating scan with data:', {
          jobId: scan.jobId,
          userId: scan.userId,
          riskScore: scan.riskScore,
          classification: scan.classification,
        });
        const created = await this.prisma.scanHistory.create({
          data: {
            jobId: scan.jobId,
            user: {
              connect: {
                id: scan.userId,
              },
            },
            emailHash: scan.emailHash,
            riskScore: scan.riskScore,
            classification: scan.classification,
            breachesFound: scan.breachesFound,
            // Criptografado com ENCRYPTION_KEY antes de ir para o banco
            breachData: sealBreachData(scan.breachData),
            recommendation: scan.recommendation,
            mitigationSteps: scan.mitigationSteps ?? undefined,
            urgencyLevel: scan.urgencyLevel ?? null,
            isVerified: scan.isVerified,
            processedAt: scan.processedAt,
          },
        });
        console.log('[ScanRepository] Scan created successfully:', created.jobId);
        return created;
      },
      findById: async (id: string) => {
        return this.prisma.scanHistory.findUnique({
          where: { jobId: id },
        });
      },
      findByUserId: async (userId: number) => {
        return this.prisma.scanHistory.findMany({ where: { userId } });
      },
      update: async (id: string, scan: any) => {
        return this.prisma.scanHistory.update({
          where: { jobId: id },
          data: scan,
        });
      },
      delete: async (id: string) => {
        await this.prisma.scanHistory.delete({ where: { jobId: id } });
        return true;
      },
    };
  }

  private async persistUserScanSnapshot(
    userId: number,
    email: string,
    result: ScanResultDto,
  ) {
    const latestHistory = await this.prisma.scanHistory.findFirst({
      where: {
        userId,
      },
      orderBy: { createdAt: 'desc' },
    });

    const snapshot = latestHistory
      ? {
          jobId: latestHistory.jobId,
          riskScore: latestHistory.riskScore,
          classification: latestHistory.classification,
          breachesFound: latestHistory.breachesFound || 0,
          recommendation: latestHistory.recommendation,
          mitigationSteps: latestHistory.mitigationSteps ?? null,
          urgencyLevel: latestHistory.urgencyLevel ?? null,
          isVerified: latestHistory.isVerified,
          processedAt: latestHistory.processedAt,
          // O snapshot também guarda os vazamentos criptografados
          breachData: sealBreachData(openBreachData(latestHistory.breachData)),
        }
      : {
          jobId: result.jobId,
          riskScore: result.riskScore,
          classification: result.classification,
          breachesFound: result.breachesFound,
          recommendation: result.recommendation ?? null,
          mitigationSteps: result.mitigationSteps ?? null,
          urgencyLevel: result.urgencyLevel ?? null,
          isVerified: result.isVerified,
          processedAt: new Date(),
          breachData: null,
        };

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        scanSnapshot: snapshot,
        scanSnapshotUpdatedAt: new Date(),
      },
    });
  }
}
