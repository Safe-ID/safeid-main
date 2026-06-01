import { useState, useEffect, useRef } from "react";

const C = {
  bg: "#040C1A",
  bgCard: "#071220",
  bgHover: "#0B1A2E",
  border: "#152338",
  borderL: "#1E3554",
  primary: "#1A6FFF",
  primaryD: "#1255CC",
  secondary: "#38BDF8",
  accent: "#86EFAC",
  text: "#EEF4FF",
  muted: "#7A9DC0",
  dim: "#3A5A80",
  danger: "#F87171",
  warn: "#FCD34D",
};

const BREACHES = [
  { name: "LinkedIn",     date: "2021-06-22", classes: ["Email addresses","Geographic locations","Job titles","Names","Phone numbers"], count: 700000000, color: "#0A8FFF" },
  { name: "Adobe",        date: "2019-10-04", classes: ["Email addresses","Passwords","Usernames","Credit card data"],                  count: 153000000, color: "#FF3B30" },
  { name: "Dropbox",      date: "2016-08-31", classes: ["Email addresses","Passwords"],                                                  count:  68648009, color: "#0061FF" },
  { name: "MyFitnessPal", date: "2018-03-25", classes: ["Email addresses","IP addresses","Passwords","Usernames"],                       count: 143606147, color: "#00B4D8" },
];

const W = {
  "Passwords": 10, "Credit card data": 10, "Bank account numbers": 10,
  "Email addresses": 3, "Usernames": 2, "Phone numbers": 4,
  "Names": 2, "Geographic locations": 2, "Job titles": 1, "IP addresses": 3,
};

function score(bs) {
  if (!bs.length) return 0;
  let t = 0;
  bs.forEach(b => { t += Math.max(...b.classes.map(c => W[c] || 2)); });
  const raw = (t / bs.length / 10) * 100;
  const bonus = bs.some(b => new Date(b.date).getFullYear() >= 2022) ? 10 : 0;
  return Math.min(Math.round(raw + bonus), 100);
}

function RiskCircle({ val, size }) {
  const sz = size || 220;
  const [anim, setAnim] = useState(0);
  const raf = useRef();
  useEffect(() => {
    let start = null;
    const dur = 1800;
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = ts => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      setAnim(ease(p) * val);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [val]);

  const r = sz * 0.37;
  const cx = sz / 2, cy = sz / 2;
  const rad = d => d * Math.PI / 180;
  const S = -218, TOTAL = 256;
  const pathD = (a, sw) => {
    const a2 = a + sw;
    const x1 = cx + r * Math.cos(rad(a)), y1 = cy + r * Math.sin(rad(a));
    const x2 = cx + r * Math.cos(rad(a2)), y2 = cy + r * Math.sin(rad(a2));
    const lg = Math.abs(sw) > 180 ? 1 : 0;
    return `M${x1} ${y1} A${r} ${r} 0 ${lg} 1 ${x2} ${y2}`;
  };
  const filled = (anim / 100) * TOTAL;
  const col = anim < 35 ? C.accent : anim < 65 ? C.warn : C.danger;
  const lbl = val === 0 ? "SEGURO" : val < 35 ? "BAIXO" : val < 65 ? "MÉDIO" : "ALTO";
  const sw = sz * 0.057;
  const ticks = Array.from({ length: 21 }, (_, i) => i);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg width={sz} height={sz * 0.86} viewBox={`0 0 ${sz} ${sz * 0.86}`} style={{ overflow: "visible" }}>
        {ticks.map(i => {
          const deg = S + (i / 20) * TOTAL;
          const ir = r - 9, or = r - 2;
          const x1 = cx + ir * Math.cos(rad(deg)), y1 = cy + ir * Math.sin(rad(deg));
          const x2 = cx + or * Math.cos(rad(deg)), y2 = cy + or * Math.sin(rad(deg));
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={(i / 20) * 100 <= anim ? col : C.border}
              strokeWidth={i % 5 === 0 ? 2 : 1} strokeLinecap="round" />
          );
        })}
        <path d={pathD(S, TOTAL)} fill="none" stroke={C.border} strokeWidth={sw} strokeLinecap="round" />
        {anim > 0 && (
          <>
            <path d={pathD(S, filled)} fill="none" stroke={col} strokeWidth={sw + 6} strokeLinecap="round" opacity="0.1" />
            <path d={pathD(S, filled)} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 8px ${col}99)` }} />
          </>
        )}
        <circle cx={cx} cy={cy} r={r - sw * 1.8} fill="none" stroke={C.border} strokeWidth="1" opacity="0.4" />
        <text x={cx} y={cy - 4} textAnchor="middle" fill={col}
          fontSize={sz * 0.19} fontWeight="700" fontFamily="system-ui,sans-serif">
          {Math.round(anim)}
        </text>
        <text x={cx} y={cy + sz * 0.1} textAnchor="middle" fill={C.dim}
          fontSize={sz * 0.05} letterSpacing="2" fontFamily="system-ui,sans-serif">
          RISK SCORE
        </text>
      </svg>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        background: `${col}18`, border: `1px solid ${col}40`,
        borderRadius: 999, padding: "5px 16px",
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: col, display: "inline-block", boxShadow: `0 0 6px ${col}` }} />
        <span style={{ color: col, fontSize: 12, fontWeight: 700, letterSpacing: "1.5px" }}>{lbl}</span>
      </div>
    </div>
  );
}

function BreachCard({ b, idx }) {
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

function AIPanel({ breaches }) {
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

function Navbar({ user, onSignOut, onNav }) {
  return (
    <nav style={{
      padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: `1px solid ${C.border}`, background: `${C.bg}E0`,
      backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 100,
    }}>
      <div onClick={() => onNav("landing")} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `linear-gradient(135deg,${C.primary},${C.secondary})`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="white">
            <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
          </svg>
        </div>
        <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.5, color: C.text }}>
          Safe<span style={{ color: C.secondary }}>ID</span>
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!user ? (
          <>
            <button onClick={() => onNav("login")} style={{
              background: "transparent", border: `1px solid ${C.borderL}`,
              borderRadius: 8, color: C.muted, padding: "7px 16px",
              fontSize: 13, cursor: "pointer", fontFamily: "inherit",
            }}>Entrar</button>
            <button onClick={() => onNav("register")} style={{
              background: `linear-gradient(135deg,${C.primary},${C.primaryD})`,
              border: "none", borderRadius: 8, color: "#fff",
              padding: "8px 16px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>Criar conta</button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: `linear-gradient(135deg,${C.primary},${C.secondary})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: "#fff",
              }}>{user.name[0].toUpperCase()}</div>
              <span style={{ color: C.muted, fontSize: 13 }}>{user.name}</span>
            </div>
            <button onClick={onSignOut} style={{
              background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.dim, padding: "7px 14px",
              fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>Sair</button>
          </>
        )}
      </div>
    </nav>
  );
}

