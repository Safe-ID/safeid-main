import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DescriptionTranslator } from '../../src/core/engines/description-translator';
import { BreachDescriptionService } from '../../src/modules/monitoring/services/breach-description.service';
import { BreachDescriptionsController, parseNames } from '../../src/modules/monitoring/breach-descriptions.controller';

jest.mock('../../src/core/engines/description-translator');

const TranslatorMock = DescriptionTranslator as unknown as jest.Mock;

const MODIFICADO = new Date('2026-10-01T00:00:00Z');

describe('BreachDescriptionService', () => {
  let prisma: any;
  let translate: jest.Mock<any>;
  let enabled: boolean;

  const build = (): BreachDescriptionService => new BreachDescriptionService(prisma);

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    enabled = true;
    translate = jest.fn();
    TranslatorMock.mockImplementation(() => ({
      get enabled() {
        return enabled;
      },
      translate,
    }));
    prisma = {
      breachCatalog: {
        fields: { modifiedDate: 'campo-modifiedDate' },
        findMany: jest.fn(),
        update: jest.fn(async () => ({})),
        count: jest.fn(async () => 3),
      },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('translatePending', () => {
    it('traduz o lote dos não sensíveis pendentes, mais recentes primeiro', async () => {
      prisma.breachCatalog.findMany.mockResolvedValue([
        { name: 'Adobe', raw: { Description: '<em>texto</em>' }, modifiedDate: MODIFICADO },
      ]);
      translate.mockResolvedValue({ ok: true, segments: [{ text: 'texto traduzido', em: true }] });

      await expect(build().translatePending(5)).resolves.toEqual({ translated: 1, failed: 0, remaining: 3 });

      const consulta = prisma.breachCatalog.findMany.mock.calls[0][0];
      expect(consulta).toMatchObject({ take: 5, orderBy: { addedDate: 'desc' } });
      expect(consulta.where).toEqual({
        isSensitive: false,
        OR: [{ descriptionPtFrom: null }, { descriptionPtFrom: { lt: 'campo-modifiedDate' } }],
      });
      expect(prisma.breachCatalog.update).toHaveBeenCalledWith({
        where: { name: 'Adobe' },
        data: { descriptionPt: [{ text: 'texto traduzido', em: true }], descriptionPtFrom: MODIFICADO },
      });
    });

    it('falha marca a versão como tentada e mantém o original, sem retentar toda hora', async () => {
      prisma.breachCatalog.findMany.mockResolvedValue([
        { name: 'Ruim', raw: { Description: 'texto' }, modifiedDate: MODIFICADO },
        { name: 'SemTexto', raw: {}, modifiedDate: MODIFICADO },
      ]);
      translate.mockResolvedValue({ ok: false, reason: 'links_changed' });

      await expect(build().translatePending()).resolves.toEqual({ translated: 0, failed: 2, remaining: 3 });
      expect(translate).toHaveBeenCalledTimes(1);
      for (const name of ['Ruim', 'SemTexto']) {
        expect(prisma.breachCatalog.update).toHaveBeenCalledWith({
          where: { name },
          data: { descriptionPt: Prisma.DbNull, descriptionPtFrom: MODIFICADO },
        });
      }
    });

    it('sem a IA configurada, não consulta nada', async () => {
      enabled = false;
      await expect(build().translatePending()).resolves.toEqual({
        translated: 0,
        failed: 0,
        remaining: 0,
        skipped: 'not_configured',
      });
      expect(prisma.breachCatalog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getDescriptions', () => {
    it('usa a tradução quando é da versão atual e o original quando não há ou ficou velha', async () => {
      prisma.breachCatalog.findMany.mockResolvedValue([
        {
          name: 'Traduzido',
          raw: { Description: 'original' },
          modifiedDate: MODIFICADO,
          descriptionPt: [{ text: 'traduzido' }],
          descriptionPtFrom: MODIFICADO,
        },
        {
          name: 'Velho',
          raw: { Description: 'novo texto da HIBP' },
          modifiedDate: MODIFICADO,
          descriptionPt: [{ text: 'tradução antiga' }],
          descriptionPtFrom: new Date('2026-01-01T00:00:00Z'),
        },
        {
          name: 'Sensivel',
          raw: { Description: 'only <b>english</b>' },
          modifiedDate: MODIFICADO,
          descriptionPt: null,
          descriptionPtFrom: null,
        },
      ]);

      const resultado = await build().getDescriptions(['Traduzido', 'Velho', 'Sensivel', 'Inexistente']);

      expect(resultado).toEqual({
        Traduzido: { segments: [{ text: 'traduzido' }], lang: 'pt' },
        Velho: { segments: [{ text: 'novo texto da HIBP' }], lang: 'en' },
        Sensivel: { segments: [{ text: 'only ' }, { text: 'english', strong: true }], lang: 'en' },
      });
    });

    it('revalida o que veio do banco: link inseguro e campos estranhos saem', async () => {
      prisma.breachCatalog.findMany.mockResolvedValue([
        {
          name: 'X',
          raw: {},
          modifiedDate: MODIFICADO,
          descriptionPt: [
            { text: 'ok', href: 'https://a.example/' },
            { text: 'ruim', href: 'javascript:alert(1)', onclick: 'x' },
            { text: '' },
            null,
          ],
          descriptionPtFrom: MODIFICADO,
        },
      ]);

      expect((await build().getDescriptions(['X'])).X.segments).toEqual([
        { text: 'ok', href: 'https://a.example/' },
        { text: 'ruim' },
      ]);
    });

    it('lista vazia não consulta o banco', async () => {
      await expect(build().getDescriptions([])).resolves.toEqual({});
      expect(prisma.breachCatalog.findMany).not.toHaveBeenCalled();
    });
  });
});

describe('parseNames', () => {
  it('separa por vírgula, tira espaços e repetidos', () => {
    expect(parseNames(' Adobe, Canva ,Adobe,, ')).toEqual(['Adobe', 'Canva']);
  });

  it.each([
    ['vazio', ''],
    ['só vírgulas', ',,'],
    ['ausente', undefined],
    ['muitos nomes', Array.from({ length: 51 }, (_, i) => `B${i}`).join(',')],
    ['nome enorme', 'x'.repeat(121)],
  ])('recusa %s', (_caso, entrada) => {
    expect(() => parseNames(entrada)).toThrow(BadRequestException);
  });
});

describe('BreachDescriptionsController', () => {
  it('valida os nomes e devolve as descrições do serviço', async () => {
    const descriptions = { getDescriptions: jest.fn(async () => ({ Adobe: { segments: [{ text: 'x' }], lang: 'en' } })) };
    const controller = new BreachDescriptionsController(descriptions as never);

    await expect(controller.list('Adobe, Adobe')).resolves.toEqual({ Adobe: { segments: [{ text: 'x' }], lang: 'en' } });
    expect(descriptions.getDescriptions).toHaveBeenCalledWith(['Adobe']);
    await expect(controller.list('')).rejects.toThrow(BadRequestException);
  });
});
