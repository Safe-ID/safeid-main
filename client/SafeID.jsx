import { useState, useEffect, useRef } from "react";
import { useAuth } from "./context/AuthContext";
import AuthForm from "./AuthForm";
import { scanAPI } from "./api/apiClient";

const COLORS = {
  bg: "#050B18",
  bgCard: "#0A1628",
  bgCardHover: "#0E1E38",
  border: "#1A2F50",
  borderLight: "#243D6A",
  primary: "#0066FF",
  primaryGlow: "#0044CC",
  secondary: "#38BDF8",
  accent: "#86EFAC",
  accentDim: "#4ADE80",
  text: "#F0F6FF",
  textMuted: "#8BA3C7",
  textDim: "#4A6B9A",
  gradStart: "#020714",
  gradMid: "#050B18",
};

// Placeholder for breach data that comes from API
// Real data will be fetched from backend

const WEIGHT_MAP = {
  "Passwords": 10,
  "Credit card data": 10,
  "Bank account numbers": 10,
  "Email addresses": 3,
  "Usernames": 2,
  "Phone numbers": 4,
  "Names": 2,
  "Geographic locations": 2,
  "Job titles": 1,
  "IP addresses": 3,
};

function calcScore(breaches) {
  if (!breaches.length) return 0;
  let total = 0, count = 0;
  breaches.forEach(b => {
    const classes = b.dataClasses;
    const max = Math.max(...classes.map(c => WEIGHT_MAP[c] || 2));
    total += max;
    count++;
  });
  const raw = (total / count / 10) * 100;
  const recencyBonus = breaches.some(b => {
    const y = new Date(b.date).getFullYear();
    return y >= 2022;
  }) ? 10 : 0;
  return Math.min(Math.round(raw + recencyBonus), 100);
}

