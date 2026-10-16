export const EMAIL_SENDER = 'EMAIL_SENDER';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Ex.: List-Unsubscribe e List-Unsubscribe-Post nos alertas */
  headers?: Record<string, string>;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ messageId: string }>;
}
