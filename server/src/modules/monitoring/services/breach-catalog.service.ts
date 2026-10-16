import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../../infra/database/prisma.service';
import { HibpBreach, HibpCatalogClientLike } from '../../../infra/http/hibp.types';
import { HIBP_CATALOG_CLIENT } from '../../../infra/queue/queue.constants';
import { log } from '../../../shared/utils/logger';

export const CATALOG_LAST_SYNC_KEY = 'monitoring:catalog:lastSyncAt';

const UPSERT_BATCH_SIZE = 100;

/** catalog_sync_state tem uma linha só */
const SYNC_STATE_ID = 1;

export interface CatalogSyncResult {
  total: number;
  /** Vazamentos novos ou com ModifiedDate mais recente que o do banco */
  changed: HibpBreach[];
  /**
   * true quando nenhum catalog-sync terminou antes: só popula, sem disparar varredura.
   * Não olha o breach_catalog, onde o getByNames também grava linhas fora do sync.
   */
  firstSync: boolean;
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Vazamentos que podem aparecer na consulta de um email. Sensíveis e retirados
 * nunca aparecem na API pública, então não justificam varrer os usuários.
 */
export function isRelevantBreach(breach: Pick<HibpBreach, 'IsSensitive' | 'IsRetired'>): boolean {
  return !breach.IsSensitive && !breach.IsRetired;
}

function toCatalogRow(breach: HibpBreach, fallbackDate: Date): Prisma.BreachCatalogCreateInput {
  const addedDate = toDate(breach.AddedDate) ?? fallbackDate;

  return {
    name: breach.Name,
    title: breach.Title || breach.Name,
    domain: breach.Domain || null,
    breachDate: toDate(breach.BreachDate),
    addedDate,
    modifiedDate: toDate(breach.ModifiedDate) ?? addedDate,
    pwnCount: BigInt(Math.max(0, Math.floor(Number(breach.PwnCount) || 0))),
    dataClasses: Array.isArray(breach.DataClasses) ? breach.DataClasses : [],
    isVerified: Boolean(breach.IsVerified),
    isFabricated: Boolean(breach.IsFabricated),
    isSensitive: Boolean(breach.IsSensitive),
    isRetired: Boolean(breach.IsRetired),
    isSpamList: Boolean(breach.IsSpamList),
    isMalware: Boolean(breach.IsMalware),
    isStealerLog: Boolean(breach.IsStealerLog),
    raw: breach as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Cópia local do catálogo público da HIBP (GET /breaches, sem chave e fora da cota).
 * Detecta vazamentos novos ou alterados comparando o ModifiedDate.
 */
@Injectable()
export class BreachCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(HIBP_CATALOG_CLIENT) private readonly catalogClient: HibpCatalogClientLike,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async sync(now = new Date()): Promise<CatalogSyncResult> {
    const breaches = (await this.catalogClient.getAllBreaches()).filter(breach => breach?.Name);

    const existingRows = await this.prisma.breachCatalog.findMany({
      select: { name: true, modifiedDate: true },
    });
    const existing = new Map(existingRows.map(row => [row.name, row.modifiedDate.getTime()]));
    const previousSync = await this.prisma.catalogSyncState.findUnique({ where: { id: SYNC_STATE_ID } });
    const firstSync = previousSync === null;

    const changed = breaches.filter(breach => {
      const known = existing.get(breach.Name);
      if (known === undefined) {
        return true;
      }
      const modified = toDate(breach.ModifiedDate) ?? toDate(breach.AddedDate);
      return modified !== null && modified.getTime() > known;
    });

    for (let i = 0; i < changed.length; i += UPSERT_BATCH_SIZE) {
      const batch = changed.slice(i, i + UPSERT_BATCH_SIZE);
      await this.prisma.$transaction(batch.map(breach => this.upsertOperation(breach, now)));
    }

    const state = { lastSyncAt: now, total: breaches.length };
    await this.prisma.catalogSyncState.upsert({
      where: { id: SYNC_STATE_ID },
      create: { id: SYNC_STATE_ID, ...state },
      update: state,
    });
    await this.redis.set(CATALOG_LAST_SYNC_KEY, now.toISOString());

    log('info', 'BreachCatalog', 'catalog.sync.done', {
      total: breaches.length,
      changed: changed.length,
      firstSync,
    });

    return { total: breaches.length, changed, firstSync };
  }

  /**
   * Vazamentos completos (formato da HIBP) para o RiskEngine/AIEngine, na ordem pedida.
   * Nomes fora do banco são buscados na HIBP e gravados; nomes que nem a HIBP conhece são ignorados.
   */
  async getByNames(names: string[], now = new Date()): Promise<HibpBreach[]> {
    const uniqueNames = Array.from(new Set(names));
    if (uniqueNames.length === 0) {
      return [];
    }

    const rows = await this.prisma.breachCatalog.findMany({
      where: { name: { in: uniqueNames } },
      select: { name: true, raw: true },
    });
    const byName = new Map(rows.map(row => [row.name, row.raw as unknown as HibpBreach]));

    for (const name of uniqueNames.filter(item => !byName.has(item))) {
      const breach = await this.catalogClient.getBreach(name);
      if (!breach) {
        log('warn', 'BreachCatalog', 'catalog.breach_not_found', { name });
        continue;
      }
      await this.upsertOperation(breach, now);
      byName.set(name, breach);
    }

    return uniqueNames.filter(name => byName.has(name)).map(name => byName.get(name)!);
  }

  async getLastSyncAt(): Promise<Date | null> {
    const cached = await this.redis.get(CATALOG_LAST_SYNC_KEY);
    if (cached) {
      return toDate(cached);
    }

    // Redis sem o valor (ex.: reinício do nó): o banco é a fonte da verdade.
    // Não usa o syncedAt do breach_catalog, que o getByNames também atualiza.
    const state = await this.prisma.catalogSyncState.findUnique({ where: { id: SYNC_STATE_ID } });
    return state?.lastSyncAt ?? null;
  }

  private upsertOperation(breach: HibpBreach, now: Date) {
    const row = toCatalogRow(breach, now);
    const { name, ...update } = row;
    return this.prisma.breachCatalog.upsert({
      where: { name },
      create: row,
      update,
    });
  }
}
