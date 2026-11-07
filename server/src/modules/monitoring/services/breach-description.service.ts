import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service';
import { DescriptionTranslator } from '../../../core/engines/description-translator';
import { DescriptionSegment, parseBreachDescription, safeHref } from '../../../shared/utils/breach-description';
import { log } from '../../../shared/utils/logger';

const DEFAULT_BATCH = 40;

export interface BreachDescription {
  segments: DescriptionSegment[];
  /** pt: traduzida pela IA; en: texto original da HIBP */
  lang: 'pt' | 'en';
}

export interface TranslationRunResult {
  translated: number;
  failed: number;
  remaining: number;
  skipped?: 'not_configured';
}

/**
 * Descrições dos vazamentos (Description da HIBP) para o painel.
 * O job traduz em lotes os vazamentos não sensíveis do catálogo público; nenhum dado de usuário
 * vai para a IA. Sensíveis e traduções que falharam ficam no original em inglês.
 */
@Injectable()
export class BreachDescriptionService {
  private readonly translator = new DescriptionTranslator(process.env.AI_API_KEY || '');

  constructor(private readonly prisma: PrismaService) {}

  /** Pendentes: nunca traduzidos ou alterados pela HIBP depois da última tentativa */
  private pendingWhere(): Prisma.BreachCatalogWhereInput {
    return {
      isSensitive: false,
      OR: [
        { descriptionPtFrom: null },
        { descriptionPtFrom: { lt: this.prisma.breachCatalog.fields.modifiedDate } },
      ],
    };
  }

  async translatePending(limit = Number(process.env.BREACH_TRANSLATE_BATCH) || DEFAULT_BATCH): Promise<TranslationRunResult> {
    if (!this.translator.enabled) {
      log('info', 'BreachDescription', 'breach.translation_skipped', { reason: 'not_configured' });
      return { translated: 0, failed: 0, remaining: 0, skipped: 'not_configured' };
    }

    // Mais recentes primeiro: são os que mais aparecem nos alertas novos
    const rows = await this.prisma.breachCatalog.findMany({
      where: this.pendingWhere(),
      orderBy: { addedDate: 'desc' },
      take: limit,
      select: { name: true, raw: true, modifiedDate: true },
    });

    let translated = 0;
    let failed = 0;
    for (const row of rows) {
      const html = (row.raw as { Description?: unknown } | null)?.Description;
      const result = typeof html === 'string' ? await this.translator.translate(html) : null;

      if (result?.ok) {
        translated++;
      } else {
        failed++;
        log('warn', 'BreachDescription', 'breach.translation_failed', {
          name: row.name,
          reason: result ? result.reason : 'empty',
        });
      }

      // Falha também marca a versão: fica em inglês até a HIBP editar o texto, sem retentar toda hora
      await this.prisma.breachCatalog.update({
        where: { name: row.name },
        data: {
          descriptionPt: result?.ok ? (result.segments as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          descriptionPtFrom: row.modifiedDate,
        },
      });
    }

    const remaining = await this.prisma.breachCatalog.count({ where: this.pendingWhere() });
    log('info', 'BreachDescription', 'breach.translation_done', { translated, failed, remaining });
    return { translated, failed, remaining };
  }

  /** Descrições por nome de vazamento; nomes fora do catálogo ficam de fora */
  async getDescriptions(names: string[]): Promise<Record<string, BreachDescription>> {
    if (names.length === 0) return {};

    const rows = await this.prisma.breachCatalog.findMany({
      where: { name: { in: names } },
      select: { name: true, raw: true, modifiedDate: true, descriptionPt: true, descriptionPtFrom: true },
    });

    const result: Record<string, BreachDescription> = {};
    for (const row of rows) {
      const current = row.descriptionPtFrom !== null && row.descriptionPtFrom.getTime() >= row.modifiedDate.getTime();
      const translated = current && Array.isArray(row.descriptionPt) && row.descriptionPt.length > 0;
      if (translated) {
        // Já guardado como trechos; passa de novo pelo conversor por garantia (links, tipos)
        result[row.name] = { segments: this.revalidate(row.descriptionPt as unknown as DescriptionSegment[]), lang: 'pt' };
      } else {
        result[row.name] = {
          segments: parseBreachDescription((row.raw as { Description?: unknown } | null)?.Description),
          lang: 'en',
        };
      }
    }
    return result;
  }

  private revalidate(segments: DescriptionSegment[]): DescriptionSegment[] {
    return segments
      .filter(segment => segment && typeof segment.text === 'string' && segment.text !== '')
      .map(segment => {
        const clean: DescriptionSegment = { text: segment.text };
        const href = safeHref(segment.href);
        if (href) clean.href = href;
        if (segment.em === true) clean.em = true;
        if (segment.strong === true) clean.strong = true;
        return clean;
      });
  }
}
