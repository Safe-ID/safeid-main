import { Parser } from 'htmlparser2';

/**
 * Trecho de uma descrição de vazamento, pronto para o front montar com elementos comuns
 * (sem innerHTML): o texto já vem decodificado e o React o escapa ao exibir.
 */
export interface DescriptionSegment {
  text: string;
  href?: string;
  em?: boolean;
  strong?: boolean;
}

// Conteúdo que nunca vira texto na tela
const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'textarea', 'svg', 'math', 'head', 'title']);
const EMPHASIS_TAGS = new Set(['em', 'i']);
const STRONG_TAGS = new Set(['strong', 'b']);
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/** Só endereços absolutos http(s) ou mailto; o resto (javascript:, data:, relativos) é descartado */
export function safeHref(href: unknown): string | undefined {
  if (typeof href !== 'string' || href.trim() === '') return undefined;
  try {
    const url = new URL(href.trim());
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Converte a Description da HIBP (HTML com ênfases e links) em trechos.
 * Tags desconhecidas somem e deixam só o texto; links inválidos viram texto simples.
 */
export function parseBreachDescription(html: unknown): DescriptionSegment[] {
  if (typeof html !== 'string' || html.trim() === '') return [];

  const segments: DescriptionSegment[] = [];
  let skipDepth = 0;
  let emDepth = 0;
  let strongDepth = 0;
  const links: Array<string | undefined> = [];

  const parser = new Parser(
    {
      onopentag(name, attribs): void {
        if (SKIPPED_TAGS.has(name)) skipDepth++;
        else if (EMPHASIS_TAGS.has(name)) emDepth++;
        else if (STRONG_TAGS.has(name)) strongDepth++;
        else if (name === 'a') links.push(safeHref(attribs.href));
      },
      onclosetag(name): void {
        if (SKIPPED_TAGS.has(name)) skipDepth = Math.max(0, skipDepth - 1);
        else if (EMPHASIS_TAGS.has(name)) emDepth = Math.max(0, emDepth - 1);
        else if (STRONG_TAGS.has(name)) strongDepth = Math.max(0, strongDepth - 1);
        else if (name === 'a') links.pop();
      },
      ontext(text): void {
        if (skipDepth > 0 || text === '') return;
        const href = links.length > 0 ? links[links.length - 1] : undefined;
        const segment: DescriptionSegment = { text };
        if (href) segment.href = href;
        if (emDepth > 0) segment.em = true;
        if (strongDepth > 0) segment.strong = true;

        // Junta com o trecho anterior quando a formatação é a mesma
        const last = segments[segments.length - 1];
        if (last && last.href === segment.href && last.em === segment.em && last.strong === segment.strong) {
          last.text += text;
        } else {
          segments.push(segment);
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();

  // Espaços repetidos viram um só; trechos que ficarem vazios saem
  return segments
    .map(segment => ({ ...segment, text: segment.text.replace(/\s+/g, ' ') }))
    .filter(segment => segment.text.trim() !== '');
}

/** Endereços dos links, em ordem alfabética, para conferir que a tradução não trocou nenhum */
export function descriptionLinks(segments: DescriptionSegment[]): string[] {
  return segments.filter(segment => segment.href).map(segment => segment.href as string).sort();
}

/** Texto corrido, sem formatação */
export function descriptionText(segments: DescriptionSegment[]): string {
  return segments.map(segment => segment.text).join('').trim();
}
