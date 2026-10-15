import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import {
  JOB_CATALOG_PROBE,
  JOB_CATALOG_SYNC,
  QUEUE_MONITORING,
} from '../../../infra/queue/queue.constants';
import { createBullConnection } from '../../../infra/queue/redis-connection';
import { runsWorkers } from '../../../shared/config/app-role';
import { log } from '../../../shared/utils/logger';
import { closeQuietly } from '../../../shared/utils/shutdown';
import { CatalogMonitorService, CatalogSyncOrigin } from '../services/catalog-monitor.service';

const MONITORING_CONCURRENCY = 2;

/**
 * Worker da fila monitoring. Na F3 trata o catálogo (probe e sync);
 * varreduras, reprocessamento, limpeza e reconciliação entram na F4.
 */
@Injectable()
export class MonitoringProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private connection: Redis | null = null;

  constructor(private readonly catalogMonitor: CatalogMonitorService) {}

  onModuleInit(): void {
    if (!runsWorkers()) {
      log('info', 'MonitoringProcessor', 'worker.disabled', { queue: QUEUE_MONITORING, reason: 'APP_ROLE=api' });
      return;
    }

    this.connection = createBullConnection();
    this.worker = new Worker(QUEUE_MONITORING, (job: Job) => this.process(job), {
      connection: this.connection,
      concurrency: MONITORING_CONCURRENCY,
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      log('warn', 'MonitoringProcessor', 'monitoring.job_failed', {
        job: job?.name,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err: error,
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    const connection = this.connection;
    this.worker = null;
    this.connection = null;

    if (worker) {
      await closeQuietly('monitoring-worker', () => worker.close());
    }
    if (connection) {
      await closeQuietly('redis-monitoring-worker', () => connection.quit());
    }
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB_CATALOG_PROBE:
        return this.catalogMonitor.handleCatalogProbe();
      case JOB_CATALOG_SYNC:
        return this.catalogMonitor.handleCatalogSync((job.data?.origin as CatalogSyncOrigin) || 'cron');
      default:
        throw new Error(`Unknown job '${job.name}' in queue ${QUEUE_MONITORING}`);
    }
  }
}
