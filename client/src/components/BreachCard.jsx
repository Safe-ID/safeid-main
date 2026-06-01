import { useState } from "react";
import { C, W } from "./safeidData";

export default function BreachCard({ b, idx }) {
  const [open, setOpen] = useState(false);
  const recent = new Date().getFullYear() - new Date(b.date).getFullYear() <= 2;

  return (
    <div
      onClick={() => setOpen(!open)}
      style={{
        background: C.bgCard, border: `1px solid ${open ? C.borderL : C.border}`,
        borderRadius: 14, padding: "16px 18px", cursor: "pointer",
        transition: "all 0.2s", animation: `slideUp 0.4s ease ${idx * 70}ms both`,
      }}
      onMouseEnter={e => e.currentTarget.style.background = C.bgHover}
      onMouseLeave={e => e.currentTarget.style.background = C.bgCard}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 9,
            background: `${b.color}1A`, border: `1px solid ${b.color}40`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: b.color, fontFamily: "monospace",
          }}>{b.name[0]}</div>
          <div>
            <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{b.name}</div>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 1 }}>
              {new Date(b.date).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })} · {(b.count / 1e6).toFixed(0)}M contas
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {recent && (
            <span style={{
              background: "#F8717122", border: "1px solid #F8717144",
              color: C.danger, fontSize: 10, fontWeight: 600,
              padding: "3px 8px", borderRadius: 999, letterSpacing: 1,
            }}>RECENTE</span>
          )}
          <svg width="14" height="14" viewBox="0 0 14 14"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "0.2s", color: C.dim }}>
            <path d="M2 5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8, letterSpacing: 1, fontWeight: 600 }}>DADOS EXPOSTOS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {b.classes.map(cls => {
              const w = W[cls] || 2;
              const col = w >= 8 ? C.danger : w >= 5 ? C.warn : C.secondary;
              return (
                <span key={cls} style={{
                  background: `${col}18`, border: `1px solid ${col}40`,
                  color: col, fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 999,
                }}>{cls}</span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
