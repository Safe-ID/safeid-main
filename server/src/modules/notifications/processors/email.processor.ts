import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../../infra/database/prisma.service';
import { EMAIL_SENDER, EmailSender } from '../../../infra/email/email-sender.interface';
import { buildVerifyEmail } from '../../../infra/email/templates/verify-email.template';
import { JOB_SEND_VERIFICATION_EMAIL, QUEUE_EMAIL } from '../../../infra/queue/queue.constants';
import { createBullConnection } from '../../../infra/queue/redis-connection';
import { runsWorkers } from '../../../shared/config/app-role';
import { getFrontendUrl } from '../../../shared/config/urls';
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
 * Worker da fila email. O limiter segue a cota do SES (sandbox: 1/s; produção: até 14/s).
 * Os alertas de vazamento novo (send-new-breach-alert) entram com as notificações.
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
}