function ScoreArc({ score }) {
  const r = 80;
  const cx = 110, cy = 110;
  const startAngle = -220;
  const sweepAngle = 260;
  const toRad = d => (d * Math.PI) / 180;
  const arcPath = (a1, sweep) => {
    const a2 = a1 + sweep;
    const x1 = cx + r * Math.cos(toRad(a1));
    const y1 = cy + r * Math.sin(toRad(a1));
    const x2 = cx + r * Math.cos(toRad(a2));
    const y2 = cy + r * Math.sin(toRad(a2));
    const lg = Math.abs(sweep) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2}`;
  };
  const filledSweep = (score / 100) * sweepAngle;
  const color = score < 35 ? "#86EFAC" : score < 65 ? "#FCD34D" : "#F87171";

  return (
    <svg width="220" height="180" viewBox="0 0 220 180" style={{ overflow: "visible" }}>
      <path d={arcPath(startAngle, sweepAngle)} fill="none" stroke="#1A2F50" strokeWidth="12" strokeLinecap="round" />
      {score > 0 && (
        <path d={arcPath(startAngle, filledSweep)} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
      )}
      <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize="38" fontWeight="700" fontFamily="'SF Pro Display', -apple-system, sans-serif">
        {score}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" fill="#4A6B9A" fontSize="11" fontFamily="'SF Pro Text', -apple-system, sans-serif" letterSpacing="2">
        RISK SCORE
      </text>
    </svg>
  );
}

function Thermometer({ score }) {
  const label = score === 0 ? "—" : score < 35 ? "LOW" : score < 65 ? "MEDIUM" : "HIGH";
  const color = score === 0 ? "#4A6B9A" : score < 35 ? "#86EFAC" : score < 65 ? "#FCD34D" : "#F87171";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <ScoreArc score={score} />
      <div style={{
        display: "inline-flex", alignItems: "center", gap: "6px",
        background: `${color}18`, border: `1px solid ${color}44`,
        borderRadius: "999px", padding: "4px 14px",
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
        <span style={{ color, fontSize: 12, fontWeight: 600, letterSpacing: "1.5px" }}>{label}</span>
      </div>
    </div>
  );
}

function BreachCard({ breach, index }) {
  const [open, setOpen] = useState(false);
  const years = new Date().getFullYear() - new Date(breach.date).getFullYear();
  const isRecent = years <= 2;
  return (
    <div
      onClick={() => setOpen(!open)}
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${open ? COLORS.borderLight : COLORS.border}`,
        borderRadius: 14,
        padding: "18px 20px",
        cursor: "pointer",
        transition: "all 0.2s",
        animationDelay: `${index * 80}ms`,
        animation: "slideUp 0.4s ease both",
      }}
      onMouseEnter={e => e.currentTarget.style.background = COLORS.bgCardHover}
      onMouseLeave={e => e.currentTarget.style.background = COLORS.bgCard}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `${breach.color}22`, border: `1px solid ${breach.color}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, fontWeight: 700, color: breach.color, fontFamily: "monospace",
          }}>
            {breach.name[0]}
          </div>
          <div>
            <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 15 }}>{breach.name}</div>
            <div style={{ color: COLORS.textDim, fontSize: 12, marginTop: 2 }}>
              {new Date(breach.date).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })} · {(breach.pwnCount / 1e6).toFixed(0)}M contas
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isRecent && (
            <span style={{
              background: "#F87171" + "22", border: "1px solid #F8717144",
              color: "#F87171", fontSize: 10, fontWeight: 600,
              padding: "3px 8px", borderRadius: 999, letterSpacing: 1,
            }}>RECENTE</span>
          )}
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ transform: open ? "rotate(180deg)" : "none", transition: "0.2s", color: COLORS.textDim }}>
            <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 10, letterSpacing: 1, fontWeight: 600 }}>DADOS EXPOSTOS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {breach.dataClasses.map(cls => {
              const w = WEIGHT_MAP[cls] || 2;
              const isCritical = w >= 8;
              const isHigh = w >= 5;
              const c = isCritical ? "#F87171" : isHigh ? "#FCD34D" : COLORS.secondary;
              return (
                <span key={cls} style={{
                  background: c + "18", border: `1px solid ${c}44`,
                  color: c, fontSize: 11, fontWeight: 500,
                  padding: "4px 10px", borderRadius: 999,
                }}>
                  {cls}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AIInsight({ breaches }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);

  const generate = async () => {
    setLoading(true);
    setText("");
    setDone(false);
    try {
      const breachSummary = breaches.map(b =>
        `${b.name} (${b.date.slice(0, 4)}): dados expostos incluem ${b.dataClasses.join(", ")}`
      ).join("; ");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          stream: true,
          system: "Você é um especialista em segurança digital do SafeID. Responda SEMPRE em português brasileiro. Seja direto, acessível e prático. Use linguagem clara sem jargões técnicos excessivos. Formate com ícones emoji e parágrafos curtos.",
          messages: [{
            role: "user",
            content: `O usuário teve os seguintes vazamentos de dados detectados: ${breachSummary}. 

Gere um plano de ação personalizado curto (3-4 parágrafos) explicando:
1. O que esses vazamentos significam na prática para o usuário
2. As 3 ações mais urgentes que ele deve tomar agora
3. Uma dica de segurança preventiva para o futuro

