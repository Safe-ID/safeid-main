import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../../infra/database/prisma.service';
import { ExecuteRiskScanUseCase } from '../../../core/use-cases/execute-risk-scan.usecase';
import { ScanSource } from '../../../core/entities/scan-result.entity';
import { UserBreachRepository } from '../../breaches/user-breach.repository';
import { log } from '../../../shared/utils/logger';
import { CreateScanDto, ScanResultDto, ScanHistoryDto } from '../dto/scan.dto';
import { openBreachData, sealBreachData } from '../../../shared/crypto/breach-data.cipher';

@Injectable()
export class ScanService {
  private executeRiskScanUseCase: ExecuteRiskScanUseCase;

  constructor(
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private cacheService: Redis,
    @Inject('HIBP_QUEUE') private hibpQueue: Queue,
    private userBreaches: UserBreachRepository,
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
  async submitScan(userId: number, dto: CreateScanDto, source: ScanSource = 'MANUAL'): Promise<ScanResultDto> {
    const result = await this.executeRiskScanUseCase.execute({
      email: dto.email,
      userId,
      source,
    });

    await this.persistUserScanSnapshot(userId, dto.email, result);

    const { breachNames, ...scanResult } = result;
    // Vazamentos que o usuário acabou de ver na tela entram na base e nunca geram alerta.
    // Em cache HIT (breachNames null) não há nada novo para registrar.
    if (breachNames) {
      await this.recordSeenBreaches(userId, breachNames, source);
    }

    return scanResult;
  }

  /**
   * Recalcula o scan a partir de vazamentos já conhecidos (sem consultar a HIBP) e
   * atualiza o snapshot do painel. Usado pelo monitoramento quando aparece vazamento novo.
   */
  async scoreBreaches(
    userId: number,
    email: string,
    breaches: Array<Record<string, any>>,
    source: ScanSource,
  ): Promise<ScanResultDto & { breachNames: string[] }> {
    const result = await this.executeRiskScanUseCase.scoreAndPersist({
      userId,
      email,
      breaches: breaches as any,
      source,
    });

    await this.persistUserScanSnapshot(userId, email, result);
    return result;
  }

  private async recordSeenBreaches(userId: number, breachNames: string[], source: ScanSource): Promise<void> {
    try {
      const { inserted, baselineDefined } = await this.userBreaches.recordSeenByUser(
        userId,
        breachNames,
        source === 'SIGNUP' ? 'SIGNUP' : 'MANUAL',
      );
      log('info', 'ScanService', 'breaches.recorded', { userId, source, inserted: inserted.length, baselineDefined });
    } catch (error) {
      // O scan já foi entregue; sem base, a primeira checagem do monitoramento define a base em silêncio
      log('error', 'ScanService', 'breaches.record_failed', { userId, source, err: error });
    }
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
      classification: scan.classification as 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL',
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
   * Apaga o resultado do scan guardado no Redis para esse email
   */
  async clearCachedScan(email: string): Promise<void> {
    await this.executeRiskScanUseCase.clearCachedResult(email);
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
            source: scan.source ?? 'MANUAL',
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
