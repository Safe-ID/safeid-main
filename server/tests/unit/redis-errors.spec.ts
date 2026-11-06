import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { logRedisErrors } from '../../src/infra/cache/redis-errors';

describe('logRedisErrors', () => {
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let logSpy: jest.SpiedFunction<typeof console.log>;
  const eventos = (spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> =>
    spy.mock.calls.map((c) => JSON.parse(c[0] as string) as Record<string, unknown>);

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registra a falha em JSON uma vez por tipo, sem repetir a cada reconexão', () => {
    const client = logRedisErrors(new EventEmitter(), 'cache');
    const recusada = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    client.emit('error', recusada);
    client.emit('error', recusada);
    client.emit('error', recusada);

    expect(eventos(errorSpy)).toHaveLength(1);
    expect(eventos(errorSpy)[0]).toMatchObject({
      level: 'error',
      ctx: 'Redis',
      event: 'redis.error',
      client: 'cache',
      code: 'ECONNREFUSED',
      error: { message: 'connect ECONNREFUSED' },
    });
  });

  it('avisa quando a conexão volta e registra de novo se cair outra vez', () => {
    const client = logRedisErrors(new EventEmitter(), 'bullmq');
    const recusada = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    client.emit('error', recusada);
    client.emit('ready');
    client.emit('error', recusada);

    expect(eventos(logSpy)).toEqual([expect.objectContaining({ event: 'redis.recovered', client: 'bullmq' })]);
    expect(eventos(errorSpy)).toHaveLength(2);
  });

  it('não avisa recuperação na primeira conexão', () => {
    const client = logRedisErrors(new EventEmitter(), 'cache');
    client.emit('ready');

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('um erro de outro tipo é registrado mesmo sem reconectar', () => {
    const client = logRedisErrors(new EventEmitter(), 'cache');
    client.emit('error', Object.assign(new Error('a'), { code: 'ECONNREFUSED' }));
    client.emit('error', Object.assign(new Error('b'), { code: 'ETIMEDOUT' }));

    expect(eventos(errorSpy).map((e) => e.code)).toEqual(['ECONNREFUSED', 'ETIMEDOUT']);
  });
});
