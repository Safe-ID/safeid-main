import { translateDataClass } from '../../../shared/utils/data-classes';
import { escapeHtml, renderButton, renderLayout, renderMuted, renderParagraph, RenderedEmail } from './layout';

export interface BreachAlertItem {
  title: string;
  breachDate: string | null;
  dataClasses: string[];
}

export interface NewBreachAlertInput {
  breaches: BreachAlertItem[];
  riskScore: number;
  classification: string;
  dashboardUrl: string;
  unsubscribeUrl: string;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  LOW: 'Baixo',
  MODERATE: 'Médio',
  HIGH: 'Alto',
  CRITICAL: 'Crítico',
};

function formatDate(value: string | null): string {
  if (!value) {
    return 'data não informada';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/**
 * Alerta de vazamento novo. Não inclui a recomendação da IA (longa e sensível):
 * só os vazamentos, os dados expostos, o novo score e o link para o painel.
 */
export function buildNewBreachAlert(input: NewBreachAlertInput): RenderedEmail {
  const count = input.breaches.length;
  const plural = count === 1 ? 'novo vazamento' : 'novos vazamentos';
  const subject = `Seu e-mail apareceu em ${count} ${plural}`;
  const classification = CLASSIFICATION_LABELS[input.classification] || input.classification;

  const items = input.breaches.map(breach => ({
    title: breach.title,
    date: formatDate(breach.breachDate),
    dataClasses: breach.dataClasses.map(translateDataClass).join(', ') || 'não informado',
  }));

  const listHtml = items
    .map(
      item =>
        `<li style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#1F2A3D"><strong>${escapeHtml(item.title)}</strong> (${escapeHtml(item.date)})<br><span style="color:#5B6B82;font-size:14px">Dados expostos: ${escapeHtml(item.dataClasses)}</span></li>`,
    )
    .join('\n');

  const html = renderLayout({
    title: subject,
    preheader: `Seu risco agora é ${input.riskScore}/100 (${classification}). Veja o que fazer no painel.`,
    bodyHtml: [
      renderParagraph('O monitoramento do SafeID encontrou seu e-mail em vazamentos publicados recentemente:'),
      `<ul style="margin:0 0 16px;padding-left:20px">${listHtml}</ul>`,
      renderParagraph(`Seu risco atualizado é <strong>${input.riskScore}/100</strong> (${escapeHtml(classification)}). O plano de ação completo está no painel.`),
      `<p style="margin:0 0 24px">${renderButton('Ver meu painel', input.dashboardUrl)}</p>`,
      renderMuted('O SafeID nunca pede sua senha por e-mail. Na dúvida, abra o painel digitando o endereço no navegador.'),
    ].join('\n'),
    footerHtml: renderMuted(
      `Você recebe este alerta porque ativou o monitoramento de vazamentos. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#5B6B82">Desativar alertas</a>.`,
    ),
  });

  const text = [
    subject,
    '',
    'O monitoramento do SafeID encontrou seu e-mail em vazamentos publicados recentemente:',
    '',
    ...items.map(item => `- ${item.title} (${item.date})\n  Dados expostos: ${item.dataClasses}`),
    '',
    `Seu risco atualizado é ${input.riskScore}/100 (${classification}). O plano de ação completo está no painel:`,
    input.dashboardUrl,
    '',
    'O SafeID nunca pede sua senha por e-mail.',
    '',
    `Para desativar os alertas: ${input.unsubscribeUrl}`,
  ].join('\n');

  return { subject, html, text };
}
