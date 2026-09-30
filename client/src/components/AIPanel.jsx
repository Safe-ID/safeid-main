const URGENCY_BADGES = {
  HIGH: { label: "URGÊNCIA ALTA", className: "bg-safe-danger/10 border-safe-danger/30 text-safe-danger" },
  MEDIUM: { label: "URGÊNCIA MÉDIA", className: "bg-safe-warn/10 border-safe-warn/30 text-safe-warn" },
  LOW: { label: "URGÊNCIA BAIXA", className: "bg-safe-accent/10 border-safe-accent/30 text-safe-accent" },
};

export default function AIPanel({ recommendation, mitigationSteps = [], urgencyLevel, updatedAt, classification, riskScore }) {
  const text = recommendation || "Ainda não há uma recomendação de IA disponível para esta conta.";
  const formattedUpdatedAt = updatedAt ? new Date(updatedAt).toLocaleString("pt-BR") : null;
  const urgency = URGENCY_BADGES[urgencyLevel] || null;

  return (
    <div className="bg-gradient-to-br from-safe-card to-[#0A1A30] border border-safe-borderL rounded-2xl p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-lg bg-safe-accent/10 border border-safe-accent/30 flex items-center justify-center text-safe-accent text-sm shrink-0">
          ✦
        </div>
        <div>
          <div className="text-safe-text font-semibold text-sm">SafeID AI · Plano de Ação</div>
          <div className="text-safe-dim text-xs">Análise personalizada por inteligência artificial</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5 mb-5">
        <span className="bg-safe-primary/10 border border-safe-primary/30 text-safe-secondary rounded-full py-1 px-3 text-[11px] font-semibold whitespace-nowrap">
          RISCO {typeof riskScore === "number" ? `${riskScore}/100` : "N/D"}
        </span>
        <span className="bg-safe-accent/10 border border-safe-accent/30 text-safe-accent rounded-full py-1 px-3 text-[11px] font-semibold whitespace-nowrap">
          {classification || "CLASSIFICAÇÃO NÃO DISPONÍVEL"}
        </span>
        {urgency && (
          <span className={`border rounded-full py-1 px-3 text-[11px] font-semibold whitespace-nowrap ${urgency.className}`}>
            {urgency.label}
          </span>
        )}
      </div>

      <div className="text-safe-muted text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap">
        {text}
      </div>

      {mitigationSteps.length > 0 && (
        <div className="mt-5 pt-5 border-t border-safe-border">
          <div className="text-[10px] text-safe-dim mb-3 tracking-[1px] font-semibold uppercase">
            O que fazer agora
          </div>
          <ol className="flex flex-col gap-2.5">
            {mitigationSteps.map((step, i) => (
              <li key={i} className="flex gap-3 text-safe-muted text-sm leading-relaxed">
                <span className="w-6 h-6 rounded-full bg-safe-primary/10 border border-safe-primary/30 text-safe-secondary text-[11px] font-semibold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {formattedUpdatedAt && (
        <div className="mt-4 text-safe-dim text-xs">
          Atualizado em {formattedUpdatedAt}
        </div>
      )}
    </div>
  );
}