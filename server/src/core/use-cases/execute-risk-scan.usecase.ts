/**
 * ExecuteRiskScanUseCase
 * Orquestrador principal da análise de vazamento
 * 
 * Pipeline:
 * 1. Valida email (Zod)
 * 2. Checa cache Redis
 * 3. Se miss, enfileira em BullMQ (HIBP com rate limit)
 * 4. Aguarda resultado (timeout 20s)
 * 5. scoreAndPersist: calcula risk com RiskEngine
 * 6. Gera recomendação com AIEngine (com cache por conjunto de vazamentos)
 * 7. Persiste resultado
 */

import { createHash, randomUUID } from 'crypto';
import { RiskEngine } from '../engines/risk.engine';
import { JOB_CHECK_HIBP } from '../../infra/queue/queue.constants';
import { hashEmail } from '../../shared/crypto/email-hash';
import { extractBreachNames } from '../../shared/utils/breach-names';
import { AIEngine, AIRecommendation } from '../engines/ai.engine';
import { ScanResult, ScanSource } from '../entities/scan-result.entity';
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

// Tempo máximo esperando o worker hibp-check responder ao scan interativo
const SCAN_JOB_TIMEOUT_MS = 20000;

interface ExecuteScanInput {
  email: string;
  userId: number;
  source?: ScanSource;
}

interface ExecuteScanOutput {
  jobId: string;
  riskScore: number;
  classification: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  breachesFound: number;
  recommendation?: string;
  mitigationSteps?: string[];
  urgencyLevel?: string;
  isVerified: boolean;
  /** Nomes dos vazamentos encontrados; null em cache HIT (nada novo para registrar) */
  breachNames: string[] | null;
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
    const jobId = randomUUID();
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
          breachNames: null,
        };
      }

      console.log(`[Cache MISS] Enfileirando no BullMQ: ${emailHash}`);

      // 2. Enfileira job HIBP. Sem priority = prioridade máxima no BullMQ: o scan interativo
      // passa na frente dos monitor-check (priority 10) da varredura
      const job = await this.hibpQueue.add(JOB_CHECK_HIBP, {
        email: input.email,
        emailHash,
      });

      // 3. Aguarda resultado com timeout de 20s: com o limite do plano Core 1 (~1 chamada
      // a cada 6,7 s), o próximo slot pode levar isso mais a consulta em andamento
      const breaches = await this.waitForJobCompletion(job, SCAN_JOB_TIMEOUT_MS);

      // 4-7. Pontua, gera a recomendação, persiste e atualiza o cache
      return await this.scoreAndPersist({
        userId: input.userId,
        email: input.email,
        breaches: breaches || [],
        source: input.source ?? 'MANUAL',
        jobId,
      });
    } catch (error) {
      console.error(`[ExecuteRiskScan Error] ${error}`);
      throw error;
    }
  }

  /**
   * Pontua os vazamentos, gera a recomendação da IA, grava o ScanHistory e atualiza o cache.
   * Usado pelo scan interativo e pelo monitoramento (vazamentos vindos do catálogo local).
   * Falha da IA não bloqueia: o resultado sai sem recomendação.
   */
  async scoreAndPersist(input: {
    userId: number;
    email: string;
    breaches: HIBPBreach[];
    source: ScanSource;
    jobId?: string;
  }): Promise<ExecuteScanOutput & { breachNames: string[] }> {
    const jobId = input.jobId ?? randomUUID();
    const emailHash = this.hashEmail(input.email);
    const breaches = input.breaches;

    // Calcula Risk Score
    const riskCalc = this.riskEngine.calculate(breaches);

    // Gera recomendação com IA (passa TODAS as breaches)
    let aiResult: AIRecommendation | undefined;
    if (breaches.length > 0) {
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

    // Cria e persiste resultado
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
      source: input.source,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log('[ExecuteRiskScan] Creating scan result:', {
      jobId,
      userId: input.userId,
      emailHash: emailHash.substring(0, 8) + '...',
      riskScore: riskCalc.totalScore,
      classification: riskCalc.classification,
      source: input.source,
    });

    await this.scanRepository.create(scanResult);

    // Cache o resultado (12h se comprometido, 24h se limpo). O DEL antes garante que um
    // resultado antigo não sobreviva se o SETEX falhar (ex.: rescore do monitoramento).
    const cacheKey = `scan:${emailHash}`;
    const ttl = riskCalc.totalScore > 0 ? 12 * 60 * 60 : 24 * 60 * 60;
    await this.cacheService.del(cacheKey);
    await this.cacheService.setex(
      cacheKey,
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
      breachNames: extractBreachNames(breaches),
    };
  }

  /**
   * Busca a recomendação no cache antes de chamar a IA.
   * Só guarda respostas do modelo, para a resposta padrão não ficar presa no cache.
   */
  private async getRecommendation(
    breaches: HIBPBreach[],
    riskCalc: { totalScore: number; classification: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' },
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
   * Hash do email usado no banco e nas chaves do cache (ver shared/crypto/email-hash)
   */
  private hashEmail(email: string): string {
    return hashEmail(email);
  }

  private calculateDaysAgo(breachDateStr: string): number {
    const breachDate = new Date(breachDateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - breachDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }
}
