import { useState } from "react";
import { C } from "./safeidData";

export default function AIPanel({ breaches }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);

  const run = async () => {
    setLoading(true); setText(""); setDone(false);
    try {
      const summary = breaches.map(b => `${b.name} (${b.date.slice(0, 4)}): ${b.classes.join(", ")}`).join("; ");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          stream: true,
          system: "Você é especialista em segurança digital do SafeID. Responda SEMPRE em português brasileiro. Use linguagem clara, sem jargões. Use emojis e parágrafos curtos.",
          messages: [{ role: "user", content: `Vazamentos: ${summary}. Gere plano de ação em 3-4 parágrafos: impacto prático, 3 ações urgentes, dica preventiva. Seja empático.` }],
        }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const p = JSON.parse(data);
            if (p.type === "content_block_delta" && p.delta?.text) setText(prev => prev + p.delta.text);
          } catch (_) {}
        }
      }
      setDone(true);
    } catch (_) {
      setText("❌ Erro ao gerar análise. Tente novamente.");
      setDone(true);
    }
    setLoading(false);
  };

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

      {!text && !loading && (
        <button onClick={run} style={{
          width: "100%", background: `linear-gradient(135deg,${C.primary}22,${C.accent}11)`,
          border: `1px solid ${C.primary}55`, borderRadius: 10, color: C.secondary,
          padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
        }}>✦ Gerar Plano de Ação com IA</button>
      )}

      {loading && !text && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", color: C.dim, fontSize: 14 }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: "50%", background: C.accent,
              display: "inline-block", animation: `pulse 1.2s ease ${i * 0.2}s infinite`,
            }} />
          ))}
          <span style={{ marginLeft: 6 }}>Analisando seus vazamentos...</span>
        </div>
      )}

      {text && (
        <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
          {text}
          {!done && <span style={{ color: C.accent, animation: "blink 1s infinite" }}>▌</span>}
        </div>
      )}

      {done && (
        <button onClick={run} style={{
          marginTop: 14, background: "transparent",
          border: `1px solid ${C.border}`, borderRadius: 8,
          color: C.dim, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
        }}>↺ Regenerar</button>
      )}
    </div>
  );
}
