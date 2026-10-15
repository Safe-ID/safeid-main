import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { resolve } from 'path';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { NotificationsModule } from '../../src/modules/notifications/notifications.module';
import { MonitoringModule } from '../../src/modules/monitoring/monitoring.module';
import { PrismaService } from '../../src/infra/database/prisma.service';
import { HibpPlanService } from '../../src/infra/http/hibp-plan.service';
import { MockHibpClient } from '../../src/infra/http/hibp.mock';
import { MockHibpCatalogClient } from '../../src/infra/http/hibp-catalog.mock';
import { ConsoleEmailSender } from '../../src/infra/email/console-email.sender';
import { EMAIL_SENDER } from '../../src/infra/email/email-sender.interface';
import {
  EMAIL_QUEUE,
  HIBP_CATALOG_CLIENT,
  HIBP_CLIENT,
  HIBP_QUEUE,
  MONITORING_QUEUE,
} from '../../src/infra/queue/queue.constants';
import { signUnsubscribeToken } from '../../src/shared/crypto/unsubscribe-token';
import { createFakeRedis, createInMemoryPrisma, FakeQueue } from '../helpers/in-memory-prisma';

describe('Notifications and monitoring API E2E', () => {
  let app: INestApplication;
  let baseUrl = '';
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let hibpQueue: FakeQueue;
  let token = '';
  let userId = 0;

  const request = (path: string, init: RequestInit = {}, auth = true) =>
    fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });

  async function addNotification(ownerId: number, index: number) {
    return prisma.notification.create({
      data: {
        userId: ownerId,
        type: 'NEW_BREACH',
        title: `Alerta ${index}`,
        body: `Vazamento ${index}`,
        dedupeKey: `${ownerId}-${index}`,
        payload: { breachNames: [`Breach${index}`], riskScoreBefore: 10, riskScoreAfter: 40, classification: 'MODERATE' },
      },
    });
  }

  beforeEach(async () => {
    process.env.APP_ROLE = 'api';
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
    process.env.FRONTEND_URL = 'https://safeid.app.br';
    process.env.MONITORING_UNSUBSCRIBE_SECRET = 'unsubscribe-secret-with-more-than-32-chars';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    prisma = createInMemoryPrisma();
    hibpQueue = new FakeQueue('hibp-check');

    // Global, como o CacheModule, o QueueModule e o EmailModule da aplicação
    const infra = {
      module: class TestInfraModule {},
      global: true,
      providers: [
        { provide: 'REDIS_CLIENT', useValue: createFakeRedis() },
        { provide: HIBP_QUEUE, useValue: hibpQueue },
        { provide: MONITORING_QUEUE, useValue: new FakeQueue('monitoring') },
        { provide: EMAIL_QUEUE, useValue: new FakeQueue('email') },
        { provide: HIBP_CLIENT, useValue: new MockHibpClient(0) },
        { provide: HIBP_CATALOG_CLIENT, useValue: new MockHibpCatalogClient(resolve(__dirname, '../fixtures/hibp-breaches.json')) },
        { provide: HibpPlanService, useValue: { getPlan: async () => ({ authOk: true }) } },
        { provide: EMAIL_SENDER, useValue: new ConsoleEmailSender(true) },
      ],
      exports: ['REDIS_CLIENT', HIBP_QUEUE, MONITORING_QUEUE, EMAIL_QUEUE, HIBP_CLIENT, HIBP_CATALOG_CLIENT, HibpPlanService, EMAIL_SENDER],
    };

    const moduleRef = await Test.createTestingModule({
      imports: [infra, AuthModule, NotificationsModule, MonitoringModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    const user = await prisma.user.create({
      data: { email: 'ana@example.com', emailVerifiedAt: new Date(), lastMonitoredAt: new Date('2026-10-14T03:00:00Z') },
    });
    userId = user.id;
    token = app.get(JwtService).sign({ sub: user.id, email: user.email });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    jest.restoreAllMocks();
    for (const key of ['APP_ROLE', 'FRONTEND_URL', 'MONITORING_UNSUBSCRIBE_SECRET']) {
      delete process.env[key];
    }
  });

  describe('notifications', () => {
    it('requires authentication', async () => {
      expect((await request('/api/v1/notifications', {}, false)).status).toBe(401);
      expect((await request('/api/v1/notifications/unread-count', {}, false)).status).toBe(401);
    });

    it('lists with cursor pagination, counts unread and marks as read', async () => {
      for (let i = 1; i <= 3; i++) await addNotification(userId, i);

      const firstPage = await request('/api/v1/notifications?limit=2');
      expect(firstPage.status).toBe(200);
      const first = (await firstPage.json()) as any;
      expect(first.items.map((item: any) => item.title)).toEqual(['Alerta 3', 'Alerta 2']);
      expect(first.items[0]).toMatchObject({ breachNames: ['Breach3'], riskScoreAfter: 40, readAt: null });

      const second = (await (await request(`/api/v1/notifications?limit=2&cursor=${first.nextCursor}`)).json()) as any;
      expect(second).toMatchObject({ items: [expect.objectContaining({ title: 'Alerta 1' })], nextCursor: null });

      await expect((await request('/api/v1/notifications/unread-count')).json()).resolves.toEqual({ count: 3 });

      const read = await request(`/api/v1/notifications/${first.items[0].id}/read`, { method: 'PATCH' });
      expect(read.status).toBe(204);
      await expect((await request('/api/v1/notifications/unread-count')).json()).resolves.toEqual({ count: 2 });

      const readAll = await request('/api/v1/notifications/read-all', { method: 'PATCH' });
      expect(readAll.status).toBe(204);
      await expect((await request('/api/v1/notifications/unread-count')).json()).resolves.toEqual({ count: 0 });
    });

    it("does not let a user read someone else's notification", async () => {
      const other = await prisma.user.create({ data: { email: 'bruno@example.com', emailVerifiedAt: new Date() } });
      const othersNotification = await addNotification(other.id, 1);

      expect((await request(`/api/v1/notifications/${othersNotification.id}/read`, { method: 'PATCH' })).status).toBe(404);
      expect(prisma.notification.rows[0].readAt).toBeNull();
    });

    it('validates the parameters', async () => {
      expect((await request('/api/v1/notifications/abc/read', { method: 'PATCH' })).status).toBe(400);
      expect((await request('/api/v1/notifications?limit=500')).status).toBe(400);
      expect((await request('/api/v1/notifications?cursor=-1')).status).toBe(400);
    });
  });

  describe('monitoring', () => {
    it('returns the status and toggles alerts, scheduling a check when turned back on', async () => {
      const status = await request('/api/v1/monitoring/status');
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        enabled: true,
        lastMonitoredAt: '2026-10-14T03:00:00.000Z',
        lastCatalogSyncAt: null,
      });

      const off = await request('/api/v1/monitoring/preferences', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
      expect(off.status).toBe(200);
      await expect(off.json()).resolves.toMatchObject({ enabled: false });

      const on = await request('/api/v1/monitoring/preferences', { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
      await expect(on.json()).resolves.toMatchObject({ enabled: true });
      expect(hibpQueue.jobs).toEqual([
        expect.objectContaining({ name: 'monitor-check', data: { userId, reason: 'OPT_IN' } }),
      ]);
    });

    it('validates the preferences body and requires authentication', async () => {
      for (const enabled of ['yes', 'false', 1, null]) {
        const response = await request('/api/v1/monitoring/preferences', { method: 'PATCH', body: JSON.stringify({ enabled }) });
        expect(response.status).toBe(400);
      }
      // "false" em texto não pode virar true e religar os alertas
      expect((await prisma.user.findUnique({ where: { id: userId } }))!.monitoringEnabled).toBe(true);
      expect((await request('/api/v1/monitoring/status', {}, false)).status).toBe(401);
    });

    it('unsubscribes through the e-mail link without login and redirects to the site', async () => {
      const unsubscribeToken = encodeURIComponent(signUnsubscribeToken(userId));

      const response = await request(`/api/v1/monitoring/unsubscribe?token=${unsubscribeToken}`, {}, false);

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://safeid.app.br/?monitoring=disabled');
      expect((await prisma.user.findUnique({ where: { id: userId } }))!.monitoringEnabled).toBe(false);

      const invalid = await request('/api/v1/monitoring/unsubscribe?token=1.forged', {}, false);
      expect(invalid.headers.get('location')).toBe('https://safeid.app.br/?monitoring=invalid');
    });

    it('supports one-click unsubscribe (RFC 8058)', async () => {
      const unsubscribeToken = encodeURIComponent(signUnsubscribeToken(userId));

      const response = await request(
        `/api/v1/monitoring/unsubscribe?token=${unsubscribeToken}`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' },
        false,
      );

      expect(response.status).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: userId } }))!.monitoringEnabled).toBe(false);

      const invalid = await request('/api/v1/monitoring/unsubscribe?token=nope', { method: 'POST' }, false);
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toMatchObject({ code: 'TOKEN_INVALID' });
    });
  });
});
