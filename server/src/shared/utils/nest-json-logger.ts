import { LoggerService } from '@nestjs/common';
import { log, LogLevel } from './logger';

/**
 * Logger do próprio NestJS (inicialização dos módulos, mapeamento das rotas, erros não tratados)
 * no mesmo formato do logger estruturado: uma linha JSON por evento, sem cores ANSI.
 * O ctx é o contexto do Nest (InstanceLoader, RouterExplorer, ExceptionsHandler...).
 */
export class NestJsonLogger implements LoggerService {
  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    const rest = [...params];
    // O Nest passa o contexto como último argumento
    const ctx = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : 'Nest';
    // Em error, o argumento antes do contexto é o stack
    const stack = level === 'error' && typeof rest[0] === 'string' ? (rest.shift() as string) : undefined;

    const fields: Record<string, unknown> = {
      message: message instanceof Error ? message.message : message,
    };
    if (message instanceof Error && message.stack) fields.stack = message.stack;
    if (stack) fields.stack = stack;
    if (rest.length > 0) fields.details = rest;

    log(level, ctx, 'nest.log', fields);
  }
}
