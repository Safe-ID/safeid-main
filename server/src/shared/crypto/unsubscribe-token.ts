import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Token do link de opt-out dos alertas: `${userId}.${base64url(HMAC-SHA256('unsub:' + userId))}`.
 * Não expira e não depende de login, para o link do e-mail (e o one-click do RFC 8058)
 * funcionarem sempre. Só permite desligar os alertas daquele usuário.
 */

const TOKEN_PATTERN = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

function getSecret(): string {
  const secret = (process.env.MONITORING_UNSUBSCRIBE_SECRET || '').trim();
  if (!secret) {
    throw new Error('MONITORING_UNSUBSCRIBE_SECRET is not configured.');
  }
  return secret;
}

function signature(userId: number, secret: string): string {
  return createHmac('sha256', secret).update(`unsub:${userId}`).digest('base64url');
}

export function signUnsubscribeToken(userId: number): string {
  return `${userId}.${signature(userId, getSecret())}`;
}

/** Devolve o userId do token, ou null se o token for inválido */
export function verifyUnsubscribeToken(token: string | undefined | null): number | null {
  const match = TOKEN_PATTERN.exec((token || '').trim());
  if (!match) {
    return null;
  }

  const userId = Number(match[1]);
  const expected = Buffer.from(signature(userId, getSecret()));
  const received = Buffer.from(match[2]);

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  return userId;
}
