import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from '../../src/modules/auth/dto/auth.dto';
import { MonitoringPreferencesDto } from '../../src/modules/monitoring/dto/monitoring.dto';

// Mesma conversão do ValidationPipe global (main.ts)
const toDto = <T>(cls: new () => T, body: object) => plainToInstance(cls, body, { enableImplicitConversion: true });

describe('StrictBoolean', () => {
  const signup = { email: 'a@example.com', password: 'StrongPass123' };

  it('accepts real booleans', async () => {
    await expect(validate(toDto(SignupDto, { ...signup, acceptTerms: true, acceptMonitoring: false }) as object)).resolves.toEqual([]);
    await expect(validate(toDto(MonitoringPreferencesDto, { enabled: false }) as object)).resolves.toEqual([]);
  });

  it('rejects strings that implicit conversion would turn into true (consent cannot be faked)', async () => {
    for (const value of ['false', 'true', 'yes', 1]) {
      const termsErrors = await validate(toDto(SignupDto, { ...signup, acceptTerms: value }) as object);
      expect(termsErrors.map(error => error.property)).toContain('acceptTerms');

      const monitoringErrors = await validate(toDto(SignupDto, { ...signup, acceptTerms: true, acceptMonitoring: value }) as object);
      expect(monitoringErrors.map(error => error.property)).toContain('acceptMonitoring');

      const preferenceErrors = await validate(toDto(MonitoringPreferencesDto, { enabled: value }) as object);
      expect(preferenceErrors.map(error => error.property)).toContain('enabled');
    }
  });

  it('keeps acceptMonitoring optional', async () => {
    await expect(validate(toDto(SignupDto, { ...signup, acceptTerms: true }) as object)).resolves.toEqual([]);
  });
});