Seja encorajador e empático.`
          }]
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                setText(prev => prev + parsed.delta.text);
              }
            } catch {}
          }
        }
      }
      setDone(true);
    } catch (e) {
      setText("❌ Erro ao gerar análise. Verifique sua conexão e tente novamente.");
      setDone(true);
    }
    setLoading(false);
  };

  return (
    <div style={{
      background: "linear-gradient(135deg, #0A1628 0%, #0A1E38 100%)",
      border: `1px solid ${COLORS.borderLight}`,
      borderRadius: 16,
      padding: "24px",
      marginTop: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${COLORS.accent}18`, border: `1px solid ${COLORS.accent}44`,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
        }}>✦</div>
        <div>
          <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 14 }}>SafeID AI · Análise de Risco</div>
          <div style={{ color: COLORS.textDim, fontSize: 12 }}>Plano de ação personalizado via IA</div>
        </div>
      </div>

      {!text && !loading && (
        <button
          onClick={generate}
          style={{
            width: "100%",
            background: `linear-gradient(135deg, ${COLORS.primary}22, ${COLORS.accent}11)`,
            border: `1px solid ${COLORS.primary}55`,
            borderRadius: 10, color: COLORS.secondary,
            padding: "12px", fontSize: 14, fontWeight: 600,
            cursor: "pointer", transition: "all 0.2s",
            fontFamily: "inherit",
          }}
          onMouseEnter={e => e.currentTarget.style.background = `linear-gradient(135deg, ${COLORS.primary}33, ${COLORS.accent}22)`}
          onMouseLeave={e => e.currentTarget.style.background = `linear-gradient(135deg, ${COLORS.primary}22, ${COLORS.accent}11)`}
        >
          ✦ Gerar Plano de Ação com IA
        </button>
      )}

      {loading && !text && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", color: COLORS.textDim, fontSize: 14 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 6, height: 6, borderRadius: "50%", background: COLORS.accent,
                display: "inline-block", animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
          Analisando seus vazamentos...
        </div>
      )}

      {text && (
        <div style={{
          color: COLORS.textMuted, fontSize: 14, lineHeight: 1.75,
          whiteSpace: "pre-wrap", fontFamily: "'SF Pro Text', -apple-system, sans-serif",
        }}>
          {text}
          {!done && <span style={{ color: COLORS.accent, animation: "blink 1s infinite" }}>▌</span>}
        </div>
      )}

      {done && (
        <button
          onClick={generate}
          style={{
            marginTop: 16, background: "transparent",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8, color: COLORS.textDim,
            padding: "8px 14px", fontSize: 12,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          ↺ Regenerar análise
        </button>
      )}
    </div>
  );
}

function DataBar({ label, count, total, color }) {
  const pct = Math.round((count / total) * 100);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: COLORS.textMuted, fontSize: 13 }}>{label}</span>
        <span style={{ color: color, fontSize: 13, fontWeight: 600 }}>{count}</span>
      </div>
      <div style={{ height: 4, background: COLORS.border, borderRadius: 99 }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: color, borderRadius: 99,
          transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
    </div>
  );
}

