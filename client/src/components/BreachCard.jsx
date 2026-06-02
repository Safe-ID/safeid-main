import { useState } from "react";
import { W, translateDataClass } from "./safeidData";

function resolveLogoPath(logoPath) {
  if (!logoPath || typeof logoPath !== "string") return "";
  if (/logos\.haveibeenpwned\.com\/List\.png/i.test(logoPath)) return "";
  if (/^https?:\/\//i.test(logoPath)) return logoPath;
  if (logoPath.startsWith("/")) return logoPath;
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

  // Fallbacks de cor customizada nativa para a logo default quando não há imagem
  const dynamicColor = isBreachData ? "#38BDF8" : item.color || "#38BDF8";

  return (
    <div
      onClick={() => setOpen(!open)}
      className={`bg-safe-card border rounded-2xl p-4 sm:p-4.5 cursor-pointer transition-all duration-200 hover:bg-safe-hover ${open ? 'border-safe-borderL' : 'border-safe-border'}`}
      style={{ animation: `slideUp 0.4s ease ${idx * 70}ms both` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {logoPath ? (
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-safe-hover border border-safe-borderL flex items-center justify-center shrink-0">
              <img
                src={logoPath}
                alt={`${title || "vazamento"} logo`}
                className="w-full h-full object-cover block"
                onError={(e) => e.currentTarget.style.display = "none"}
              />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl border flex items-center justify-center text-sm font-bold font-mono shrink-0" 
                 style={{ backgroundColor: `${dynamicColor}1A`, borderColor: `${dynamicColor}40`, color: dynamicColor }}>
              {logoInitial}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-safe-text font-semibold text-[13px] sm:text-sm truncate">{title}</div>
            <div className="text-safe-dim text-xs mt-0.5 truncate">{subtitle}</div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          {recent && (
            <span className="bg-safe-danger/10 border border-safe-danger/20 text-safe-danger text-[10px] font-semibold px-2 py-0.5 rounded-full tracking-widest hidden sm:inline-block">
              RECENTE
            </span>
          )}
          <svg width="14" height="14" viewBox="0 0 14 14" className={`text-safe-dim transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
            <path d="M2 5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      
      {open && (
        <div className="mt-3.5 pt-3.5 border-t border-safe-border animate-fade-in">
          <div className="text-[10px] text-safe-dim mb-2.5 tracking-[1px] font-semibold uppercase">
            {isBreachData ? "DADOS EXPOSTOS" : isHistory ? "DETALHES DO SCAN" : "DADOS EXPOSTOS"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {isBreachData ? (item.DataClasses || item.classes || []).map((cls) => {
              const w = W[cls] || 2;
              const colClass = w >= 8 ? "safe-danger" : w >= 5 ? "safe-warn" : "safe-secondary";
              return (
                <span key={cls} className={`bg-${colClass}/10 border border-${colClass}/30 text-${colClass} text-[11px] font-medium px-2.5 py-1 rounded-full`}>
                  {translateDataClass(cls)}
                </span>
              );
            }) : isHistory ? [
              `Risk ${item.riskScore}/100`,
              item.classification,
              `${item.breachesFound} vazamentos`,
              item.isVerified ? "Verificado" : "Não verificado",
            ].filter(Boolean).map(detail => (
              <span key={detail} className="bg-safe-secondary/10 border border-safe-secondary/30 text-safe-secondary text-[11px] font-medium px-2.5 py-1 rounded-full">
                {detail}
              </span>
            )) : item.classes.map(cls => {
              const w = W[cls] || 2;
              const colClass = w >= 8 ? "safe-danger" : w >= 5 ? "safe-warn" : "safe-secondary";
              return (
                <span key={cls} className={`bg-${colClass}/10 border border-${colClass}/30 text-${colClass} text-[11px] font-medium px-2.5 py-1 rounded-full`}>
                  {translateDataClass(cls)}
                </span>
              );
            })}
          </div>
          {item?.IsVerified !== undefined && (
            <div className="mt-3 text-safe-dim text-xs">
              {item.IsVerified ? "Vazamento verificado pelo HIBP." : "Vazamento não verificado."}
            </div>
          )}
          {isHistory && item.recommendation && (
            <div className="mt-3 text-safe-muted text-[13px] leading-relaxed whitespace-pre-wrap">
              {item.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}