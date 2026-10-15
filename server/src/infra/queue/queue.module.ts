import { Module, Global, Inject, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { HibpClient } from '../http/hibp.client';
import { MockHibpClient } from '../http/hibp.mock';
import { HibpCatalogClient } from '../http/hibp-catalog.client';
import { MockHibpCatalogClient } from '../http/hibp-catalog.mock';
import { HibpPlanService } from '../http/hibp-plan.service';
import { HibpClientLike } from '../http/hibp.types';
import { closeQuietly } from '../../shared/utils/shutdown';
import { createBullConnection } from './redis-connection';
import {
  EMAIL_QUEUE,
  HIBP_CATALOG_CLIENT,
  HIBP_CLIENT,
  HIBP_QUEUE,
  MONITORING_QUEUE,
  QUEUE_EMAIL,
  QUEUE_HIBP,
  QUEUE_MONITORING,
  REDIS_QUEUE_CONNECTION,
} from './queue.constants';

const SEVEN_DAYS_S = 7 * 24 * 3600;

function isMockEnabled(): boolean {
  return process.env.HIBP_USE_MOCK === 'true';
}

/**
 * Filas e clientes HIBP. Só produz jobs: os workers são providers dos módulos
 * de domínio (ex.: HibpProcessor) e respeitam o APP_ROLE.
 */
@Global()
@Module({
  providers: [
    { provide: REDIS_QUEUE_CONNECTION, useFactory: createBullConnection },
    {
      provide: HIBP_CLIENT,
      useFactory: (): HibpClientLike => {
        const apiKey = (process.env.HIBP_API_KEY || '').trim();

        if (!isMockEnabled() && !apiKey) {
          throw new Error(
            '[QueueModule] HIBP_API_KEY is required. Use the zeroed test key for the HIBP integration tests or set HIBP_USE_MOCK=true explicitly.'
          );
        }

        if (isMockEnabled()) {
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
      provide: HIBP_CATALOG_CLIENT,
      useFactory: () =>
        isMockEnabled()
          ? new MockHibpCatalogClient()
          : new HibpCatalogClient({ baseUrl: process.env.HIBP_BASE_URL, userAgent: 'safeid-backend' }),
    },
    {
      provide: HIBP_QUEUE,
      inject: [REDIS_QUEUE_CONNECTION],
      useFactory: (connection: Redis) =>
        // Os jobs check-hibp guardam o e-mail em texto e o resultado do HIBP.
        // São apagados pouco depois de terminar (o scan lê o resultado em até 20 s).
        new Queue(QUEUE_HIBP, {
          connection,
          defaultJobOptions: {
            removeOnComplete: { age: 60 },
            removeOnFail: { age: 10 * 60 },
          },
        }),
    },
    {
      provide: MONITORING_QUEUE,
      inject: [REDIS_QUEUE_CONNECTION],
      // Jobs do monitoramento carregam só userId e nomes de vazamentos
      useFactory: (connection: Redis) =>
        new Queue(QUEUE_MONITORING, {
          connection,
          defaultJobOptions: {
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: SEVEN_DAYS_S },
          },
        }),
    },
    {
      provide: EMAIL_QUEUE,
      inject: [REDIS_QUEUE_CONNECTION],
      // O e-mail de verificação carrega o token: o job some assim que termina
      useFactory: (connection: Redis) =>
        new Queue(QUEUE_EMAIL, {
          connection,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: { age: SEVEN_DAYS_S },
          },
        }),
    },
    HibpPlanService,
  ],
  exports: [
    REDIS_QUEUE_CONNECTION,
    HIBP_QUEUE,
    MONITORING_QUEUE,
    EMAIL_QUEUE,
    HIBP_CLIENT,
    HIBP_CATALOG_CLIENT,
    HibpPlanService,
  ],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(HIBP_QUEUE) private readonly hibpQueue: Queue,
    @Inject(MONITORING_QUEUE) private readonly monitoringQueue: Queue,
    @Inject(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @Inject(HIBP_CLIENT) private readonly hibpClient: HibpClientLike,
    @Inject(REDIS_QUEUE_CONNECTION) private readonly queueConnection: Redis,
  ) {}

  /**
   * Os workers já fecharam no onModuleDestroy dos próprios módulos.
   * Aqui fecham as filas, o circuit breaker do cliente HIBP e a conexão Redis.
   */
  async onApplicationShutdown(): Promise<void> {
    await closeQuietly('hibp-queue', () => this.hibpQueue.close());
    await closeQuietly('monitoring-queue', () => this.monitoringQueue.close());
    await closeQuietly('email-queue', () => this.emailQueue.close());
    if (typeof this.hibpClient.shutdown === 'function') {
      await closeQuietly('hibp-client', () => this.hibpClient.shutdown!());
    }
    await closeQuietly('redis-queue', () => this.queueConnection.quit());
  }
}
