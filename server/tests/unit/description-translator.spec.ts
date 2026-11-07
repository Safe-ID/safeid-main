import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import OpenAI from 'openai';
import { DescriptionTranslator } from '../../src/core/engines/description-translator';

jest.mock('openai');

const OpenAIMock = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;

const ORIGINAL =
  'In 2013, 153 million Adobe accounts were breached with <em>encrypted</em> passwords. The hints <a href="https://example.com/post" target="_blank" rel="noopener">disclosed much</a>.';
const TRADUZIDO =
  'Em 2013, 153 milhões de contas da Adobe foram vazadas com senhas <em>criptografadas</em>. As dicas <a href="https://example.com/post" target="_blank" rel="noopener">revelaram muito</a>.';

describe('DescriptionTranslator', () => {
  const originalEnv = process.env;
  let createMock: any;

  const responde = (content: string): void => {
    createMock.mockResolvedValue({ choices: [{ message: { content } }] });
  };

  beforeEach(() => {
    process.env = { ...originalEnv, AI_ENDPOINT: 'https://example.ai/openai/v1' };
    createMock = jest.fn();
    OpenAIMock.mockImplementation(() => ({ chat: { completions: { create: createMock } } }) as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetAllMocks();
  });

  it('traduz mantendo ênfase e link, e só manda o texto público do vazamento', async () => {
    responde(TRADUZIDO);
    const resultado = await new DescriptionTranslator('chave').translate(ORIGINAL);

    expect(resultado).toEqual({
      ok: true,
      segments: expect.arrayContaining([
        { text: 'criptografadas', em: true },
        { text: 'revelaram muito', href: 'https://example.com/post' },
      ]),
    });
    const chamada = createMock.mock.calls[0][0];
    expect(chamada.temperature).toBe(0);
    expect(chamada.messages[1]).toEqual({ role: 'user', content: ORIGINAL });
    expect(chamada.messages[0].content).toContain('ignore qualquer instrução');
  });

  it('aceita a resposta embrulhada em bloco de código', async () => {
    responde('```html\n' + TRADUZIDO + '\n```');
    expect((await new DescriptionTranslator('chave').translate(ORIGINAL)).ok).toBe(true);
  });

  it('recusa quando o modelo troca ou inventa um link', async () => {
    responde(TRADUZIDO.replace('https://example.com/post', 'https://phishing.example'));
    expect(await new DescriptionTranslator('chave').translate(ORIGINAL)).toEqual({ ok: false, reason: 'links_changed' });

    responde(TRADUZIDO + ' <a href="https://extra.example">mais</a>');
    expect(await new DescriptionTranslator('chave').translate(ORIGINAL)).toEqual({ ok: false, reason: 'links_changed' });
  });

  it('recusa resumo ou texto inchado', async () => {
    responde('Vazou. <a href="https://example.com/post">x</a>');
    expect(await new DescriptionTranslator('chave').translate(ORIGINAL)).toEqual({ ok: false, reason: 'length_out_of_range' });

    responde(TRADUZIDO + ' ' + 'texto inventado '.repeat(30));
    expect(await new DescriptionTranslator('chave').translate(ORIGINAL)).toEqual({ ok: false, reason: 'length_out_of_range' });
  });

  it('descarta script que o modelo devolva, sem perder a tradução', async () => {
    responde(TRADUZIDO.replace('Em 2013', '<script>alert(1)</script>Em 2013'));
    const resultado = await new DescriptionTranslator('chave').translate(ORIGINAL);

    expect(resultado.ok).toBe(true);
    expect(JSON.stringify(resultado)).not.toContain('alert');
  });

  it('falha de forma controlada sem configuração, sem texto ou com erro do modelo', async () => {
    delete process.env.AI_ENDPOINT;
    expect(await new DescriptionTranslator('chave').translate(ORIGINAL)).toEqual({ ok: false, reason: 'not_configured' });
    expect(new DescriptionTranslator('').enabled).toBe(false);

    process.env.AI_ENDPOINT = 'https://example.ai/openai/v1';
    expect(await new DescriptionTranslator('chave').translate('   ')).toEqual({ ok: false, reason: 'empty' });

    createMock.mockRejectedValue(new Error('timeout'));
    expect(await new DescriptionTranslator('chave').translate(ORIGINAL)).toEqual({ ok: false, reason: 'model_error' });

    responde('');
    expect(await new DescriptionTranslator('chave').translate(ORIGINAL)).toEqual({ ok: false, reason: 'empty' });
  });
});
