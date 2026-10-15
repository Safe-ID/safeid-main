/** Fuso dos agendamentos (BRT por padrão) */
export function getSchedulerTimeZone(): string {
  return (process.env.SCHEDULER_TZ || '').trim() || 'America/Sao_Paulo';
}

/**
 * yyyyMMddHH no fuso informado. Usado em jobIds para deduplicar jobs
 * disparados na mesma hora (ex.: sweep-CATALOG_CHANGE-2026101509).
 */
export function formatHourKey(date: Date, timeZone = getSchedulerTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}${value('month')}${value('day')}${value('hour')}`;
}

/** Só caracteres aceitos num jobId do BullMQ (sem ':') */
export function toJobIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}
