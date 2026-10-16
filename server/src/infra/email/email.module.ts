import { Global, Module } from '@nestjs/common';
import { EMAIL_SENDER, EmailSender } from './email-sender.interface';
import { ConsoleEmailSender } from './console-email.sender';
import { SesEmailSender } from './ses-email.sender';
import { log } from '../../shared/utils/logger';

export function createEmailSender(): EmailSender {
  const provider = (process.env.EMAIL_PROVIDER || 'console').trim().toLowerCase();

  if (provider === 'ses') {
    const from = (process.env.EMAIL_FROM || '').trim();
    if (!from) {
      throw new Error('[EmailModule] EMAIL_FROM is required when EMAIL_PROVIDER=ses.');
    }

    return new SesEmailSender({
      region: (process.env.AWS_SES_REGION || process.env.AWS_REGION || 'us-east-1').trim(),
      from,
      replyTo: (process.env.EMAIL_REPLY_TO || '').trim() || undefined,
      configurationSet: (process.env.SES_CONFIGURATION_SET || '').trim() || undefined,
    });
  }

  if (provider !== 'console') {
    throw new Error(`[EmailModule] Unknown EMAIL_PROVIDER '${provider}'. Use 'console' or 'ses'.`);
  }

  if (process.env.NODE_ENV === 'production') {
    log('warn', 'EmailModule', 'email.console_in_production', {
      message: 'EMAIL_PROVIDER=console em produção: nenhum e-mail será enviado.',
    });
  }

  return new ConsoleEmailSender();
}

@Global()
@Module({
  providers: [{ provide: EMAIL_SENDER, useFactory: createEmailSender }],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
