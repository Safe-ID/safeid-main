import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NestJsonLogger } from '../../src/shared/utils/nest-json-logger';

describe('NestJsonLogger', () => {
  const originalLevel = process.env.LOG_LEVEL;
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  const logger = new NestJsonLogger();
  const linha = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown> => JSON.parse(spy.mock.calls[0][0] as string);

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  });

  it('escreve a mensagem do Nest como JSON, com o contexto no ctx', () => {
    logger.log('Mapped {/api/health, GET} route', 'RouterExplorer');

    expect(linha(logSpy)).toMatchObject({
      level: 'info',
      ctx: 'RouterExplorer',
      event: 'nest.log',
      message: 'Mapped {/api/health, GET} route',
    });
    // Sem as cores ANSI do logger padrão do Nest
    expect(logSpy.mock.calls[0][0]).not.toContain('\u001b[');
  });

  it('em error, guarda o stack que vem antes do contexto', () => {
    logger.error('Falhou', 'Error: Falhou\n    at algo', 'ExceptionsHandler');

    expect(linha(errorSpy)).toMatchObject({
      level: 'error',
      ctx: 'ExceptionsHandler',
      message: 'Falhou',
      stack: 'Error: Falhou\n    at algo',
    });
  });

  it('aceita um Error como mensagem e usa o contexto padrão sem contexto', () => {
    logger.fatal(new Error('quebrou'));

    expect(linha(errorSpy)).toMatchObject({ level: 'error', ctx: 'Nest', message: 'quebrou' });
    expect(linha(errorSpy).stack).toContain('quebrou');
  });

  it('mapeia warn, debug e verbose para os níveis do logger estruturado', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.warn('aviso', 'Ctx');
    logger.debug('detalhe', 'Ctx');
    logger.verbose('mais detalhe', 'Ctx');

    expect(linha(warnSpy)).toMatchObject({ level: 'warn', message: 'aviso' });
    expect(logSpy.mock.calls.map((c) => JSON.parse(c[0] as string).level)).toEqual(['debug', 'debug']);
  });

  it('guarda argumentos extras em details', () => {
    logger.log('com extra', { id: 1 }, 'Ctx');

    expect(linha(logSpy)).toMatchObject({ ctx: 'Ctx', details: [{ id: 1 }] });
  });
});
