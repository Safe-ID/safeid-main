import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { PrismaService } from '../../src/infra/database/prisma.service';
import { ScanService } from '../../src/modules/scan/services/scan.service';
import { EMAIL_QUEUE } from '../../src/infra/queue/queue.constants';
import { ConsoleEmailSender } from '../../src/infra/email/console-email.sender';
import { EmailProcessor } from '../../src/modules/notifications/processors/email.processor';

type Row = Record<string, any>;

function pick(row: Row | undefined, select?: Record<string, boolean>): Row | null {
  if (!row) return null;
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map(key => [key, row[key]]));
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

/**
 * Prisma em memória com o que o fluxo de cadastro/verificação/login usa
 */
function createInMemoryPrisma() {
  const users: Row[] = [];
  const tokens: Row[] = [];
  let nextUserId = 1;
  let nextTokenId = 1;

  const prisma: any = {
    users,
    tokens,
    user: {
      findUnique: async ({ where, select }: any) => pick(users.find(user => matches(user, where)), select),
      findUniqueOrThrow: async ({ where }: any) => {
        const user = users.find(item => matches(item, where));
        if (!user) throw new Error('not found');
        return { ...user };
      },
      create: async ({ data }: any) => {
        const user = {
          id: nextUserId++,
          googleId: null,
          emailVerifiedAt: null,
          lastMonitoredAt: null,
          scanSnapshot: null,
          scanSnapshotUpdatedAt: null,
          createdAt: new Date(),
          ...data,
        };
        users.push(user);
        return { ...user };
      },
      update: async ({ where, data }: any) => {
        const user = users.find(item => matches(item, where));
        if (!user) throw new Error('not found');
        Object.assign(user, data);
        return { ...user };
      },
      delete: async ({ where }: any) => {
        const index = users.findIndex(item => matches(item, where));
        const [removed] = users.splice(index, 1);
        // ON DELETE CASCADE
        for (let i = tokens.length - 1; i >= 0; i--) {
          if (tokens[i].userId === removed.id) tokens.splice(i, 1);
        }
        return removed;
      },
    },
    emailVerificationToken: {
      findUnique: async ({ where }: any) => pick(tokens.find(token => matches(token, where))),
      create: async ({ data }: any) => {
        const token = { id: nextTokenId++, usedAt: null, createdAt: new Date(), ...data };
        tokens.push(token);
        return { ...token };
      },
      updateMany: async ({ where, data }: any) => {
        const found = tokens.filter(token => matches(token, where));
        found.forEach(token => Object.assign(token, data));
        return { count: found.length };
      },
    },
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
  };

  return prisma;
}

function createInMemoryRedis() {
  const store = new Map<string, number>();
  return {
    set: async (key: string) => {
      if (store.has(key)) return null;
      store.set(key, 1);
      return 'OK';
    },
    incr: async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    expire: async () => 1,
    // Simula o fim do cooldown de 60 s
    clearCooldowns: () => {
      for (const key of Array.from(store.keys())) {
        if (!key.includes(':day:')) store.delete(key);
      }
    },
  };
}

