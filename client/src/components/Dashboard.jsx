import { useState, useEffect } from "react";
import { W, translateDataClass, severityFromWeight } from "./safeidData";
import RiskCircle from "./RiskCircle";
import BreachCard from "./BreachCard";
import AIPanel from "./AIPanel";
import { createScan, deleteAccount, fetchMe } from "../lib/api";

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

export default function Dashboard({ user, onSignOut, onDeleteAccount }) {
  const [profile, setProfile] = useState(user);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [scanning, setScanning] = useState(false);
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
  const mitigationSteps = Array.isArray(scanSnapshot?.mitigationSteps) ? scanSnapshot.mitigationSteps : [];
  const urgencyLevel = scanSnapshot?.urgencyLevel || null;
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

  // Separa "nunca verificado" e "não deu para verificar" de "verificado e sem vazamentos"
  const scanStatus = !scanSnapshot
    ? "pending"
    : scanSnapshot.isVerified === false
      ? "unverified"
      : totalBreaches > 0
        ? "breached"
        : "clean";

  const STATUS_BADGES = {
    pending: { label: "Ainda não verificado", className: "bg-safe-card border-safe-borderL text-safe-muted", dot: "bg-safe-muted" },
    unverified: { label: "Verificação pendente", className: "bg-safe-warn/15 border-safe-warn/40 text-safe-warn", dot: "bg-safe-warn" },
    breached: { label: `${totalBreaches} vazamentos detectados`, className: "bg-safe-danger/15 border-safe-danger/40 text-safe-danger", dot: "bg-safe-danger" },
    clean: { label: "Nenhum vazamento encontrado", className: "bg-safe-accent/15 border-safe-accent/40 text-safe-accent", dot: "bg-safe-accent" },
  };
  const statusBadge = STATUS_BADGES[scanStatus];

  const handleRescan = async () => {
    try {
      setScanning(true);
      setActionError("");
      // O backend sempre usa o email da conta logada
      await createScan(profile?.email);
      const me = await fetchMe();
      setProfile(me);
    } catch (err) {
      setActionError(err.message || "Não foi possível fazer um novo scan.");
    } finally {
      setScanning(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm("Tem certeza que deseja excluir sua conta? Esta ação não pode ser desfeita.");
    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      setActionError("");
      await deleteAccount();
      onDeleteAccount();
    } catch (err) {
      setActionError(err.message || "Não foi possível excluir a conta.");
    } finally {
      setDeleting(false);
    }
  };

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
            <div className={`flex items-center gap-2 border rounded-xl py-2 px-4 h-fit ${statusBadge.className}`}>
              <span className={`w-2 h-2 rounded-full inline-block ${statusBadge.dot}`} />
              <span className="text-sm font-semibold">{statusBadge.label}</span>
            </div>
            <button
              onClick={handleRescan}
              disabled={scanning || loading}
              className="bg-gradient-to-br from-safe-primary to-safe-primaryD border-none rounded-xl text-white py-2 px-4 text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70 flex items-center gap-2"
            >
              {scanning && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />}
              {scanning ? "Verificando..." : "Verificar novamente"}
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="bg-transparent border border-safe-danger/50 rounded-xl text-safe-danger py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-danger/10 disabled:cursor-wait disabled:opacity-70"
            >
              {deleting ? "Excluindo..." : "Excluir conta"}
            </button>
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

      {!loading && actionError && (
        <div className="bg-gradient-to-br from-[#180808] to-[#200A0A] border border-safe-danger/40 rounded-2xl p-5 mb-6">
          <div className="text-safe-danger font-semibold text-base">Ação indisponível</div>
          <div className="text-safe-dim text-sm mt-2">{actionError}</div>
        </div>
      )}

      {!loading && !error && (
        <>
          {scanStatus === "clean" && (
            <div className="bg-safe-accent/5 border border-safe-accent/30 rounded-2xl p-5 flex items-center gap-4 mb-6 animate-slide-up">
              <div className="w-10 h-10 rounded-xl bg-safe-accent/10 flex items-center justify-center text-xl text-safe-accent shrink-0">✓</div>
              <div>
                <div className="text-safe-accent font-semibold text-base">Nenhum vazamento encontrado para {profile?.email}</div>
                <div className="text-safe-muted text-sm mt-1">Seu email não aparece nas bases de vazamentos consultadas. Continue usando senhas únicas e a verificação em duas etapas.</div>
              </div>
            </div>
          )}

          {(scanStatus === "pending" || scanStatus === "unverified") && (
            <div className="bg-safe-warn/5 border border-safe-warn/30 rounded-2xl p-5 flex items-center gap-4 mb-6 animate-slide-up">
              <div className="w-10 h-10 rounded-xl bg-safe-warn/10 flex items-center justify-center text-xl text-safe-warn shrink-0">!</div>
              <div>
                <div className="text-safe-warn font-semibold text-base">
                  {scanStatus === "pending" ? "Ainda não verificamos o seu email" : "Não conseguimos verificar o seu email agora"}
                </div>
                <div className="text-safe-muted text-sm mt-1">Clique em "Verificar novamente" para consultar os vazamentos. Até lá, o score abaixo não vale como resultado.</div>
              </div>
            </div>
          )}

          {scanStatus === "breached" && (
            <div className="bg-gradient-to-br from-[#180808] to-[#200A0A] border border-safe-danger/40 rounded-2xl p-5 flex items-center gap-4 mb-6 animate-slide-up">
              <div className="w-10 h-10 rounded-xl bg-safe-danger/10 flex items-center justify-center text-xl shrink-0">⚠</div>
              <div>
                <div className="text-safe-danger font-semibold text-base">{totalBreaches} vazamentos encontrados para {profile?.email}</div>
                <div className="text-[#7A3030] text-sm mt-1">Seus dados circulam em repositórios de ameaças. Ação imediata recomendada.</div>
              </div>
            </div>
          )}

          <div role="tablist" aria-label="Seções do painel" className="flex flex-col sm:flex-row gap-1 bg-safe-card border border-safe-border rounded-xl p-1.5 mb-6">
            {[{ id: "overview", label: "Visão Geral" }, { id: "breaches", label: `Vazamentos (${breachData.length})` }, { id: "ai", label: "✦ Plano IA" }].map(t => (
              <button 
                key={t.id} 
                type="button"
                role="tab"
                aria-selected={tab === t.id}
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
                  <RiskCircle val={riskScore} size={220} label={scanStatus === "pending" || scanStatus === "unverified" ? "PENDENTE" : undefined} />
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
                    const itemSeverity = severityFromWeight(
                      Math.max(0, ...(item?.DataClasses || item?.classes || []).map((cls) => W[cls] || 0)),
                    );
                    const breachDate = item?.BreachDate || item?.date || item?.createdAt;
                    const pwnCount = item?.PwnCount ?? item?.pwnCount ?? item?.count;
                    const logoPath = resolveLogoPath(item?.LogoPath || item?.logoPath);
                    const logoInitial = getLogoInitial(item);

                    return (
                      <div key={item.id || item.Name || item.Title || i} className={`flex gap-[20px] pl-[36px] relative ${i < breachTimeline.length - 1 ? "mb-[20px]" : ""}`}>
                        <div className={`absolute left-[10px] top-[5px] w-[10px] h-[10px] rounded-full ${itemSeverity.dot} shadow-[0_0_8px_var(--tw-shadow-color)]`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-[10px] flex-wrap">
                            {logoPath ? (
                              <div className="w-[30px] h-[30px] rounded-[8px] overflow-hidden bg-safe-hover border border-safe-borderL shrink-0">
                                <img src={logoPath} alt="vazamento" className="w-full h-full object-cover" onError={e => e.currentTarget.style.display = "none"} />
                              </div>
                            ) : (
                              <div className={`w-[30px] h-[30px] rounded-[8px] ${itemSeverity.chip} border flex items-center justify-center text-[13px] font-bold shrink-0`}>
                                {logoInitial}
                              </div>
                            )}
                            <span className="text-safe-text text-[14px] font-semibold">{item?.Title || item?.Name || `Incidente ${i + 1}`}</span>
                            <span className="text-safe-dim text-[12px]">{breachDate ? new Date(breachDate).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "Sem data"}</span>
                          </div>
                          
                          <div className="flex gap-[6px] mt-[6px] flex-wrap">
                            {(item?.DataClasses || item?.classes || []).slice(0, 3).map((dataClass) => {
                              const severity = severityFromWeight(W[dataClass] || 2);
                              return (
                                <span key={dataClass} className={`${severity.softChip} border text-[10px] py-[2px] px-[8px] rounded-full`}>
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
              <AIPanel recommendation={recommendation} mitigationSteps={mitigationSteps} urgencyLevel={urgencyLevel} updatedAt={updatedAt} classification={classification} riskScore={riskScore} />
            </div>
          )}
        </>
      )}
    </div>
  );
}