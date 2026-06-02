import { useEffect, useState } from "react";
import Navbar from "./components/Navbar";
import Landing from "./components/Landing";
import Auth from "./components/Auth";
import Dashboard from "./components/Dashboard";
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
    <div className="min-h-screen bg-[radial-gradient(ellipse_90%_60%_at_50%_-5%,#0D2545_0%,#040C1A_55%)] font-[system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif] text-safe-text flex flex-col">
      <style>{`
        ::placeholder { color: #253F60; }
        input { caret-color: #38BDF8; }
      `}</style>

      <Navbar user={user} onSignOut={onOut} onNav={goTo} />

      <main className="flex-1">
        {booting && (
          <div className="py-16 px-6 text-center text-safe-muted">
            Carregando sessão...
          </div>
        )}

        {!booting && page === "landing" && <Landing onNav={goTo} />}
        {!booting && page === "register" && <Auth mode="register" onSuccess={(u) => onAuth(u)} onSwitch={() => setPage("login")} />}
        {!booting && page === "login" && <Auth mode="login" onSuccess={(u) => onAuth(u)} onSwitch={() => setPage("register")} />}
        {!booting && page === "dashboard" && isAuthenticated && <Dashboard user={user} onSignOut={onOut} />}
      </main>

      {!booting && page !== "dashboard" && (
        <footer className="border-t border-safe-border py-5 px-8 flex items-center justify-between text-safe-dim text-xs">
          <div><span className="text-safe-secondary font-bold">SafeID</span> · IFSP São Paulo · TADS 2026</div>
          <div className="flex gap-5">
            {['Privacidade', 'LGPD', 'GitHub'].map(l => (
              <span key={l} className="cursor-pointer transition-colors hover:text-safe-text">
                {l}
              </span>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}