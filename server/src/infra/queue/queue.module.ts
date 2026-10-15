import { Module, Global, Inject, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { HibpClient } from '../http/hibp.client';
import { MockHibpClient } from '../http/hibp.mock';
import { createHibpWorker } from './hibp.worker';
import { closeQuietly } from '../../shared/utils/shutdown';

const REDIS_QUEUE_CONNECTION = 'REDIS_QUEUE_CONNECTION';
const REDIS_WORKER_CONNECTION = 'REDIS_WORKER_CONNECTION';
const HIBP_CLIENT = 'HIBP_CLIENT';
const HIBP_WORKER = 'HIBP_WORKER';

type HibpClientWithShutdown = (HibpClient | MockHibpClient) & { shutdown?: () => Promise<void> };

function createQueueRedisConnection(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null as null,
  });
}

@Global()
@Module({
  providers: [
    { provide: REDIS_QUEUE_CONNECTION, useFactory: createQueueRedisConnection },
    { provide: REDIS_WORKER_CONNECTION, useFactory: createQueueRedisConnection },
    {
      provide: HIBP_CLIENT,
      useFactory: () => {
        const apiKey = (process.env.HIBP_API_KEY || '').trim();
        const useMock = process.env.HIBP_USE_MOCK === 'true';

        if (!useMock && !apiKey) {
          throw new Error(
            '[QueueModule] HIBP_API_KEY is required. Use the zeroed test key for the HIBP integration tests or set HIBP_USE_MOCK=true explicitly.'
          );
        }

        if (useMock) {
          console.log(
            '[QueueModule] ⚠️  Using MOCK HIBP client because HIBP_USE_MOCK=true.'
          );
          return new MockHibpClient();
        }

        return new HibpClient({
          apiKey,
          baseUrl: process.env.HIBP_BASE_URL,
          userAgent: 'safeid-backend',
        });
      },
    },
    {
      provide: 'HIBP_QUEUE',
      inject: [REDIS_QUEUE_CONNECTION],
      useFactory: (connection: Redis) => {
        // Queue producer
        // Os jobs guardam o email em texto e o resultado do HIBP. Eles são apagados
        // do Redis pouco depois de terminar (o scan lê o resultado em até 10s),
        // em vez de ficarem lá para sempre.
        return new Queue('hibp-check', {
          connection,
          defaultJobOptions: {
            removeOnComplete: { age: 60 },
            removeOnFail: { age: 10 * 60 },
          },
        });
      },
    },
    {
      provide: HIBP_WORKER,
      inject: [REDIS_WORKER_CONNECTION, HIBP_CLIENT],
      useFactory: (connection: Redis, hibpClient: HibpClientWithShutdown) =>
        createHibpWorker(connection, hibpClient),
    },
  ],
  exports: ['HIBP_QUEUE'],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(HIBP_WORKER) private readonly worker: Worker,
    @Inject('HIBP_QUEUE') private readonly queue: Queue,
    @Inject(HIBP_CLIENT) private readonly hibpClient: HibpClientWithShutdown,
    @Inject(REDIS_QUEUE_CONNECTION) private readonly queueConnection: Redis,
    @Inject(REDIS_WORKER_CONNECTION) private readonly workerConnection: Redis,
  ) {}

  /**
   * O worker fecha primeiro: espera o job em andamento terminar e não pega jobs novos.
   * Depois fecham a fila, o circuit breaker do cliente HIBP e as conexões Redis.
   */
  async onApplicationShutdown(): Promise<void> {
    await closeQuietly('hibp-worker', () => this.worker.close());
    await closeQuietly('hibp-queue', () => this.queue.close());
    if (typeof this.hibpClient.shutdown === 'function') {
      await closeQuietly('hibp-client', () => this.hibpClient.shutdown!());
    }
    await closeQuietly('redis-queue', () => this.queueConnection.quit());
    await closeQuietly('redis-worker', () => this.workerConnection.quit());
  }
}
