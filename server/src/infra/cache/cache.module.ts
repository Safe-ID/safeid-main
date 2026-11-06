import { Module, Global, Inject, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { closeQuietly } from '../../shared/utils/shutdown';
import { logRedisErrors } from './redis-errors';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return logRedisErrors(
          new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
          }),
          'cache',
        );
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class CacheModule implements OnApplicationShutdown {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await closeQuietly('redis-cache', () => this.redis.quit());
  }
}
