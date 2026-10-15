import { escapeHtml, renderButton, renderLayout, renderMuted, renderParagraph, RenderedEmail } from './layout';

export function buildVerifyEmail(input: { verifyUrl: string; ttlHours: number }): RenderedEmail {
  const subject = 'Confirme seu e-mail no SafeID';
  const validity = `${input.ttlHours} ${input.ttlHours === 1 ? 'hora' : 'horas'}`;

  const html = renderLayout({
    title: 'Confirme seu e-mail',
    preheader: 'Falta só um passo para ativar sua conta no SafeID.',
    bodyHtml: [
      renderParagraph('Recebemos um cadastro no SafeID com este endereço. Para ativar a conta, confirme que o e-mail é seu:'),
      `<p style="margin:0 0 24px">${renderButton('Confirmar e-mail', input.verifyUrl)}</p>`,
      renderMuted(`O link vale por ${escapeHtml(validity)}. Se o botão não funcionar, copie e cole este endereço no navegador:`),
      renderMuted(`<span style="word-break:break-all">${escapeHtml(input.verifyUrl)}</span>`),
    ].join('\n'),
    footerHtml: renderMuted('Se você não criou uma conta no SafeID, ignore este e-mail. Nada será ativado sem a confirmação.'),
  });

  const text = [
    'Confirme seu e-mail no SafeID',
    '',
    'Recebemos um cadastro no SafeID com este endereço. Para ativar a conta, abra o link abaixo:',
    '',
    input.verifyUrl,
    '',
    `O link vale por ${validity}.`,
    '',
    'Se você não criou uma conta no SafeID, ignore este e-mail.',
  ].join('\n');

  return { subject, html, text };
}
