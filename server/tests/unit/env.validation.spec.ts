import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { findEnvProblems, validateEnv } from '../../src/shared/config/env.validation';

describe('env validation', () => {
  const validConfig = {
    NODE_ENV: 'development',
    JWT_SECRET: 'a-real-jwt-secret',
    REFRESH_TOKEN_SECRET: 'a-real-refresh-secret',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('finds no problems with real secrets', () => {
    expect(findEnvProblems(validConfig)).toEqual([]);
  });

  it('reports missing secrets', () => {
    expect(findEnvProblems({ NODE_ENV: 'development' })).toContain('JWT_SECRET não está definida');
    expect(findEnvProblems({ ...validConfig, REFRESH_TOKEN_SECRET: '  ' })).toContain('REFRESH_TOKEN_SECRET não está definida');
  });

  it('reports the placeholder values from .env.example', () => {
    expect(findEnvProblems({ ...validConfig, JWT_SECRET: 'your_jwt_secret_here' })).toContain(
      'JWT_SECRET ainda está com o valor de exemplo',
    );
  });

  it('reports the same secret for access and refresh tokens', () => {
    expect(findEnvProblems({ ...validConfig, REFRESH_TOKEN_SECRET: validConfig.JWT_SECRET })).toContain(
      'REFRESH_TOKEN_SECRET precisa ser diferente de JWT_SECRET',
    );
  });

  it('checks the session secret only in production', () => {
    expect(findEnvProblems(validConfig)).toEqual([]);
    expect(findEnvProblems({ ...validConfig, NODE_ENV: 'production' })).toContain('SESSION_SECRET não está definida');
    expect(findEnvProblems({ ...validConfig, NODE_ENV: 'production', SESSION_SECRET: 'local-session-secret' })).toContain(
      'SESSION_SECRET ainda está com o valor de exemplo',
    );
  });

  it('only warns and never blocks the app from starting', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = { NODE_ENV: 'production', JWT_SECRET: 'your_jwt_secret_here' };

    expect(validateEnv(config)).toBe(config);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockClear();
    expect(validateEnv(validConfig)).toBe(validConfig);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
