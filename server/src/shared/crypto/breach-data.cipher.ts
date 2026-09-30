/**
 * Criptografia dos dados de vazamento guardados no banco
 * Usa AES-256-GCM com a chave ENCRYPTION_KEY. Valores antigos, gravados em
 * JSON puro antes da criptografia, continuam sendo lidos normalmente.
 */

import { Aes256GcmPayload, decryptAes256Gcm, encryptAes256Gcm } from './aes-256-gcm';

// Marca os valores criptografados para diferenciar dos registros antigos em JSON
const ENCRYPTED_PREFIX = 'enc:v1:';

let missingKeyWarned = false;

function getKey(): string | null {
  const key = (process.env.ENCRYPTION_KEY || '').trim();
  return key || null;
}

/**
 * Serializa e criptografa os dados de vazamento para gravar no banco
 */
export function sealBreachData(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null;
  }

  const json = JSON.stringify(data);
  const key = getKey();

  if (!key) {
    if (!missingKeyWarned) {
      console.warn('[BreachDataCipher] ENCRYPTION_KEY não configurada, dados de vazamento gravados sem criptografia.');
      missingKeyWarned = true;
    }
    return json;
  }

  const payload = encryptAes256Gcm(json, key);
  return ENCRYPTED_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Lê os dados de vazamento gravados no banco, criptografados ou não
 */
export function openBreachData(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  // Snapshots antigos guardavam o array direto no JSON do usuário
  if (typeof value !== 'string') {
    return value;
  }

  try {
    if (!value.startsWith(ENCRYPTED_PREFIX)) {
      return JSON.parse(value);
    }

    const key = getKey();
    if (!key) {
      console.error('[BreachDataCipher] Dado criptografado encontrado, mas ENCRYPTION_KEY não está configurada.');
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64').toString('utf8'),
    ) as Aes256GcmPayload;

    return JSON.parse(decryptAes256Gcm(payload, key));
  } catch (error) {
    console.error('[BreachDataCipher] Não foi possível ler os dados de vazamento:', error);
    return null;
  }
}