function Landing({ onNav }) {
  return (
    <div>
      <section style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 24px 60px", textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: `${C.accent}0F`, border: `1px solid ${C.accent}30`,
          borderRadius: 999, padding: "5px 14px", marginBottom: 32, animation: "fadeIn 0.6s ease",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, display: "inline-block" }} />
          <span style={{ color: C.accent, fontSize: 11, fontWeight: 600, letterSpacing: "1.5px" }}>
            MONITORAMENTO DE IDENTIDADE DIGITAL · BRASIL
          </span>
        </div>

        <h1 style={{
          fontSize: 58, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2.5,
          marginBottom: 24, fontFamily: "system-ui,sans-serif",
          background: `linear-gradient(140deg,${C.text} 20%,${C.secondary} 80%)`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          animation: "slideUp 0.6s ease 0.1s both",
        }}>
          Seus dados estão<br />nas mãos certas?
        </h1>

        <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.65, maxWidth: 480, marginBottom: 44, animation: "slideUp 0.6s ease 0.2s both" }}>
          O SafeID monitora vazamentos de dados e entrega um plano de ação personalizado com IA — para que você recupere o controle da sua identidade digital.
        </p>

        <div style={{ display: "flex", gap: 12, animation: "slideUp 0.6s ease 0.3s both" }}>
          <button onClick={() => onNav("register")} style={{
            background: `linear-gradient(135deg,${C.primary},${C.primaryD})`,
            border: "none", borderRadius: 12, color: "#fff",
            padding: "14px 32px", fontSize: 15, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", boxShadow: `0 0 30px ${C.primary}44`,
          }}>Criar conta grátis</button>
          <button onClick={() => onNav("login")} style={{
            background: C.bgCard, border: `1px solid ${C.borderL}`,
            borderRadius: 12, color: C.muted, padding: "14px 28px",
            fontSize: 15, cursor: "pointer", fontFamily: "inherit",
          }}>Já tenho conta →</button>
        </div>
        <p style={{ color: C.dim, fontSize: 12, marginTop: 16 }}>🔒 Gratuito · Sem cartão · Conformidade LGPD</p>
      </section>

      <section style={{ padding: "0 24px 64px", maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 52 }}>
          {[
            { val: "14B+", label: "Credenciais monitoradas", col: C.secondary },
            { val: "780+", label: "Serviços verificados", col: C.accent },
            { val: "99.9%", label: "Disponibilidade", col: "#A78BFA" },
          ].map(s => (
            <div key={s.label} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: "22px 18px", textAlign: "center" }}>
              <div style={{ color: s.col, fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>{s.val}</div>
              <div style={{ color: C.dim, fontSize: 12, marginTop: 5 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <span style={{ color: C.dim, fontSize: 11, fontWeight: 600, letterSpacing: 2 }}>COMO FUNCIONA</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 52 }}>
          {[
            { n: "01", icon: "🔍", title: "Consulta OSINT", desc: "Verificamos seu email em +780 bases de vazamentos via Have I Been Pwned." },
            { n: "02", icon: "⚡", title: "Score de Risco", desc: "Algoritmo ponderado calcula a gravidade real com base na criticidade dos dados expostos." },
            { n: "03", icon: "✦", title: "IA Personalizada", desc: "Transformamos dados técnicos em um plano de ação claro, em linguagem acessível." },
          ].map((f, i) => (
            <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 16, padding: "22px 18px", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderL; e.currentTarget.style.background = C.bgHover; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bgCard; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ color: C.dim, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{f.n}</span>
                <span style={{ fontSize: 22 }}>{f.icon}</span>
              </div>
              <div style={{ color: C.text, fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{f.title}</div>
              <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        <div style={{
          background: `linear-gradient(135deg,${C.bgCard},#0B1E38)`,
          border: `1px solid ${C.borderL}`, borderRadius: 20, padding: "44px 40px", textAlign: "center",
        }}>
          <h2 style={{ color: C.text, fontSize: 26, fontWeight: 700, letterSpacing: -0.8, marginBottom: 12, fontFamily: "system-ui,sans-serif" }}>
            Proteja sua identidade digital agora
          </h2>
          <p style={{ color: C.muted, fontSize: 15, marginBottom: 28, maxWidth: 400, margin: "0 auto 28px" }}>
            Cadastre-se e descubra em segundos se seus dados foram comprometidos.
          </p>
          <button onClick={() => onNav("register")} style={{
            background: `linear-gradient(135deg,${C.primary},${C.primaryD})`,
            border: "none", borderRadius: 12, color: "#fff",
            padding: "14px 36px", fontSize: 15, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", boxShadow: `0 0 30px ${C.primary}44`,
          }}>Começar gratuitamente</button>
        </div>
      </section>
    </div>
  );
}

function Auth({ mode, onSuccess, onSwitch }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [conf, setConf] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const isReg = mode === "register";

  const submit = async () => {
    setErr("");
    if (isReg) {
      if (name.trim().length < 2) { setErr("Insira seu nome completo."); return; }
      if (!email.includes("@")) { setErr("Email inválido."); return; }
      if (pass.length < 6) { setErr("Senha deve ter pelo menos 6 caracteres."); return; }
      if (pass !== conf) { setErr("As senhas não coincidem."); return; }
    } else {
      if (!email.includes("@") || !pass) { setErr("Preencha todos os campos."); return; }
    }
    setLoading(true);
    await new Promise(r => setTimeout(r, 900));
    setLoading(false);
    onSuccess({ name: isReg ? name.trim() : email.split("@")[0], email: email.trim() });
  };

  const inp = {
    width: "100%", background: "#040C1A", border: `1px solid ${C.border}`,
    borderRadius: 10, color: C.text, padding: "12px 14px",
    fontSize: 14, fontFamily: "inherit", outline: "none", transition: "border-color 0.2s",
  };

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
      <div style={{ width: "100%", maxWidth: 420, animation: "slideUp 0.4s ease" }}>
        <div style={{
          background: C.bgCard, border: `1px solid ${C.borderL}`,
          borderRadius: 20, padding: "36px 32px", boxShadow: `0 0 60px ${C.primary}0D`,
        }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: `linear-gradient(135deg,${C.primary},${C.secondary})`,
              display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
            }}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="white">
                <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
              </svg>
            </div>
            <h2 style={{ color: C.text, fontSize: 22, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6, fontFamily: "system-ui,sans-serif" }}>
              {isReg ? "Criar sua conta" : "Entrar no SafeID"}
            </h2>
            <p style={{ color: C.dim, fontSize: 13 }}>
              {isReg ? "Monitore sua identidade digital gratuitamente" : "Bem-vindo de volta"}
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {isReg && (
              <div>
                <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>NOME COMPLETO</div>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Seu nome completo" style={inp}
                  onFocus={e => e.target.style.borderColor = C.primary}
                  onBlur={e => e.target.style.borderColor = C.border}
                  onKeyDown={e => e.key === "Enter" && submit()} />
              </div>
            )}
            <div>
              <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>EMAIL</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" style={inp}
                onFocus={e => e.target.style.borderColor = C.primary}
                onBlur={e => e.target.style.borderColor = C.border}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            <div>
              <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>SENHA</div>
              <input type="password" value={pass} onChange={e => setPass(e.target.value)}
                placeholder={isReg ? "Mínimo 6 caracteres" : "••••••••"} style={inp}
                onFocus={e => e.target.style.borderColor = C.primary}
                onBlur={e => e.target.style.borderColor = C.border}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            {isReg && (
              <div>
                <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>CONFIRMAR SENHA</div>
                <input type="password" value={conf} onChange={e => setConf(e.target.value)}
                  placeholder="Repita a senha" style={inp}
                  onFocus={e => e.target.style.borderColor = C.primary}
                  onBlur={e => e.target.style.borderColor = C.border}
                  onKeyDown={e => e.key === "Enter" && submit()} />
              </div>
            )}

            {err && (
              <div style={{ background: "#F8717115", border: "1px solid #F8717140", borderRadius: 8, padding: "10px 14px", color: C.danger, fontSize: 13 }}>
                {err}
              </div>
            )}

            <button onClick={submit} disabled={loading} style={{
              background: loading ? C.border : `linear-gradient(135deg,${C.primary},${C.primaryD})`,
              border: "none", borderRadius: 10, color: "#fff", padding: "13px",
              fontSize: 14, fontWeight: 600, cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 0.2s", boxShadow: loading ? "none" : `0 0 20px ${C.primary}33`, marginTop: 4,
            }}>
              {loading
                ? <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #ffffff40", borderTopColor: "#fff", animation: "spin 0.8s linear infinite" }} />{isReg ? "Criando conta..." : "Entrando..."}</>
                : (isReg ? "Criar conta e verificar" : "Entrar")}
            </button>

            <div style={{ textAlign: "center", color: C.dim, fontSize: 13 }}>
              {isReg ? "Já tem uma conta? " : "Não tem conta? "}
              <span onClick={onSwitch} style={{ color: C.secondary, cursor: "pointer", fontWeight: 600 }}>
                {isReg ? "Entrar" : "Criar conta grátis"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ user }) {
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

export default function SafeID() {
  const [page, setPage] = useState("landing");
  const [user, setUser] = useState(null);

  const goTo = (p) => {
    if (p === "landing") setUser(null);
    setPage(p);
  };
  const onAuth = (u) => { setUser(u); setPage("dashboard"); };
  const onOut = () => { setUser(null); setPage("landing"); };

  return (
    <div style={{
      minHeight: "100vh",
      background: `radial-gradient(ellipse 90% 60% at 50% -5%,#0D2545 0%,#040C1A 55%)`,
      fontFamily: "'SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      color: C.text,
    }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        ::placeholder { color: #253F60; }
        input { caret-color: #38BDF8; }
      `}</style>

      <Navbar user={user} onSignOut={onOut} onNav={goTo} />

      {page === "landing"   && <Landing onNav={goTo} />}
      {page === "register"  && <Auth mode="register" onSuccess={onAuth} onSwitch={() => setPage("login")} />}
      {page === "login"     && <Auth mode="login"    onSuccess={onAuth} onSwitch={() => setPage("register")} />}
      {page === "dashboard" && user && <Dashboard user={user} />}

      {page !== "dashboard" && (
        <footer style={{ borderTop: `1px solid ${C.border}`, padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", color: C.dim, fontSize: 12 }}>
          <div><span style={{ color: C.secondary, fontWeight: 700 }}>SafeID</span> · IFSP São Paulo · TADS 2026</div>
          <div style={{ display: "flex", gap: 20 }}>
            {["Privacidade", "LGPD", "GitHub"].map(l => (
              <span key={l} style={{ cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.color = C.text}
                onMouseLeave={e => e.currentTarget.style.color = C.dim}>{l}</span>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
