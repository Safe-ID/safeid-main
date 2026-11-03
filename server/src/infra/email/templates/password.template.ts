import { escapeHtml, legalFooterText, renderButton, renderLayout, renderMuted, renderParagraph, RenderedEmail } from './layout';

export function buildPasswordResetEmail(input: { resetUrl: string; ttlMinutes: number }): RenderedEmail {
  const subject = 'Crie uma nova senha no SafeID';
  const validity = `${input.ttlMinutes} minutos`;

  const html = renderLayout({
    title: subject,
    preheader: 'Use o link para criar uma nova senha.',
    bodyHtml: [
      renderParagraph('Recebemos um pedido para criar uma nova senha na sua conta do SafeID:'),
      `<p style="margin:0 0 24px">${renderButton('Criar nova senha', input.resetUrl)}</p>`,
      renderMuted(`O link vale por ${escapeHtml(validity)} e só pode ser usado uma vez. Se o botão não funcionar, copie e cole este endereço no navegador:`),
      renderMuted(`<span style="word-break:break-all">${escapeHtml(input.resetUrl)}</span>`),
    ].join('\n'),
    footerHtml: renderMuted('Se não foi você, ignore este e-mail. Sua senha continua a mesma.'),
  });

  const text = [
    subject,
    '',
    'Recebemos um pedido para criar uma nova senha na sua conta do SafeID. Abra o link abaixo:',
    '',
    input.resetUrl,
    '',
    `O link vale por ${validity} e só pode ser usado uma vez.`,
    '',
    'Se não foi você, ignore este e-mail. Sua senha continua a mesma.',
    '',
    legalFooterText(),
  ].join('\n');

  return { subject, html, text };
}

export function buildPasswordChangedEmail(input: { loginUrl: string; contactEmail: string }): RenderedEmail {
  const subject = 'Sua senha do SafeID foi alterada';

  const html = renderLayout({
    title: subject,
    preheader: 'As outras sessões da sua conta foram encerradas.',
    bodyHtml: [
      renderParagraph('A senha da sua conta do SafeID acabou de ser alterada, e as outras sessões abertas foram encerradas.'),
      renderParagraph(
        `Se não foi você, crie uma nova senha agora pela opção "Esqueci minha senha" em <a href="${escapeHtml(input.loginUrl)}" style="color:#1A6FFF">${escapeHtml(input.loginUrl)}</a> e fale com a equipe em ${escapeHtml(input.contactEmail)}.`,
      ),
    ].join('\n'),
  });

  const text = [
    subject,
    '',
    'A senha da sua conta do SafeID acabou de ser alterada, e as outras sessões abertas foram encerradas.',
    '',
    `Se não foi você, crie uma nova senha pela opção "Esqueci minha senha" em ${input.loginUrl} e fale com a equipe em ${input.contactEmail}.`,
    '',
    legalFooterText(),
  ].join('\n');

  return { subject, html, text };
}
