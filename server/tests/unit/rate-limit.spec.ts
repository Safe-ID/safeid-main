import { describe, expect, it, jest } from '@jest/globals';
import { ClientIpThrottlerGuard, getClientIp } from '../../src/infra/rate-limit/rate-limit.module';

describe('rate limit client IP', () => {
  it('uses the IP written by the trusted proxy (the last one), not the first', () => {
    // O ALB acrescenta o IP real no fim; o primeiro item é do cliente.
    expect(getClientIp({ headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(getClientIp({ headers: { 'x-forwarded-for': ['198.51.100.20'] } })).toBe('198.51.100.20');
    expect(getClientIp({ headers: { 'x-forwarded-for': ['1.1.1.1', '2.2.2.2, 10.0.0.1'] } })).toBe('10.0.0.1');
  });

  it('ignores forged entries the client prepends (S07)', () => {
    // Qualquer que seja o X-Forwarded-For enviado pelo cliente, o ALB acrescenta o IP real no fim.
    const real = '10.0.0.7';
    expect(getClientIp({ headers: { 'x-forwarded-for': `${real}` } })).toBe(real);
    expect(getClientIp({ headers: { 'x-forwarded-for': `203.0.113.1, ${real}` } })).toBe(real);
    expect(getClientIp({ headers: { 'x-forwarded-for': `203.0.113.2, 203.0.113.3, ${real}` } })).toBe(real);
  });

  it('respects TRUSTED_PROXY_HOPS when more proxies are in front', async () => {
    jest.resetModules();
    process.env.TRUSTED_PROXY_HOPS = '2';
    const { getClientIp: comDoisProxies } = await import('../../src/infra/rate-limit/rate-limit.module');
    // Com 2 proxies (ex.: CloudFront + ALB), o IP real é o penúltimo.
    expect(comDoisProxies({ headers: { 'x-forwarded-for': 'forjado, 203.0.113.9, 10.0.0.1' } })).toBe('203.0.113.9');
    delete process.env.TRUSTED_PROXY_HOPS;
    jest.resetModules();
  });

  it('falls back to the connection IP without the header', () => {
    expect(getClientIp({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
    expect(getClientIp({ headers: { 'x-forwarded-for': ' ' }, socket: { remoteAddress: '::1' } })).toBe('::1');
    expect(getClientIp({})).toBe('unknown');
  });

  it('is the tracker used by the throttler guard', async () => {
    const guard = Object.create(ClientIpThrottlerGuard.prototype) as any;
    await expect(guard.getTracker({ headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' } })).resolves.toBe('10.0.0.1');
  });
});
