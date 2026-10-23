/**
 * Tempos de conexão do servidor HTTP atrás do ALB.
 *
 * O ALB reaproveita as conexões com a task por até 60 s sem uso (idle timeout).
 * O Node fecha uma conexão parada depois de 5 s por padrão, então o ALB às vezes
 * manda uma requisição por uma conexão que o Node acabou de fechar e responde 502.
 * Com o keep-alive do Node maior que o do ALB, quem fecha a conexão é sempre o ALB.
 */

export const ALB_IDLE_TIMEOUT_MS = 60_000;
export const KEEP_ALIVE_TIMEOUT_MS = ALB_IDLE_TIMEOUT_MS + 5_000;
// Precisa ser maior que o keep-alive, senão o Node encerra antes por tempo de cabeçalho
export const HEADERS_TIMEOUT_MS = KEEP_ALIVE_TIMEOUT_MS + 1_000;

interface TimeoutConfigurableServer {
  keepAliveTimeout: number;
  headersTimeout: number;
}

export function applyServerTimeouts(server: TimeoutConfigurableServer): void {
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}
