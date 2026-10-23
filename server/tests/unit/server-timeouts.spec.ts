import {
  ALB_IDLE_TIMEOUT_MS,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  applyServerTimeouts,
} from '../../src/shared/http/server-timeouts';

describe('applyServerTimeouts', () => {
  it('keeps connections open longer than the ALB idle timeout', () => {
    // Padrões do Node: 5 s de keep-alive e 60 s de cabeçalhos
    const server = { keepAliveTimeout: 5_000, headersTimeout: 60_000 };

    applyServerTimeouts(server);

    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBeGreaterThan(ALB_IDLE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });
});
