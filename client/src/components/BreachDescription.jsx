import { Fragment } from "react";

const SAFE_HREF = /^(https?:|mailto:)/i;

/**
 * "O que aconteceu": descrição do vazamento publicada pelo Have I Been Pwned.
 * A API entrega trechos { text, href?, em?, strong? }; aqui eles viram elementos comuns,
 * sem innerHTML, então o texto é sempre escapado pelo React.
 * A atribuição com link para a HIBP é exigida pela licença CC BY 4.0.
 */
export default function BreachDescription({ name, description }) {
  const segments = Array.isArray(description?.segments)
    ? description.segments.filter((segment) => typeof segment?.text === "string" && segment.text !== "")
    : [];
  if (segments.length === 0) return null;

  const translated = description.lang === "pt";
  const breachPage = `https://haveibeenpwned.com/Breach/${encodeURIComponent(name || "")}`;

  return (
    <div className="mt-3.5">
      <div className="text-[10px] text-safe-dim mb-2 tracking-[1px] font-semibold uppercase">O que aconteceu</div>
      <p className="m-0 text-safe-muted text-[13px] leading-relaxed" lang={translated ? "pt-BR" : "en"}>
        {segments.map((segment, i) => {
          let node = segment.text;
          if (segment.em) node = <em>{node}</em>;
          if (segment.strong) node = <strong className="text-safe-text font-semibold">{node}</strong>;
          if (segment.href && SAFE_HREF.test(segment.href)) {
            node = (
              <a
                href={segment.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-safe-secondary underline underline-offset-2 hover:text-safe-accent"
              >
                {node}
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            );
          }
          return <Fragment key={i}>{node}</Fragment>;
        })}
      </p>
      <p className="mt-2 mb-0 text-safe-dim text-[11px] leading-relaxed">
        {translated ? "Tradução automática do texto do " : "Texto original, em inglês, do "}
        <a
          href="https://haveibeenpwned.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-safe-dim underline underline-offset-2 hover:text-safe-text"
        >
          Have I Been Pwned<span className="sr-only"> (abre em nova aba)</span>
        </a>{" "}
        (CC BY 4.0)
        {translated && (
          <>
            {" · "}
            <a
              href={breachPage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-safe-dim underline underline-offset-2 hover:text-safe-text"
            >
              ver original<span className="sr-only"> em inglês (abre em nova aba)</span>
            </a>
          </>
        )}
      </p>
    </div>
  );
}
