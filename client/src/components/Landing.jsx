import { C } from "./safeidData";

export default function Landing({ onNav }) {
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
