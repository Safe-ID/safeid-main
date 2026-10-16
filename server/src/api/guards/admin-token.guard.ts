import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Rotas operacionais (ex.: /api/health/jobs): exigem o header X-Admin-Token igual ao ADMIN_TOKEN.
 * Sem ADMIN_TOKEN configurado a rota fica desligada (403). A comparação é por hash e
 * timingSafeEqual, para não revelar o token pelo tempo de resposta.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = (process.env.ADMIN_TOKEN || '').trim();
    if (!expected) {
      throw new ForbiddenException('Rota administrativa desativada (ADMIN_TOKEN não configurado).');
    }

    const request = context.switchToHttp().getRequest();
    const header = request.headers?.['x-admin-token'];
    const received = typeof header === 'string' ? header.trim() : '';

    if (!received || !timingSafeEqual(digest(received), digest(expected))) {
      throw new UnauthorizedException('Token administrativo inválido.');
    }

    return true;
  }
}
