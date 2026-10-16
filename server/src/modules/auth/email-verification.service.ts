import { BadRequestException, GoneException, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../infra/database/prisma.service';
import { EMAIL_QUEUE, JOB_SEND_VERIFICATION_EMAIL } from '../../infra/queue/queue.constants';
import { log } from '../../shared/utils/logger';

const RESEND_COOLDOWN_S = 60;
const RESEND_DAILY_LIMIT = 5;
const DAY_S = 24 * 3600;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenTtlHours(): number {
  const hours = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours : 24;
}

/**
 * Tokens de verificação de e-mail. Só o SHA-256 do token vai para o banco;
 * o token em claro existe apenas no link do e-mail (e no job, apagado ao concluir).
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Inject(EMAIL_QUEUE) private readonly emailQueue: Queue,
  ) {}

  /** Gera um token novo (32 bytes, base64url) e invalida os anteriores não usados */
  async issueToken(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + tokenTtlHours() * 3600 * 1000),
        },
      }),
    ]);

    return token;
  }

  /** Gera o token e enfileira o e-mail com o link */
  async sendVerificationEmail(userId: number): Promise<void> {
    const token = await this.issueToken(userId);

    await this.emailQueue.add(
      JOB_SEND_VERIFICATION_EMAIL,
      { userId, token },
      { attempts: 5, backoff: { type: 'exponential', delay: 30_000 } },
    );

    log('info', 'EmailVerification', 'verification.email_enqueued', { userId });
  }

  /**
   * Consome o token: inválido → 400 TOKEN_INVALID; usado ou expirado → 410 TOKEN_EXPIRED.
   * Marca o token como usado e o e-mail como verificado na mesma transação.
   */
  async consumeToken(token: string): Promise<{ id: number; email: string; emailVerifiedAt: Date | null }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token || '') },
    });

    if (!record) {
      throw new BadRequestException({ code: 'TOKEN_INVALID', message: 'Link de verificação inválido.' });
    }

    const now = new Date();
    if (record.usedAt || record.expiresAt.getTime() <= now.getTime()) {
      throw new GoneException({ code: 'TOKEN_EXPIRED', message: 'Este link de verificação expirou ou já foi usado.' });
    }

    const [consumed, user] = await this.prisma.$transaction(async tx => {
      // Condicional: duas requisições com o mesmo token não verificam duas vezes
      const updated = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });

      if (updated.count === 0) {
        return [0, null] as const;
      }

      const current = await tx.user.findUniqueOrThrow({ where: { id: record.userId } });
      const verified = current.emailVerifiedAt
        ? current
        : await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } });

      return [updated.count, verified] as const;
    });

    if (!consumed || !user) {
      throw new GoneException({ code: 'TOKEN_EXPIRED', message: 'Este link de verificação expirou ou já foi usado.' });
    }

    log('info', 'EmailVerification', 'verification.completed', { userId: user.id });
    return { id: user.id, email: user.email, emailVerifiedAt: user.emailVerifiedAt };
  }

  /**
   * Limite de reenvio por e-mail: 1 a cada 60 s e no máximo 5 por dia.
   * Consome uma tentativa quando devolve true.
   */
  async canResend(email: string): Promise<boolean> {
    const key = sha256(email.trim().toLowerCase());

    const cooldown = await this.redis.set(`verify:resend:${key}`, '1', 'EX', RESEND_COOLDOWN_S, 'NX');
    if (cooldown !== 'OK') {
      return false;
    }

    const dailyKey = `verify:resend:day:${key}`;
    const count = await this.redis.incr(dailyKey);
    if (count === 1) {
      await this.redis.expire(dailyKey, DAY_S);
    }

    return count <= RESEND_DAILY_LIMIT;
  }

  /**
   * Limpeza (job cleanup-unverified, agendado na fase de monitoramento):
   * contas por senha nunca verificadas e tokens expirados há mais de 7 dias.
   */
  async cleanupUnverified(now = new Date()): Promise<{ users: number; tokens: number }> {
    const ttlDays = Number(process.env.UNVERIFIED_ACCOUNT_TTL_DAYS);
    const accountTtlDays = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 7;

    const users = await this.prisma.user.deleteMany({
      where: {
        emailVerifiedAt: null,
        googleId: null,
        createdAt: { lt: new Date(now.getTime() - accountTtlDays * DAY_S * 1000) },
      },
    });

    const tokens = await this.prisma.emailVerificationToken.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 7 * DAY_S * 1000) } },
    });

    log('info', 'EmailVerification', 'verification.cleanup', { users: users.count, tokens: tokens.count });
    return { users: users.count, tokens: tokens.count };
  }
}
