import { useState, useEffect } from "react";
import { W, translateDataClass } from "./safeidData";
import RiskCircle from "./RiskCircle";
import BreachCard from "./BreachCard";
import AIPanel from "./AIPanel";
import { fetchMe } from "../lib/api";

function resolveLogoPath(logoPath) {
  if (!logoPath || typeof logoPath !== "string") return "";
  if (/logos\.haveibeenpwned\.com\/List\.png/i.test(logoPath)) return "";
  if (/^https?:\/\//i.test(logoPath)) return logoPath;
  if (logoPath.startsWith("/")) return logoPath;
  return `/${logoPath.replace(/^\/+/, "")}`;
}

function getLogoInitial(item) {
  const label = item?.Title || item?.Name || "V";
  return label.trim().charAt(0).toUpperCase() || "V";
}

export default function Dashboard({ user, onSignOut }) {
  const [profile, setProfile] = useState(user);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const me = await fetchMe();
        if (!active) return;
        setProfile(me);
      } catch (err) {
        if (!active) return;
        setError(err.message || "Não foi possível carregar o dashboard.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading) {
      let p = 0;
      const iv = setInterval(() => {
        p += Math.random() * 22 + 6;
        if (p >= 100) p = 100;
        setPct(Math.round(p));
      }, 100);
      return () => clearInterval(iv);
    }
    const frame = requestAnimationFrame(() => setPct(100));
    return () => cancelAnimationFrame(frame);
  }, [loading]);

  const scanSnapshot = profile?.scanSnapshot || null;
  const riskScore = typeof scanSnapshot?.riskScore === "number" ? scanSnapshot.riskScore : 0;
  const classification = scanSnapshot?.classification || "N/D";
  const recommendation = scanSnapshot?.recommendation || "";
  const updatedAt = profile?.scanSnapshotUpdatedAt || scanSnapshot?.processedAt || null;

  const rawBreachData = scanSnapshot?.breachData;
  const breachData = Array.isArray(rawBreachData)
    ? rawBreachData
    : Array.isArray(rawBreachData?.breaches)
      ? rawBreachData.breaches
      : Array.isArray(rawBreachData?.data)
        ? rawBreachData.data
        : [];

  const breachTimeline = [...breachData].sort((a, b) => {
    const aDate = new Date(a?.BreachDate || a?.date || a?.createdAt || 0).getTime();
    const bDate = new Date(b?.BreachDate || b?.date || b?.createdAt || 0).getTime();
    return bDate - aDate;
  });

  const dataClassCounts = breachData.reduce((acc, breach) => {
    const classes = breach?.DataClasses || breach?.classes || [];
    classes.forEach((dataClass) => {
      acc[dataClass] = (acc[dataClass] || 0) + 1;
    });
    return acc;
  }, {});

  const greetingName = profile?.email ? profile.email.split("@")[0] : "usuário";
  const totalBreaches = typeof scanSnapshot?.breachesFound === "number" ? scanSnapshot.breachesFound : breachData.length;

  return (
    <div className="w-full max-w-4xl mx-auto pt-10 px-6 pb-20">
      <div className="mb-8 animate-slide-up">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-safe-dim text-sm mb-1 capitalize">
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1 className="text-safe-text text-3xl font-bold tracking-tight font-[system-ui,sans-serif]">
              Olá, {greetingName} 👋
            </h1>
            <p className="text-safe-muted text-base mt-1">
              Monitorando: <span className="text-safe-secondary">{profile?.email}</span>
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 mt-4 sm:mt-0">
            <div className="flex items-center gap-2 bg-safe-danger/15 border border-safe-danger/40 rounded-xl py-2 px-4 h-fit">
              <span className="w-2 h-2 rounded-full bg-safe-danger inline-block" />
              <span className="text-safe-danger text-sm font-semibold">{totalBreaches || 0} vazamentos detectados</span>
            </div>
            <button onClick={onSignOut} className="bg-transparent border border-safe-border rounded-xl text-safe-dim py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-hover">
              Sair
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="bg-safe-card border border-safe-border rounded-2xl p-6 mb-6">
          <div className="flex justify-between mb-3">
            <span className="text-safe-muted text-sm">Sincronizando seu perfil e histórico...</span>
            <span className="text-safe-secondary text-sm font-semibold">{pct}%</span>
          </div>
          <div className="h-1.5 bg-safe-border rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-safe-primary to-safe-secondary rounded-full transition-all duration-150 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-safe-dim text-xs mt-3">Consultando auth/me e scan/history</p>
        </div>
      )}

      {!loading && error && (
        <div className="bg-gradient-to-br from-[#180808] to-[#200A0A] border border-safe-danger/40 rounded-2xl p-5 mb-6">
          <div className="text-safe-danger font-semibold text-base">Não foi possível carregar o dashboard</div>
          <div className="text-safe-dim text-sm mt-2">{error}</div>
        </div>
      )}

      {!loading && !error && (
        <>
          {totalBreaches > 0 && (
            <div className="bg-gradient-to-br from-[#180808] to-[#200A0A] border border-safe-danger/40 rounded-2xl p-5 flex items-center gap-4 mb-6 animate-slide-up">
              <div className="w-10 h-10 rounded-xl bg-safe-danger/10 flex items-center justify-center text-xl shrink-0">⚠</div>
              <div>
                <div className="text-safe-danger font-semibold text-base">{totalBreaches} vazamentos encontrados para {profile?.email}</div>
                <div className="text-[#7A3030] text-sm mt-1">Seus dados circulam em repositórios de ameaças. Ação imediata recomendada.</div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-1 bg-safe-card border border-safe-border rounded-xl p-1.5 mb-6">
            {[{ id: "overview", label: "Visão Geral" }, { id: "breaches", label: `Vazamentos (${breachData.length})` }, { id: "ai", label: "✦ Plano IA" }].map(t => (
              <button 
                key={t.id} 
                onClick={() => setTab(t.id)} 
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm transition-all cursor-pointer ${
                  tab === t.id 
                    ? "bg-safe-hover border border-safe-borderL text-safe-text font-semibold" 
                    : "bg-transparent border border-transparent text-safe-dim font-normal"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 mb-6">
                <div className="bg-safe-card border border-safe-border rounded-2xl p-8 flex flex-col items-center justify-center">
                  <RiskCircle val={riskScore} size={220} />
                </div>
                
                <div className="flex flex-col gap-3">
                  {[
                    { label: "Risco atual", value: `${riskScore}/100`, colorClass: "text-safe-danger", icon: "🔑" },
                    { label: "Classificação", value: classification, colorClass: "text-safe-warn", icon: "💳" },
                    { label: "Vazamentos detectados", value: `${totalBreaches || 0}`, colorClass: "text-safe-secondary", icon: "👤" },
                    { label: "Última atualização", value: updatedAt ? new Date(updatedAt).toLocaleDateString("pt-BR") : "Sem dados", colorClass: "text-safe-muted", icon: "📅" },
                  ].map(s => (
                    <div key={s.label} className="bg-safe-card border border-safe-border rounded-xl p-4 flex items-center gap-4">
                      <span className="text-2xl">{s.icon}</span>
                      <div>
                        <div className="text-safe-dim text-xs mb-1">{s.label}</div>
                        <div className={`${s.colorClass} font-semibold text-base`}>{s.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-safe-card border border-safe-border rounded-[16px] p-[20px] mb-[16px]">
                <div className="text-safe-dim text-[11px] font-semibold tracking-[1.2px] mb-[18px]">DADOS EXPOSTOS</div>
                {Object.entries(dataClassCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                  const w = W[type] || 2;
                  const colClass = w >= 8 ? "text-safe-danger" : w >= 5 ? "text-safe-warn" : "text-safe-secondary";
                  const bgColorClass = w >= 8 ? "bg-safe-danger" : w >= 5 ? "bg-safe-warn" : "bg-safe-secondary";
                  const p = breachData.length ? Math.round((count / breachData.length) * 100) : 0;
                  
                  return (
                    <div key={type} className="mb-[14px]">
                      <div className="flex justify-between mb-[6px]">
                        <span className="text-safe-muted text-[13px]">{translateDataClass(type)}</span>
                        <div className="flex gap-[8px] items-center">
                          <span className="text-safe-dim text-[12px]">{count}/{breachData.length || 1}</span>
                          <span className={`${colClass} text-[12px] font-semibold`}>{p}%</span>
                        </div>
                      </div>
                      <div className="h-[4px] bg-safe-border rounded-full overflow-hidden">
                        <div className={`h-full ${bgColorClass} rounded-full transition-all duration-[800ms] ease-[cubic-bezier(0.4,0,0.2,1)]`} style={{ width: `${p}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-safe-card border border-safe-border rounded-[16px] p-[20px]">
                <div className="text-safe-dim text-[11px] font-semibold tracking-[1.2px] mb-[18px]">LINHA DO TEMPO DOS INCIDENTES</div>
                <div className="relative">
                  <div className="absolute left-[15px] top-0 bottom-0 w-[1px] bg-safe-border" />
                  {breachTimeline.map((item, i) => {
                    const itemColor = (item?.DataClasses || item?.classes || []).some((cls) => (W[cls] || 0) >= 8)
                      ? "safe-danger"
                      : (item?.DataClasses || item?.classes || []).some((cls) => (W[cls] || 0) >= 5)
                        ? "safe-warn"
                        : "safe-secondary";
                    const breachDate = item?.BreachDate || item?.date || item?.createdAt;
                    const pwnCount = item?.PwnCount ?? item?.pwnCount ?? item?.count;
                    const logoPath = resolveLogoPath(item?.LogoPath || item?.logoPath);
                    const logoInitial = getLogoInitial(item);

                    return (
                      <div key={item.id || item.Name || item.Title || i} className={`flex gap-[20px] pl-[36px] relative ${i < breachTimeline.length - 1 ? "mb-[20px]" : ""}`}>
                        <div className={`absolute left-[10px] top-[5px] w-[10px] h-[10px] rounded-full bg-${itemColor} shadow-[0_0_8px_var(--tw-shadow-color)] shadow-${itemColor}/50`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-[10px] flex-wrap">
                            {logoPath ? (
                              <div className="w-[30px] h-[30px] rounded-[8px] overflow-hidden bg-safe-hover border border-safe-borderL shrink-0">
                                <img src={logoPath} alt="vazamento" className="w-full h-full object-cover" onError={e => e.currentTarget.style.display = "none"} />
                              </div>
                            ) : (
                              <div className={`w-[30px] h-[30px] rounded-[8px] bg-${itemColor}/10 border border-${itemColor}/30 flex items-center justify-center text-${itemColor} text-[13px] font-bold shrink-0`}>
                                {logoInitial}
                              </div>
                            )}
                            <span className="text-safe-text text-[14px] font-semibold">{item?.Title || item?.Name || `Incidente ${i + 1}`}</span>
                            <span className="text-safe-dim text-[12px]">{breachDate ? new Date(breachDate).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "Sem data"}</span>
                          </div>
                          
                          <div className="flex gap-[6px] mt-[6px] flex-wrap">
                            {(item?.DataClasses || item?.classes || []).slice(0, 3).map((dataClass) => {
                              const col = (W[dataClass] || 2) >= 8 ? "safe-danger" : (W[dataClass] || 2) >= 5 ? "safe-warn" : "safe-secondary";
                              return (
                                <span key={dataClass} className={`bg-${col}/10 border border-${col}/20 text-${col} text-[10px] py-[2px] px-[8px] rounded-full`}>
                                  {translateDataClass(dataClass)}
                                </span>
                              );
                            })}
                            {pwnCount && <span className="bg-safe-secondary/10 border border-safe-secondary/20 text-safe-secondary text-[10px] py-[2px] px-[8px] rounded-full">{pwnCount.toLocaleString("pt-BR")} contas</span>}
                            <span className="bg-safe-dim/10 border border-safe-dim/20 text-safe-dim text-[10px] py-[2px] px-[8px] rounded-full">{item?.IsVerified ? "Verificado" : "Não verificado"}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "breaches" && (
            <div className="animate-fade-in flex flex-col gap-[10px]">
              {breachData.length ? breachData.map((item, i) => <BreachCard key={item.id || item.Name || item.Title || i} item={item} idx={i} />) : (
                <div className="bg-safe-card border border-safe-border rounded-[14px] py-[18px] px-[20px] text-safe-dim">
                  Nenhum histórico disponível ainda.
                </div>
              )}
            </div>
          )}

          {tab === "ai" && (
            <div className="animate-fade-in">
              <AIPanel recommendation={recommendation} updatedAt={updatedAt} classification={classification} riskScore={riskScore} />
            </div>
          )}
        </>
      )}
    </div>
  );
}