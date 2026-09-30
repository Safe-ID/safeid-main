/**
 * ScanResult Entity
 * Representa o resultado de uma análise de vazamento
 */

export interface ScanResult {
  jobId: string; // UUID do job (identificador público único)
  userId: number;
  emailHash: string; // SHA-256 hash (não armazenar email em texto)
  riskScore: number; // 0-100
  classification: 'LOW' | 'MODERATE' | 'CRITICAL' | string;
  breachesFound: number | null;
  breachData?: any; // JSON dos breaches (pode ser serializado ou array)
  recommendation?: string | null; // Texto da recomendação IA
  mitigationSteps?: unknown; // Passos de mitigação sugeridos pela IA (array de strings em JSON)
  urgencyLevel?: string | null; // HIGH, MEDIUM ou LOW
  isVerified?: boolean;
  processedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
