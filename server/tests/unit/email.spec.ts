import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { ConsoleEmailSender } from '../../src/infra/email/console-email.sender';
import { SesEmailSender } from '../../src/infra/email/ses-email.sender';
import { createEmailSender } from '../../src/infra/email/email.module';
import { buildVerifyEmail } from '../../src/infra/email/templates/verify-email.template';
import { buildNewBreachAlert } from '../../src/infra/email/templates/new-breach-alert.template';
import { escapeHtml } from '../../src/infra/email/templates/layout';
import { translateDataClass } from '../../src/shared/utils/data-classes';

const EMAIL_ENV = ['EMAIL_PROVIDER', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'SES_CONFIGURATION_SET', 'AWS_SES_REGION', 'NODE_ENV'];

const message = {
  to: 'User@Example.com',
  subject: 'Confirme seu e-mail no SafeID',
  html: '<p>corpo secreto</p>',
  text: 'Abra https://safeid.app.br/?verify_token=abc123 para confirmar. corpo secreto',
};

describe('ConsoleEmailSender', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs subject and links but never the body or the plain e-mail', async () => {
    const sender = new ConsoleEmailSender(true);

    const result = await sender.send(message);

    expect(result.messageId).toMatch(/^console-/);
    const line = logSpy.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({
      event: 'email.sent',
      provider: 'console',
      subject: message.subject,
      links: ['https://safeid.app.br/?verify_token=abc123'],
    });
    expect(line).not.toContain('corpo secreto');
    expect(line).not.toContain('User@Example.com');
  });

  it('hides links (tokens) when running in production', async () => {
    await new ConsoleEmailSender(false).send(message);

    expect(JSON.parse(logSpy.mock.calls[0][0] as string).links).toBeUndefined();
  });

  it('keeps the last messages for tests and caps the history', async () => {
    const sender = new ConsoleEmailSender(true);
    for (let i = 0; i < 105; i++) {
      await sender.send({ ...message, to: `user${i}@example.com` });
    }
    await sender.send(message);

    expect(sender.sent).toHaveLength(100);
    expect(sender.lastMessageTo('user@example.com')).toEqual(message);
    expect(sender.lastMessageTo('user0@example.com')).toBeUndefined();

    sender.clear();
    expect(sender.sent).toHaveLength(0);
  });
});

describe('SesEmailSender', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends a simple UTF-8 message with reply-to, configuration set and custom headers', async () => {
    const client = { send: jest.fn(async (_command: unknown) => ({ MessageId: 'ses-123' })) };
    const sender = new SesEmailSender(
      { region: 'us-east-1', from: 'SafeID <alertas@safeid.app.br>', replyTo: 'projeto@gmail.com', configurationSet: 'safeid-default' },
      client as any,
    );

    const result = await sender.send({
      ...message,
      headers: { 'List-Unsubscribe': '<https://api/unsub>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });

    expect(result).toEqual({ messageId: 'ses-123' });
    const command = (client.send.mock.calls[0] as unknown[])[0] as unknown as SendEmailCommand;
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: 'SafeID <alertas@safeid.app.br>',
      Destination: { ToAddresses: ['User@Example.com'] },
      ReplyToAddresses: ['projeto@gmail.com'],
      ConfigurationSetName: 'safeid-default',
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: message.html, Charset: 'UTF-8' },
            Text: { Data: message.text, Charset: 'UTF-8' },
          },
          Headers: [
            { Name: 'List-Unsubscribe', Value: '<https://api/unsub>' },
            { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
          ],
        },
      },
    });
  });

  it('omits optional fields when they are not configured', async () => {
    const client = { send: jest.fn(async (_command: unknown) => ({})) };
    const sender = new SesEmailSender({ region: 'us-east-1', from: 'alertas@safeid.app.br' }, client as any);

    await expect(sender.send(message)).resolves.toEqual({ messageId: '' });

    const input = ((client.send.mock.calls[0] as unknown[])[0] as any).input;
    expect(input.ReplyToAddresses).toBeUndefined();
    expect(input.ConfigurationSetName).toBeUndefined();
    expect(input.Content.Simple.Headers).toBeUndefined();
  });

  it('creates its own SES client when none is given', () => {
    expect(new SesEmailSender({ region: 'us-east-1', from: 'a@safeid.app.br' })).toBeInstanceOf(SesEmailSender);
  });
});

