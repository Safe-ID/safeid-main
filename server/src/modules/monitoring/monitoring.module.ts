import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/database/database.module';
import { HibpProcessor } from './processors/hibp.processor';
import { MonitoringProcessor } from './processors/monitoring.processor';
import { BreachCatalogService } from './services/breach-catalog.service';
import { CatalogMonitorService } from './services/catalog-monitor.service';

/**
 * Monitoramento contínuo de vazamentos: worker da HIBP (F0) e catálogo (F3).
 * Varreduras, reprocessamento e agendamentos entram na F4.
 */
@Module({
  imports: [DatabaseModule],
  providers: [HibpProcessor, MonitoringProcessor, BreachCatalogService, CatalogMonitorService],
  exports: [HibpProcessor, BreachCatalogService],
})
export class MonitoringModule {}
