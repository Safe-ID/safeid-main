import { C } from "./safeidData";

export default function AIPanel({ recommendation, updatedAt, classification, riskScore }) {
  const text = recommendation || "Ainda não há uma recomendação de IA disponível para esta conta.";
  const formattedUpdatedAt = updatedAt ? new Date(updatedAt).toLocaleString("pt-BR") : null;

  return (
    <div style={{
      background: "linear-gradient(135deg,#071220,#0A1A30)",
      border: `1px solid ${C.borderL}`, borderRadius: 16, padding: 24,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `${C.accent}18`, border: `1px solid ${C.accent}40`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
        }}>✦</div>
        <div>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>SafeID AI · Plano de Ação</div>
          <div style={{ color: C.dim, fontSize: 12 }}>Análise personalizada por inteligência artificial</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <span style={{ background: `${C.primary}18`, border: `1px solid ${C.primary}35`, color: C.secondary, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
          RISCO {typeof riskScore === "number" ? `${riskScore}/100` : "N/D"}
        </span>
        <span style={{ background: `${C.accent}14`, border: `1px solid ${C.accent}30`, color: C.accent, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
          {classification || "CLASSIFICAÇÃO NÃO DISPONÍVEL"}
        </span>
      </div>

      <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
        {text}
      </div>

      {formattedUpdatedAt && (
        <div style={{ marginTop: 14, color: C.dim, fontSize: 12 }}>
          Atualizado em {formattedUpdatedAt}
        </div>
      )}
    </div>
  );
}
