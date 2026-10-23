import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(function (this: any, config?: any) {
    this.config = config;
    this.connect = jest.fn();
    this.quit = jest.fn();
  });
});

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    close: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}));

describe('bootstrap and module wiring coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HIBP_API_KEY = 'test-key';
    process.env.HIBP_USE_MOCK = 'true';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';
    process.env.JWT_SECRET = 'unit-test-secret';
    process.env.REFRESH_TOKEN_SECRET = 'unit-test-refresh-secret';
    process.env.APP_PORT = '3001';
    process.env.NODE_ENV = 'test';
    process.env.SWAGGER_ENABLED = 'false';
    delete process.env.APP_ROLE;
  });

  it('creates the cache client from the cache module factory', async () => {
    const { CacheModule } = await import('../../src/infra/cache/cache.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CacheModule],
    }).compile();

    const client = moduleRef.get('REDIS_CLIENT');
    expect(client).toBeDefined();
    expect((require('ioredis') as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('uses the cache module defaults when no Redis env values are configured', async () => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;

    const { CacheModule } = await import('../../src/infra/cache/cache.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CacheModule],
    }).compile();

    const client = moduleRef.get('REDIS_CLIENT');
    expect(client).toBeDefined();
    expect((require('ioredis') as jest.Mock).mock.calls.at(-1)?.[0]).toMatchObject({
      host: 'localhost',
      port: 6379,
    });
  });

  it('creates the three queues with their retention options', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { QueueModule } = await import('../../src/infra/queue/queue.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();

    expect(moduleRef.get('HIBP_QUEUE')).toBeDefined();
    expect(moduleRef.get('MONITORING_QUEUE')).toBeDefined();
    expect(moduleRef.get('EMAIL_QUEUE')).toBeDefined();
    expect(moduleRef.get('HIBP_CATALOG_CLIENT')).toBeDefined();

    const queueCalls = (require('bullmq').Queue as jest.Mock).mock.calls;
    const optionsByName = Object.fromEntries(queueCalls.map(call => [call[0], (call[1] as any).defaultJobOptions]));
    expect(optionsByName['hibp-check']).toEqual({ removeOnComplete: { age: 60 }, removeOnFail: { age: 600 } });
    expect(optionsByName['monitoring']).toEqual({
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
    expect(optionsByName['email']).toEqual({ removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } });
  });

  it('uses the real HIBP and catalog clients when the mock is disabled', async () => {
    process.env.HIBP_USE_MOCK = 'false';
    const { QueueModule } = await import('../../src/infra/queue/queue.module');
    const { HibpCatalogClient } = await import('../../src/infra/http/hibp-catalog.client');
    const { HibpClient } = await import('../../src/infra/http/hibp.client');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();

    expect(moduleRef.get('HIBP_CATALOG_CLIENT')).toBeInstanceOf(HibpCatalogClient);
    const client = moduleRef.get('HIBP_CLIENT');
    expect(client).toBeInstanceOf(HibpClient);
    await (client as any).shutdown();
  });

  it('closes the cache Redis connection on application shutdown', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { CacheModule } = await import('../../src/infra/cache/cache.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CacheModule],
    }).compile();

    const client = moduleRef.get('REDIS_CLIENT') as { quit: jest.Mock };
    await moduleRef.close();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('closes the queues before the HIBP client and the Redis connection on application shutdown', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { QueueModule } = await import('../../src/infra/queue/queue.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();

    const calls: string[] = [];
    for (const [token, name] of [['HIBP_QUEUE', 'hibp'], ['MONITORING_QUEUE', 'monitoring'], ['EMAIL_QUEUE', 'email']]) {
      (moduleRef.get(token) as { close: jest.Mock }).close.mockImplementation(async () => { calls.push(name); });
    }
    const client = moduleRef.get('HIBP_CLIENT') as { shutdown: () => Promise<void> };
    jest.spyOn(client, 'shutdown').mockImplementation(async () => { calls.push('client'); });
    const queueConnection = moduleRef.get('REDIS_QUEUE_CONNECTION') as { quit: jest.Mock };
    queueConnection.quit.mockImplementation(async () => { calls.push('redis'); });

    await moduleRef.close();

    expect(calls).toEqual(['hibp', 'monitoring', 'email', 'client', 'redis']);
  });

  it('keeps closing the other resources when one of them fails', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { QueueModule } = await import('../../src/infra/queue/queue.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();

    const hibpQueue = moduleRef.get('HIBP_QUEUE') as { close: jest.Mock };
    const emailQueue = moduleRef.get('EMAIL_QUEUE') as { close: jest.Mock };
    hibpQueue.close.mockImplementation(async () => { throw new Error('queue stuck'); });

    await moduleRef.close();

    expect(emailQueue.close).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
      event: 'shutdown.close_failed',
      resource: 'hibp-queue',
      err: { message: 'queue stuck' },
    });
  });

  it('throws when a real HIBP queue is requested without an API key', async () => {
    jest.resetModules();
    process.env.HIBP_USE_MOCK = 'false';
    delete process.env.HIBP_API_KEY;

    const compileModule = async () => {
      const { QueueModule } = await import('../../src/infra/queue/queue.module');
      await Test.createTestingModule({ imports: [QueueModule] }).compile();
    };

    await expect(compileModule()).rejects.toThrow(
      '[QueueModule] HIBP_API_KEY is required. Use the zeroed test key for the HIBP integration tests or set HIBP_USE_MOCK=true explicitly.',
    );
  });

  it('covers the mock HIBP client used in degraded test mode', async () => {
    const { MockHibpClient } = await import('../../src/infra/http/hibp.mock');
    const client = new MockHibpClient();

    await expect(client.checkAccount('breached@example.com')).resolves.toHaveLength(2);
    await expect(client.checkAccount('clean@example.com')).resolves.toEqual([]);

    const openListener = jest.fn();
    const closeListener = jest.fn();
    client.on('open', openListener);
    client.on('close', closeListener);
    await client.shutdown();

    expect(typeof client.on).toBe('function');
    expect(openListener).not.toHaveBeenCalled();
    expect(closeListener).not.toHaveBeenCalled();
  });

  it('runs Prisma lifecycle hooks and keeps the service behavior explicit', async () => {
    const { PrismaService } = await import('../../src/infra/database/prisma.service');
    const service = new PrismaService();

    service.$connect = jest.fn(async () => undefined) as any;
    service.$disconnect = jest.fn(async () => undefined) as any;

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(service.$connect).toHaveBeenCalledTimes(1);
    expect(service.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('initializes the Nest app with default middleware and bootstrap sequence', async () => {
    jest.resetModules();

    const httpServer = { keepAliveTimeout: 5_000, headersTimeout: 60_000 };
    const app = {
      enableShutdownHooks: jest.fn(),
      use: jest.fn(),
      enableCors: jest.fn(),
      useGlobalPipes: jest.fn(),
      getHttpServer: jest.fn(() => httpServer),
      listen: jest.fn((_port: number | string, callback?: () => void) => {
        if (callback) callback();
        return Promise.resolve(undefined);
      }),
    };

    const mockCreate = jest.fn(async () => app) as any;
    const mockSetup = jest.fn() as any;
    const mockDocument = jest.fn().mockReturnValue({}) as any;

    jest.doMock('@nestjs/core', () => ({
      NestFactory: {
        create: mockCreate,
      },
    }));

    jest.doMock('@nestjs/swagger', () => ({
      ApiTags: () => () => undefined,
      ApiOperation: () => () => undefined,
      ApiResponse: () => () => undefined,
      ApiBearerAuth: () => () => undefined,
      ApiProperty: () => () => undefined,
      ApiPropertyOptional: () => () => undefined,
      ApiQuery: () => () => undefined,
      ApiHeader: () => () => undefined,
      SwaggerModule: {
        createDocument: mockDocument,
        setup: mockSetup,
      },
      DocumentBuilder: jest.fn().mockImplementation(() => ({
        setTitle: () => ({
          setDescription: () => ({
            setVersion: () => ({
              addBearerAuth: () => ({
                addServer: () => ({
                  build: () => ({})
                })
              })
            })
          })
        })
      })),
    }));

    const { AppModule } = await import('../../src/app.module');
    expect(AppModule).toBeDefined();

    await import('../../src/main');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalled();
    expect(app.use).toHaveBeenCalled();
    // Keep-alive acima do idle timeout de 60 s do ALB, para não haver 502 em conexões reaproveitadas
    expect(httpServer.keepAliveTimeout).toBeGreaterThan(60_000);
    expect(httpServer.headersTimeout).toBeGreaterThan(httpServer.keepAliveTimeout);
  });

  it('starts only the application context when APP_ROLE=worker', async () => {
    jest.resetModules();
    process.env.APP_ROLE = 'worker';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const context = { enableShutdownHooks: jest.fn() };
    const mockCreate = jest.fn() as any;
    const mockCreateContext = jest.fn(async () => context) as any;

    jest.doMock('@nestjs/core', () => ({
      NestFactory: {
        create: mockCreate,
        createApplicationContext: mockCreateContext,
      },
    }));

    await import('../../src/main');
    await new Promise(resolve => setImmediate(resolve));

    expect(mockCreateContext).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(context.enableShutdownHooks).toHaveBeenCalledTimes(1);
  });

  it('initializes Swagger when the feature flag is enabled', async () => {
    jest.resetModules();
    process.env.SWAGGER_ENABLED = 'true';

    const httpServer = { keepAliveTimeout: 5_000, headersTimeout: 60_000 };
    const app = {
      enableShutdownHooks: jest.fn(),
      use: jest.fn(),
      enableCors: jest.fn(),
      useGlobalPipes: jest.fn(),
      getHttpServer: jest.fn(() => httpServer),
      listen: jest.fn((_port: number | string, callback?: () => void) => {
        if (callback) callback();
        return Promise.resolve(undefined);
      }),
    };

    const mockCreate = jest.fn(async () => app) as any;
    const mockSetup = jest.fn() as any;
    const mockDocument = jest.fn().mockReturnValue({}) as any;

    jest.doMock('@nestjs/core', () => ({
      NestFactory: {
        create: mockCreate,
      },
    }));

    jest.doMock('@nestjs/swagger', () => ({
      ApiTags: () => () => undefined,
      ApiOperation: () => () => undefined,
      ApiResponse: () => () => undefined,
      ApiBearerAuth: () => () => undefined,
      ApiProperty: () => () => undefined,
      ApiPropertyOptional: () => () => undefined,
      ApiQuery: () => () => undefined,
      ApiHeader: () => () => undefined,
      SwaggerModule: {
        createDocument: mockDocument,
        setup: mockSetup,
      },
      DocumentBuilder: jest.fn().mockImplementation(() => ({
        setTitle: () => ({
          setDescription: () => ({
            setVersion: () => ({
              addBearerAuth: () => ({
                addServer: () => ({
                  build: () => ({})
                })
              })
            })
          })
        })
      })),
    }));

    await import('../../src/main');
    expect(mockSetup).toHaveBeenCalled();
  });
});
