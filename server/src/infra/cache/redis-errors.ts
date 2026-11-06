import { log } from '../../shared/utils/logger';

// Só o que é usado do cliente: qualquer emissor de eventos serve (ioredis, ou um EventEmitter nos testes)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- assinatura genérica de listener, a mesma do EventEmitter
type EventSource = { on(event: string, listener: (...args: any[]) => void): unknown };

/**
 * Trata os erros de conexão de um cliente Redis no logger estruturado.
 * Sem um listener de 'error', o ioredis imprime "Unhandled error event" com o stack em texto
 * a cada tentativa de reconexão, fora do JSON e em volume, justamente durante uma queda.
 * Aqui sai um evento redis.error por tipo de falha e um redis.recovered quando volta.
 */
export function logRedisErrors<T extends EventSource>(client: T, name: string): T {
  let lastCode: string | undefined;

  client.on('error', (err: NodeJS.ErrnoException) => {
    const code = err?.code || err?.name || 'unknown';
    // O ioredis repete o mesmo erro a cada tentativa de reconexão
    if (code === lastCode) return;
    lastCode = code;
    log('error', 'Redis', 'redis.error', { client: name, code, error: err });
  });

  client.on('ready', () => {
    if (lastCode) log('info', 'Redis', 'redis.recovered', { client: name });
    lastCode = undefined;
  });

  return client;
}
