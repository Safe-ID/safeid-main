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
 * 6. Gera recomendação com AIEngine (com cache por conjunto de vazamentos)
 * 7. Persiste resultado
 */

import { createHash, createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RiskEngine } from '../engines/risk.engine';
import { AIEngine, AIRecommendation } from '../engines/ai.engine';
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

// Recomendações do modelo ficam em cache por 7 dias para o mesmo conjunto de vazamentos
const AI_RECOMMENDATION_TTL = 7 * 24 * 60 * 60;

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
  mitigationSteps?: string[];
  urgencyLevel?: string;
  isVerified: boolean;
}

export class ExecuteRiskScanUseCase {
  private static missingSecretWarned = false;
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
      let aiResult: AIRecommendation | undefined;
      if (breaches && breaches.length > 0) {
        try {
          aiResult = await this.getRecommendation(breaches, riskCalc);
        } catch (error) {
          console.warn('[ExecuteRiskScan] AI recommendation unavailable, continuing without it:', error);
          aiResult = undefined;
        }
      }
      const recommendation = aiResult?.executive_summary;
      const mitigationSteps = aiResult?.mitigation_steps;
      const urgencyLevel = aiResult?.urgency_level;

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
        mitigationSteps,
        urgencyLevel,
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
          mitigationSteps,
          urgencyLevel,
        })
      );

      return {
        jobId,
        riskScore: riskCalc.totalScore,
        classification: riskCalc.classification,
        breachesFound: riskCalc.breachesFound,
        recommendation,
        mitigationSteps,
        urgencyLevel,
        isVerified: true,
      };
    } catch (error) {
      console.error(`[ExecuteRiskScan Error] ${error}`);
      throw error;
    }
  }

  /**
   * Busca a recomendação no cache antes de chamar a IA.
   * Só guarda respostas do modelo, para a resposta padrão não ficar presa no cache.
   */
  private async getRecommendation(
    breaches: HIBPBreach[],
    riskCalc: { totalScore: number; classification: 'LOW' | 'MODERATE' | 'CRITICAL' },
  ): Promise<AIRecommendation> {
    const cacheKey = `ai-recommendation:${this.hashBreaches(breaches, riskCalc)}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        console.log('[AI Cache HIT] Reutilizando recomendação');
        return JSON.parse(cached) as AIRecommendation;
      }
    } catch (error) {
      console.warn('[ExecuteRiskScan] AI cache read failed, calling the model:', error);
    }

    const aiResult = await this.aiEngine.generateRecommendation({
      breaches: breaches,
      riskScore: riskCalc.totalScore,
      classification: riskCalc.classification,
    });

    if (aiResult.source === 'ai') {
      try {
        await this.cacheService.setex(cacheKey, AI_RECOMMENDATION_TTL, JSON.stringify(aiResult));
      } catch (error) {
        console.warn('[ExecuteRiskScan] AI cache write failed:', error);
      }
    }

    return aiResult;
  }

  /**
   * Gera a chave do cache a partir dos campos públicos dos vazamentos (sem dados do usuário)
   */
  private hashBreaches(
    breaches: HIBPBreach[],
    riskCalc: { totalScore: number; classification: string },
  ): string {
    const signature = breaches
      .map(breach => ({
        name: breach.Name,
        date: breach.BreachDate,
        dataClasses: [...(breach.DataClasses || [])].sort(),
        verified: breach.IsVerified,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return createHash('sha256')
      .update(JSON.stringify({
        breaches: signature,
        riskScore: riskCalc.totalScore,
        classification: riskCalc.classification,
      }))
      .digest('hex');
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

  /**
   * Remove do cache o resultado do scan desse email (usado na exclusão de conta)
   */
  async clearCachedResult(email: string): Promise<void> {
    await this.cacheService.del(`scan:${this.hashEmail(email)}`);
  }

  /**
   * Hash do email usado no banco e nas chaves do cache.
   * Com EMAIL_HASH_SECRET é um HMAC: sem a chave, não dá para descobrir o email
   * testando uma lista de emails conhecidos. Sem a variável, mantém o SHA-256 antigo.
   */
  private hashEmail(email: string): string {
    const normalizedEmail = email.toLowerCase();
    const secret = (process.env.EMAIL_HASH_SECRET || '').trim();

    if (!secret) {
      if (!ExecuteRiskScanUseCase.missingSecretWarned) {
        console.warn('[ExecuteRiskScan] EMAIL_HASH_SECRET não configurada, usando SHA-256 sem chave.');
        ExecuteRiskScanUseCase.missingSecretWarned = true;
      }
      return createHash('sha256').update(normalizedEmail).digest('hex');
    }

    return createHmac('sha256', secret).update(normalizedEmail).digest('hex');
  }

  private calculateDaysAgo(breachDateStr: string): number {
    const breachDate = new Date(breachDateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - breachDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }
}
