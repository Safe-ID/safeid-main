import { useEffect, useRef, useState } from "react";
import { fetchScanHistory } from "../lib/api";

// O SVG é desenhado na largura real do card (1 unidade = 1 px), para o texto não escalar
const VIEW_H = 200;
const PAD = { top: 16, right: 56, bottom: 28, left: 30 };
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

// Mesmas faixas do RiskEngine do backend (linhas discretas no fundo)
const BANDS = [
  { from: 26, label: "Médio" },
  { from: 51, label: "Alto" },
  { from: 76, label: "Crítico" },
];

const SOURCE_LABELS = {
  SIGNUP: "Análise do cadastro",
  MANUAL: "Verificação manual",
  MONITORING: "Verificação automática",
};

const CLASSIFICATION_LABELS = { LOW: "Baixo", MODERATE: "Médio", HIGH: "Alto", CRITICAL: "Crítico" };

const formatDate = (value) => new Date(value).toLocaleDateString("pt-BR");
const formatDateTime = (value) =>
  new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const yFor = (score) => PAD.top + PLOT_H * (1 - Math.min(100, Math.max(0, score)) / 100);

/**
 * Evolução do score ao longo das análises (US05). Cada ponto é uma análise salva no histórico:
 * o cadastro, uma verificação manual ou um recálculo do monitoramento.
 * `refreshKey` muda quando o snapshot do painel muda, para recarregar o histórico.
 */
