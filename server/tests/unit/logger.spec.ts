import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'crypto';
import { log, maskEmail } from '../../src/shared/utils/logger';

describe('structured logger', () => {
  const originalLevel = process.env.LOG_LEVEL;
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env.LOG_LEVEL = originalLevel;
  });

  it('writes a single JSON line with the base fields and the extra fields', () => {
    log('info', 'Monitoring', 'catalog.sync.done', { total: 800, changed: 2 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      ts: '2026-10-15T12:00:00.000Z',
      level: 'info',
      ctx: 'Monitoring',
      event: 'catalog.sync.done',
      total: 800,
      changed: 2,
    });
  });

  it('does not let extra fields override the base fields', () => {
    log('info', 'Ctx', 'real.event', { event: 'fake', level: 'error' });

    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({ event: 'real.event', level: 'info' });
  });

  it('serializes errors with name and message', () => {
    log('error', 'Email', 'email.failed', { err: new TypeError('boom') });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string).err).toEqual({ name: 'TypeError', message: 'boom' });
  });

  it('routes warn to console.warn', () => {
    log('warn', 'Hibp', 'hibp.rate_limited', { retryAfterMs: 2000 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('uses info as the default level and skips debug', () => {
    log('debug', 'Ctx', 'debug.event');
    log('info', 'Ctx', 'info.event');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string).event).toBe('info.event');
  });

  it('respects LOG_LEVEL, ignoring case and invalid values', () => {
    process.env.LOG_LEVEL = 'WARN';
    log('info', 'Ctx', 'skipped');
    log('warn', 'Ctx', 'kept');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    process.env.LOG_LEVEL = 'debug';
    log('debug', 'Ctx', 'debug.kept');
    expect(logSpy).toHaveBeenCalledTimes(1);

    process.env.LOG_LEVEL = 'verbose';
    log('debug', 'Ctx', 'debug.skipped');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('masks e-mails as the first 8 chars of the SHA-256 of the normalized address', () => {
    const expected = createHash('sha256').update('user@example.com').digest('hex').substring(0, 8);

    expect(maskEmail(' User@Example.com ')).toBe(expected);
    expect(maskEmail('user@example.com')).toHaveLength(8);
    expect(maskEmail('user@example.com')).not.toContain('@');
  });
});
