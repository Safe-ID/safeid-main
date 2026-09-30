import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '@infra/database/prisma.service';

// Tempo máximo para cada verificação, para o health check não ficar pendurado
const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), CHECK_TIMEOUT_MS),
    ),
  ]);
}

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp: string;
  database?: {
    status: 'ok' | 'error';
    message?: string;
  };
  redis?: {
    status: 'ok' | 'error';
    message?: string;
  };
}

@Injectable()
export class HealthService {
  constructor(
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private redis: Redis,
  ) {}

  async getHealth(): Promise<HealthStatus> {
    const health: HealthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    try {
      // Check database connection
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 'Database');
      health.database = {
        status: 'ok',
      };
    } catch (error) {
      health.status = 'error';
      health.database = {
        status: 'error',
        message: 'Database connection failed',
      };
    }

    try {
      // Redis guarda o cache e a fila do HIBP: sem ele nenhum scan funciona
      await withTimeout(this.redis.ping(), 'Redis');
      health.redis = {
        status: 'ok',
      };
    } catch (error) {
      health.status = 'error';
      health.redis = {
        status: 'error',
        message: 'Redis connection failed',
      };
    }

    return health;
  }
}
