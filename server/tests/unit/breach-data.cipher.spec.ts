import { afterEach, describe, expect, it } from '@jest/globals';
import { openBreachData, sealBreachData } from '../../src/shared/crypto/breach-data.cipher';

describe('breach data cipher', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const breaches = [{ Name: 'Adobe', DataClasses: ['Passwords', 'Email addresses'] }];

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalKey;
    }
  });

  it('encrypts the breach data when ENCRYPTION_KEY is set', () => {
    process.env.ENCRYPTION_KEY = 'k'.repeat(32);

    const sealed = sealBreachData(breaches) as string;

    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('Adobe');
    expect(sealed).not.toContain('Passwords');
    expect(openBreachData(sealed)).toEqual(breaches);
  });

  it('keeps plain JSON when there is no key and still reads it back', () => {
    delete process.env.ENCRYPTION_KEY;

    const sealed = sealBreachData(breaches);

    expect(sealed).toBe(JSON.stringify(breaches));
    expect(openBreachData(sealed)).toEqual(breaches);
  });

  it('reads legacy values and handles empty or broken data', () => {
    process.env.ENCRYPTION_KEY = 'k'.repeat(32);

    expect(openBreachData(JSON.stringify(breaches))).toEqual(breaches);
    expect(openBreachData(breaches)).toEqual(breaches);
    expect(openBreachData(null)).toBeNull();
    expect(openBreachData('{broken-json')).toBeNull();
    expect(sealBreachData(null)).toBeNull();
  });

  it('returns null instead of crashing when the key is missing or wrong', () => {
    process.env.ENCRYPTION_KEY = 'k'.repeat(32);
    const sealed = sealBreachData(breaches);

    delete process.env.ENCRYPTION_KEY;
    expect(openBreachData(sealed)).toBeNull();

    process.env.ENCRYPTION_KEY = 'x'.repeat(32);
    expect(openBreachData(sealed)).toBeNull();
  });
});