export default function ScoreHistoryChart({ refreshKey }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(null);
  const [width, setWidth] = useState(640);
  const boxRef = useRef(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(box);
    return () => observer.disconnect();
  }, [history]);

  const VIEW_W = width;
  const PLOT_W = VIEW_W - PAD.left - PAD.right;

  useEffect(() => {
    let alive = true;
    fetchScanHistory()
      .then((items) => {
        if (!alive) return;
        // A API devolve do mais novo para o mais antigo
        setHistory([...(Array.isArray(items) ? items : [])].reverse());
        setError("");
      })
      .catch((err) => {
        if (alive) setError(err.message || "Não foi possível carregar o histórico.");
      });
    return () => { alive = false; };
  }, [refreshKey]);

  const points = (history || []).map((item, index, list) => ({
    ...item,
    x: PAD.left + (list.length === 1 ? PLOT_W / 2 : (PLOT_W * index) / (list.length - 1)),
    y: yFor(item.riskScore),
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const hasAutomatic = points.some((p) => p.source === "MONITORING");
  const last = points[points.length - 1];
  const activePoint = active === null ? null : points[active];

  return (
    <section aria-labelledby="score-history-title" className="bg-safe-card border border-safe-border rounded-[16px] p-[20px] mb-[16px]">
      <div className="flex items-baseline justify-between gap-3 mb-[14px] flex-wrap">
        <h2 id="score-history-title" className="text-safe-dim text-[11px] font-semibold tracking-[1.2px] m-0">
          EVOLUÇÃO DO RISCO
        </h2>
        {points.length > 0 && (
          <span className="text-safe-dim text-[12px]">
            {points.length} {points.length === 1 ? "análise" : "análises"}
            {points.length > 1 && ` · ${formatDate(points[0].createdAt)} a ${formatDate(last.createdAt)}`}
          </span>
        )}
      </div>

      {error && <p className="text-safe-danger text-sm m-0">{error}</p>}
      {!error && history === null && <p className="text-safe-muted text-sm m-0">Carregando histórico...</p>}
      {!error && history !== null && points.length < 2 && (
        <p className="text-safe-muted text-sm m-0">
          O gráfico aparece a partir da segunda análise. Use "Verificar novamente" ou mantenha os alertas ligados
          para o SafeID registrar a evolução do seu risco.
        </p>
      )}

      {!error && points.length >= 2 && (
        <>
          <div className="relative" ref={boxRef}>
            <svg
              width={VIEW_W}
              height={VIEW_H}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="block max-w-full overflow-visible"
              role="img"
              aria-label={`Evolução do score de risco em ${points.length} análises, de ${points[0].riskScore} para ${last.riskScore} de 100`}
              onMouseLeave={() => setActive(null)}
            >
              {/* Eixo e faixas de risco: discretos, para não competir com a linha */}
              <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={yFor(0)} y2={yFor(0)} className="stroke-safe-borderL" strokeWidth="1" />
              {[0, 100].map((tick) => (
                <text key={tick} x={PAD.left - 8} y={yFor(tick) + 4} textAnchor="end" className="fill-safe-dim text-[11px]">{tick}</text>
              ))}
              {BANDS.map((band) => (
                <g key={band.from}>
                  <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={yFor(band.from)} y2={yFor(band.from)} className="stroke-safe-border" strokeWidth="1" strokeDasharray="3 4" />
                  <text x={PAD.left + PLOT_W + 8} y={yFor(band.from) + 4} className="fill-safe-dim text-[11px]">{band.label}</text>
                </g>
              ))}

              <path d={path} fill="none" className="stroke-safe-primary" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

              {activePoint && (
                <line x1={activePoint.x} x2={activePoint.x} y1={PAD.top} y2={yFor(0)} className="stroke-safe-borderL" strokeWidth="1" />
              )}

              {points.map((p, i) => (
                <g key={p.id || i}>
                  {/* Verificação automática em anel vazado: a diferença não depende só da cor */}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={active === i ? 6 : 4.5}
                    strokeWidth="2"
                    className={p.source === "MONITORING" ? "fill-safe-card stroke-safe-primary" : "fill-safe-primary stroke-safe-card"}
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="14"
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${formatDateTime(p.createdAt)}: score ${p.riskScore}, ${CLASSIFICATION_LABELS[p.classification] || p.classification}, ${SOURCE_LABELS[p.source] || "análise"}`}
                    className="cursor-pointer outline-none"
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  />
                </g>
              ))}

              {/* Rótulo direto só no último valor */}
              <text x={last.x} y={last.y - 12} textAnchor="end" className="fill-safe-text text-[12px] font-semibold">{last.riskScore}</text>

              <text x={PAD.left} y={VIEW_H - 8} className="fill-safe-dim text-[11px]">{formatDate(points[0].createdAt)}</text>
              <text x={PAD.left + PLOT_W} y={VIEW_H - 8} textAnchor="end" className="fill-safe-dim text-[11px]">{formatDate(last.createdAt)}</text>
            </svg>

            {activePoint && (
              <div
                role="status"
                // Perto das bordas o tooltip se alinha pelo lado do ponto, para não sair do card
                className={`pointer-events-none absolute z-10 -translate-y-full bg-safe-hover border border-safe-borderL rounded-lg px-3 py-2 text-[12px] whitespace-nowrap shadow-lg ${
                  activePoint.x > VIEW_W * 0.7 ? "-translate-x-full" : activePoint.x < VIEW_W * 0.3 ? "" : "-translate-x-1/2"
                }`}
                style={{ left: `${activePoint.x}px`, top: `${activePoint.y - 12}px` }}
              >
                <div className="text-safe-text font-semibold">
                  Score {activePoint.riskScore} · {CLASSIFICATION_LABELS[activePoint.classification] || activePoint.classification}
                </div>
                <div className="text-safe-muted">{formatDateTime(activePoint.createdAt)}</div>
                <div className="text-safe-muted">
                  {SOURCE_LABELS[activePoint.source] || "Análise"} · {activePoint.breachesFound} {activePoint.breachesFound === 1 ? "vazamento" : "vazamentos"}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 mt-2 flex-wrap text-[12px] text-safe-muted">
            <span className="flex items-center gap-1.5">
              <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" className="fill-safe-primary" /></svg>
              Análise do cadastro ou manual
            </span>
            {hasAutomatic && (
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" strokeWidth="2" className="fill-safe-card stroke-safe-primary" /></svg>
                Verificação automática
              </span>
            )}
          </div>

          <details className="mt-3">
            <summary className="text-safe-secondary text-[12px] cursor-pointer">Ver como tabela</summary>
            <table className="w-full mt-2 text-[12px] text-left border-collapse">
              <thead>
                <tr className="text-safe-dim">
                  <th className="py-1 pr-3 font-semibold">Data</th>
                  <th className="py-1 pr-3 font-semibold">Score</th>
                  <th className="py-1 pr-3 font-semibold">Classificação</th>
                  <th className="py-1 pr-3 font-semibold">Vazamentos</th>
                  <th className="py-1 font-semibold">Origem</th>
                </tr>
              </thead>
              <tbody className="text-safe-muted">
                {[...points].reverse().map((p, i) => (
                  <tr key={p.id || i} className="border-t border-safe-border">
                    <td className="py-1 pr-3">{formatDateTime(p.createdAt)}</td>
                    <td className="py-1 pr-3 text-safe-text">{p.riskScore}</td>
                    <td className="py-1 pr-3">{CLASSIFICATION_LABELS[p.classification] || p.classification}</td>
                    <td className="py-1 pr-3">{p.breachesFound}</td>
                    <td className="py-1">{SOURCE_LABELS[p.source] || "Análise"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
