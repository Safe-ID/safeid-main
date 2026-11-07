import { useState, useEffect, useRef } from "react";
import { W, translateDataClass, severityFromWeight, classificationLabel, plural, riskLevel, riskLevelByClassification } from "./safeidData";
import RiskCircle from "./RiskCircle";
import BreachCard from "./BreachCard";
import AIPanel from "./AIPanel";
import PrintablePlan from "./PrintablePlan";
import MonitoringSettings from "./MonitoringSettings";
import ScoreHistoryChart from "./ScoreHistoryChart";
import {
  NOTIFICATIONS_UPDATED_EVENT,
  OPEN_DASHBOARD_TAB_EVENT,
  fetchMe,
} from "../lib/api";
import SkyHeader from "./brand/SkyHeader";

// Ícones de traço no estilo da marca (no lugar de emojis, que mudam de cara em cada aparelho)
function LineIcon({ children, className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const ICONS = {
  gauge: <><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-5" /><circle cx="12" cy="18" r="1.2" /></>,
  levels: <><path d="M5 19v-4M10 19v-7M15 19v-10M20 19V5" /></>,
  breach: <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" /><path d="M12 8v5M12 16h.01" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  alert: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
};

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

export default function Dashboard({ user, initialTab }) {
  const [profile, setProfile] = useState(user);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(initialTab || "overview");
  const tabRefs = useRef({});
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

  // Sino: clicar numa notificação abre a aba de vazamentos; alerta novo recarrega o perfil,
  // porque o monitoramento já recalculou o score e o plano de ação
  useEffect(() => {
    const onOpenTab = (event) => {
      if (event.detail) setTab(event.detail);
    };
    const onNotificationsUpdated = async () => {
      try {
        setProfile(await fetchMe());
      } catch {
        // Mantém o que está na tela; o próximo ciclo do sino tenta de novo
      }
    };

    window.addEventListener(OPEN_DASHBOARD_TAB_EVENT, onOpenTab);
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onNotificationsUpdated);
    return () => {
      window.removeEventListener(OPEN_DASHBOARD_TAB_EVENT, onOpenTab);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onNotificationsUpdated);
    };
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
  const classificationText = classificationLabel(classification);
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

  const tabs = [
    { id: "overview", label: "Visão Geral" },
    { id: "breaches", label: `Vazamentos (${breachData.length})` },
    { id: "ai", label: "✦ Plano IA" },
  ];

  // Setas, Home e End trocam de aba e levam o foco junto (padrão de abas do WAI-ARIA)
  const onTabKeyDown = (event) => {
    const index = tabs.findIndex((t) => t.id === tab);
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowDown: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowUp: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  };

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

  // Exporta o plano: a impressão do navegador salva o PDF. O título vira o nome sugerido do arquivo
  const exportPlanPdf = () => {
    const previousTitle = document.title;
    document.title = `SafeID-plano-de-acao-${new Date().toISOString().slice(0, 10)}`;
    const restore = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };

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

  // Sem resultado válido, o backend tenta o scan de novo sozinho de hora em hora:
  // o painel confere a cada 2 minutos para mostrar o resultado assim que ele chegar
  const waitingForScan = scanStatus === "pending" || scanStatus === "unverified";
  // Cadeado do cabeçalho aberto enquanto o painel carrega ou a primeira análise não terminou
  const analyzing = loading || scanStatus === "pending";
  // Resultado válido na tela: os astros seguem em órbita (calma) em volta do cadeado trancado
  const resultReady = !loading && !error && (scanStatus === "clean" || scanStatus === "breached");
  useEffect(() => {
    if (loading || error || !waitingForScan) return undefined;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        setProfile(await fetchMe());
      } catch {
        // Tenta de novo no próximo ciclo
      }
    }, 2 * 60 * 1000);
    return () => clearInterval(timer);
  }, [loading, error, waitingForScan]);

  const alertsOff = profile?.monitoringEnabled === false;
  const lastResultDate = updatedAt ? new Date(updatedAt).toLocaleDateString("pt-BR") : null;

  return (
    <div className="w-full max-w-4xl mx-auto pt-6 sm:pt-10 px-4 sm:px-6 pb-20">
      {/* Boas-vindas com o céu da página inicial. O resultado da análise fica em destaque no card
          logo abaixo, e a exclusão da conta mora em "Editar cadastro" (menu do avatar, na barra).
          Enquanto a análise está em andamento, os cometas giram em volta do cadeado aberto;
          quando o resultado chega, o cadeado tranca, os astros celebram com um giro rápido e
          depois seguem orbitando devagar. De tempos em tempos um cometa solto é resgatado para a
          órbita: o monitoramento pega vazamentos novos. Sem resultado válido (erro/não verificado), dispersam */}
      <SkyHeader
        ordered={analyzing || resultReady}
        celebrate={resultReady}
        capture={resultReady}
        speed={resultReady ? 0.45 : 1}
        locked={!analyzing}
        lockSide="left"
        skyClass={analyzing ? "opacity-90" : resultReady ? "opacity-75" : "opacity-50"}
        status={analyzing ? "Analisando o seu email." : ""}
      >
        <p className="text-safe-dim text-sm mb-1 capitalize">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="text-safe-text text-2xl sm:text-3xl font-serif font-medium tracking-tight [overflow-wrap:anywhere]">
          Olá, {greetingName}
        </h1>
        <p className="text-safe-muted text-base mt-1 [overflow-wrap:anywhere]">
          Monitorando: <span className="text-safe-secondary">{profile?.email}</span>
        </p>
      </SkyHeader>

      {loading && (
        <div className="bg-safe-card border border-safe-border rounded-2xl p-6 mb-6">
          <div className="flex justify-between mb-3">
            <span className="text-safe-muted text-sm">Sincronizando seu perfil e histórico...</span>
            <span className="text-safe-secondary text-sm font-semibold">{pct}%</span>
          </div>
          <div className="h-1.5 bg-safe-border rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-safe-primary to-safe-accent rounded-full transition-all duration-150 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-safe-dim text-xs mt-3">Buscando o resultado mais recente da sua análise</p>
        </div>
      )}

      {/* Esqueleto do painel enquanto carrega: a página não "pula" quando os dados chegam */}
      {loading && (
        <div aria-hidden="true" className="mb-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-safe-card border border-safe-border rounded-2xl p-4 sm:p-5">
                <div className="safe-skel h-8 w-8 rounded-lg mb-4" />
                <div className="safe-skel h-6 w-16 rounded mb-2" />
                <div className="safe-skel h-3 w-24 rounded" />
              </div>
            ))}
          </div>
          <div className="bg-safe-card border border-safe-border rounded-2xl p-5 sm:p-6">
            <div className="flex gap-3 mb-6">
              {[0, 1, 2].map((i) => <div key={i} className="safe-skel h-8 w-24 rounded-full" />)}
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 py-4 border-t border-safe-border first:border-t-0">
                <div className="safe-skel h-10 w-10 rounded-xl shrink-0" />
                <div className="flex-1">
                  <div className="safe-skel h-4 w-2/5 rounded mb-2" />
                  <div className="safe-skel h-3 w-3/4 rounded" />
                </div>
              </div>
            ))}
          </div>
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
          {scanStatus === "clean" && (
            <div className="bg-safe-accent/5 border border-safe-accent/30 rounded-2xl p-5 flex items-center gap-4 mb-6 animate-slide-up">
              <div className="w-10 h-10 rounded-xl bg-safe-accent/10 flex items-center justify-center text-safe-accent shrink-0"><LineIcon className="w-5 h-5">{ICONS.check}</LineIcon></div>
              <div className="min-w-0">
                <div className="text-safe-accent font-semibold text-base [overflow-wrap:anywhere]">Nenhum vazamento encontrado para {profile?.email}</div>
                <div className="text-safe-muted text-sm mt-1">Seu email não aparece nas bases de vazamentos consultadas. Continue usando senhas únicas e a verificação em duas etapas.</div>
              </div>
            </div>
          )}

          {(scanStatus === "pending" || scanStatus === "unverified") && (
            <div className="bg-safe-warn/5 border border-safe-warn/30 rounded-2xl p-5 flex items-center gap-4 mb-6 animate-slide-up">
              <div className="w-10 h-10 rounded-xl bg-safe-warn/10 flex items-center justify-center text-safe-warn shrink-0"><LineIcon className="w-5 h-5">{ICONS.alert}</LineIcon></div>
              <div className="min-w-0">
                <div className="text-safe-warn font-semibold text-base">
                  {scanStatus === "pending" ? "Estamos analisando o seu email" : "Não conseguimos verificar o seu email agora"}
                </div>
                <div className="text-safe-muted text-sm mt-1">
                  {scanStatus === "pending"
                    ? "O resultado aparece aqui em alguns minutos."
                    : "As bases de vazamentos não responderam. O SafeID tenta de novo sozinho a cada hora, e o resultado aparece aqui assim que der certo."}
                  {" "}Até lá, o score abaixo não vale como resultado.
                </div>
              </div>
            </div>
          )}

          {scanStatus === "breached" && (
            <div className="bg-gradient-to-br from-[#180808] to-[#200A0A] border border-safe-danger/40 rounded-2xl p-5 flex items-center gap-4 mb-6 animate-slide-up">
              <div className="w-10 h-10 rounded-xl bg-safe-danger/10 flex items-center justify-center text-safe-danger shrink-0"><LineIcon className="w-5 h-5">{ICONS.alert}</LineIcon></div>
              <div className="min-w-0">
                <div className="text-safe-danger font-semibold text-base [overflow-wrap:anywhere]">
                  {plural(totalBreaches, "vazamento")} {totalBreaches === 1 ? "encontrado" : "encontrados"} para {profile?.email}
                </div>
                <div className="text-[#E4A0A0] text-sm mt-1">Seus dados circulam em repositórios de ameaças. Ação imediata recomendada.</div>
              </div>
            </div>
          )}

          {/* Sem os alertas, ninguém atualiza o resultado: ele fica como estava na data abaixo */}
          {alertsOff && (scanStatus === "clean" || scanStatus === "breached") && (
            <div role="status" className="bg-safe-card border border-safe-borderL rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-6">
              <div className="flex-1 min-w-0 text-safe-muted text-sm leading-relaxed">
                <span className="text-safe-text font-semibold">Seus alertas estão desligados.</span>{" "}
                Este é o resultado {lastResultDate ? `de ${lastResultDate}` : "da última análise"} e ele não é atualizado sozinho.
                Ligue os alertas para o SafeID verificar seu email de novo e avisar quando ele aparecer em um vazamento novo.
              </div>
              <a
                href="#alertas"
                className="shrink-0 self-start sm:self-auto bg-safe-primary/10 border border-safe-primary/30 text-safe-secondary rounded-lg py-2 px-3.5 text-xs font-semibold no-underline hover:bg-safe-primary/20 transition-colors"
              >
                Ligar alertas
              </a>
            </div>
          )}

          <div role="tablist" aria-label="Seções do painel" className="flex flex-col sm:flex-row gap-1 bg-safe-card border border-safe-border rounded-xl p-1.5 mb-6">
            {tabs.map(t => (
              <button 
                key={t.id} 
                ref={(el) => { tabRefs.current[t.id] = el; }}
                id={`aba-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`painel-${t.id}`}
                // Só a aba ativa entra no Tab; as outras se alcançam pelas setas (padrão WAI-ARIA)
                tabIndex={tab === t.id ? 0 : -1}
                onKeyDown={onTabKeyDown}
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
            <div role="tabpanel" id="painel-overview" aria-labelledby="aba-overview" className="animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 mb-6">
                <div className="bg-safe-card border border-safe-border rounded-2xl p-8 flex flex-col items-center justify-center">
                  <RiskCircle val={riskScore} size={220} label={scanStatus === "pending" || scanStatus === "unverified" ? "PENDENTE" : undefined} />
                </div>
                
                <div className="flex flex-col gap-3">
                  {[
                    { label: "Risco atual", value: `${riskScore}/100`, color: waitingForScan ? undefined : riskLevel(riskScore).color, colorClass: waitingForScan ? "text-safe-muted" : undefined, icon: ICONS.gauge },
                    { label: "Classificação", value: classificationText, color: waitingForScan ? undefined : riskLevelByClassification(classification)?.color, colorClass: waitingForScan ? "text-safe-muted" : undefined, icon: ICONS.levels },
                    { label: "Vazamentos detectados", value: `${totalBreaches || 0}`, colorClass: "text-safe-secondary", icon: ICONS.breach },
                    { label: "Última atualização", value: updatedAt ? new Date(updatedAt).toLocaleDateString("pt-BR") : "Sem dados", colorClass: "text-safe-muted", icon: ICONS.calendar },
                  ].map(s => (
                    <div key={s.label} className="bg-safe-card border border-safe-border rounded-xl p-4 flex items-center gap-4">
                      <span className="w-10 h-10 rounded-xl bg-safe-hover border border-safe-borderL flex items-center justify-center text-safe-accent shrink-0">
                        <LineIcon className="w-5 h-5">{s.icon}</LineIcon>
                      </span>
                      <div>
                        <div className="text-safe-dim text-xs mb-1">{s.label}</div>
                        <div className={`${s.colorClass ?? "text-safe-text"} font-semibold text-base`} style={s.color ? { color: s.color } : undefined}>{s.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <ScoreHistoryChart refreshKey={updatedAt} />

              <div className="bg-safe-card border border-safe-border rounded-[16px] p-[20px] mb-[16px]">
                <div className="text-safe-dim text-[11px] font-semibold tracking-[1.2px] mb-[18px]">DADOS EXPOSTOS</div>
                {Object.entries(dataClassCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                  const w = W[type] || 2;
                  const severityLabel = severityFromWeight(w).label;
                  const colClass = w >= 8 ? "text-safe-danger" : w >= 5 ? "text-safe-warn" : "text-safe-secondary";
                  const bgColorClass = w >= 8 ? "bg-safe-danger" : w >= 5 ? "bg-safe-warn" : "bg-safe-secondary";
                  const p = breachData.length ? Math.round((count / breachData.length) * 100) : 0;
                  
                  return (
                    <div key={type} className="mb-[14px]">
                      <div className="flex justify-between mb-[6px]">
                        <span className="text-safe-muted text-[13px]">{translateDataClass(type)}</span>
                        <div className="flex gap-[8px] items-center">
                          <span className={`${colClass} text-[11px]`}>{severityLabel.replace("Gravidade ", "")}</span>
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
                                <img src={logoPath} alt="" className="w-full h-full object-cover" onError={e => e.currentTarget.style.display = "none"} />
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
                                  <span className="sr-only">, {severity.label.toLowerCase()}</span>
                                </span>
                              );
                            })}
                            {pwnCount > 0 && <span className="bg-safe-secondary/10 border border-safe-secondary/20 text-safe-secondary text-[10px] py-[2px] px-[8px] rounded-full">{pwnCount.toLocaleString("pt-BR")} contas</span>}
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
            <div role="tabpanel" id="painel-breaches" aria-labelledby="aba-breaches" className="animate-fade-in flex flex-col gap-[10px]">
              {breachData.length ? breachData.map((item, i) => <BreachCard key={item.id || item.Name || item.Title || i} item={item} idx={i} />) : (
                <div className="bg-safe-card border border-safe-border rounded-[14px] py-[18px] px-[20px] text-safe-dim">
                  Nenhum histórico disponível ainda.
                </div>
              )}
            </div>
          )}

          {tab === "ai" && (
            <div role="tabpanel" id="painel-ai" aria-labelledby="aba-ai" className="animate-fade-in">
              <AIPanel recommendation={recommendation} mitigationSteps={mitigationSteps} urgencyLevel={urgencyLevel} updatedAt={updatedAt} classification={classificationText} riskScore={riskScore} onExportPdf={exportPlanPdf} />
              <PrintablePlan
                email={profile?.email}
                riskScore={riskScore}
                classification={classification}
                urgencyLevel={urgencyLevel}
                recommendation={recommendation}
                mitigationSteps={mitigationSteps}
                breaches={breachData}
                updatedAt={updatedAt}
              />
            </div>
          )}

          {/* Ligar os alertas agenda uma checagem imediata no backend */}
          <MonitoringSettings onChange={(status) => setProfile((current) => ({ ...current, monitoringEnabled: status.enabled }))} />
        </>
      )}
    </div>
  );
}