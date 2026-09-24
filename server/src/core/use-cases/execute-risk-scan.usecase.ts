/**
 * ExecuteRiskScanUseCase
 * Orquestrador principal da análise de vazamento
 * 
 * Pipeline:
 * 1. Valida email (Zod)
 * 2. Checa cache Redis
 * 3. Se miss, enfileira em BullMQ (HIBP com rate limit)
 * 4. Aguarda resultado (timeout 10s)
 * 5. Calcula risk com RiskEngine
 * 6. Gera recomendação com AIEngine
 * 7. Persiste resultado
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RiskEngine } from '../engines/risk.engine';
import { AIEngine } from '../engines/ai.engine';
import { ScanResult } from '../entities/scan-result.entity';
import { IScanHistoryRepository } from '../repositories/scan-history.repository';

interface HIBPBreach {
  Name: string;
  Title: string;
  BreachDate: string;
  DataClasses: string[];
  IsVerified: boolean;
  [key: string]: any;
}

interface ExecuteScanInput {
  email: string;
  userId: number;
}

interface ExecuteScanOutput {
  jobId: string;
  riskScore: number;
  classification: 'LOW' | 'MODERATE' | 'CRITICAL';
  breachesFound: number;
  recommendation?: string;
  isVerified: boolean;
}

export class ExecuteRiskScanUseCase {
  private riskEngine: RiskEngine;
  private aiEngine: AIEngine;

  constructor(
    private scanRepository: IScanHistoryRepository,
    private cacheService: any, // Redis
    private hibpQueue: any, // BullMQ
    aiApiKey: string,
  ) {
    this.riskEngine = new RiskEngine();
    this.aiEngine = new AIEngine(aiApiKey);
  }

  /**
   * Executa o use case completo
   */
  async execute(input: ExecuteScanInput): Promise<ExecuteScanOutput> {
    const jobId = uuidv4();
    const emailHash = this.hashEmail(input.email);

    try {
      // 1. Checa cache
      const cachedResult = await this.cacheService.get(`scan:${emailHash}`);
      
      if (cachedResult) {
        console.log(`[Cache HIT] ${emailHash}`);
        return {
          jobId,
          ...JSON.parse(cachedResult),
          isVerified: false, // Resultado em cache não é re-verificado
        };
      }

      console.log(`[Cache MISS] Enfileirando no BullMQ: ${emailHash}`);

      // 2. Enfileira job HIBP com rate limit (1 req/1500ms)
      const job = await this.hibpQueue.add('check-hibp', {
        email: input.email,
        emailHash,
      });

      // 3. Aguarda resultado com timeout de 10s
      const breaches = await this.waitForJobCompletion(job, 10000);

      // 4. Calcula Risk Score
      const riskCalc = this.riskEngine.calculate(breaches || []);

      // 5. Gera recomendação com IA (passa TODAS as breaches)
      let recommendation: string | undefined;
      if (breaches && breaches.length > 0) {
        try {
          const aiResult = await this.aiEngine.generateRecommendation({
            breaches: breaches,
            riskScore: riskCalc.totalScore,
          });
          recommendation = aiResult.executive_summary;
        } catch (error) {
          console.warn('[ExecuteRiskScan] AI recommendation unavailable, continuing without it:', error);
          recommendation = undefined;
        }
      }

      // 6. Cria e persiste resultado
      const scanResult: ScanResult = {
        jobId,
        userId: input.userId,
        emailHash,
        riskScore: riskCalc.totalScore,
        classification: riskCalc.classification,
        breachesFound: riskCalc.breachesFound,
        breachData: breaches,
        recommendation,
        isVerified: true,
        processedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      console.log('[ExecuteRiskScan] Creating scan result:', {
        jobId,
        userId: input.userId,
        emailHash: emailHash.substring(0, 8) + '...',
        riskScore: riskCalc.totalScore,
        classification: riskCalc.classification,
      });

      await this.scanRepository.create(scanResult);

      // 7. Cache o resultado (12h se comprometido, 24h se limpo)
      const ttl = riskCalc.totalScore > 0 ? 12 * 60 * 60 : 24 * 60 * 60;
      await this.cacheService.setex(
        `scan:${emailHash}`,
        ttl,
        JSON.stringify({
          riskScore: riskCalc.totalScore,
          classification: riskCalc.classification,
          breachesFound: riskCalc.breachesFound,
          recommendation,
        })
      );

      return {
        jobId,
        riskScore: riskCalc.totalScore,
        classification: riskCalc.classification,
        breachesFound: riskCalc.breachesFound,
        recommendation,
        isVerified: true,
      };
    } catch (error) {
      console.error(`[ExecuteRiskScan Error] ${error}`);
      throw error;
    }
  }

  /**
   * Aguarda resultado do job BullMQ com timeout
   */
  private async waitForJobCompletion(
    job: any,
    timeoutMs: number
  ): Promise<HIBPBreach[] | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const state = await job.getState();
      
      if (state === 'completed') {
        const refreshed = await job.queue.getJob(job.id);
        return (
          refreshed?.data?.result ||
          refreshed?.returnvalue ||
          job?.data?.result ||
          null
        );
      }

      if (state === 'failed') {
        const refreshed = await job.queue.getJob(job.id);
        const failureReason =
          refreshed?.failedReason ||
          job.failedReason ||
          refreshed?.data?.error?.message ||
          job.data?.error?.message ||
          'Unknown error';
        throw new Error(`Job failed: ${failureReason}`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Job timeout after ${timeoutMs}ms`);
  }

  private hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase()).digest('hex');
  }

  private calculateDaysAgo(breachDateStr: string): number {
    const breachDate = new Date(breachDateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - breachDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }
}
