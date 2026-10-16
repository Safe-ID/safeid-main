import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './services/scan.service';
import { DatabaseModule } from '@infra/database/database.module';
import { BreachesModule } from '../breaches/breaches.module';

@Module({
  imports: [DatabaseModule, BreachesModule],
  controllers: [ScanController],
  providers: [ScanService],
  exports: [ScanService],
})
export class ScanModule {}
