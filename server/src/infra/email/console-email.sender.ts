import { randomUUID } from 'crypto';
import { EmailMessage, EmailSender } from './email-sender.interface';
import { log, maskEmail } from '../../shared/utils/logger';

const MAX_KEPT_MESSAGES = 100;

/**
 * Dev/test: não envia nada. Loga o assunto e os links (para copiar o link de verificação),
 * sem o corpo inteiro. Guarda as mensagens em `sent` para os testes lerem o token.
 * Em produção os links não vão para o log: eles carregam tokens de verificação.
 */
export class ConsoleEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  constructor(private readonly logLinks = process.env.NODE_ENV !== 'production') {}

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const messageId = `console-${randomUUID()}`;
    const links = Array.from(new Set(message.text.match(/https?:\/\/\S+/g) || []));

    this.sent.push(message);
    // Só as últimas mensagens ficam em memória (elas carregam tokens)
    if (this.sent.length > MAX_KEPT_MESSAGES) {
      this.sent.shift();
    }
    log('info', 'Email', 'email.sent', {
      provider: 'console',
      to: maskEmail(message.to),
      subject: message.subject,
      ...(this.logLinks ? { links } : {}),
      messageId,
    });

    return { messageId };
  }

  /** Última mensagem enviada para o endereço (testes) */
  lastMessageTo(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find(message => message.to.toLowerCase() === to.toLowerCase());
  }

  clear(): void {
    this.sent.length = 0;
  }
}
