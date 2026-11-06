import { afterEach, describe, expect, it } from '@jest/globals';
import { createHash, createHmac } from 'crypto';
import { hashEmail, maskEmail } from '../../src/shared/crypto/email-hash';

describe('maskEmail', () => {
  const previous = process.env.EMAIL_HASH_SECRET;

  afterEach(() => {
    if (previous === undefined) delete process.env.EMAIL_HASH_SECRET;
    else process.env.EMAIL_HASH_SECRET = previous;
  });

  it('é o começo do HMAC com chave do e-mail normalizado, igual ao emailHash do banco', () => {
    process.env.EMAIL_HASH_SECRET = 'segredo-de-teste';
    const esperado = createHmac('sha256', 'segredo-de-teste').update('user@example.com').digest('hex').substring(0, 8);

    expect(maskEmail(' User@Example.com ')).toBe(esperado);
    expect(hashEmail('user@example.com').startsWith(maskEmail('user@example.com'))).toBe(true);
    expect(maskEmail('user@example.com')).toHaveLength(8);
    expect(maskEmail('user@example.com')).not.toContain('@');
  });

  it('não dá para confirmar um e-mail conhecido só com o SHA-256 dele', () => {
    process.env.EMAIL_HASH_SECRET = 'segredo-de-teste';
    const semChave = createHash('sha256').update('user@example.com').digest('hex').substring(0, 8);

    expect(maskEmail('user@example.com')).not.toBe(semChave);
  });

  it('muda com a chave', () => {
    process.env.EMAIL_HASH_SECRET = 'chave-a';
    const comA = maskEmail('user@example.com');
    process.env.EMAIL_HASH_SECRET = 'chave-b';

    expect(maskEmail('user@example.com')).not.toBe(comA);
  });

  it('sem a chave, cai no SHA-256 como o hashEmail', () => {
    delete process.env.EMAIL_HASH_SECRET;
    const semChave = createHash('sha256').update('user@example.com').digest('hex').substring(0, 8);

    expect(maskEmail('User@Example.com')).toBe(semChave);
    expect(maskEmail('')).toHaveLength(8);
  });
});
