import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { EmailMessage, EmailSender } from './email-sender.interface';
import { log, maskEmail } from '../../shared/utils/logger';

export interface SesEmailSenderOptions {
  region: string;
  from: string;
  replyTo?: string;
  configurationSet?: string;
}

/**
 * Envio pelo Amazon SES v2. As credenciais vêm da task role do ECS
 * (cadeia padrão do SDK), nunca de chaves no .env.
 */
export class SesEmailSender implements EmailSender {
  constructor(
    private readonly options: SesEmailSenderOptions,
    private readonly client: SESv2Client = new SESv2Client({ region: options.region }),
  ) {}

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const headers = Object.entries(message.headers || {}).map(([Name, Value]) => ({ Name, Value }));

    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.options.from,
        Destination: { ToAddresses: [message.to] },
        ReplyToAddresses: this.options.replyTo ? [this.options.replyTo] : undefined,
        ConfigurationSetName: this.options.configurationSet || undefined,
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
            Headers: headers.length > 0 ? headers : undefined,
          },
        },
      }),
    );

    const messageId = result.MessageId || '';
    log('info', 'Email', 'email.sent', { provider: 'ses', to: maskEmail(message.to), messageId });
    return { messageId };
  }
}
