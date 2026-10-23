import { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { CLASSIFICATION_LABELS, ENETSEC, W, translateDataClass } from "./safeidData";

const URGENCY_LABELS = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };
// Mesmas faixas do RiskEngine; a cor é só reforço, o texto sempre diz o nível
const LEVEL_CLASS = { LOW: "level-low", MODERATE: "level-moderate", HIGH: "level-high", CRITICAL: "level-critical" };
const URGENCY_CLASS = { LOW: "level-low", MEDIUM: "level-moderate", HIGH: "level-high" };

// Gravidade de um vazamento pelo dado mais sensível exposto (mesmos pesos do painel)
function breachSeverity(breach) {
  const weight = Math.max(0, ...(breach?.DataClasses || []).map((dataClass) => W[dataClass] || 2));
  if (weight >= 8) return { label: "Alta", className: "level-high" };
  if (weight >= 5) return { label: "Média", className: "level-moderate" };
  return { label: "Baixa", className: "level-low" };
}

const formatMonthYear = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "data não informada" : date.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * Versão para impressão do plano de ação (US09). Fica fora do #root, num portal no <body>:
 * na tela não aparece, e na impressão (main.css) só ela aparece, em fundo branco.
 * O navegador salva o PDF ("Salvar como PDF" na janela de impressão), sem dependência nova.
 *
 * O layout é uma tabela: o <thead> (espaço do topo) e o <tfoot> (rodapé) se repetem em cada
 * página, então as margens não dependem da opção "Margens" da janela de impressão.
 */
export default function PrintablePlan({ email, riskScore, classification, urgencyLevel, recommendation, mitigationSteps, breaches, updatedAt }) {
  // Data da impressão, não de quando a aba abriu: atualizada no beforeprint, antes do navegador montar a página
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toLocaleString("pt-BR"));
  useEffect(() => {
    const onBeforePrint = () => flushSync(() => setGeneratedAt(new Date().toLocaleString("pt-BR")));
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);
  const analysedAt = updatedAt ? new Date(updatedAt).toLocaleString("pt-BR") : null;
  const sortedBreaches = [...breaches].sort((a, b) => new Date(b?.BreachDate || 0) - new Date(a?.BreachDate || 0));
  const levelClass = LEVEL_CLASS[classification] || "";

  return createPortal(
    <div id="safeid-print-plan" aria-hidden="true">
      <table className="print-layout">
        <thead>
          <tr><td><div className="print-space" /></td></tr>
        </thead>
        <tfoot>
          <tr>
            <td>
              <div className="print-page-footer">
                <span>SafeID · safeid.app.br</span>
                <span>Plano de ação gerado em {generatedAt}</span>
              </div>
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td>
              <header className="print-header">
                <div className="print-brand">
                  <span className="print-logo">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="#fff" aria-hidden="true">
                      <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
                    </svg>
                  </span>
                  <div>
                    <div className="print-brand-name">Safe<span>ID</span></div>
                    <h1>Plano de ação contra vazamentos de dados</h1>
                  </div>
                </div>
                <div className="print-meta">
                  <div>Conta: {email || "não informada"}</div>
                  {analysedAt && <div>Análise de {analysedAt}</div>}
                  <div>Gerado em {generatedAt}</div>
                </div>
              </header>

              <section className="print-summary">
                <div className={`print-card ${levelClass}`}><span>Score de risco</span><strong>{riskScore}/100</strong></div>
                <div className={`print-card ${levelClass}`}><span>Classificação</span><strong>{CLASSIFICATION_LABELS[classification] || classification}</strong></div>
                <div className="print-card"><span>Vazamentos</span><strong>{breaches.length}</strong></div>
                {urgencyLevel && (
                  <div className={`print-card ${URGENCY_CLASS[urgencyLevel] || ""}`}><span>Urgência</span><strong>{URGENCY_LABELS[urgencyLevel] || urgencyLevel}</strong></div>
                )}
              </section>

              {recommendation && (
                <section>
                  <h2>Resumo</h2>
                  <p className="print-text">{recommendation}</p>
                </section>
              )}

              {mitigationSteps.length > 0 && (
                <section>
                  <h2>O que fazer agora</h2>
                  <p className="print-hint">Marque cada passo quando concluir.</p>
                  <ol className="print-checklist">
                    {mitigationSteps.map((step, i) => (
                      <li key={i}>
                        <span className="print-checkbox" aria-hidden="true" />
                        <span className="print-step-number">{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {sortedBreaches.length > 0 && (
                <section>
                  <h2>Vazamentos encontrados</h2>
                  <table className="print-breaches">
                    <thead>
                      <tr><th>Vazamento</th><th>Data</th><th>Gravidade</th><th>Dados expostos</th></tr>
                    </thead>
                    <tbody>
                      {sortedBreaches.map((breach, i) => {
                        const severity = breachSeverity(breach);
                        return (
                          <tr key={breach?.Name || i}>
                            <td>{breach?.Title || breach?.Name}</td>
                            <td className="print-nowrap">{formatMonthYear(breach?.BreachDate)}</td>
                            <td><span className={`print-severity ${severity.className}`}>{severity.label}</span></td>
                            <td>{(breach?.DataClasses || []).map(translateDataClass).join(", ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              )}

              <section className="print-partner">
                <h2>Precisa de ajuda profissional?</h2>
                <p>{breaches.length > 0 ? ENETSEC.messageWithBreaches : ENETSEC.messageWithoutBreaches}</p>
                <p className="print-partner-links">
                  ENETSEC, parceira do SafeID · <a href={ENETSEC.websiteUrl}>enetsec.com</a> · WhatsApp:{" "}
                  <a href={ENETSEC.whatsappUrl}>wa.me/19546187140</a>
                </p>
              </section>

              <p className="print-disclaimer">
                O SafeID nunca mostra nem guarda senhas vazadas: este relatório lista apenas os tipos de dado expostos,
                segundo o Have I Been Pwned. Recomendação gerada por inteligência artificial; confira os passos antes de agir.
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>,
    document.body,
  );
}