describe('Auth API E2E', () => {
  let app: INestApplication;
  let baseUrl = '';
  let prisma: any;
  let redis: ReturnType<typeof createInMemoryRedis>;
  let sender: ConsoleEmailSender;
  let scanMock: any;

  const post = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const tokenFromLastEmail = (email: string): string => {
    const message = sender.lastMessageTo(email);
    const match = message?.text.match(/verify_token=([A-Za-z0-9_%-]+)/);
    if (!match) throw new Error(`No verification e-mail for ${email}`);
    return decodeURIComponent(match[1]);
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
    process.env.FRONTEND_URL = 'https://safeid.app.br';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    prisma = createInMemoryPrisma();
    redis = createInMemoryRedis();
    sender = new ConsoleEmailSender(true);
    const emailProcessor = new EmailProcessor(prisma, sender);

    // A fila de e-mail entrega o job direto ao processor: o teste lê o link no ConsoleEmailSender
    const emailQueue = {
      add: jest.fn(async (name: string, data: unknown) => emailProcessor.process({ name, data } as any)),
    };

    scanMock = {
      submitScan: jest.fn(async () => undefined),
      persistFallbackSnapshot: jest.fn(async () => undefined),
      clearCachedScan: jest.fn(async () => undefined),
    };

    // Global, como o CacheModule e o QueueModule da aplicação
    const testInfraModule = {
      module: class TestInfraModule {},
      global: true,
      providers: [
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: EMAIL_QUEUE, useValue: emailQueue },
      ],
      exports: ['REDIS_CLIENT', EMAIL_QUEUE],
    };

    const moduleRef = await Test.createTestingModule({
      imports: [testInfraModule, AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ScanService)
      .useValue(scanMock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    jest.restoreAllMocks();
    delete process.env.FRONTEND_URL;
  });

  it('signs up, verifies the e-mail through the link and reaches /auth/me', async () => {
    const signup = await post('/api/v1/auth/signup', {
      email: 'Jane@Example.com',
      password: 'StrongPass123',
      acceptTerms: true,
    });

    expect(signup.status).toBe(201);
    await expect(signup.json()).resolves.toEqual({ requiresEmailVerification: true, email: 'jane@example.com' });
    expect(prisma.users[0]).toMatchObject({ email: 'jane@example.com', emailVerifiedAt: null, monitoringEnabled: true });
    expect(scanMock.submitScan).not.toHaveBeenCalled();

    const message = sender.lastMessageTo('jane@example.com');
    expect(message?.text).toContain('https://safeid.app.br/?verify_token=');
    const token = tokenFromLastEmail('jane@example.com');
    expect(token).toHaveLength(43);
    // Só o hash do token fica no banco
    expect(JSON.stringify(prisma.tokens)).not.toContain(token);

    const verify = await post('/api/v1/auth/verify-email', { token });
    expect(verify.status).toBe(200);
    const session = (await verify.json()) as any;
    expect(session).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      user: { email: 'jane@example.com', emailVerified: true, monitoringEnabled: true },
    });
    expect(scanMock.submitScan).toHaveBeenCalledWith(1, { email: 'jane@example.com' }, 'SIGNUP');

    const me = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({ id: 1, email: 'jane@example.com', emailVerified: true });

    // O mesmo link não funciona duas vezes
    const reused = await post('/api/v1/auth/verify-email', { token });
    expect(reused.status).toBe(410);
    await expect(reused.json()).resolves.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('renews the session with the refresh token and keeps the two tokens apart', async () => {
    await post('/api/v1/auth/signup', { email: 'renew@example.com', password: 'StrongPass123', acceptTerms: true });
    const session = (await (await post('/api/v1/auth/verify-email', { token: tokenFromLastEmail('renew@example.com') })).json()) as any;
    const me = (token: string) => fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });

    const refreshed = await post('/api/v1/auth/refresh', { refresh_token: session.refresh_token });
    expect(refreshed.status).toBe(200);
    const pair = (await refreshed.json()) as any;
    expect(pair).toEqual({ access_token: expect.any(String), refresh_token: expect.any(String) });
    expect((await me(pair.access_token)).status).toBe(200);
    // O refresh token também é renovado e continua servindo
    expect((await post('/api/v1/auth/refresh', { refresh_token: pair.refresh_token })).status).toBe(200);

    // Um token não vale no lugar do outro
    const accessAsRefresh = await post('/api/v1/auth/refresh', { refresh_token: session.access_token });
    expect(accessAsRefresh.status).toBe(401);
    await expect(accessAsRefresh.json()).resolves.toMatchObject({ code: 'REFRESH_INVALID' });
    expect((await me(session.refresh_token)).status).toBe(401);

    // Token adulterado ou inválido (aqui sem o ValidationPipe global do main.ts, o serviço é quem recusa)
    expect((await post('/api/v1/auth/refresh', { refresh_token: `${session.refresh_token}x` })).status).toBe(401);
    expect((await post('/api/v1/auth/refresh', { refresh_token: 'nao-e-um-jwt' })).status).toBe(401);

    // Conta apagada: o refresh token deixa de valer
    await fetch(`${baseUrl}/api/v1/auth/me`, { method: 'DELETE', headers: { Authorization: `Bearer ${pair.access_token}` } });
    expect((await post('/api/v1/auth/refresh', { refresh_token: pair.refresh_token })).status).toBe(401);
  });

  it('answers 400 TOKEN_INVALID for unknown tokens and validates the token format', async () => {
    const unknown = await post('/api/v1/auth/verify-email', { token: 'x'.repeat(43) });
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toMatchObject({ code: 'TOKEN_INVALID' });

    const malformed = await post('/api/v1/auth/verify-email', { token: 'short' });
    expect(malformed.status).toBe(400);
  });

  it('blocks login until the e-mail is verified and resends the link', async () => {
    await post('/api/v1/auth/signup', { email: 'pending@example.com', password: 'StrongPass123', acceptTerms: true });
    const firstToken = tokenFromLastEmail('pending@example.com');
    redis.clearCooldowns();

    const login = await post('/api/v1/auth/login', { email: 'pending@example.com', password: 'StrongPass123' });
    expect(login.status).toBe(403);
    await expect(login.json()).resolves.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });

    // O reenvio invalida o link anterior
    const secondToken = tokenFromLastEmail('pending@example.com');
    expect(secondToken).not.toBe(firstToken);
    expect((await post('/api/v1/auth/verify-email', { token: firstToken })).status).toBe(410);
    expect((await post('/api/v1/auth/verify-email', { token: secondToken })).status).toBe(200);

    const afterVerify = await post('/api/v1/auth/login', { email: 'pending@example.com', password: 'StrongPass123' });
    expect(afterVerify.status).toBe(200);
  });

  it('answers resend requests the same way whether the account exists or not', async () => {
    await post('/api/v1/auth/signup', { email: 'pending@example.com', password: 'StrongPass123', acceptTerms: true });
    redis.clearCooldowns();
    const sentBefore = sender.sent.length;

    const existing = await post('/api/v1/auth/resend-verification', { email: 'pending@example.com' });
    const unknown = await post('/api/v1/auth/resend-verification', { email: 'nobody@example.com' });

    expect(existing.status).toBe(202);
    expect(unknown.status).toBe(202);
    await expect(existing.json()).resolves.toEqual(await unknown.json());
    expect(sender.sent.length).toBe(sentBefore + 1);

    // Dentro do cooldown de 60 s nada é enviado
    await post('/api/v1/auth/resend-verification', { email: 'pending@example.com' });
    expect(sender.sent.length).toBe(sentBefore + 1);
  });

  it('rejects access tokens of accounts that are not verified', async () => {
    const passwordHash = await bcrypt.hash('StrongPass123', 10);
    await prisma.user.create({ data: { email: 'legacy@example.com', passwordHash } });
    const legacyToken = app.get(JwtService).sign({ sub: 1, email: 'legacy@example.com' });

    const me = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${legacyToken}` } });

    expect(me.status).toBe(401);
  });

  it('deletes the authenticated account', async () => {
    const passwordHash = await bcrypt.hash('StrongPass123', 10);
    await prisma.user.create({ data: { email: 'delete@example.com', passwordHash, emailVerifiedAt: new Date() } });

    const login = await post('/api/v1/auth/login', { email: 'delete@example.com', password: 'StrongPass123' });
    expect(login.status).toBe(200);
    const { access_token } = (await login.json()) as any;

    const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${access_token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ message: 'Conta deletada com sucesso' });
    expect(prisma.users).toHaveLength(0);
    expect(scanMock.clearCachedScan).toHaveBeenCalledWith('delete@example.com');
  });
});
