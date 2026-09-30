import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Module imports
import { HealthModule } from './modules/health/health.module';
import { ScanModule } from './modules/scan/scan.module';
import { AuthModule } from './modules/auth/auth.module';

// Infra modules
import { DatabaseModule } from './infra/database/database.module';
import { CacheModule } from './infra/cache/cache.module';
import { QueueModule } from './infra/queue/queue.module';
import { RateLimitModule } from './infra/rate-limit/rate-limit.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),

    // Infrastructure
    DatabaseModule,
    CacheModule,
    QueueModule,
    RateLimitModule,

    // Domain Modules
    AuthModule,
    ScanModule,
    HealthModule,
  ],
})
export class AppModule {}
