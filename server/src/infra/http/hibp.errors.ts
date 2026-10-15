/**
 * Erros tipados da HIBP. No monitoramento, um erro nunca pode virar "sem vazamentos":
 * quem chama decide o que fazer com cada tipo (repetir, esperar o rate limit, alertar).
 */

export class HibpError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = new.target.name;
  }
}

/** 429: esperar retryAfterMs antes da próxima chamada */
export class HibpRateLimitError extends HibpError {
  constructor(public readonly retryAfterMs: number) {
    super('HIBP rate limited', 429);
  }
}

/** 401/403 ou chave ausente: sem chave válida o monitoramento para */
export class HibpAuthError extends HibpError {}

/** 5xx, timeout, falha de rede ou circuit breaker aberto */
export class HibpUnavailableError extends HibpError {}

// Sem o header retry-after, espera 2 s (o mínimo que a HIBP costuma pedir)
const DEFAULT_RETRY_AFTER_MS = 2000;

function parseRetryAfterMs(headers: unknown): number {
  const raw = (headers as Record<string, unknown> | undefined)?.['retry-after'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : DEFAULT_RETRY_AFTER_MS;
}

/**
 * Converte um erro do axios num HibpError tipado. 404 não passa por aqui:
 * quem chama trata "não encontrado" antes.
 */
export function toHibpError(err: unknown): HibpError {
  if (err instanceof HibpError) {
    return err;
  }

  const error = err as { response?: { status?: number; headers?: unknown }; message?: string; code?: string };
  const status = error?.response?.status;

  if (status === 429) {
    return new HibpRateLimitError(parseRetryAfterMs(error.response?.headers));
  }
  if (status === 401 || status === 403) {
    return new HibpAuthError(`HIBP authorization failed (${status})`, status);
  }
  if (status === undefined || status >= 500) {
    // Sem resposta: timeout, falha de rede ou circuit breaker aberto
    return new HibpUnavailableError(`HIBP unavailable: ${error?.message || error?.code || 'unknown error'}`, status);
  }

  return new HibpError(`HIBP request failed (${status})`, status);
}
