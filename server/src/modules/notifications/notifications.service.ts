import { Inject, Injectable } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '../../infra/database/prisma.service';
import { EMAIL_QUEUE, JOB_SEND_NEW_BREACH_ALERT } from '../../infra/queue/queue.constants';
import { UserBreachRepository } from '../breaches/user-breach.repository';
import { log } from '../../shared/utils/logger';

export interface NewBreachNotificationInput {
  userId: number;
  breaches: Array<{ name: string; title: string }>;
  scan: { jobId: string; riskScore: number; classification: string };
  riskScoreBefore: number | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

/**
 * Notificações de vazamento novo (in-app + e-mail). Idempotente pela chave
 * (userId, dedupeKey): o mesmo conjunto de vazamentos nunca gera dois avisos.
 * A listagem, a leitura e o envio do alerta por e-mail entram com a F5.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userBreaches: UserBreachRepository,
    @Inject(EMAIL_QUEUE) private readonly emailQueue: Queue,
  ) {}

  static dedupeKey(type: string, names: string[]): string {
    return createHash('sha256').update(`${type}:${[...names].sort().join('|')}`).digest('hex');
  }

  /** Devolve a notificação criada, ou null se ela já existia (reprocessamento) */
  async createNewBreach(input: NewBreachNotificationInput): Promise<Notification | null> {
    const names = input.breaches.map(breach => breach.name);
    const count = names.length;
    const title = `Seu e-mail apareceu em ${count} ${count === 1 ? 'novo vazamento' : 'novos vazamentos'}`;
    const body = input.breaches.map(breach => breach.title || breach.name).join(', ');

    let notification: Notification;
    try {
      notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: 'NEW_BREACH',
          title,
          body,
          dedupeKey: NotificationsService.dedupeKey('NEW_BREACH', names),
          payload: {
            breachNames: names,
            scanJobId: input.scan.jobId,
            riskScoreBefore: input.riskScoreBefore,
            riskScoreAfter: input.scan.riskScore,
            classification: input.scan.classification,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Já avisado antes: só garante que os vazamentos fiquem marcados
      await this.userBreaches.markNotified(input.userId, names);
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { emailVerifiedAt: true, monitoringEnabled: true },
    });

    if (user?.emailVerifiedAt && user.monitoringEnabled) {
      await this.emailQueue.add(
        JOB_SEND_NEW_BREACH_ALERT,
        { notificationId: notification.id },
        { jobId: `email-notif-${notification.id}`, attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
      );
    } else {
      notification = await this.prisma.notification.update({
        where: { id: notification.id },
        data: { emailStatus: 'SKIPPED' },
      });
    }

    await this.userBreaches.markNotified(input.userId, names);
    log('info', 'Notifications', 'notification.created', {
      userId: input.userId,
      notificationId: notification.id,
      count,
      emailStatus: notification.emailStatus,
    });

    return notification;
  }
}
