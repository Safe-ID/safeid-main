import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { randomBytes } from 'crypto';
import { backfillUserBreaches } from '../../scripts/backfill-user-breaches';
import { hashEmail } from '../../src/shared/crypto/email-hash';
import { sealBreachData } from '../../src/shared/crypto/breach-data.cipher';

type Row = Record<string, any>;

/**
 * Prisma em memória com o que o backfill usa
 */
function createPrisma(users: Row[], scans: Row[]) {
  const userBreaches: Row[] = [];

  return {
    users,
    userBreaches,
    user: {
      findMany: jest.fn(async ({ where, take }: any) =>
        users
          .filter(user => user.id > where.id.gt)
          .sort((a, b) => a.id - b.id)
          .slice(0, take)
          .map(user => ({ id: user.id, email: user.email })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const found = users.filter(user => user.id === where.id && user.breachBaselineAt === null);
        found.forEach(user => Object.assign(user, data));
        return { count: found.length };
      }),
    },
    scanHistory: {
      findFirst: jest.fn(async ({ where }: any) => {
        const found = scans
          .filter(scan => scan.userId === where.userId && scan.emailHash === where.emailHash && scan.breachData !== null)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return found[0] ? { breachData: found[0].breachData } : null;
      }),
    },
    userBreach: {
      findMany: jest.fn(async ({ where }: any) =>
        userBreaches.filter(row => row.userId === where.userId).map(row => ({ breachName: row.breachName })),
      ),
      create: jest.fn(async ({ data }: any) => {
        if (userBreaches.some(row => row.userId === data.userId && row.breachName === data.breachName)) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        userBreaches.push({ ...data });
        return data;
      }),
    },
  };
}

describe('backfillUserBreaches', () => {
  const now = new Date('2026-10-15T12:00:00.000Z');
  const savedKey = process.env.ENCRYPTION_KEY;
  const savedSecret = process.env.EMAIL_HASH_SECRET;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.EMAIL_HASH_SECRET = 'hash-secret';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
    if (savedSecret === undefined) delete process.env.EMAIL_HASH_SECRET;
    else process.env.EMAIL_HASH_SECRET = savedSecret;
    jest.restoreAllMocks();
  });

  function scenario() {
    const users = [
      { id: 1, email: 'alice@example.com', breachBaselineAt: null },
      { id: 2, email: 'bob@example.com', breachBaselineAt: null },
      { id: 3, email: 'carol@example.com', breachBaselineAt: null },
      { id: 4, email: 'dave@example.com', breachBaselineAt: null },
    ];
    const scans = [
      // Alice: scan antigo e scan recente (criptografado); vale o mais recente
      {
        userId: 1,
        emailHash: hashEmail('alice@example.com'),
        breachData: sealBreachData([{ Name: 'Old' }]),
        createdAt: new Date('2026-01-01'),
      },
      {
        userId: 1,
        emailHash: hashEmail('alice@example.com'),
        breachData: sealBreachData([{ Name: 'Adobe' }, { Name: 'LinkedIn' }]),
        createdAt: new Date('2026-09-01'),
      },
      // Bob escaneou o email de outra pessoa antes da restrição do POST /scan: não vira base
      {
        userId: 2,
        emailHash: hashEmail('someone-else@example.com'),
        breachData: sealBreachData([{ Name: 'NotBobs' }]),
        createdAt: new Date('2026-08-01'),
      },
      // Carol: scan limpo, gravado em JSON antes da criptografia existir
      {
        userId: 3,
        emailHash: hashEmail('carol@example.com'),
        breachData: JSON.stringify([]),
        createdAt: new Date('2026-07-01'),
      },
      // Dave: só o snapshot de fallback, sem breachData
      { userId: 4, emailHash: hashEmail('dave@example.com'), breachData: null, createdAt: new Date('2026-07-01') },
    ];
    return createPrisma(users, scans);
  }

  it('defines the baseline from the latest scan of the account e-mail', async () => {
    const prisma = scenario();

    const stats = await backfillUserBreaches(prisma as any, { batchSize: 2, now });

    expect(stats).toEqual({ usersScanned: 4, usersWithBaseline: 2, usersWithoutScan: 2, breachesInserted: 2 });
    expect(prisma.userBreaches).toEqual([
      { userId: 1, breachName: 'Adobe', source: 'BASELINE' },
      { userId: 1, breachName: 'LinkedIn', source: 'BASELINE' },
    ]);
    // Alice e Carol (scan limpo também é base); Bob e Dave ficam para a 1ª checagem do monitoramento
    expect(prisma.users.map(user => user.breachBaselineAt)).toEqual([now, null, now, null]);
    // Paginou em lotes de 2
    expect(prisma.user.findMany).toHaveBeenCalledTimes(3);
  });

  it('is idempotent: a second run inserts nothing and keeps the baseline date', async () => {
    const prisma = scenario();
    await backfillUserBreaches(prisma as any, { now });

    const later = new Date('2026-10-16T12:00:00.000Z');
    const stats = await backfillUserBreaches(prisma as any, { now: later });

    expect(stats.breachesInserted).toBe(0);
    expect(prisma.userBreaches).toHaveLength(2);
    expect(prisma.users[0].breachBaselineAt).toEqual(now);
  });

  it('only counts in dry-run mode', async () => {
    const prisma = scenario();

    const stats = await backfillUserBreaches(prisma as any, { dryRun: true });

    expect(stats).toEqual({ usersScanned: 4, usersWithBaseline: 2, usersWithoutScan: 2, breachesInserted: 2 });
    expect(prisma.userBreaches).toHaveLength(0);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('handles an empty database', async () => {
    await expect(backfillUserBreaches(createPrisma([], []) as any)).resolves.toEqual({
      usersScanned: 0,
      usersWithBaseline: 0,
      usersWithoutScan: 0,
      breachesInserted: 0,
    });
  });
});
