import { describe, expect, it } from '@jest/globals';
import { validateEnv } from '../../src/shared/config/env.validation';

describe('validateEnv', () => {
  const validConfig = {
    NODE_ENV: 'development',
    JWT_SECRET: 'a-real-jwt-secret',
    REFRESH_TOKEN_SECRET: 'a-real-refresh-secret',
  };

  it('accepts a configuration with real secrets', () => {
    expect(validateEnv(validConfig)).toEqual(validConfig);
  });

  it('rejects missing secrets', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow('JWT_SECRET não está definida');
    expect(() => validateEnv({ ...validConfig, REFRESH_TOKEN_SECRET: '  ' })).toThrow('REFRESH_TOKEN_SECRET não está definida');
  });

  it('rejects the placeholder values from .env.example', () => {
    expect(() => validateEnv({ ...validConfig, JWT_SECRET: 'your_jwt_secret_here' })).toThrow(
      'JWT_SECRET ainda está com o valor de exemplo',
    );
  });

  it('rejects the same secret for access and refresh tokens', () => {
    expect(() => validateEnv({ ...validConfig, REFRESH_TOKEN_SECRET: validConfig.JWT_SECRET })).toThrow(
      'REFRESH_TOKEN_SECRET precisa ser diferente de JWT_SECRET',
    );
  });

  it('requires the session secret only in production', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'production' })).toThrow('SESSION_SECRET não está definida');
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'production', SESSION_SECRET: 'local-session-secret' })).toThrow(
      'SESSION_SECRET ainda está com o valor de exemplo',
    );
    expect(validateEnv({ ...validConfig, NODE_ENV: 'production', SESSION_SECRET: 'a-real-session-secret' })).toBeDefined();
  });
});
