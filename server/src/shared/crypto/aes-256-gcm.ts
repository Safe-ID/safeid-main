import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface Aes256GcmPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

function normalizeKey(key: string | Buffer): Buffer {
  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) {
      throw new Error('AES-256-GCM requires a 32-byte key');
    }

    return key;
  }

  const trimmedKey = key.trim();
  const candidates: Buffer[] = [
    Buffer.from(trimmedKey, 'utf8'),
  ];

  if (/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
    candidates.unshift(Buffer.from(trimmedKey, 'hex'));
  }

  if (trimmedKey.length % 4 === 0) {
    candidates.push(Buffer.from(trimmedKey, 'base64'));
  }

  const normalized = candidates.find(candidate => candidate.length === 32);

  if (!normalized) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }

  return normalized;
}

export function encryptAes256Gcm(
  plaintext: string,
  key: string | Buffer,
): Aes256GcmPayload {
  const normalizedKey = normalizeKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', normalizedKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptAes256Gcm(
  payload: Aes256GcmPayload,
  key: string | Buffer,
): string {
  const normalizedKey = normalizeKey(key);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    normalizedKey,
    Buffer.from(payload.iv, 'base64'),
  );

  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}