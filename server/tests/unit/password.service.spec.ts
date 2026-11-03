import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { PasswordService } from '../../src/modules/auth/password.service';
import { isIssuedAfterPasswordChange } from '../../src/shared/utils/session-validity';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('PasswordService', () => {
  const now = Date.now();
  let prisma: any;
  let redis: any;
  let queue: any;
  let service: PasswordService;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
      passwordResetToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async () => ({})),
      },
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    redis = { set: jest.fn(async () => 'OK'), incr: jest.fn(async () => 1), expire: jest.fn(async () => 1) };
    queue = { add: jest.fn(async () => ({})) };
    service = new PasswordService(prisma, redis, queue);
  });

  describe('requestReset', () => {
    const generic = { message: 'Se houver uma conta com este email, enviamos um link para criar uma nova senha.' };

    it('stores only the token hash and queues the e-mail without keeping the token', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7, emailVerifiedAt: new Date() });

      await expect(service.requestReset(' Owner@Example.com ')).resolves.toEqual(generic);

      expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({ email: 'owner@example.com' });
      const [jobName, jobData, jobOptions] = queue.add.mock.calls[0];
      expect(jobName).toBe('send-password-reset');
      expect(jobData.userId).toBe(7);
      expect(jobOptions).toMatchObject({ removeOnComplete: true, removeOnFail: true });
      const created = prisma.passwordResetToken.create.mock.calls[0][0].data;
      expect(created.tokenHash).toBe(sha256(jobData.token));
      expect(created.tokenHash).not.toBe(jobData.token);
      expect(created.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
      // Um link novo invalida os anteriores
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 7, usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('answers the same and sends nothing for unknown or unverified accounts', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.requestReset('ghost@example.com')).resolves.toEqual(generic);

      prisma.user.findUnique.mockResolvedValueOnce({ id: 8, emailVerifiedAt: null });
      await expect(service.requestReset('unverified@example.com')).resolves.toEqual(generic);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('respects the cooldown and the daily limit, still answering the same', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7, emailVerifiedAt: new Date() });

      redis.set.mockResolvedValueOnce(null);
      await expect(service.requestReset('owner@example.com')).resolves.toEqual(generic);

      redis.incr.mockResolvedValueOnce(6);
      await expect(service.requestReset('owner@example.com')).resolves.toEqual(generic);

      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const valid = { id: 1, userId: 7, usedAt: null, expiresAt: new Date(now + 60_000) };

    it('changes the password, marks the session cut-off and warns the owner', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);

      await expect(service.resetPassword('tok', 'NovaSenha123')).resolves.toMatchObject({ message: expect.any(String) });

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('tok') } });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(await bcrypt.compare('NovaSenha123', data.passwordHash)).toBe(true);
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
      expect(queue.add).toHaveBeenCalledWith('send-password-changed', { userId: 7 }, expect.any(Object));
    });

    it('rejects unknown, used and expired tokens with distinct codes', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce(null);
      await expect(service.resetPassword('x', 'NovaSenha123')).rejects.toMatchObject({ response: { code: 'TOKEN_INVALID' } });

      prisma.passwordResetToken.findUnique.mockResolvedValueOnce({ ...valid, usedAt: new Date() });
      await expect(service.resetPassword('x', 'NovaSenha123')).rejects.toMatchObject({ response: { code: 'TOKEN_EXPIRED' } });

      prisma.passwordResetToken.findUnique.mockResolvedValueOnce({ ...valid, expiresAt: new Date(now - 1) });
      await expect(service.resetPassword('x', 'NovaSenha123')).rejects.toMatchObject({ response: { code: 'TOKEN_EXPIRED' } });

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not change the password twice when two requests race with the same token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.resetPassword('tok', 'NovaSenha123')).rejects.toMatchObject({ response: { code: 'TOKEN_EXPIRED' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('keeps the new password even if the notice cannot be queued', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);
      queue.add.mockRejectedValue(new Error('redis down'));
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await expect(service.resetPassword('tok', 'NovaSenha123')).resolves.toBeDefined();
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    let passwordHash: string;

    beforeEach(async () => {
      passwordHash = await bcrypt.hash('SenhaAtual123', 4);
    });

    it('changes the password when the current one is right', async () => {
      prisma.user.findUnique.mockResolvedValue({ passwordHash });

      await service.changePassword(7, 'SenhaAtual123', 'NovaSenha123');

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(await bcrypt.compare('NovaSenha123', data.passwordHash)).toBe(true);
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
      expect(queue.add).toHaveBeenCalledWith('send-password-changed', { userId: 7 }, expect.any(Object));
    });

    it('answers 400 with a code, never 401, on each refusal', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ passwordHash });
      await expect(service.changePassword(7, 'errada', 'NovaSenha123')).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_CURRENT_PASSWORD' },
      });

      prisma.user.findUnique.mockResolvedValueOnce({ passwordHash });
      await expect(service.changePassword(7, 'SenhaAtual123', 'SenhaAtual123')).rejects.toMatchObject({
        status: 400,
        response: { code: 'SAME_PASSWORD' },
      });

      prisma.user.findUnique.mockResolvedValueOnce({ passwordHash: null });
      await expect(service.changePassword(7, 'x', 'NovaSenha123')).rejects.toMatchObject({
        status: 400,
        response: { code: 'NO_PASSWORD' },
      });

      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

describe('isIssuedAfterPasswordChange', () => {
  const changedAt = new Date('2026-11-04T12:00:00.500Z');
  const seconds = Math.floor(changedAt.getTime() / 1000);

  it('accepts every token while the password never changed', () => {
    expect(isIssuedAfterPasswordChange(1, null)).toBe(true);
    expect(isIssuedAfterPasswordChange(undefined, undefined)).toBe(true);
  });

  it('rejects older tokens and keeps those issued in the same second', () => {
    expect(isIssuedAfterPasswordChange(seconds - 1, changedAt)).toBe(false);
    expect(isIssuedAfterPasswordChange(seconds, changedAt)).toBe(true);
    expect(isIssuedAfterPasswordChange(seconds + 1, changedAt)).toBe(true);
    expect(isIssuedAfterPasswordChange(undefined, changedAt)).toBe(false);
  });
});
