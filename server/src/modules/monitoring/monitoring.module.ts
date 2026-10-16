import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/database/database.module';
import { HibpProcessor } from './processors/hibp.processor';
import { MonitoringProcessor } from './processors/monitoring.processor';
import { BreachCatalogService } from './services/breach-catalog.service';
import { CatalogMonitorService } from './services/catalog-monitor.service';
import { MonitoringService } from './services/monitoring.service';
import { MonitoringReconcileService } from './services/monitoring-reconcile.service';
import { MonitoringSchedulerService } from './services/monitoring-scheduler.service';
import { MonitoringPreferencesService } from './services/monitoring-preferences.service';
import { MonitoringController } from './monitoring.controller';
import { JobsHealthController } from './jobs-health.controller';
import { JobsHealthService } from './services/jobs-health.service';
import { ScanModule } from '../scan/scan.module';
import { BreachesModule } from '../breaches/breaches.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Monitoramento contínuo de vazamentos: worker da HIBP, catálogo, varreduras,
 * reprocessamento, agendamentos (com watchdog) e reconciliação.
 */
@Module({
  imports: [DatabaseModule, ScanModule, BreachesModule, NotificationsModule, AuthModule],
  controllers: [MonitoringController, JobsHealthController],
  providers: [
    HibpProcessor,
    MonitoringProcessor,
    BreachCatalogService,
    CatalogMonitorService,
    MonitoringService,
    MonitoringReconcileService,
    MonitoringSchedulerService,
    MonitoringPreferencesService,
    JobsHealthService,
  ],
  exports: [HibpProcessor, BreachCatalogService, MonitoringService],
})
export class MonitoringModule {}