describe('createEmailSender', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    EMAIL_ENV.forEach(key => {
      saved[key] = process.env[key];
      delete process.env[key];
    });
  });

  afterEach(() => {
    EMAIL_ENV.forEach(key => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    jest.restoreAllMocks();
  });

  it('uses the console sender by default', () => {
    expect(createEmailSender()).toBeInstanceOf(ConsoleEmailSender);
  });

  it('uses SES when configured and requires EMAIL_FROM', () => {
    process.env.EMAIL_PROVIDER = 'ses';
    expect(() => createEmailSender()).toThrow('EMAIL_FROM is required');

    process.env.EMAIL_FROM = 'SafeID <alertas@safeid.app.br>';
    process.env.EMAIL_REPLY_TO = 'projeto@gmail.com';
    process.env.SES_CONFIGURATION_SET = 'safeid-default';
    expect(createEmailSender()).toBeInstanceOf(SesEmailSender);
  });

  it('rejects unknown providers and warns about console in production', () => {
    process.env.EMAIL_PROVIDER = 'smtp';
    expect(() => createEmailSender()).toThrow("Unknown EMAIL_PROVIDER 'smtp'");

    process.env.EMAIL_PROVIDER = 'console';
    process.env.NODE_ENV = 'production';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(createEmailSender()).toBeInstanceOf(ConsoleEmailSender);
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({ event: 'email.console_in_production' });
  });
});

describe('email templates', () => {
  it('builds the verification e-mail in HTML and text with the link and validity', () => {
    const verifyUrl = 'https://safeid.app.br/?verify_token=abc&x=1';
    const email = buildVerifyEmail({ verifyUrl, ttlHours: 24 });

    expect(email.subject).toBe('Confirme seu e-mail no SafeID');
    expect(email.html).toContain('href="https://safeid.app.br/?verify_token=abc&amp;x=1"');
    expect(email.html).toContain('24 horas');
    expect(email.html).toContain('<html lang="pt-BR">');
    expect(email.text).toContain(verifyUrl);
    expect(email.text).toContain('24 horas');
    expect(buildVerifyEmail({ verifyUrl, ttlHours: 1 }).text).toContain('1 hora.');
  });

  it('builds the new breach alert without AI content and with the unsubscribe link', () => {
    const email = buildNewBreachAlert({
      breaches: [
        { title: 'ShopBR <script>', breachDate: '2025-11-03', dataClasses: ['Passwords', 'Phone numbers', 'Unknown class'] },
        { title: 'Outro', breachDate: null, dataClasses: [] },
      ],
      riskScore: 74,
      classification: 'HIGH',
      dashboardUrl: 'https://safeid.app.br/',
      unsubscribeUrl: 'https://api.safeid.app.br/api/v1/monitoring/unsubscribe?token=7.sig',
    });

    expect(email.subject).toBe('Seu e-mail apareceu em 2 novos vazamentos');
    expect(email.html).toContain('ShopBR &lt;script&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('Senhas, Números de telefone, Unknown class');
    expect(email.html).toContain('03/11/2025');
    expect(email.html).toContain('74/100');
    expect(email.html).toContain('(Alto)');
    expect(email.html).toContain('monitoring/unsubscribe?token=7.sig');
    expect(email.text).toContain('- Outro (data não informada)\n  Dados expostos: não informado');
    expect(email.text).toContain('https://safeid.app.br/');

    const single = buildNewBreachAlert({
      breaches: [{ title: 'Uno', breachDate: 'not-a-date', dataClasses: ['Passwords'] }],
      riskScore: 20,
      classification: 'UNKNOWN',
      dashboardUrl: 'https://safeid.app.br/',
      unsubscribeUrl: 'https://u',
    });
    expect(single.subject).toBe('Seu e-mail apareceu em 1 novo vazamento');
    expect(single.text).toContain('Uno (not-a-date)');
    expect(single.text).toContain('(UNKNOWN)');
  });

  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('translates HIBP data classes like the client does', () => {
    expect(translateDataClass('Passwords')).toBe('Senhas');
    expect(translateDataClass('Something new')).toBe('Something new');
  });
});
