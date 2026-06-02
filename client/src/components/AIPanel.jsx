export default function AIPanel({ recommendation, updatedAt, classification, riskScore }) {
  const text = recommendation || "Ainda não há uma recomendação de IA disponível para esta conta.";
  const formattedUpdatedAt = updatedAt ? new Date(updatedAt).toLocaleString("pt-BR") : null;

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
      </div>

      <div className="text-safe-muted text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap">
        {text}
      </div>

      {formattedUpdatedAt && (
        <div className="mt-4 text-safe-dim text-xs">
          Atualizado em {formattedUpdatedAt}
        </div>
      )}
    </div>
  );
}