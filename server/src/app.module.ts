import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './shared/config/env.validation';

// Module imports
import { HealthModule } from './modules/health/health.module';
import { ScanModule } from './modules/scan/scan.module';
import { AuthModule } from './modules/auth/auth.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';

// Infra modules
import { DatabaseModule } from './infra/database/database.module';
import { CacheModule } from './infra/cache/cache.module';
import { QueueModule } from './infra/queue/queue.module';
import { RateLimitModule } from './infra/rate-limit/rate-limit.module';
import { EmailModule } from './infra/email/email.module';

@Module({
  imports: [
    // Configuration
    // validateEnv só avisa no log sobre segredos faltando ou com valor de exemplo
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
      validate: validateEnv,
    }),

    // Infrastructure
    DatabaseModule,
    CacheModule,
    QueueModule,
    RateLimitModule,
    EmailModule,

    // Domain Modules
    AuthModule,
    ScanModule,
    MonitoringModule,
    HealthModule,
  ],
})
export class AppModule {}
