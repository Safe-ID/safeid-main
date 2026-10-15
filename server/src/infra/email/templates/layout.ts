export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Cores do SafeID (client/tailwind.config.js), com fundo claro para leitura em clientes de e-mail
const COLORS = {
  primary: '#1A6FFF',
  dark: '#040C1A',
  text: '#1F2A3D',
  muted: '#5B6B82',
  border: '#E3E8F0',
  background: '#F4F7FB',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderButton(label: string, url: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${COLORS.primary};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${escapeHtml(label)}</a>`;
}

export function renderParagraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.text}">${html}</p>`;
}

export function renderMuted(html: string): string {
  return `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${COLORS.muted}">${html}</p>`;
}

/**
 * HTML base dos e-mails (CSS inline, tabela de largura fixa, compatível com clientes antigos).
 * O conteúdo de bodyHtml já deve vir escapado.
 */
export function renderLayout(options: { title: string; preheader: string; bodyHtml: string; footerHtml?: string }): string {
  const footer = options.footerHtml
    ? `<tr><td style="padding:16px 32px 28px;border-top:1px solid ${COLORS.border}">${options.footerHtml}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.background};font-family:Arial,Helvetica,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(options.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.background}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${COLORS.border};border-radius:12px">
<tr><td style="padding:20px 32px;background:${COLORS.dark};border-radius:12px 12px 0 0;color:#FFFFFF;font-size:18px;font-weight:700">SafeID</td></tr>
<tr><td style="padding:28px 32px 12px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${COLORS.text}">${escapeHtml(options.title)}</h1>
${options.bodyHtml}
</td></tr>
${footer}
</table>
</td></tr>
</table>
</body>
</html>`;
}
