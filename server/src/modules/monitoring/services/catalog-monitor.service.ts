import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { HibpCatalogClientLike } from '../../../infra/http/hibp.types';
import {
  HIBP_CATALOG_CLIENT,
  JOB_CATALOG_SYNC,
  JOB_MONITOR_SWEEP,
  MONITORING_QUEUE,
} from '../../../infra/queue/queue.constants';
import { log } from '../../../shared/utils/logger';
import { formatHourKey, toJobIdPart } from '../../../shared/utils/time';
import { BreachCatalogService, isRelevantBreach } from './breach-catalog.service';

export const CATALOG_LATEST_NAME_KEY = 'monitoring:catalog:latestName';
export const CATALOG_LAST_PROBE_KEY = 'monitoring:catalog:lastProbeAt';

export type CatalogSyncOrigin = 'cron' | 'probe' | 'reconcile';

export interface CatalogSyncJobResult {
  total: number;
  changed: number;
  firstSync: boolean;
  sweepEnqueued: boolean;
}

/**
 * Detecção de vazamentos novos no catálogo da HIBP (orientada a eventos):
 * - catalog-probe (de hora em hora): olha só o último vazamento publicado e dispara um sync se mudou
 * - catalog-sync (6 em 6 h ou pelo probe): diff completo; se algo relevante mudou, dispara a varredura
 */
@Injectable()
export class CatalogMonitorService {
  constructor(
    private readonly catalog: BreachCatalogService,
    @Inject(HIBP_CATALOG_CLIENT) private readonly catalogClient: HibpCatalogClientLike,
    @Inject(MONITORING_QUEUE) private readonly monitoringQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /**
   * T3.2: no primeiro sync só popula o banco. Depois, qualquer vazamento novo ou alterado
   * que possa aparecer na consulta de um email dispara a varredura dos usuários.
   */
  async handleCatalogSync(origin: CatalogSyncOrigin = 'cron', now = new Date()): Promise<CatalogSyncJobResult> {
    const result = await this.catalog.sync(now);
    const relevant = result.changed.filter(isRelevantBreach);
    const shouldSweep = !result.firstSync && relevant.length > 0;

    if (shouldSweep) {
      const reason = 'CATALOG_CHANGE';
      const breachNames = relevant.map(breach => breach.Name);
      // A mesma mudança (ex.: sync repetido) gera uma varredura só; uma mudança diferente
      // na mesma hora gera outra. O dedup por usuário do monitor-check evita checagens duplicadas.
      const changeKey = createHash('sha256').update([...breachNames].sort().join('|')).digest('hex').slice(0, 12);
      await this.monitoringQueue.add(
        JOB_MONITOR_SWEEP,
        { reason, breachNames },
        { jobId: `sweep-${reason}-${formatHourKey(now)}-${changeKey}` },
      );
    }

    log('info', 'CatalogMonitor', 'catalog.sync.handled', {
      origin,
      changed: result.changed.length,
      relevant: relevant.length,
      firstSync: result.firstSync,
      sweepEnqueued: shouldSweep,
    });

    return {
      total: result.total,
      changed: result.changed.length,
      firstSync: result.firstSync,
      sweepEnqueued: shouldSweep,
    };
  }

  /**
   * T3.3: GET /latestbreach é pequeno e não gasta cota. Se o último vazamento publicado mudou,
   * antecipa o sync (senão a detecção esperaria até 6 h). Só enxerga inclusões; alterações em
   * vazamentos existentes ficam com o sync de 6 em 6 h.
   */
  async handleCatalogProbe(now = new Date()): Promise<{ latestName: string | null; syncEnqueued: boolean }> {
    const latest = await this.catalogClient.getLatestBreach();
    await this.redis.set(CATALOG_LAST_PROBE_KEY, now.toISOString());

    if (!latest?.Name) {
      return { latestName: null, syncEnqueued: false };
    }

    const previous = await this.redis.get(CATALOG_LATEST_NAME_KEY);
    if (latest.Name === previous) {
      return { latestName: latest.Name, syncEnqueued: false };
    }

    await this.redis.set(CATALOG_LATEST_NAME_KEY, latest.Name);

    // Primeira execução: só guarda o nome atual como referência
    if (previous === null) {
      return { latestName: latest.Name, syncEnqueued: false };
    }

    await this.monitoringQueue.add(
      JOB_CATALOG_SYNC,
      { origin: 'probe' },
      {
        jobId: `catalog-sync-probe-${toJobIdPart(latest.Name)}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );

    log('info', 'CatalogMonitor', 'catalog.probe.changed', { previous, latest: latest.Name });
    return { latestName: latest.Name, syncEnqueued: true };
  }
}
