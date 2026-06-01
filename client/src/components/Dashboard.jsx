import { useState, useEffect } from "react";
import { C, BREACHES, W, score } from "./safeidData";
import RiskCircle from "./RiskCircle";
import BreachCard from "./BreachCard";
import AIPanel from "./AIPanel";

export default function Dashboard({ user }) {
  const bs = BREACHES;
  const sc = score(bs);
  const [tab, setTab] = useState("overview");
  const [pct, setPct] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 22 + 6;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(() => setReady(true), 400); }
      setPct(Math.round(p));
    }, 100);
    return () => clearInterval(iv);
  }, []);

  const allTypes = [...new Set(bs.flatMap(b => b.classes))];
  const counts = allTypes.reduce((a, t) => { a[t] = bs.filter(b => b.classes.includes(t)).length; return a; }, {});

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "36px 24px 80px" }}>
      <div style={{ marginBottom: 28, animation: "slideUp 0.4s ease" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <p style={{ color: C.dim, fontSize: 13, marginBottom: 4 }}>
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1 style={{ color: C.text, fontSize: 26, fontWeight: 700, letterSpacing: -0.8, fontFamily: "system-ui,sans-serif" }}>
              Olá, {user.name.split(" ")[0]} 👋
            </h1>
            <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>
              Monitorando: <span style={{ color: C.secondary }}>{user.email}</span>
            </p>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: `${C.danger}15`, border: `1px solid ${C.danger}40`,
            borderRadius: 10, padding: "8px 14px", height: "fit-content",
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.danger, display: "inline-block" }} />
            <span style={{ color: C.danger, fontSize: 12, fontWeight: 600 }}>{bs.length} vazamentos detectados</span>
          </div>
        </div>
      </div>

      {!ready && (
        <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ color: C.muted, fontSize: 13 }}>Verificando bases de dados OSINT...</span>
            <span style={{ color: C.secondary, fontSize: 13, fontWeight: 600 }}>{pct}%</span>
          </div>
          <div style={{ height: 4, background: C.border, borderRadius: 99 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${C.primary},${C.secondary})`, borderRadius: 99, transition: "width 0.12s ease" }} />
          </div>
          <p style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>Consultando Have I Been Pwned · 780+ fontes</p>
        </div>
      )}

      {ready && (
        <>
          <div style={{
            background: "linear-gradient(135deg,#180808,#200A0A)",
            border: `1px solid ${C.danger}40`, borderRadius: 14,
            padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
            marginBottom: 24, animation: "slideUp 0.4s ease",
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: `${C.danger}1A`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>⚠</div>
            <div>
              <div style={{ color: C.danger, fontWeight: 600, fontSize: 14 }}>{bs.length} vazamentos encontrados para {user.email}</div>
              <div style={{ color: "#7A3030", fontSize: 13, marginTop: 2 }}>Seus dados circulam em repositórios de ameaças. Ação imediata recomendada.</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 2, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, marginBottom: 24 }}>
            {[{ id: "overview", label: "Visão Geral" }, { id: "breaches", label: `Vazamentos (${bs.length})` }, { id: "ai", label: "✦ Plano IA" }].map(t => (
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
                  <RiskCircle val={sc} size={220} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "Senhas expostas", value: "2 serviços", color: C.danger, icon: "🔑" },
                    { label: "Dados financeiros", value: "1 serviço", color: C.warn, icon: "💳" },
                    { label: "Dados pessoais", value: "4 serviços", color: C.secondary, icon: "👤" },
                    { label: "Último vazamento", value: "LinkedIn 2021", color: C.muted, icon: "📅" },
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
                <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, letterSpacing: 1.2, marginBottom: 18 }}>CATEGORIAS DE DADOS EXPOSTOS</div>
                {Object.entries(counts).sort((a, b) => (W[b[0]] || 2) - (W[a[0]] || 2)).map(([type, count]) => {
                  const w = W[type] || 2;
                  const col = w >= 8 ? C.danger : w >= 5 ? C.warn : C.secondary;
                  const p = Math.round((count / bs.length) * 100);
                  return (
                    <div key={type} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ color: C.muted, fontSize: 13 }}>{type}</span>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ color: C.dim, fontSize: 12 }}>{count}/{bs.length}</span>
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
                  {[...bs].sort((a, b) => new Date(b.date) - new Date(a.date)).map((b, i) => (
                    <div key={i} style={{ display: "flex", gap: 20, marginBottom: i < bs.length - 1 ? 20 : 0, paddingLeft: 36, position: "relative" }}>
                      <div style={{ position: "absolute", left: 10, top: 5, width: 10, height: 10, borderRadius: "50%", background: b.color, boxShadow: `0 0 8px ${b.color}88` }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{b.name}</span>
                          <span style={{ color: C.dim, fontSize: 12 }}>{new Date(b.date).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          {b.classes.slice(0, 3).map(d => {
                            const w = W[d] || 2;
                            const col = w >= 8 ? C.danger : w >= 5 ? C.warn : C.secondary;
                            return <span key={d} style={{ background: `${col}18`, border: `1px solid ${col}30`, color: col, fontSize: 10, padding: "2px 8px", borderRadius: 999 }}>{d}</span>;
                          })}
                          {b.classes.length > 3 && <span style={{ color: C.dim, fontSize: 10 }}>+{b.classes.length - 3} mais</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "breaches" && (
            <div style={{ animation: "fadeIn 0.3s ease", display: "flex", flexDirection: "column", gap: 10 }}>
              {bs.map((b, i) => <BreachCard key={b.name} b={b} idx={i} />)}
            </div>
          )}

          {tab === "ai" && (
            <div style={{ animation: "fadeIn 0.3s ease" }}>
              <AIPanel breaches={bs} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
