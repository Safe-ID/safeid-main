import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infra/database/database.module';
import { CacheModule } from '@infra/cache/cache.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// Usa o PrismaService do DatabaseModule em vez de criar outra conexão com o banco
@Module({
  imports: [DatabaseModule, CacheModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
