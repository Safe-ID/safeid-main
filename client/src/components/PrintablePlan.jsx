import { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { translateDataClass } from "./safeidData";

const CLASSIFICATION_LABELS = { LOW: "Baixo", MODERATE: "Médio", HIGH: "Alto", CRITICAL: "Crítico" };
const URGENCY_LABELS = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };

const formatMonthYear = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "data não informada" : date.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * Versão para impressão do plano de ação (US09). Fica fora do #root, num portal no <body>:
 * na tela não aparece, e na impressão (main.css) só ela aparece, em fundo branco.
 * O navegador salva o PDF ("Salvar como PDF" na janela de impressão), sem dependência nova.
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

  return createPortal(
    <div id="safeid-print-plan" aria-hidden="true">
      <header className="print-header">
        <div>
          <div className="print-brand">SafeID</div>
          <h1>Plano de ação contra vazamentos de dados</h1>
        </div>
        <div className="print-meta">
          <div>Conta: {email || "não informada"}</div>
          {analysedAt && <div>Análise de {analysedAt}</div>}
          <div>Gerado em {generatedAt}</div>
        </div>
      </header>

      <section className="print-summary">
        <div><span>Score de risco</span><strong>{riskScore}/100</strong></div>
        <div><span>Classificação</span><strong>{CLASSIFICATION_LABELS[classification] || classification}</strong></div>
        <div><span>Vazamentos</span><strong>{breaches.length}</strong></div>
        {urgencyLevel && <div><span>Urgência</span><strong>{URGENCY_LABELS[urgencyLevel] || urgencyLevel}</strong></div>}
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
          <ol>
            {mitigationSteps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </section>
      )}

      {sortedBreaches.length > 0 && (
        <section>
          <h2>Vazamentos encontrados</h2>
          <table>
            <thead>
              <tr><th>Vazamento</th><th>Data</th><th>Dados expostos</th></tr>
            </thead>
            <tbody>
              {sortedBreaches.map((breach, i) => (
                <tr key={breach?.Name || i}>
                  <td>{breach?.Title || breach?.Name}</td>
                  <td>{formatMonthYear(breach?.BreachDate)}</td>
                  <td>{(breach?.DataClasses || []).map(translateDataClass).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer>
        O SafeID nunca mostra nem guarda senhas vazadas: este relatório lista apenas os tipos de dado expostos,
        segundo o Have I Been Pwned. Recomendação gerada por inteligência artificial; confira os passos antes de agir.
      </footer>
    </div>,
    document.body,
  );
}
