import { useState, useEffect } from "react";
import { C, W, translateDataClass } from "./safeidData";
import RiskCircle from "./RiskCircle";
import BreachCard from "./BreachCard";
import AIPanel from "./AIPanel";
import { fetchMe } from "../lib/api";

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
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "36px 24px 80px" }}>
      <div style={{ marginBottom: 28, animation: "slideUp 0.4s ease" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <p style={{ color: C.dim, fontSize: 13, marginBottom: 4 }}>
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1 style={{ color: C.text, fontSize: 26, fontWeight: 700, letterSpacing: -0.8, fontFamily: "system-ui,sans-serif" }}>
              Olá, {greetingName} 👋
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>
              Monitorando: <span style={{ color: C.secondary }}>{profile?.email}</span>
            </p>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: `${C.danger}15`, border: `1px solid ${C.danger}40`,
            borderRadius: 10, padding: "8px 14px", height: "fit-content",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.danger, display: "inline-block" }} />
            <span style={{ color: C.danger, fontSize: 12, fontWeight: 600 }}>{totalBreaches || 0} vazamentos detectados</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onSignOut} style={{
              background: "transparent", border: `1px solid ${C.border}`, borderRadius: 10,
              color: C.dim, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>Sair</button>
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Sincronizando seu perfil e histórico...</span>
            <span style={{ color: C.secondary, fontSize: 13, fontWeight: 600 }}>{pct}%</span>
          </div>
          <div style={{ height: 4, background: C.border, borderRadius: 99 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${C.primary},${C.secondary})`, borderRadius: 99, transition: "width 0.12s ease" }} />
          </div>
          <p style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>Consultando auth/me e scan/history</p>
        </div>
      )}

      {!loading && error && (
        <div style={{ background: "linear-gradient(135deg,#180808,#200A0A)", border: `1px solid ${C.danger}40`, borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
          <div style={{ color: C.danger, fontWeight: 600, fontSize: 14 }}>Não foi possível carregar o dashboard</div>
          <div style={{ color: C.dim, fontSize: 13, marginTop: 6 }}>{error}</div>
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={{
            background: "linear-gradient(135deg,#180808,#200A0A)",
            border: `1px solid ${C.danger}40`, borderRadius: 14,
            padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
            marginBottom: 24, animation: "slideUp 0.4s ease",
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: `${C.danger}1A`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>⚠</div>
            <div>
              <div style={{ color: C.danger, fontWeight: 600, fontSize: 14 }}>{totalBreaches || 0} vazamentos encontrados para {profile?.email}</div>
              <div style={{ color: "#7A3030", fontSize: 13, marginTop: 2 }}>Seus dados circulam em repositórios de ameaças. Ação imediata recomendada.</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 2, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, marginBottom: 24 }}>
            {[{ id: "overview", label: "Visão Geral" }, { id: "breaches", label: `Vazamentos (${breachData.length})` }, { id: "ai", label: "✦ Plano IA" }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                flex: 1, padding: "9px 12px", borderRadius: 9,
                background: tab === t.id ? C.bgHover : "transparent",
                border: tab === t.id ? `1px solid ${C.borderL}` : "1px solid transparent",
                color: tab === t.id ? C.text : C.dim,
                fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
                cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
              }}>{t.label}</button>
            ))}
          </div>

          {tab === "overview" && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, marginBottom: 16 }}>
                <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 18, padding: "28px 24px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <RiskCircle val={riskScore} size={220} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "Risco atual", value: `${riskScore}/100`, color: C.danger, icon: "🔑" },
                    { label: "Classificação", value: classification, color: C.warn, icon: "💳" },
                    { label: "Vazamentos detectados", value: `${totalBreaches || 0}`, color: C.secondary, icon: "👤" },
                    { label: "Última atualização", value: updatedAt ? new Date(updatedAt).toLocaleDateString("pt-BR") : "Sem dados", color: C.muted, icon: "📅" },
                  ].map(s => (
                    <div key={s.label} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "13px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 18 }}>{s.icon}</span>
                      <div>
                        <div style={{ color: C.dim, fontSize: 11, marginBottom: 2 }}>{s.label}</div>
                        <div style={{ color: s.color, fontWeight: 600, fontSize: 14 }}>{s.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px", marginBottom: 16 }}>
                <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, letterSpacing: 1.2, marginBottom: 18 }}>DADOS EXPOSTOS</div>
                {Object.entries(dataClassCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                  const w = W[type] || 2;
                  const col = w >= 8 ? C.danger : w >= 5 ? C.warn : C.secondary;
                  const p = breachData.length ? Math.round((count / breachData.length) * 100) : 0;
                  return (
                    <div key={type} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ color: C.muted, fontSize: 13 }}>{translateDataClass(type)}</span>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ color: C.dim, fontSize: 12 }}>{count}/{breachData.length || 1}</span>
                          <span style={{ color: col, fontSize: 12, fontWeight: 600 }}>{p}%</span>
                        </div>
                      </div>
                      <div style={{ height: 4, background: C.border, borderRadius: 99 }}>
                        <div style={{ height: "100%", width: `${p}%`, background: col, borderRadius: 99, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px" }}>
                <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, letterSpacing: 1.2, marginBottom: 18 }}>LINHA DO TEMPO DOS INCIDENTES</div>
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: 15, top: 0, bottom: 0, width: 1, background: C.border }} />
                  {breachTimeline.map((item, i) => {
                    const itemColor = (item?.DataClasses || item?.classes || []).some((cls) => (W[cls] || 0) >= 8)
                      ? C.danger
                      : (item?.DataClasses || item?.classes || []).some((cls) => (W[cls] || 0) >= 5)
                        ? C.warn
                        : C.secondary;
                    const breachDate = item?.BreachDate || item?.date || item?.createdAt;
                    const pwnCount = item?.PwnCount ?? item?.pwnCount ?? item?.count;
                    const logoPath = resolveLogoPath(item?.LogoPath || item?.logoPath);
                    const logoInitial = getLogoInitial(item);

                    return (
                    <div key={item.id || item.Name || item.Title || i} style={{ display: "flex", gap: 20, marginBottom: i < breachTimeline.length - 1 ? 20 : 0, paddingLeft: 36, position: "relative" }}>
                      <div style={{ position: "absolute", left: 10, top: 5, width: 10, height: 10, borderRadius: "50%", background: itemColor, boxShadow: `0 0 8px ${itemColor}88` }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          {logoPath ? (
                            <div style={{ width: 30, height: 30, borderRadius: 8, overflow: "hidden", background: C.bgHover, border: `1px solid ${C.borderL}`, flexShrink: 0 }}>
                              <img
                                src={logoPath}
                                alt={`${item?.Title || item?.Name || "vazamento"} logo`}
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            </div>
                          ) : (
                            <div style={{
                              width: 30, height: 30, borderRadius: 8,
                              background: `${itemColor}1F`, border: `1px solid ${itemColor}55`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: itemColor, fontSize: 13, fontWeight: 700, flexShrink: 0,
                            }}>{logoInitial}</div>
                          )}
                          <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{item?.Title || item?.Name || `Incidente ${i + 1}`}</span>
                          <span style={{ color: C.dim, fontSize: 12 }}>{breachDate ? new Date(breachDate).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "Sem data"}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          {(item?.DataClasses || item?.classes || []).slice(0, 3).map((dataClass) => {
                            const col = (W[dataClass] || 2) >= 8 ? C.danger : (W[dataClass] || 2) >= 5 ? C.warn : C.secondary;
                            return (
                              <span key={dataClass} style={{ background: `${col}18`, border: `1px solid ${col}30`, color: col, fontSize: 10, padding: "2px 8px", borderRadius: 999 }}>{translateDataClass(dataClass)}</span>
                            );
                          })}
                          {pwnCount ? <span style={{ background: `${C.secondary}18`, border: `1px solid ${C.secondary}30`, color: C.secondary, fontSize: 10, padding: "2px 8px", borderRadius: 999 }}>{pwnCount.toLocaleString("pt-BR")} contas</span> : null}
                          <span style={{ background: `${C.dim}18`, border: `1px solid ${C.dim}30`, color: C.dim, fontSize: 10, padding: "2px 8px", borderRadius: 999 }}>{item?.IsVerified ? "Verificado" : "Não verificado"}</span>
                        </div>
                      </div>
                    </div>
                  );})}
                </div>
              </div>
            </div>
          )}

          {tab === "breaches" && (
            <div style={{ animation: "fadeIn 0.3s ease", display: "flex", flexDirection: "column", gap: 10 }}>
              {breachData.length ? breachData.map((item, i) => <BreachCard key={item.id || item.Name || item.Title || i} item={item} idx={i} />) : (
                <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px", color: C.dim }}>
                  Nenhum histórico disponível ainda.
                </div>
              )}
            </div>
          )}

          {tab === "ai" && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <AIPanel recommendation={recommendation} updatedAt={updatedAt} classification={classification} riskScore={riskScore} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
