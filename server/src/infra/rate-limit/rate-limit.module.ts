/**
 * RateLimitModule
 * Limita a quantidade de requisições por IP para evitar força bruta no login
 * e consumo abusivo da API do HIBP.
 */

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

const MINUTE = 60 * 1000;

// Limites mais apertados para as rotas sensíveis (sobrescrevem o limite geral)
export const RATE_LIMITS = {
  login: { default: { limit: 5, ttl: MINUTE } },
  signup: { default: { limit: 5, ttl: 15 * MINUTE } },
  scan: { default: { limit: 5, ttl: 15 * MINUTE } },
};

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
      useClass: ThrottlerGuard,
    },
  ],
})
export class RateLimitModule {}
