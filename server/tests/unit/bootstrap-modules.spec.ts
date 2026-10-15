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

jest.mock('../../src/infra/queue/hibp.worker', () => ({
  createHibpWorker: jest.fn(() => ({ on: jest.fn(), close: jest.fn() })),
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

  it('creates the HIBP queue from the queue module factory', async () => {
    const { QueueModule } = await import('../../src/infra/queue/queue.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();

    const queue = moduleRef.get('HIBP_QUEUE');
    expect(queue).toBeDefined();
    expect((require('bullmq').Queue as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((require('bullmq').Queue as jest.Mock).mock.calls.at(-1)?.[1]).toMatchObject({
      defaultJobOptions: {
        removeOnComplete: { age: 60 },
        removeOnFail: { age: 600 },
      },
    });
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

  it('closes the worker before the queue and the Redis connections on application shutdown', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { QueueModule } = await import('../../src/infra/queue/queue.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();

    const calls: string[] = [];
    const worker = moduleRef.get('HIBP_WORKER') as { close: jest.Mock };
    const queue = moduleRef.get('HIBP_QUEUE') as { close: jest.Mock };
    const queueConnection = moduleRef.get('REDIS_QUEUE_CONNECTION') as { quit: jest.Mock };
    const workerConnection = moduleRef.get('REDIS_WORKER_CONNECTION') as { quit: jest.Mock };
    worker.close.mockImplementation(async () => { calls.push('worker'); });
    queue.close.mockImplementation(async () => { calls.push('queue'); });
    queueConnection.quit.mockImplementation(async () => { calls.push('redis-queue'); });
    workerConnection.quit.mockImplementation(async () => { calls.push('redis-worker'); });

    await moduleRef.close();

    expect(calls).toEqual(['worker', 'queue', 'redis-queue', 'redis-worker']);
  });

  it('keeps closing the other resources when one of them fails', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { QueueModule } = await import('../../src/infra/queue/queue.module');
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();

    const worker = moduleRef.get('HIBP_WORKER') as { close: jest.Mock };
    const queue = moduleRef.get('HIBP_QUEUE') as { close: jest.Mock };
    worker.close.mockImplementation(async () => { throw new Error('worker stuck'); });

    await moduleRef.close();

    expect(queue.close).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
      event: 'shutdown.close_failed',
      resource: 'hibp-worker',
      err: { message: 'worker stuck' },
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

    const app = {
      enableShutdownHooks: jest.fn(),
      use: jest.fn(),
      enableCors: jest.fn(),
      useGlobalPipes: jest.fn(),
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
  });

  it('initializes Swagger when the feature flag is enabled', async () => {
    jest.resetModules();
    process.env.SWAGGER_ENABLED = 'true';

    const app = {
      enableShutdownHooks: jest.fn(),
      use: jest.fn(),
      enableCors: jest.fn(),
      useGlobalPipes: jest.fn(),
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
