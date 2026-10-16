import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHmac } from 'crypto';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../../src/shared/crypto/unsubscribe-token';
import { findEnvProblems } from '../../src/shared/config/env.validation';
import { UserBreachRepository } from '../../src/modules/breaches/user-breach.repository';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { EmailProcessor } from '../../src/modules/notifications/processors/email.processor';
import { MonitoringPreferencesService } from '../../src/modules/monitoring/services/monitoring-preferences.service';
import { NotificationsController } from '../../src/modules/notifications/notifications.controller';
import { MonitoringController } from '../../src/modules/monitoring/monitoring.controller';
import { createInMemoryPrisma, FakeQueue } from '../helpers/in-memory-prisma';

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

const SECRET = 'unsubscribe-secret-with-more-than-32-chars';

describe('unsubscribe token', () => {
  beforeEach(() => {
    process.env.MONITORING_UNSUBSCRIBE_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.MONITORING_UNSUBSCRIBE_SECRET;
  });

  it('signs userId.HMAC and verifies it back', () => {
    const token = signUnsubscribeToken(42);
    const expectedSignature = createHmac('sha256', SECRET).update('unsub:42').digest('base64url');

    expect(token).toBe(`42.${expectedSignature}`);
    expect(verifyUnsubscribeToken(token)).toBe(42);
    expect(verifyUnsubscribeToken(` ${token} `)).toBe(42);
  });

  it('rejects tampered, swapped, malformed and empty tokens', () => {
    const token = signUnsubscribeToken(42);
    const [, signature] = token.split('.');
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');

    expect(verifyUnsubscribeToken(`42.${flipped}`)).toBeNull();
    expect(verifyUnsubscribeToken(`43.${signature}`)).toBeNull();
    expect(verifyUnsubscribeToken('42')).toBeNull();
    expect(verifyUnsubscribeToken('abc.def')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
  });

  it('does not accept tokens signed with another secret', () => {
    const token = signUnsubscribeToken(7);
    process.env.MONITORING_UNSUBSCRIBE_SECRET = 'another-secret-also-longer-than-32-chars';

    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it('requires the secret', () => {
    delete process.env.MONITORING_UNSUBSCRIBE_SECRET;
    expect(() => signUnsubscribeToken(1)).toThrow('MONITORING_UNSUBSCRIBE_SECRET');
  });

  it('is required (32+ chars, not the example value) in production', () => {
    const base = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a-real-jwt-secret',
      REFRESH_TOKEN_SECRET: 'a-real-refresh-secret',
      SESSION_SECRET: 'a-real-session-secret',
    };

    expect(findEnvProblems(base)).toContain('MONITORING_UNSUBSCRIBE_SECRET não está definida');
    expect(findEnvProblems({ ...base, MONITORING_UNSUBSCRIBE_SECRET: 'change_me_32_bytes_min' })).toContain(
      'MONITORING_UNSUBSCRIBE_SECRET ainda está com o valor de exemplo',
    );
    expect(findEnvProblems({ ...base, MONITORING_UNSUBSCRIBE_SECRET: 'short-secret' })).toContain(
      'MONITORING_UNSUBSCRIBE_SECRET precisa ter pelo menos 32 caracteres',
    );
    expect(findEnvProblems({ ...base, MONITORING_UNSUBSCRIBE_SECRET: SECRET })).toEqual([]);
  });
});

describe('NotificationsService (listing and reading)', () => {
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let service: NotificationsService;

  async function seed(userId: number, count: number) {
    for (let i = 0; i < count; i++) {
      await prisma.notification.create({
        data: {
          userId,
          type: 'NEW_BREACH',
          title: `t${i}`,
          body: `b${i}`,
          dedupeKey: `${userId}-${i}`,
          payload: { breachNames: [`Breach${i}`], riskScoreBefore: null, riskScoreAfter: 50, classification: 'MODERATE' },
        },
      });
    }
  }

  beforeEach(() => {
    prisma = createInMemoryPrisma();
    service = new NotificationsService(prisma as any, new UserBreachRepository(prisma as any), new FakeQueue('email') as any);
  });

  it('pages from the newest with a cursor and maps the payload', async () => {
    await seed(1, 5);
    await seed(2, 1);

    const first = await service.list(1, undefined, 2);
    expect(first.items.map(item => item.title)).toEqual(['t4', 't3']);
    expect(first.items[0]).toMatchObject({
      type: 'NEW_BREACH',
      breachNames: ['Breach4'],
      riskScoreBefore: null,
      riskScoreAfter: 50,
      classification: 'MODERATE',
      readAt: null,
    });
    expect(first.nextCursor).toBe(first.items[1].id);

    const second = await service.list(1, first.nextCursor!, 2);
    expect(second.items.map(item => item.title)).toEqual(['t2', 't1']);

    const last = await service.list(1, second.nextCursor!, 2);
    expect(last).toEqual({ items: [expect.objectContaining({ title: 't0' })], nextCursor: null });
  });

  it('clamps the page size and tolerates an empty payload', async () => {
    await prisma.notification.create({
      data: { userId: 3, type: 'NEW_BREACH', title: 'x', body: 'y', dedupeKey: 'k', payload: null },
    });

    const page = await service.list(3, undefined, 500);
    expect(page.items[0]).toMatchObject({ breachNames: [], riskScoreAfter: null, classification: null });
    await expect(service.list(3, undefined, 0)).resolves.toMatchObject({ items: [expect.anything()] });
  });

  it('counts unread, marks one (only for the owner) and marks all', async () => {
    await seed(1, 3);
    await seed(2, 1);
    const [mine] = prisma.notification.rows.filter(row => row.userId === 1);
    const others = prisma.notification.rows.find(row => row.userId === 2)!;

    await expect(service.unreadCount(1)).resolves.toBe(3);

    await service.markRead(1, mine.id);
    await service.markRead(1, mine.id);
    await expect(service.unreadCount(1)).resolves.toBe(2);

    await expect(service.markRead(1, others.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.markRead(1, 9999)).rejects.toBeInstanceOf(NotFoundException);

    await service.markAllRead(1);
    await expect(service.unreadCount(1)).resolves.toBe(0);
    await expect(service.unreadCount(2)).resolves.toBe(1);
  });
});

describe('MonitoringPreferencesService', () => {
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let monitoring: any;
  let catalog: any;
  let service: MonitoringPreferencesService;

  beforeEach(() => {
    process.env.MONITORING_UNSUBSCRIBE_SECRET = SECRET;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    prisma = createInMemoryPrisma();
    monitoring = { enqueueCheck: jest.fn(async () => undefined) };
    catalog = { getLastSyncAt: jest.fn(async () => new Date('2026-10-15T12:00:00.000Z')) };
    service = new MonitoringPreferencesService(prisma as any, monitoring, catalog);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MONITORING_UNSUBSCRIBE_SECRET;
  });

  it('returns the status', async () => {
    const user = await prisma.user.create({ data: { email: 'a@example.com', lastMonitoredAt: new Date('2026-10-14T03:00:00Z') } });

    await expect(service.getStatus(user.id)).resolves.toEqual({
      enabled: true,
      lastMonitoredAt: new Date('2026-10-14T03:00:00Z'),
      lastCatalogSyncAt: new Date('2026-10-15T12:00:00.000Z'),
    });
    await expect(service.getStatus(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('turns alerts off and back on, recording consent and scheduling an immediate check', async () => {
    const user = await prisma.user.create({ data: { email: 'a@example.com' } });

    await expect(service.setEnabled(user.id, false)).resolves.toMatchObject({ enabled: false });
    expect(monitoring.enqueueCheck).not.toHaveBeenCalled();

    await expect(service.setEnabled(user.id, true)).resolves.toMatchObject({ enabled: true });
    expect(monitoring.enqueueCheck).toHaveBeenCalledWith(user.id, 'OPT_IN');
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.monitoringConsentAt).toEqual(expect.any(Date));

    // Sem mudança de estado: nada é agendado de novo
    await service.setEnabled(user.id, true);
    expect(monitoring.enqueueCheck).toHaveBeenCalledTimes(1);

    await expect(service.setEnabled(999, true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unsubscribes with a valid token, idempotently, and rejects invalid tokens', async () => {
    const user = await prisma.user.create({ data: { email: 'a@example.com' } });
    const token = signUnsubscribeToken(user.id);

    await expect(service.unsubscribeByToken(token)).resolves.toBe(true);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.monitoringEnabled).toBe(false);
    await expect(service.unsubscribeByToken(token)).resolves.toBe(true);

    // Conta apagada: o link continua respondendo como sucesso
    await expect(service.unsubscribeByToken(signUnsubscribeToken(999))).resolves.toBe(true);
    await expect(service.unsubscribeByToken('1.invalid')).resolves.toBe(false);
  });
});

describe('EmailProcessor: new breach alert', () => {
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let sender: { send: jest.Mock<any> };
  let processor: EmailProcessor;

  beforeEach(async () => {
    process.env.MONITORING_UNSUBSCRIBE_SECRET = SECRET;
    process.env.FRONTEND_URL = 'https://safeid.app.br';
    process.env.APP_URL = 'https://api.safeid.app.br/';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    prisma = createInMemoryPrisma();
    sender = { send: jest.fn(async () => ({ messageId: 'm-1' })) };
    processor = new EmailProcessor(prisma as any, sender as any);

    await prisma.breachCatalog.create({
      data: {
        name: 'MegaLeak',
        title: 'Mega Leak 2026',
        breachDate: new Date('2026-09-28T00:00:00.000Z'),
        dataClasses: ['Passwords', 'Phone numbers'],
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MONITORING_UNSUBSCRIBE_SECRET;
    delete process.env.FRONTEND_URL;
    delete process.env.APP_URL;
  });

  async function createNotification(userData: Record<string, unknown> = {}, breachNames = ['MegaLeak', 'Unknown']) {
    const user = await prisma.user.create({ data: { email: 'ana@example.com', emailVerifiedAt: new Date(), ...userData } });
    return prisma.notification.create({
      data: {
        userId: user.id,
        type: 'NEW_BREACH',
        title: 't',
        body: 'b',
        dedupeKey: 'k',
        payload: { breachNames, riskScoreAfter: 74, classification: 'HIGH' },
      },
    });
  }

  const job = (notificationId: number) => ({ name: 'send-new-breach-alert', data: { notificationId } }) as any;

  it('sends the alert with breach details, unsubscribe link and one-click headers, then marks it SENT', async () => {
    const notification = await createNotification();

    await expect(processor.process(job(notification.id))).resolves.toEqual({ sent: true });

    const message = sender.send.mock.calls[0][0] as any;
    const unsubscribeUrl = `https://api.safeid.app.br/api/v1/monitoring/unsubscribe?token=${encodeURIComponent(
      signUnsubscribeToken(notification.userId),
    )}`;
    expect(message).toMatchObject({
      to: 'ana@example.com',
      subject: 'Seu e-mail apareceu em 2 novos vazamentos',
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    expect(message.text).toContain('Mega Leak 2026 (28/09/2026)');
    expect(message.text).toContain('Senhas, Números de telefone');
    expect(message.text).toContain('- Unknown (data não informada)');
    expect(message.text).toContain('74/100 (Alto)');
    expect(message.text).toContain('https://safeid.app.br/');
    expect(message.text).toContain(unsubscribeUrl);
    expect(prisma.notification.rows[0]).toMatchObject({ emailStatus: 'SENT', emailSentAt: expect.any(Date) });
  });

  it('does not send twice', async () => {
    const notification = await createNotification();
    await processor.process(job(notification.id));

    await expect(processor.process(job(notification.id))).resolves.toEqual({ sent: false, reason: 'already_sent' });
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('skips the e-mail when the user turned alerts off in the meantime', async () => {
    const notification = await createNotification({ monitoringEnabled: false });

    await expect(processor.process(job(notification.id))).resolves.toEqual({ sent: false, reason: 'monitoring_disabled' });
    expect(sender.send).not.toHaveBeenCalled();
    expect(prisma.notification.rows[0].emailStatus).toBe('SKIPPED');
  });

  it('handles missing notifications and incomplete jobs', async () => {
    await expect(processor.process(job(999))).resolves.toEqual({ sent: false, reason: 'notification_not_found' });
    await expect(processor.process({ name: 'send-new-breach-alert', data: {} } as any)).rejects.toThrow('Job missing notificationId');
  });

  it('keeps the notification PENDING while retrying and marks it FAILED on the last attempt', async () => {
    delete process.env.APP_ROLE;
    const notification = await createNotification();
    processor.onModuleInit();
    const worker = (processor as any).worker;
    const failed = worker.on.mock.calls.find((call: any[]) => call[0] === 'failed')[1];

    failed({ name: 'send-new-breach-alert', attemptsMade: 2, opts: { attempts: 5 }, data: { notificationId: notification.id } }, new Error('ses'));
    await new Promise(resolve => setImmediate(resolve));
    expect(prisma.notification.rows[0].emailStatus).toBe('PENDING');

    failed({ name: 'send-new-breach-alert', attemptsMade: 5, opts: { attempts: 5 }, data: { notificationId: notification.id } }, new Error('ses'));
    await new Promise(resolve => setImmediate(resolve));
    expect(prisma.notification.rows[0].emailStatus).toBe('FAILED');

    await processor.onModuleDestroy();
  });
});

describe('notifications and monitoring controllers', () => {
  afterEach(() => {
    delete process.env.FRONTEND_URL;
  });

  it('delegates the notification routes to the service', async () => {
    const service = {
      list: jest.fn(async () => ({ items: [], nextCursor: null })),
      unreadCount: jest.fn(async () => 4),
      markRead: jest.fn(async () => undefined),
      markAllRead: jest.fn(async () => undefined),
    };
    const controller = new NotificationsController(service as any);

    await expect(controller.list(7, { cursor: 10, limit: 5 })).resolves.toEqual({ items: [], nextCursor: null });
    await expect(controller.unreadCount(7)).resolves.toEqual({ count: 4 });
    await controller.markRead(7, 3);
    await controller.markAllRead(7);

    expect(service.list).toHaveBeenCalledWith(7, 10, 5);
    expect(service.markRead).toHaveBeenCalledWith(7, 3);
    expect(service.markAllRead).toHaveBeenCalledWith(7);
  });

  it('delegates status/preferences and answers the unsubscribe routes', async () => {
    process.env.FRONTEND_URL = 'https://safeid.app.br/';
    const preferences = {
      getStatus: jest.fn(async () => ({ enabled: true })),
      setEnabled: jest.fn(async () => ({ enabled: false })),
      unsubscribeByToken: jest.fn<(token: string) => Promise<boolean>>().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    };
    const controller = new MonitoringController(preferences as any);
    const res: any = { redirect: jest.fn(), status: jest.fn(() => res), json: jest.fn() };

    await expect(controller.status(7)).resolves.toEqual({ enabled: true });
    await expect(controller.updatePreferences(7, { enabled: false })).resolves.toEqual({ enabled: false });
    expect(preferences.setEnabled).toHaveBeenCalledWith(7, false);

    await controller.unsubscribeLink('ok', res);
    await controller.unsubscribeLink('bad', res);
    expect(res.redirect.mock.calls).toEqual([
      [302, 'https://safeid.app.br/?monitoring=disabled'],
      [302, 'https://safeid.app.br/?monitoring=invalid'],
    ]);

    await controller.unsubscribeOneClick('ok', res);
    await controller.unsubscribeOneClick('bad', res);
    expect(res.status.mock.calls).toEqual([[200], [400]]);
    expect(res.json).toHaveBeenLastCalledWith({ code: 'TOKEN_INVALID', message: 'Link de descadastro inválido.' });
  });
});
