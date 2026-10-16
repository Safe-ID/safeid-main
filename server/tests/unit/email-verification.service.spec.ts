import { BadRequestException, GoneException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'crypto';
import { EmailVerificationService } from '../../src/modules/auth/email-verification.service';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('EmailVerificationService', () => {
  let prisma: any;
  let tx: any;
  let redis: any;
  let emailQueue: any;
  let service: EmailVerificationService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    delete process.env.EMAIL_VERIFICATION_TTL_HOURS;
    delete process.env.UNVERIFIED_ACCOUNT_TTL_DAYS;

    tx = {
      emailVerificationToken: { updateMany: jest.fn(async () => ({ count: 1 })) },
      user: {
        findUniqueOrThrow: jest.fn(async () => ({ id: 7, email: 'user@example.com', emailVerifiedAt: null })),
        update: jest.fn(async () => ({ id: 7, email: 'user@example.com', emailVerifiedAt: new Date() })),
      },
    };

    prisma = {
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
      emailVerificationToken: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async (args: any) => args.data),
        findUnique: jest.fn(),
        deleteMany: jest.fn(async () => ({ count: 4 })),
      },
      user: { deleteMany: jest.fn(async () => ({ count: 2 })) },
    };

    const store = new Map<string, number>();
    redis = {
      set: jest.fn(async (key: string) => {
        if (store.has(key)) return null;
        store.set(key, 1);
        return 'OK';
      }),
      incr: jest.fn(async (key: string) => {
        const next = (store.get(key) ?? 0) + 1;
        store.set(key, next);
        return next;
      }),
      expire: jest.fn(async () => 1),
      store,
    };

    emailQueue = { add: jest.fn(async () => ({ id: 'job-1' })) };
    service = new EmailVerificationService(prisma, redis, emailQueue);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('issueToken', () => {
    it('stores only the SHA-256 of a 43-char base64url token and invalidates the previous ones', async () => {
      const token = await service.issueToken(7);

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 7, usedAt: null },
        data: { usedAt: new Date('2026-10-15T12:00:00.000Z') },
      });
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          userId: 7,
          tokenHash: sha256(token),
          expiresAt: new Date('2026-10-16T12:00:00.000Z'),
        },
      });
      expect(JSON.stringify(prisma.emailVerificationToken.create.mock.calls)).not.toContain(token);
    });

    it('uses EMAIL_VERIFICATION_TTL_HOURS for the expiration', async () => {
      process.env.EMAIL_VERIFICATION_TTL_HOURS = '2';
      await service.issueToken(7);

      expect(prisma.emailVerificationToken.create.mock.calls[0][0].data.expiresAt).toEqual(
        new Date('2026-10-15T14:00:00.000Z'),
      );
    });
  });

  it('enqueues the verification e-mail with the token and retries', async () => {
    await service.sendVerificationEmail(7);

    const [name, data, options] = emailQueue.add.mock.calls[0];
    expect(name).toBe('send-verification-email');
    expect(data).toEqual({ userId: 7, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(options).toEqual({ attempts: 5, backoff: { type: 'exponential', delay: 30000 } });
  });

  describe('consumeToken', () => {
    const validRecord = (overrides: Record<string, unknown> = {}) => ({
      id: 3,
      userId: 7,
      tokenHash: sha256('valid-token'),
      expiresAt: new Date('2026-10-16T00:00:00.000Z'),
      usedAt: null,
      ...overrides,
    });

    it('marks the token as used and the e-mail as verified', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validRecord());

      await expect(service.consumeToken('valid-token')).resolves.toMatchObject({ id: 7, email: 'user@example.com' });

      expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('valid-token') } });
      expect(tx.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { id: 3, usedAt: null },
        data: { usedAt: new Date('2026-10-15T12:00:00.000Z') },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { emailVerifiedAt: new Date('2026-10-15T12:00:00.000Z') },
      });
    });

    it('keeps the original verification date for an already verified user', async () => {
      const originalDate = new Date('2026-01-01T00:00:00.000Z');
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validRecord());
      tx.user.findUniqueOrThrow.mockResolvedValue({ id: 7, email: 'user@example.com', emailVerifiedAt: originalDate });

      await expect(service.consumeToken('valid-token')).resolves.toMatchObject({ emailVerifiedAt: originalDate });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('answers 400 TOKEN_INVALID for unknown tokens', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      const error = await service.consumeToken('unknown').catch(err => err);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: 'TOKEN_INVALID' });

      await expect(service.consumeToken(undefined as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      ['used', { usedAt: new Date('2026-10-15T11:00:00.000Z') }],
      ['expired', { expiresAt: new Date('2026-10-15T11:59:59.000Z') }],
    ])('answers 410 TOKEN_EXPIRED for %s tokens', async (_label, overrides) => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validRecord(overrides));

      const error = await service.consumeToken('valid-token').catch(err => err);
      expect(error).toBeInstanceOf(GoneException);
      expect(error.getResponse()).toMatchObject({ code: 'TOKEN_EXPIRED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not verify twice when two requests race with the same token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validRecord());
      tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.consumeToken('valid-token')).rejects.toBeInstanceOf(GoneException);
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });

  describe('canResend', () => {
    it('allows one e-mail per minute', async () => {
      await expect(service.canResend('User@Example.com')).resolves.toBe(true);
      await expect(service.canResend('user@example.com')).resolves.toBe(false);

      const key = sha256('user@example.com');
      expect(redis.set).toHaveBeenCalledWith(`verify:resend:${key}`, '1', 'EX', 60, 'NX');
      expect(redis.expire).toHaveBeenCalledWith(`verify:resend:day:${key}`, 86400);
    });

    it('allows at most five e-mails per day', async () => {
      const results: boolean[] = [];
      for (let i = 0; i < 6; i++) {
        // Simula o fim do cooldown de 60 s entre as tentativas
        redis.store.delete(`verify:resend:${sha256('user@example.com')}`);
        results.push(await service.canResend('user@example.com'));
      }

      expect(results).toEqual([true, true, true, true, true, false]);
      expect(redis.expire).toHaveBeenCalledTimes(1);
    });
  });

  it('deletes stale unverified password accounts and old tokens', async () => {
    process.env.UNVERIFIED_ACCOUNT_TTL_DAYS = '3';

    await expect(service.cleanupUnverified()).resolves.toEqual({ users: 2, tokens: 4 });

    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: {
        emailVerifiedAt: null,
        googleId: null,
        createdAt: { lt: new Date('2026-10-12T12:00:00.000Z') },
      },
    });
    expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date('2026-10-08T12:00:00.000Z') } },
    });

    delete process.env.UNVERIFIED_ACCOUNT_TTL_DAYS;
    await service.cleanupUnverified();
    expect(prisma.user.deleteMany.mock.calls[1][0].where.createdAt).toEqual({ lt: new Date('2026-10-08T12:00:00.000Z') });
  });
});
