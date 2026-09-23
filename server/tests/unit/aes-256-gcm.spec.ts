import { describe, expect, it } from '@jest/globals';
import {
  decryptAes256Gcm,
  encryptAes256Gcm,
} from '../../src/shared/crypto/aes-256-gcm';

describe('AES-256-GCM crypto helper', () => {
  const key = Buffer.from('0123456789abcdef0123456789abcdef');

  it('encrypts and decrypts a payload round-trip', () => {
    const payload = encryptAes256Gcm('conteudo sensivel', key);

    expect(payload.iv).toEqual(expect.any(String));
    expect(payload.tag).toEqual(expect.any(String));
    expect(payload.ciphertext).toEqual(expect.any(String));

    const plaintext = decryptAes256Gcm(payload, key);

    expect(plaintext).toBe('conteudo sensivel');
  });

  it('rejects tampered ciphertext', () => {
    const payload = encryptAes256Gcm('conteudo sensivel', key);
    const tampered = {
      ...payload,
      ciphertext: Buffer.from('conteudo adulterado').toString('base64'),
    };

    expect(() => decryptAes256Gcm(tampered, key)).toThrow();
  });

  it('accepts a 32-byte hex key and a 32-byte base64 key', () => {
    const hexKey = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    const base64Key = Buffer.from(hexKey, 'hex').toString('base64');

    const hexPayload = encryptAes256Gcm('hex-key', hexKey);
    const base64Payload = encryptAes256Gcm('base64-key', base64Key);

    expect(decryptAes256Gcm(hexPayload, hexKey)).toBe('hex-key');
    expect(decryptAes256Gcm(base64Payload, base64Key)).toBe('base64-key');
  });

  it('rejects keys shorter than 32 bytes', () => {
    expect(() => encryptAes256Gcm('conteudo sensivel', 'chave-fraca')).toThrow(
      'AES-256-GCM requires a 32-byte key',
    );
  });

  it('rejects a buffer key with the wrong size', () => {
    expect(() => encryptAes256Gcm('conteudo sensivel', Buffer.alloc(31))).toThrow(
      'AES-256-GCM requires a 32-byte key',
    );
  });
});