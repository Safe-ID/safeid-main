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
  verifyEmail: { default: { limit: 10, ttl: 15 * MINUTE } },
  resendVerification: { default: { limit: 5, ttl: 15 * MINUTE } },
  refresh: { default: { limit: 20, ttl: 15 * MINUTE } },
  unsubscribe: { default: { limit: 20, ttl: 15 * MINUTE } },
  forgotPassword: { default: { limit: 5, ttl: 15 * MINUTE } },
  resetPassword: { default: { limit: 10, ttl: 15 * MINUTE } },
  changePassword: { default: { limit: 5, ttl: 15 * MINUTE } },
  exportData: { default: { limit: 5, ttl: 15 * MINUTE } },
};

// Quantos proxies confiáveis ficam na frente da aplicação (ALB = 1; com CloudFront na
// frente da API também, seriam 2). Cada um acrescenta ao fim do X-Forwarded-For o IP de
// quem o chamou, então o IP real do cliente é o que o proxy mais próximo escreveu.
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);

/**
 * IP do cliente para o rate limit. O X-Forwarded-For é uma lista "cliente, proxy1, proxy2":
 * os itens da esquerda vêm do cliente e podem ser forjados; só os que os proxies confiáveis
 * acrescentam à direita são confiáveis. Por isso usamos o item a TRUSTED_PROXY_HOPS posições
 * do fim — o que o proxy mais externo registrou — e não o primeiro, que o cliente controla.
 */
export function getClientIp(req: Record<string, any>): string {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(forwardedFor) ? forwardedFor : typeof forwardedFor === 'string' ? [forwardedFor] : [];
  const ips = raw.flatMap((value) => String(value).split(',')).map((ip) => ip.trim()).filter(Boolean);

  if (ips.length > 0) {
    return ips[Math.max(0, ips.length - TRUSTED_PROXY_HOPS)];
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
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
