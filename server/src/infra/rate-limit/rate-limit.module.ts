/**
 * RateLimitModule
 * Limita a quantidade de requisições por IP para evitar força bruta no login
 * e consumo abusivo da API do HIBP.
 */

import { Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

const MINUTE = 60 * 1000;

// Limites mais apertados para as rotas sensíveis (sobrescrevem o limite geral)
export const RATE_LIMITS = {
  login: { default: { limit: 5, ttl: MINUTE } },
  signup: { default: { limit: 5, ttl: 15 * MINUTE } },
  scan: { default: { limit: 5, ttl: 15 * MINUTE } },
};

/**
 * Atrás do CloudFront/ALB todas as requisições chegam com o IP do proxy.
 * O IP do cliente vem no primeiro item do X-Forwarded-For, então ele é usado
 * quando existe, sem precisar configurar nada no Express.
 */
export function getClientIp(req: Record<string, any>): string {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const clientIp = typeof firstForwarded === 'string' ? firstForwarded.split(',')[0].trim() : '';

  return clientIp || req.ip || req.socket?.remoteAddress || 'unknown';
}

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return getClientIp(req);
  }
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          {
            name: 'default',
            ttl: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * MINUTE,
            limit: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
          },
        ],
        errorMessage: 'Muitas requisições. Aguarde alguns minutos e tente novamente.',
      }),
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ClientIpThrottlerGuard,
    },
  ],
})
export class RateLimitModule {}
