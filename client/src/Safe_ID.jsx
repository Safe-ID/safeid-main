import { useEffect, useState } from "react";
import Navbar from "./components/Navbar";
import Landing from "./components/Landing";
import Auth from "./components/Auth";
import Dashboard from "./components/Dashboard";
import { C } from "./components/safeidData";
import { clearToken, fetchMe, getToken, setToken } from "./lib/api";

export default function SafeID() {
  const [page, setPage] = useState("landing");
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  const goTo = (p) => {
    if (p === "landing") setUser(null);
    setPage(p);
  };
  const onAuth = (u, token) => {
    if (token) setToken(token);
    setUser(u);
    setPage("dashboard");
  };
  const onOut = () => { clearToken(); setUser(null); setPage("landing"); };

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      const token = getToken();
      if (!token) {
        if (active) setBooting(false);
        return;
      }

      try {
        const profile = await fetchMe();
        if (!active) return;
        setUser(profile);
        setPage("dashboard");
      } catch {
        clearToken();
        if (active) {
          setUser(null);
          setPage("landing");
        }
      } finally {
        if (active) setBooting(false);
      }
    };

    restoreSession();
    return () => { active = false; };
  }, []);

  const isAuthenticated = Boolean(user);

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

      {booting && (
        <div style={{ padding: "64px 24px", textAlign: "center", color: C.muted }}>
          Carregando sessão...
        </div>
      )}

      {!booting && page === "landing" && <Landing onNav={goTo} />}
      {!booting && page === "register" && <Auth mode="register" onSuccess={(u) => onAuth(u)} onSwitch={() => setPage("login")} />}
      {!booting && page === "login" && <Auth mode="login" onSuccess={(u) => onAuth(u)} onSwitch={() => setPage("register")} />}
      {!booting && page === "dashboard" && isAuthenticated && <Dashboard user={user} onSignOut={onOut} />}

      {!booting && page !== "dashboard" && (
        <footer style={{ borderTop: `1px solid ${C.border}`, padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", color: C.dim, fontSize: 12 }}>
          <div><span style={{ color: C.secondary, fontWeight: 700 }}>SafeID</span> · IFSP São Paulo · TADS 2026</div>
          <div style={{ display: "flex", gap: 20 }}>
            {['Privacidade', 'LGPD', 'GitHub'].map(l => (
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
