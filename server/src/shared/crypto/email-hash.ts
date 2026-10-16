import { createHash, createHmac } from 'crypto';

let missingSecretWarned = false;

/**
 * Hash do email usado no banco (ScanHistory.emailHash) e nas chaves do cache.
 * Com EMAIL_HASH_SECRET é um HMAC: sem a chave, não dá para descobrir o email
 * testando uma lista de emails conhecidos. Sem a variável, mantém o SHA-256 antigo.
 */
export function hashEmail(email: string): string {
  const normalizedEmail = email.toLowerCase();
  const secret = (process.env.EMAIL_HASH_SECRET || '').trim();

  if (!secret) {
    if (!missingSecretWarned) {
      console.warn('[ExecuteRiskScan] EMAIL_HASH_SECRET não configurada, usando SHA-256 sem chave.');
      missingSecretWarned = true;
    }
    return createHash('sha256').update(normalizedEmail).digest('hex');
  }

  return createHmac('sha256', secret).update(normalizedEmail).digest('hex');
}
