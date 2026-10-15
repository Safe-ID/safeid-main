import { Module, Global, Inject, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { closeQuietly } from '../../shared/utils/shutdown';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        });
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
