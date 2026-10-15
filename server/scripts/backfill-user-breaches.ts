/**
 * Backfill da base de vazamentos conhecidos (UserBreach) a partir do histórico de scans.
 * Rodar uma vez depois da migration 20261006000000_email_verification_and_breach_monitoring,
 * antes de ligar o monitoramento. Sem isso, a primeira checagem trataria como "novos"
 * vazamentos que o usuário já viu no painel.
 *
 * Uso (dentro de server/):
 *   npm run backfill:user-breaches -- --dry-run   # só conta, não grava
 *   npm run backfill:user-breaches
 *
 * Precisa das mesmas ENCRYPTION_KEY e EMAIL_HASH_SECRET da aplicação: sem elas o
 * breachData criptografado não abre e o emailHash não bate com o banco.
 *
 * Idempotente: rodar de novo não duplica nada nem muda a data da base já definida.
 */

import { PrismaClient } from '@prisma/client';
import { UserBreachRepository } from '../src/modules/breaches/user-breach.repository';
import { hashEmail } from '../src/shared/crypto/email-hash';
import { openBreachData } from '../src/shared/crypto/breach-data.cipher';
import { extractBreachNames } from '../src/shared/utils/breach-names';
import { log } from '../src/shared/utils/logger';

export interface BackfillOptions {
  batchSize?: number;
  dryRun?: boolean;
  now?: Date;
}

export interface BackfillStats {
  usersScanned: number;
  usersWithBaseline: number;
  usersWithoutScan: number;
  breachesInserted: number;
}

type BackfillPrisma = Pick<PrismaClient, 'user' | 'scanHistory' | 'userBreach'>;

export async function backfillUserBreaches(prisma: BackfillPrisma, options: BackfillOptions = {}): Promise<BackfillStats> {
  const batchSize = options.batchSize ?? 200;
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const repository = UserBreachRepository.fromPrisma(prisma as any);
  const stats: BackfillStats = { usersScanned: 0, usersWithBaseline: 0, usersWithoutScan: 0, breachesInserted: 0 };

  let cursor = 0;
  for (;;) {
    const users = await prisma.user.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, email: true },
    });

    if (users.length === 0) {
      break;
    }

    for (const user of users) {
      stats.usersScanned++;

      // Só scans do email da própria conta: antes da restrição do POST /scan,
      // dava para escanear emails de terceiros, que não podem virar base
      const scan = await prisma.scanHistory.findFirst({
        where: { userId: user.id, emailHash: hashEmail(user.email), breachData: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { breachData: true },
      });

      if (!scan) {
        // breachBaselineAt fica null: a primeira checagem do monitoramento define a base sem notificar
        stats.usersWithoutScan++;
        continue;
      }

      const names = extractBreachNames(openBreachData(scan.breachData));
      stats.usersWithBaseline++;

      if (dryRun) {
        const known = await repository.getKnownNames(user.id);
        stats.breachesInserted += names.filter(name => !known.has(name)).length;
        continue;
      }

      const { inserted } = await repository.recordSeenByUser(user.id, names, 'BASELINE', now);
      stats.breachesInserted += inserted.length;
    }

    cursor = users[users.length - 1].id;
  }

  log('info', 'Backfill', 'backfill.user_breaches.done', { ...stats, dryRun });
  return stats;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();

  try {
    const stats = await backfillUserBreaches(prisma, { dryRun });
    console.log(dryRun ? 'Simulação (nada foi gravado):' : 'Backfill concluído:');
    console.table(stats);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('[Backfill] Falhou:', error);
    process.exit(1);
  });
}
