import { createHash } from 'crypto';

/**
 * Logger estruturado: escreve uma linha JSON por evento ({ ts, level, ctx, event, ...fields }).
 * No CloudWatch, cada linha vira um evento pesquisável e serve de base para metric filters.
 * Nunca passe e-mail em texto nos campos: use userId ou maskEmail(email).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const configured = (process.env.LOG_LEVEL || '').trim().toLowerCase();
  return configured in LEVEL_ORDER ? (configured as LogLevel) : 'info';
}

/**
 * Serializa erros como { name, message } para não perder a informação no JSON
 */
function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

export function log(
  level: LogLevel,
  ctx: string,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) {
    return;
  }

  const normalizedFields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, normalizeValue(value)]),
  );

  const line = JSON.stringify({
    ...normalizedFields,
    ts: new Date().toISOString(),
    level,
    ctx,
    event,
  });

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Identificador de e-mail seguro para logs: os 8 primeiros caracteres do SHA-256
 */
export function maskEmail(email: string): string {
  return createHash('sha256').update((email || '').trim().toLowerCase()).digest('hex').substring(0, 8);
}
