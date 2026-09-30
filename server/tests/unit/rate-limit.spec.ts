import { describe, expect, it } from '@jest/globals';
import { ClientIpThrottlerGuard, getClientIp } from '../../src/infra/rate-limit/rate-limit.module';

describe('rate limit client IP', () => {
  it('uses the first X-Forwarded-For address when the API is behind a proxy', () => {
    expect(getClientIp({ headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }, ip: '10.0.0.1' })).toBe('203.0.113.10');
    expect(getClientIp({ headers: { 'x-forwarded-for': ['198.51.100.20'] } })).toBe('198.51.100.20');
  });

  it('falls back to the connection IP without the header', () => {
    expect(getClientIp({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
    expect(getClientIp({ headers: { 'x-forwarded-for': ' ' }, socket: { remoteAddress: '::1' } })).toBe('::1');
    expect(getClientIp({})).toBe('unknown');
  });

  it('is the tracker used by the throttler guard', async () => {
    const guard = Object.create(ClientIpThrottlerGuard.prototype) as any;
    await expect(guard.getTracker({ headers: { 'x-forwarded-for': '203.0.113.10' } })).resolves.toBe('203.0.113.10');
  });
});
