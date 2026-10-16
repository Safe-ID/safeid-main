import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(async () => undefined),
  })),
}));

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(function (this: any) {
    this.quit = jest.fn(async () => 'OK');
  }),
);

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { EmailProcessor } from '../../src/modules/notifications/processors/email.processor';

const WorkerMock = Worker as unknown as jest.Mock;
const RedisMock = Redis as unknown as jest.Mock;

describe('EmailProcessor', () => {
  let prisma: any;
  let sender: any;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.APP_ROLE;
    delete process.env.SES_MAX_PER_SECOND;
    delete process.env.EMAIL_VERIFICATION_TTL_HOURS;
    process.env.FRONTEND_URL = 'https://safeid.app.br/';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    prisma = { user: { findUnique: jest.fn() } };
    sender = { send: jest.fn(async () => ({ messageId: 'm-1' })) };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.FRONTEND_URL;
    delete process.env.APP_ROLE;
  });

  it('starts the worker with the SES rate as limiter', () => {
    process.env.SES_MAX_PER_SECOND = '14';
    new EmailProcessor(prisma, sender).onModuleInit();

    expect(WorkerMock).toHaveBeenCalledWith('email', expect.any(Function), expect.objectContaining({
      concurrency: 14,
      limiter: { max: 14, duration: 1000 },
    }));
  });

  it('defaults to the SES sandbox rate (1/s) and does not start with APP_ROLE=api', () => {
    new EmailProcessor(prisma, sender).onModuleInit();
    expect(WorkerMock).toHaveBeenLastCalledWith('email', expect.any(Function), expect.objectContaining({
      limiter: { max: 1, duration: 1000 },
    }));

    WorkerMock.mockClear();
    process.env.APP_ROLE = 'api';
    new EmailProcessor(prisma, sender).onModuleInit();
    expect(WorkerMock).not.toHaveBeenCalled();
  });

  it('sends the verification link to the account e-mail', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'user@example.com', emailVerifiedAt: null });
    const processor = new EmailProcessor(prisma, sender);

    await expect(
      processor.process({ name: 'send-verification-email', data: { userId: 7, token: 'abc_DEF-123' } } as any),
    ).resolves.toEqual({ sent: true });

    const message = sender.send.mock.calls[0][0];
    expect(message.to).toBe('user@example.com');
    expect(message.subject).toBe('Confirme seu e-mail no SafeID');
    expect(message.text).toContain('https://safeid.app.br/?verify_token=abc_DEF-123');
    expect(message.text).toContain('24 horas');
  });

  it('skips deleted and already verified accounts', async () => {
    const processor = new EmailProcessor(prisma, sender);

    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      processor.process({ name: 'send-verification-email', data: { userId: 7, token: 't' } } as any),
    ).resolves.toEqual({ sent: false, reason: 'user_not_found' });

    prisma.user.findUnique.mockResolvedValueOnce({ email: 'user@example.com', emailVerifiedAt: new Date() });
    await expect(
      processor.process({ name: 'send-verification-email', data: { userId: 7, token: 't' } } as any),
    ).resolves.toEqual({ sent: false, reason: 'already_verified' });

    expect(sender.send).not.toHaveBeenCalled();
  });

  it('rejects incomplete and unknown jobs so they are retried or surface', async () => {
    const processor = new EmailProcessor(prisma, sender);

    await expect(processor.process({ name: 'send-verification-email', data: { userId: 7 } } as any)).rejects.toThrow(
      'Job missing userId or token',
    );
    await expect(processor.process({ name: 'other', data: {} } as any)).rejects.toThrow("Unknown job 'other'");
  });

  it('logs retries and the final failure without the token or e-mail', () => {
    const infoSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    new EmailProcessor(prisma, sender).onModuleInit();
    const worker = WorkerMock.mock.results.at(-1)?.value as any;
    const failed = worker.on.mock.calls.find((call: any[]) => call[0] === 'failed')[1];

    failed({ id: '1', name: 'send-verification-email', attemptsMade: 1, opts: { attempts: 5 }, data: { token: 'secret' } }, new Error('ses'));
    failed({ id: '1', name: 'send-verification-email', attemptsMade: 5, opts: { attempts: 5 }, data: { token: 'secret' } }, new Error('ses'));

    expect(JSON.parse(infoSpy.mock.calls.at(-1)?.[0] as string)).toMatchObject({ event: 'email.retry' });
    const finalLine = warnSpy.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(finalLine)).toMatchObject({ event: 'email.failed', type: 'send-verification-email' });
    expect(finalLine).not.toContain('secret');
  });

  it('closes the worker and its connection on shutdown', async () => {
    const processor = new EmailProcessor(prisma, sender);
    processor.onModuleInit();
    const worker = WorkerMock.mock.results.at(-1)?.value as any;
    const connection = RedisMock.mock.instances.at(-1) as any;

    await processor.onModuleDestroy();
    await processor.onModuleDestroy();

    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(connection.quit).toHaveBeenCalledTimes(1);
  });
});
