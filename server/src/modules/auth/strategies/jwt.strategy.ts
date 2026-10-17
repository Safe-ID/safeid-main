/**
 * JWT Strategy for Passport
 * Extrai o token do header Authorization: Bearer <token>
 * Valida assinatura e expiration, e confere no banco se a conta existe e tem o email verificado
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { JwtPayload } from '../dto/auth.dto';
import { PrismaService } from '../../../infra/database/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // O refresh token só serve na rota /auth/refresh
    if (!payload.sub || !payload.email || payload.typ === 'refresh') {
      throw new UnauthorizedException('Invalid token');
    }

    // Token emitido antes da verificação obrigatória, ou de conta já apagada
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { emailVerifiedAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException({ code: 'EMAIL_NOT_VERIFIED', message: 'Email não verificado' });
    }

    return payload;
  }
}
