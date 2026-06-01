import { useState } from "react";
import { C, W, translateDataClass } from "./safeidData";

function resolveLogoPath(logoPath) {
  if (!logoPath || typeof logoPath !== "string") {
    return "";
  }

  if (/logos\.haveibeenpwned\.com\/List\.png/i.test(logoPath)) {
    return "";
  }

  if (/^https?:\/\//i.test(logoPath)) {
    return logoPath;
  }

  if (logoPath.startsWith("/")) {
    return logoPath;
  }

  return `/${logoPath.replace(/^\/+/, "")}`;
}

function getLogoInitial(item, title) {
  const label = title || item?.Title || item?.Name || "V";
  return label.trim().charAt(0).toUpperCase() || "V";
}

export default function BreachCard({ item, idx }) {
  const [open, setOpen] = useState(false);
  const isBreachData = Boolean(item?.Name || item?.Title || item?.BreachDate || item?.DataClasses);
  const isHistory = Boolean(item?.createdAt) && !isBreachData;
  const breachDate = item?.BreachDate || item?.date || item?.createdAt;
  const logoPath = resolveLogoPath(item?.LogoPath || item?.logoPath);
  const recent = breachDate ? new Date().getFullYear() - new Date(breachDate).getFullYear() <= 2 : false;
  const title = isBreachData ? (item.Title || item.Name) : isHistory ? `Scan ${new Date(item.createdAt).toLocaleDateString("pt-BR")}` : item?.name;
  const logoInitial = getLogoInitial(item, title);
  const subtitle = isBreachData
    ? `${breachDate ? new Date(breachDate).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "Sem data"}${item?.PwnCount || item?.pwnCount ? ` · ${(item.PwnCount || item.pwnCount).toLocaleString("pt-BR")} contas` : ""}`
    : isHistory
      ? `${item.breachesFound} vazamentos · ${item.classification}`
      : `${new Date(item.date).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })} · ${(item.count / 1e6).toFixed(0)}M contas`;

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
          {logoPath ? (
            <div style={{
              width: 38, height: 38, borderRadius: 9, overflow: "hidden",
              background: C.bgHover, border: `1px solid ${C.borderL}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <img
                src={logoPath}
                alt={`${title || "vazamento"} logo`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            </div>
          ) : (
            <div style={{
              width: 38, height: 38, borderRadius: 9,
              background: `${(isBreachData ? C.secondary : item.color || C.secondary)}1A`, border: `1px solid ${(isBreachData ? C.secondary : item.color || C.secondary)}40`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: isBreachData ? C.secondary : item.color || C.secondary, fontFamily: "monospace",
            }}>{logoInitial}</div>
          )}
          <div>
            <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{title}</div>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 1 }}>
              {subtitle}
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
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 8, letterSpacing: 1, fontWeight: 600 }}>
            {isBreachData ? "DADOS EXPOSTOS" : isHistory ? "DETALHES DO SCAN" : "DADOS EXPOSTOS"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {isBreachData ? (item.DataClasses || item.classes || []).map((cls) => {
              const w = W[cls] || 2;
              const col = w >= 8 ? C.danger : w >= 5 ? C.warn : C.secondary;
              return (
                <span key={cls} style={{
                  background: `${col}18`, border: `1px solid ${col}40`,
                  color: col, fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 999,
                }}>{translateDataClass(cls)}</span>
              );
            }) : isHistory ? [
              `Risk ${item.riskScore}/100`,
              item.classification,
              `${item.breachesFound} vazamentos`,
              item.isVerified ? "Verificado" : "Não verificado",
            ].filter(Boolean).map(detail => (
              <span key={detail} style={{
                background: `${C.secondary}18`, border: `1px solid ${C.secondary}40`,
                color: C.secondary, fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 999,
              }}>{detail}</span>
            )) : item.classes.map(cls => {
              const w = W[cls] || 2;
              const col = w >= 8 ? C.danger : w >= 5 ? C.warn : C.secondary;
              return (
                <span key={cls} style={{
                  background: `${col}18`, border: `1px solid ${col}40`,
                  color: col, fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 999,
                }}>{translateDataClass(cls)}</span>
              );
            })}
          </div>
          {item?.IsVerified !== undefined && (
            <div style={{ marginTop: 12, color: C.dim, fontSize: 12 }}>
              {item.IsVerified ? "Vazamento verificado pelo HIBP." : "Vazamento não verificado."}
            </div>
          )}
          {isHistory && item.recommendation && (
            <div style={{ marginTop: 12, color: C.muted, fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
              {item.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
