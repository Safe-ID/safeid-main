import Redis from 'ioredis';

/**
 * Conexão Redis para BullMQ (filas e workers). O BullMQ exige maxRetriesPerRequest: null.
 * Cada worker abre a própria conexão, porque usa comandos bloqueantes.
 */
export function createBullConnection(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null as null,
  });
}
