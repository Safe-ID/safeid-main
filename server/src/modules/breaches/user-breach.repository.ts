import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';

export type UserBreachSource = 'BASELINE' | 'SIGNUP' | 'MANUAL' | 'MONITORING';

type PrismaLike = Pick<PrismaService, 'userBreach' | 'user'>;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/**
 * Vazamentos já conhecidos de cada usuário (UserBreach). É a base para o monitoramento
 * saber o que é novo: só nomes fora desta lista geram notificação.
 */
@Injectable()
export class UserBreachRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Permite usar o repositório fora do Nest (ex.: script de backfill com PrismaClient) */
  static fromPrisma(prisma: PrismaLike): UserBreachRepository {
    return new UserBreachRepository(prisma as PrismaService);
  }

  async getKnownNames(userId: number): Promise<Set<string>> {
    const rows = await this.prisma.userBreach.findMany({
      where: { userId },
      select: { breachName: true },
    });

    return new Set(rows.map(row => row.breachName));
  }

  /**
   * Registra os nomes ainda não conhecidos e devolve só os que foram de fato inseridos.
   * Seguro contra execuções concorrentes: a chave única (userId, breachName) descarta duplicados.
   */
  async recordKnown(userId: number, names: string[], source: UserBreachSource): Promise<string[]> {
    const known = await this.getKnownNames(userId);
    const candidates = Array.from(new Set(names)).filter(name => !known.has(name));
    const inserted: string[] = [];

    for (const breachName of candidates) {
      try {
        await this.prisma.userBreach.create({ data: { userId, breachName, source } });
        inserted.push(breachName);
      } catch (error) {
        // Outra execução registrou o mesmo vazamento entre a leitura e a inserção
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }

    return inserted;
  }

  /**
   * Registra os vazamentos vistos pelo usuário (cadastro, scan manual, backfill) e marca
   * a base como definida, se ainda não estava. Nunca notifica: o usuário já viu esses vazamentos.
   */
  async recordSeenByUser(
    userId: number,
    names: string[],
    source: UserBreachSource,
    now = new Date(),
  ): Promise<{ inserted: string[]; baselineDefined: boolean }> {
    const inserted = await this.recordKnown(userId, names, source);

    const baseline = await this.prisma.user.updateMany({
      where: { id: userId, breachBaselineAt: null },
      data: { breachBaselineAt: now },
    });

    return { inserted, baselineDefined: baseline.count > 0 };
  }

  /**
   * Vazamentos achados pelo monitoramento que ainda não viraram notificação.
   * Inclui os de uma execução anterior que falhou entre o registro e o aviso.
   */
  async getPendingNotification(userId: number): Promise<string[]> {
    const rows = await this.prisma.userBreach.findMany({
      where: { userId, source: 'MONITORING', notifiedAt: null },
      orderBy: { firstSeenAt: 'asc' },
      select: { breachName: true },
    });

    return rows.map(row => row.breachName);
  }

  async markNotified(userId: number, names: string[], now = new Date()): Promise<void> {
    if (names.length === 0) {
      return;
    }

    await this.prisma.userBreach.updateMany({
      where: { userId, breachName: { in: names }, notifiedAt: null },
      data: { notifiedAt: now },
    });
  }
}
