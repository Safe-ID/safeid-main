import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../../infra/database/prisma.service';
import { EMAIL_SENDER, EmailSender } from '../../../infra/email/email-sender.interface';
import { buildVerifyEmail } from '../../../infra/email/templates/verify-email.template';
import { BreachAlertItem, buildNewBreachAlert } from '../../../infra/email/templates/new-breach-alert.template';
import {
  JOB_SEND_NEW_BREACH_ALERT,
  JOB_SEND_VERIFICATION_EMAIL,
  QUEUE_EMAIL,
} from '../../../infra/queue/queue.constants';
import { createBullConnection } from '../../../infra/queue/redis-connection';
import { runsWorkers } from '../../../shared/config/app-role';
import { getApiPublicUrl, getFrontendUrl } from '../../../shared/config/urls';
import { signUnsubscribeToken } from '../../../shared/crypto/unsubscribe-token';
import { log } from '../../../shared/utils/logger';
import { closeQuietly } from '../../../shared/utils/shutdown';

function sesMaxPerSecond(): number {
  const value = Number(process.env.SES_MAX_PER_SECOND);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function verificationTtlHours(): number {
  const hours = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours : 24;
}

/**
 * Worker da fila email: verificação de conta e alerta de vazamento novo.
 * O limiter segue a cota do SES (sandbox: 1/s; produção: até 14/s).
 */
@Injectable()
export class EmailProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private connection: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {}

  onModuleInit(): void {
    if (!runsWorkers()) {
      log('info', 'EmailProcessor', 'worker.disabled', { queue: QUEUE_EMAIL, reason: 'APP_ROLE=api' });
      return;
    }

    const maxPerSecond = sesMaxPerSecond();
    this.connection = createBullConnection();
    this.worker = new Worker(QUEUE_EMAIL, (job: Job) => this.process(job), {
      connection: this.connection,
      concurrency: maxPerSecond,
      limiter: { max: maxPerSecond, duration: 1000 },
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      const attempts = job?.opts?.attempts ?? 1;
      const finalAttempt = (job?.attemptsMade ?? 0) >= attempts;
      if (finalAttempt && job?.name === JOB_SEND_NEW_BREACH_ALERT) {
        void this.markAlertFailed(job.data?.notificationId);
      }
      log(finalAttempt ? 'warn' : 'info', 'EmailProcessor', finalAttempt ? 'email.failed' : 'email.retry', {
        type: job?.name,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        err: error,
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    const connection = this.connection;
    this.worker = null;
    this.connection = null;

    if (worker) {
      await closeQuietly('email-worker', () => worker.close());
    }
    if (connection) {
      await closeQuietly('redis-email-worker', () => connection.quit());
    }
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JOB_SEND_VERIFICATION_EMAIL:
        return this.sendVerificationEmail(job);
      case JOB_SEND_NEW_BREACH_ALERT:
        return this.sendNewBreachAlert(job);
      default:
        throw new Error(`Unknown job '${job.name}' in queue ${QUEUE_EMAIL}`);
    }
  }

  private async sendVerificationEmail(job: Job): Promise<{ sent: boolean; reason?: string }> {
    const { userId, token } = job.data || {};
    if (!userId || !token) {
      throw new Error('Job missing userId or token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });

    // Conta apagada ou já verificada (ex.: por outro link) entre o enfileiramento e o envio
    if (!user || user.emailVerifiedAt) {
      log('info', 'EmailProcessor', 'email.skipped', { type: job.name, userId, reason: user ? 'already_verified' : 'user_not_found' });
      return { sent: false, reason: user ? 'already_verified' : 'user_not_found' };
    }

    const verifyUrl = `${getFrontendUrl()}/?verify_token=${encodeURIComponent(token)}`;
    const email = buildVerifyEmail({ verifyUrl, ttlHours: verificationTtlHours() });
    await this.sender.send({ to: user.email, ...email });

    return { sent: true };
  }

  /**
   * T5.4: alerta de vazamento novo. Idempotente (não reenvia se já está SENT) e respeita
   * um opt-out feito entre a notificação e o envio.
   */
  async sendNewBreachAlert(job: Job): Promise<{ sent: boolean; reason?: string }> {
    const notificationId = Number(job.data?.notificationId);
    if (!notificationId) {
      throw new Error('Job missing notificationId');
    }

    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) {
      return { sent: false, reason: 'notification_not_found' };
    }
    if (notification.emailStatus === 'SENT') {
      return { sent: false, reason: 'already_sent' };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: notification.userId },
      select: { id: true, email: true, emailVerifiedAt: true, monitoringEnabled: true },
    });

    if (!user || !user.emailVerifiedAt || !user.monitoringEnabled) {
      await this.prisma.notification.update({ where: { id: notificationId }, data: { emailStatus: 'SKIPPED' } });
      log('info', 'EmailProcessor', 'email.skipped', { type: job.name, notificationId, reason: 'monitoring_disabled' });
      return { sent: false, reason: 'monitoring_disabled' };
    }

    const payload = (notification.payload ?? {}) as {
      breachNames?: string[];
      riskScoreAfter?: number;
      classification?: string;
    };
    const breachNames = Array.isArray(payload.breachNames) ? payload.breachNames : [];
    const unsubscribeUrl = `${getApiPublicUrl()}/api/v1/monitoring/unsubscribe?token=${encodeURIComponent(
      signUnsubscribeToken(user.id),
    )}`;

    const email = buildNewBreachAlert({
      breaches: await this.loadAlertItems(breachNames),
      riskScore: payload.riskScoreAfter ?? 0,
      classification: payload.classification ?? '',
      dashboardUrl: `${getFrontendUrl()}/`,
      unsubscribeUrl,
    });

    await this.sender.send({
      to: user.email,
      ...email,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { emailStatus: 'SENT', emailSentAt: new Date() },
    });

    return { sent: true };
  }

  /** Título, data e dados expostos de cada vazamento, a partir do catálogo local */
  private async loadAlertItems(names: string[]): Promise<BreachAlertItem[]> {
    const rows = await this.prisma.breachCatalog.findMany({
      where: { name: { in: names } },
      select: { name: true, title: true, breachDate: true, dataClasses: true },
    });
    const byName = new Map(rows.map(row => [row.name, row]));

    return names.map(name => {
      const row = byName.get(name);
      return {
        title: row?.title || name,
        breachDate: row?.breachDate ? row.breachDate.toISOString() : null,
        dataClasses: Array.isArray(row?.dataClasses) ? (row!.dataClasses as string[]) : [],
      };
    });
  }

  private async markAlertFailed(notificationId: unknown): Promise<void> {
    const id = Number(notificationId);
    if (!id) {
      return;
    }

    try {
      await this.prisma.notification.updateMany({
        where: { id, emailStatus: 'PENDING' },
        data: { emailStatus: 'FAILED' },
      });
    } catch (error) {
      log('warn', 'EmailProcessor', 'email.status_update_failed', { notificationId: id, err: error });
    }
  }
}
