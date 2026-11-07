import { describe, expect, it } from '@jest/globals';
import {
  descriptionLinks,
  descriptionText,
  parseBreachDescription,
  safeHref,
} from '../../src/shared/utils/breach-description';

// Trecho real da Description do vazamento Adobe na HIBP
const ADOBE =
  'In October 2013, 153 million Adobe accounts were breached with each containing an internal ID, username, email, <em>encrypted</em> password and a password hint in plain text. The unencrypted hints also <a href="http://www.troyhunt.com/2013/11/adobe-credentials-and-serious.html" target="_blank" rel="noopener">disclosed much about the passwords</a> adding further to the risk.';

describe('parseBreachDescription', () => {
  it('converte o HTML da HIBP em trechos com ênfase e link', () => {
    const trechos = parseBreachDescription(ADOBE);

    expect(trechos).toContainEqual({ text: 'encrypted', em: true });
    expect(trechos).toContainEqual({
      text: 'disclosed much about the passwords',
      href: 'http://www.troyhunt.com/2013/11/adobe-credentials-and-serious.html',
    });
    expect(descriptionText(trechos)).toContain('153 million Adobe accounts');
    // Nenhum trecho carrega HTML: o front monta os elementos
    expect(trechos.every(t => !/[<>]/.test(t.text))).toBe(true);
  });

  it.each([
    ['script', 'antes<script>alert(1)</script>depois', [{ text: 'antesdepois' }]],
    ['estilo', 'a<style>*{display:none}</style>b', [{ text: 'ab' }]],
    ['imagem com evento', 'texto <img src=x onerror="alert(1)"> fim', [{ text: 'texto fim' }]],
    ['iframe', 'a<iframe src="https://evil.example">x</iframe>b', [{ text: 'ab' }]],
    ['tag desconhecida', '<div onclick="x"><span>só o texto</span></div>', [{ text: 'só o texto' }]],
    ['link javascript:', '<a href="javascript:alert(1)">clique</a>', [{ text: 'clique' }]],
    ['link data:', '<a href="data:text/html,<b>x</b>">clique</a>', [{ text: 'clique' }]],
    ['link relativo', '<a href="/conta">clique</a>', [{ text: 'clique' }]],
    ['svg', 'a<svg><a href="javascript:x"><text>y</text></a></svg>b', [{ text: 'ab' }]],
  ])('descarta %s', (_caso, entrada, esperado) => {
    expect(parseBreachDescription(entrada)).toEqual(esperado);
  });

  it('decodifica entidades em texto puro, sem virar marcação', () => {
    expect(parseBreachDescription('Tom &amp; Jerry &lt;b&gt;')).toEqual([{ text: 'Tom & Jerry <b>' }]);
  });

  it('aceita negrito, mailto e devolve lista vazia para o que não é texto', () => {
    expect(parseBreachDescription('<b>forte</b> e <strong>mais</strong>')).toEqual([
      { text: 'forte', strong: true },
      { text: ' e ' },
      { text: 'mais', strong: true },
    ]);
    expect(parseBreachDescription('<a href="mailto:a@example.com">a</a>')).toEqual([
      { text: 'a', href: 'mailto:a@example.com' },
    ]);
    expect(parseBreachDescription(undefined)).toEqual([]);
    expect(parseBreachDescription(42)).toEqual([]);
    expect(parseBreachDescription('   ')).toEqual([]);
  });
});

describe('safeHref', () => {
  it('só aceita endereços absolutos http(s) e mailto', () => {
    expect(safeHref('https://a.example/x')).toBe('https://a.example/x');
    expect(safeHref('HTTP://A.example')).toBe('http://a.example/');
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(safeHref(' javascript:alert(1)')).toBeUndefined();
    expect(safeHref('//evil.example')).toBeUndefined();
    expect(safeHref('vbscript:x')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe('descriptionLinks', () => {
  it('lista os endereços em ordem, só dos links válidos', () => {
    const trechos = parseBreachDescription(
      '<a href="https://b.example">b</a> <a href="javascript:x">j</a> <a href="https://a.example">a</a>',
    );
    expect(descriptionLinks(trechos)).toEqual(['https://a.example/', 'https://b.example/']);
  });
});
