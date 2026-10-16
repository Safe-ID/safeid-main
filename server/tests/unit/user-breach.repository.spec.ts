import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UserBreachRepository } from '../../src/modules/breaches/user-breach.repository';
import { extractBreachNames } from '../../src/shared/utils/breach-names';
import { hashEmail } from '../../src/shared/crypto/email-hash';
import { createHash, createHmac } from 'crypto';

describe('UserBreachRepository', () => {
  let prisma: any;
  let repository: UserBreachRepository;

  beforeEach(() => {
    prisma = {
      userBreach: {
        findMany: jest.fn(async () => [{ breachName: 'Adobe' }]),
        create: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    repository = new UserBreachRepository(prisma);
  });

  it('returns the known breach names as a set', async () => {
    await expect(repository.getKnownNames(7)).resolves.toEqual(new Set(['Adobe']));
    expect(prisma.userBreach.findMany).toHaveBeenCalledWith({ where: { userId: 7 }, select: { breachName: true } });
  });

  it('inserts only unknown names, once, and returns what was inserted', async () => {
    const inserted = await repository.recordKnown(7, ['Adobe', 'LinkedIn', 'LinkedIn', 'Canva'], 'MONITORING');

    expect(inserted).toEqual(['LinkedIn', 'Canva']);
    expect(prisma.userBreach.create).toHaveBeenCalledTimes(2);
    expect(prisma.userBreach.create).toHaveBeenCalledWith({ data: { userId: 7, breachName: 'LinkedIn', source: 'MONITORING' } });
  });

  it('skips names inserted concurrently by another execution (unique violation)', async () => {
    prisma.userBreach.create
      .mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
      .mockResolvedValueOnce({});

    await expect(repository.recordKnown(7, ['LinkedIn', 'Canva'], 'MONITORING')).resolves.toEqual(['Canva']);
  });

  it('propagates other database errors', async () => {
    prisma.userBreach.create.mockRejectedValueOnce(new Error('connection lost'));

    await expect(repository.recordKnown(7, ['LinkedIn'], 'MANUAL')).rejects.toThrow('connection lost');
  });

  it('defines the baseline only when it is still missing', async () => {
    const now = new Date('2026-10-15T12:00:00.000Z');

    await expect(repository.recordSeenByUser(7, ['LinkedIn'], 'SIGNUP', now)).resolves.toEqual({
      inserted: ['LinkedIn'],
      baselineDefined: true,
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 7, breachBaselineAt: null },
      data: { breachBaselineAt: now },
    });

    prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repository.recordSeenByUser(7, [], 'MANUAL')).resolves.toEqual({ inserted: [], baselineDefined: false });
  });

  it('marks notified breaches and ignores empty lists', async () => {
    const now = new Date('2026-10-15T12:00:00.000Z');

    await repository.markNotified(7, ['LinkedIn'], now);
    await repository.markNotified(7, []);

    expect(prisma.userBreach.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.userBreach.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, breachName: { in: ['LinkedIn'] }, notifiedAt: null },
      data: { notifiedAt: now },
    });
  });

  it('can be built from a plain Prisma client (scripts)', () => {
    expect(UserBreachRepository.fromPrisma(prisma)).toBeInstanceOf(UserBreachRepository);
  });
});

describe('extractBreachNames', () => {
  it.each([
    [[{ Name: 'Adobe' }, { Name: ' LinkedIn ' }, { Name: 'Adobe' }], ['Adobe', 'LinkedIn']],
    [{ breaches: [{ Name: 'Canva' }] }, ['Canva']],
    [{ data: [{ Name: 'Dropbox' }] }, ['Dropbox']],
    [[{ Title: 'no name' }, null, { Name: '' }, { Name: 42 }], []],
    [null, []],
    ['not-a-list', []],
  ])('extracts %j → %j', (input, expected) => {
    expect(extractBreachNames(input)).toEqual(expected);
  });
});

describe('hashEmail', () => {
  it('uses HMAC with EMAIL_HASH_SECRET and SHA-256 without it, on the lowercased e-mail', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const previous = process.env.EMAIL_HASH_SECRET;

    process.env.EMAIL_HASH_SECRET = 'secret';
    expect(hashEmail('User@Example.com')).toBe(createHmac('sha256', 'secret').update('user@example.com').digest('hex'));

    delete process.env.EMAIL_HASH_SECRET;
    expect(hashEmail('User@Example.com')).toBe(createHash('sha256').update('user@example.com').digest('hex'));
    hashEmail('other@example.com');
    expect(warnSpy.mock.calls.filter(call => String(call[0]).includes('EMAIL_HASH_SECRET')).length).toBeLessThanOrEqual(1);

    if (previous === undefined) delete process.env.EMAIL_HASH_SECRET;
    else process.env.EMAIL_HASH_SECRET = previous;
    warnSpy.mockRestore();
  });
});
