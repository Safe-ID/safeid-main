import { createHash, createHmac } from 'crypto';
import { log } from '../utils/logger';

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
      log('warn', 'EmailHash', 'email_hash.secret_missing', { variable: 'EMAIL_HASH_SECRET', fallback: 'sha256' });
      missingSecretWarned = true;
    }
    return createHash('sha256').update(normalizedEmail).digest('hex');
  }

  return createHmac('sha256', secret).update(normalizedEmail).digest('hex');
}

/**
 * Identificador de e-mail para os logs: os 8 primeiros caracteres do hashEmail.
 * É o mesmo HMAC com chave do banco, então quem lê o log não confirma um e-mail
 * conhecido sem a EMAIL_HASH_SECRET, e quem investiga cruza a linha com o emailHash.
 */
export function maskEmail(email: string): string {
  return hashEmail((email || '').trim()).substring(0, 8);
}