export default function SafeID() {
  const { user, isAuthenticated, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [breaches, setBreaches] = useState(null);
  const [score, setScore] = useState(0);
  const [tab, setTab] = useState("overview");
  const [noResult, setNoResult] = useState(false);
  const [error, setError] = useState("");
  const [breachData, setBreachData] = useState(null);
  const inputRef = useRef();

  // If user is not authenticated, show auth form
  if (!isAuthenticated) {
    return <AuthForm onSuccess={() => {}} />;
  }

  // Format breach data from API response for display
  const formatBreachData = (apiData) => {
    if (!apiData || !apiData.breachData) return [];
    try {
      const data = typeof apiData.breachData === 'string' ? JSON.parse(apiData.breachData) : apiData.breachData;
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('Error parsing breach data:', e);
      return [];
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    
    setSearching(true);
    setBreaches(null);
    setNoResult(false);
    setError("");

    try {
      const result = await scanAPI.submitScan(email);
      
      // Parse breach data
      const formattedBreaches = formatBreachData(result);
      
      if (formattedBreaches.length === 0) {
        setBreaches([]);
        setScore(0);
        setNoResult(true);
      } else {
        setBreaches(formattedBreaches);
        setScore(result.riskScore || 0);
      }
      
      setBreachData(result);
      setTab("overview");
    } catch (err) {
      setError(err.message || "Erro ao verificar email. Tente novamente.");
      setBreaches(null);
    } finally {
      setSearching(false);
    }
  };

  const handleLogout = () => {
    logout();
    setEmail("");
    setBreaches(null);
    setScore(0);
  };

  const allDataTypes = breaches ? [...new Set(breaches.flatMap(b => b.dataClasses))] : [];
  const dataTypeCounts = allDataTypes.reduce((acc, t) => {
    acc[t] = breaches.filter(b => b.dataClasses.includes(t)).length;
    return acc;
  }, {});

  return (
    <div style={{
      minHeight: "100vh",
      background: `radial-gradient(ellipse 80% 50% at 50% -10%, #0D2545 0%, ${COLORS.bg} 60%)`,
      fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
      color: COLORS.text,
    }}>
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::placeholder { color: #2D4A6E; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1A2F50; border-radius: 99px; }
      `}</style>

      {/* Navbar */}
      <nav style={{
        padding: "16px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${COLORS.border}`,
        background: `${COLORS.bg}CC`,
        backdropFilter: "blur(20px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary})`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
              <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: -0.5, color: COLORS.text }}>Safe<span style={{ color: COLORS.secondary }}>ID</span></span>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          {["Como funciona", "LGPD", "API"].map(item => (
            <span key={item} style={{ color: COLORS.textDim, fontSize: 13, cursor: "pointer", transition: "color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color = COLORS.text}
              onMouseLeave={e => e.currentTarget.style.color = COLORS.textDim}>
              {item}
            </span>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: COLORS.textMuted, fontSize: 13 }}>
              {user?.email}
            </span>
            <button
              onClick={handleLogout}
              style={{
                background: "transparent",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                color: COLORS.textDim,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.2s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = COLORS.borderLight;
                e.currentTarget.style.color = COLORS.text;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = COLORS.border;
                e.currentTarget.style.color = COLORS.textDim;
              }}
            >
              Sair
            </button>
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px 80px" }}>

        {/* Hero */}
        <div style={{ textAlign: "center", padding: "72px 0 52px", animation: "fadeIn 0.6s ease" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: `${COLORS.accent}11`, border: `1px solid ${COLORS.accent}33`,
            borderRadius: 999, padding: "5px 14px", marginBottom: 28,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.accent, display: "inline-block" }} />
            <span style={{ color: COLORS.accent, fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>MONITORAMENTO ATIVO · BRASIL</span>
          </div>
          <h1 style={{
            fontSize: 54, fontWeight: 700, lineHeight: 1.1,
            letterSpacing: -2, marginBottom: 20,
            fontFamily: "'SF Pro Display', -apple-system, sans-serif",
            background: `linear-gradient(135deg, ${COLORS.text} 30%, ${COLORS.secondary} 100%)`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Seus dados estão<br />seguros?
          </h1>
          <p style={{ color: COLORS.textMuted, fontSize: 17, lineHeight: 1.6, maxWidth: 480, margin: "0 auto 40px" }}>
            Verifique se suas credenciais aparecem em vazamentos de dados conhecidos e receba um plano de ação personalizado com IA.
          </p>

          {/* Search */}
          <form onSubmit={handleSearch}>
            {error && (
              <div style={{
                background: '#1A0A0A',
                border: `1px solid #F87171` + '44',
                borderRadius: 12,
                padding: '12px 14px',
                marginBottom: 16,
                color: '#F87171',
                fontSize: 13,
              }}>
                {error}
              </div>
            )}
            <div style={{
              display: "flex", gap: 10,
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.borderLight}`,
              borderRadius: 16, padding: 6,
              maxWidth: 520, margin: "0 auto",
              boxShadow: `0 0 40px ${COLORS.primary}11`,
            }}>
              <input
                ref={inputRef}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={user?.email || "seu@email.com"}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: COLORS.text, fontSize: 16, padding: "10px 14px",
                  fontFamily: "inherit",
                }}
              />
              <button
                type="submit"
                disabled={searching || !email.includes("@")}
                style={{
                  background: searching ? COLORS.border : `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryGlow})`,
                  border: "none", borderRadius: 10,
                  color: "#fff", padding: "10px 24px",
                  fontSize: 14, fontWeight: 600, cursor: searching ? "wait" : "pointer",
                  fontFamily: "inherit", transition: "all 0.2s", whiteSpace: "nowrap",
                  minWidth: 120, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {searching ? (
                  <>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #ffffff55", borderTopColor: "#fff", animation: "spin 0.8s linear infinite" }} />
                    Verificando
                  </>
                ) : "Verificar agora"}
              </button>
            </div>
            <p style={{ color: COLORS.textDim, fontSize: 12, marginTop: 12 }}>
              🔒 Seus dados são processados com segurança · Conformidade LGPD
            </p>
          </form>
        </div>

        {/* Stats bar */}
        {!breaches && !searching && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
            marginBottom: 48, animation: "slideUp 0.6s ease 0.2s both",
          }}>
            {[
              { label: "Vazamentos monitorados", value: "14B+", color: COLORS.secondary },
              { label: "Sites verificados", value: "780+", color: COLORS.accent },
              { label: "Consultas hoje", value: "12.4K", color: "#A78BFA" },
            ].map(s => (
              <div key={s.label} style={{
                background: COLORS.bgCard, border: `1px solid ${COLORS.border}`,
                borderRadius: 14, padding: "20px 16px", textAlign: "center",
              }}>
                <div style={{ color: s.color, fontSize: 28, fontWeight: 700, letterSpacing: -1, fontFamily: "'SF Pro Display', sans-serif" }}>{s.value}</div>
                <div style={{ color: COLORS.textDim, fontSize: 12, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Searching skeleton */}
        {searching && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                height: 76, borderRadius: 14, marginBottom: 12,
                background: `linear-gradient(90deg, ${COLORS.bgCard} 25%, ${COLORS.bgCardHover} 50%, ${COLORS.bgCard} 75%)`,
                backgroundSize: "200% 100%",
                animation: "shimmer 1.5s infinite",
              }} />
            ))}
          </div>
        )}

        {/* No breach result */}
        {noResult && (
          <div style={{
            textAlign: "center", padding: "48px 32px",
            background: COLORS.bgCard, border: `1px solid ${COLORS.accent}44`,
            borderRadius: 20, animation: "slideUp 0.4s ease",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <h2 style={{ color: COLORS.accent, fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Nenhum vazamento encontrado</h2>
            <p style={{ color: COLORS.textMuted, fontSize: 15, maxWidth: 360, margin: "0 auto" }}>
              Ótima notícia! Seu email não aparece em nenhuma base de dados de vazamentos conhecidos. Continue mantendo boas práticas de segurança.
            </p>
            <div style={{
              marginTop: 24, display: "inline-flex", gap: 8, alignItems: "center",
              background: `${COLORS.accent}11`, border: `1px solid ${COLORS.accent}33`,
              borderRadius: 999, padding: "8px 20px", color: COLORS.accent, fontSize: 13, fontWeight: 600,
            }}>
              Score de Risco: 0 · SEGURO
            </div>
          </div>
        )}

        {/* Results */}
        {breaches && breaches.length > 0 && (
          <div style={{ animation: "slideUp 0.4s ease" }}>
            {/* Alert banner */}
            <div style={{
              background: `linear-gradient(135deg, #1A0A0A, #200A0A)`,
              border: "1px solid #F87171" + "44",
              borderRadius: 14, padding: "16px 20px",
              display: "flex", alignItems: "center", gap: 14,
              marginBottom: 20,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9, background: "#F87171" + "22",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0,
              }}>⚠</div>
              <div>
                <div style={{ color: "#F87171", fontWeight: 600, fontSize: 14 }}>{breaches.length} vazamentos detectados para {email}</div>
                <div style={{ color: "#8B4444", fontSize: 13, marginTop: 2 }}>
                  Seus dados aparecem em {breaches.length} bases de dados comprometidas. Ação imediata recomendada.
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{
              display: "flex", gap: 2,
              background: COLORS.bgCard, border: `1px solid ${COLORS.border}`,
              borderRadius: 12, padding: 4, marginBottom: 20,
            }}>
              {[
                { id: "overview", label: "Visão Geral" },
                { id: "breaches", label: `Vazamentos (${breaches.length})` },
                { id: "ai", label: "✦ Plano de Ação IA" },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  flex: 1, padding: "9px 12px", borderRadius: 9,
                  background: tab === t.id ? COLORS.bgCardHover : "transparent",
                  border: tab === t.id ? `1px solid ${COLORS.borderLight}` : "1px solid transparent",
                  color: tab === t.id ? COLORS.text : COLORS.textDim,
                  fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
                  cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {tab === "overview" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  {/* Score card */}
                  <div style={{
                    background: COLORS.bgCard, border: `1px solid ${COLORS.border}`,
                    borderRadius: 16, padding: "24px 20px",
                    display: "flex", flexDirection: "column", alignItems: "center",
                  }}>
                    <Thermometer score={score} />
                  </div>

                  {/* Data types */}
                  <div style={{
                    background: COLORS.bgCard, border: `1px solid ${COLORS.border}`,
                    borderRadius: 16, padding: "20px",
                  }}>
                    <div style={{ color: COLORS.textDim, fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 16 }}>CATEGORIAS EXPOSTAS</div>
                    {Object.entries(dataTypeCounts)
                      .sort((a, b) => (WEIGHT_MAP[b[0]] || 2) - (WEIGHT_MAP[a[0]] || 2))
                      .slice(0, 5)
                      .map(([type, count]) => {
                        const w = WEIGHT_MAP[type] || 2;
                        const c = w >= 8 ? "#F87171" : w >= 5 ? "#FCD34D" : COLORS.secondary;
                        return <DataBar key={type} label={type} count={count} total={breaches.length} color={c} />;
                      })}
                  </div>
                </div>

                {/* Timeline */}
                <div style={{
                  background: COLORS.bgCard, border: `1px solid ${COLORS.border}`,
                  borderRadius: 16, padding: "20px",
                }}>
                  <div style={{ color: COLORS.textDim, fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 16 }}>LINHA DO TEMPO</div>
                  <div style={{ position: "relative", paddingLeft: 20 }}>
                    <div style={{ position: "absolute", left: 7, top: 0, bottom: 0, width: 1, background: COLORS.border }} />
                    {[...breaches].sort((a, b) => new Date(b.date) - new Date(a.date)).map((b, i) => (
                      <div key={i} style={{ display: "flex", gap: 14, marginBottom: i < breaches.length - 1 ? 16 : 0, alignItems: "flex-start" }}>
                        <div style={{
                          position: "absolute", left: 3, width: 9, height: 9,
                          borderRadius: "50%", background: b.color,
                          marginTop: 4,
                          boxShadow: `0 0 6px ${b.color}88`,
                        }} />
                        <div style={{ paddingLeft: 10 }}>
                          <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 600 }}>{b.name}</div>
                          <div style={{ color: COLORS.textDim, fontSize: 12 }}>
                            {new Date(b.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Breaches tab */}
            {tab === "breaches" && (
              <div style={{ animation: "fadeIn 0.3s ease", display: "flex", flexDirection: "column", gap: 10 }}>
                {breaches.map((b, i) => <BreachCard key={b.name} breach={b} index={i} />)}
              </div>
            )}

            {/* AI tab */}
            {tab === "ai" && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <AIInsight breaches={breaches} />
              </div>
            )}
          </div>
        )}

        {/* Features section */}
        {!breaches && !searching && (
          <div style={{ marginTop: 8, animation: "slideUp 0.6s ease 0.4s both" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <h2 style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, letterSpacing: 2, marginBottom: 12 }}>COMO O SAFEID FUNCIONA</h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { icon: "🔍", title: "Consulta OSINT", desc: "Verificamos seu email em mais de 780 bases de dados de vazamentos conhecidos via Have I Been Pwned." },
                { icon: "⚡", title: "Score de Risco", desc: "Algoritmo ponderado calcula a gravidade real da sua exposição com base na criticidade dos dados comprometidos." },
                { icon: "✦", title: "Plano com IA", desc: "Nossa IA transforma dados técnicos em um plano de ação claro e personalizado para proteger sua identidade digital." },
              ].map((f, i) => (
                <div key={i} style={{
                  background: COLORS.bgCard, border: `1px solid ${COLORS.border}`,
                  borderRadius: 16, padding: "24px 18px",
                  transition: "border-color 0.2s",
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.borderLight}
                  onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.border}>
                  <div style={{ fontSize: 28, marginBottom: 14 }}>{f.icon}</div>
                  <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{f.title}</div>
                  <div style={{ color: COLORS.textDim, fontSize: 13, lineHeight: 1.6 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: `1px solid ${COLORS.border}`,
        padding: "24px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        color: COLORS.textDim, fontSize: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: COLORS.secondary, fontWeight: 700 }}>SafeID</span>
          <span>· IFSP São Paulo · TADS 2026</span>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {["Privacidade", "LGPD", "GitHub"].map(l => (
            <span key={l} style={{ cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.color = COLORS.text}
              onMouseLeave={e => e.currentTarget.style.color = COLORS.textDim}>{l}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}
