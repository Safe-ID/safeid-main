import { BadRequestException, GoneException, Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../infra/database/prisma.service';
import { EMAIL_QUEUE, JOB_SEND_PASSWORD_CHANGED, JOB_SEND_PASSWORD_RESET } from '../../infra/queue/queue.constants';
import { log } from '../../shared/utils/logger';

export const RESET_TOKEN_TTL_MINUTES = 60;
const REQUEST_COOLDOWN_S = 60;
const REQUEST_DAILY_LIMIT = 5;
const DAY_S = 24 * 3600;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Recuperação e troca de senha. Como na verificação de e-mail, só o SHA-256 do token vai
 * para o banco. Trocar a senha grava passwordChangedAt: tokens de sessão mais antigos
 * deixam de valer, o que derruba quem estiver usando a conta sem autorização.
 */
@Injectable()
export class PasswordService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Inject(EMAIL_QUEUE) private readonly emailQueue: Queue,
  ) {}

  /**
   * Pede o link de recuperação. A resposta é a mesma exista a conta ou não, para não revelar
   * quais e-mails têm cadastro. Conta só do Google também recebe: o link prova a posse do e-mail.
   */
  async requestReset(rawEmail: string): Promise<{ message: string }> {
    const email = rawEmail.trim().toLowerCase();
    const response = { message: 'Se houver uma conta com este email, enviamos um link para criar uma nova senha.' };

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });

    if (!user || !user.emailVerifiedAt || !(await this.canRequest(email))) {
      return response;
    }

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
        },
      }),
    ]);

    // O token em claro não fica na fila depois do envio
    await this.emailQueue.add(
      JOB_SEND_PASSWORD_RESET,
      { userId: user.id, token },
      { attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: true },
    );

    log('info', 'PasswordService', 'password.reset_requested', { userId: user.id });
    return response;
  }

  /** Inválido → 400 TOKEN_INVALID; usado ou expirado → 410 TOKEN_EXPIRED */
  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token || '') } });
    if (!record) {
      throw new BadRequestException({ code: 'TOKEN_INVALID', message: 'Link de recuperação inválido.' });
    }

    const now = new Date();
    const expired = () => new GoneException({ code: 'TOKEN_EXPIRED', message: 'Este link expirou ou já foi usado. Peça um novo.' });
    if (record.usedAt || record.expiresAt.getTime() <= now.getTime()) {
      throw expired();
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const consumed = await this.prisma.$transaction(async tx => {
      // Condicional: duas requisições com o mesmo token não trocam a senha duas vezes
      const updated = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } });
      if (updated.count === 0) {
        return false;
      }
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash, passwordChangedAt: now } });
      return true;
    });

    if (!consumed) {
      throw expired();
    }

    await this.notifyPasswordChanged(record.userId);
    log('info', 'PasswordService', 'password.reset_completed', { userId: record.userId });
    return { message: 'Senha alterada. Entre com a nova senha.' };
  }

  /** Códigos 400 (não 401): o cliente trata 401 como sessão vencida e tentaria renovar */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });

    if (!user?.passwordHash) {
      throw new BadRequestException({
        code: 'NO_PASSWORD',
        message: 'Esta conta entra pelo Google e ainda não tem senha. Use "Esqueci minha senha" na tela de login para criar uma.',
      });
    }

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException({ code: 'INVALID_CURRENT_PASSWORD', message: 'A senha atual está incorreta.' });
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException({ code: 'SAME_PASSWORD', message: 'A nova senha precisa ser diferente da atual.' });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date() },
    });

    await this.notifyPasswordChanged(userId);
    log('info', 'PasswordService', 'password.changed', { userId });
  }

  /** O aviso não pode impedir a troca: a senha já mudou */
  private async notifyPasswordChanged(userId: number): Promise<void> {
    try {
      await this.emailQueue.add(JOB_SEND_PASSWORD_CHANGED, { userId }, { attempts: 5, backoff: { type: 'exponential', delay: 30_000 } });
    } catch (error) {
      log('warn', 'PasswordService', 'password.notice_failed', { userId, err: error });
    }
  }

  /** 1 pedido a cada 60 s e até 5 por dia, por e-mail */
  private async canRequest(email: string): Promise<boolean> {
    const key = sha256(email);
    const cooldown = await this.redis.set(`password:reset:${key}`, '1', 'EX', REQUEST_COOLDOWN_S, 'NX');
    if (cooldown !== 'OK') {
      return false;
    }

    const dailyKey = `password:reset:day:${key}`;
    const count = await this.redis.incr(dailyKey);
    if (count === 1) {
      await this.redis.expire(dailyKey, DAY_S);
    }
    return count <= REQUEST_DAILY_LIMIT;
  }
}
