import { useEffect, useState } from "react";
import Navbar from "./components/Navbar";
import Landing from "./components/Landing";
import Auth from "./components/Auth";
import Dashboard from "./components/Dashboard";
import Privacy from "./components/Privacy";
import { SESSION_EXPIRED_EVENT, clearToken, fetchMe, getToken, setAuthTokens, setToken, verifyEmail } from "./lib/api";

const MONITORING_NOTICES = {
  disabled: { tone: "info", text: "Alertas de vazamento desativados. Você pode religar quando quiser no seu painel." },
  invalid: { tone: "error", text: "Este link de descadastro é inválido. Entre na sua conta para desligar os alertas pelo painel." },
};

// Uma verificação por carregamento da página. O StrictMode roda o efeito duas vezes em dev:
// a segunda execução reaproveita a mesma chamada em vez de perder o token já tirado da URL.
let pendingVerification = null;

function verifyOnce(token) {
  if (!pendingVerification || pendingVerification.token !== token) {
    pendingVerification = { token, promise: verifyEmail(token) };
  }
  return pendingVerification.promise;
}

/** Lê um parâmetro da URL e o remove do endereço (tokens não ficam no histórico) */
function takeQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  if (value === null) return null;

  params.delete(name);
  const query = params.toString();
  window.history.replaceState({}, document.title, window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
  return value;
}

export default function SafeID() {
  const [page, setPage] = useState("landing");
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState("");
  // Aviso da página inicial (ex.: alertas desativados pelo link do email)
  const [landingNotice, setLandingNotice] = useState(null);
  // Página de onde a pessoa abriu a Política de Privacidade, para o botão Voltar
  const [privacyReturn, setPrivacyReturn] = useState("landing");

  const openPrivacy = () => {
    setPrivacyReturn(page === "privacy" ? privacyReturn : page);
    setPage("privacy");
    window.scrollTo(0, 0);
  };

  const goTo = (p) => {
    // Logado, a logo leva ao painel: voltar para a página inicial apagava o usuário da tela
    // sem apagar o token, um "logout pela metade"
    if (p === "landing" && user) p = "dashboard";
    setNotice("");
    setLandingNotice(null);
    setPage(p);
  };
  const onAuth = (u, token) => {
    if (token) setToken(token);
    setNotice("");
    setUser(u);
    setPage("dashboard");
  };

  useEffect(() => {
    const onSessionExpired = () => {
      setUser(null);
      setNotice("Sua sessão expirou. Entre novamente para continuar.");
      setPage("login");
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);
  const onAccountDeleted = () => { clearToken(); setUser(null); setPage("landing"); };
  const onOut = () => { clearToken(); setUser(null); setPage("landing"); };

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      const monitoringParam = takeQueryParam("monitoring");
      if (monitoringParam && MONITORING_NOTICES[monitoringParam] && active) {
        setLandingNotice(MONITORING_NOTICES[monitoringParam]);
      }

      // Link do email de verificação: o token sai da URL antes da chamada
      const verifyToken = takeQueryParam("verify_token") ?? pendingVerification?.token;
      if (verifyToken) {
        clearToken();
        try {
          const session = await verifyOnce(verifyToken);
          if (!active) return;
          setAuthTokens(session);
          setUser(session.user);
          setPage("dashboard");
        } catch (error) {
          if (!active) return;
          setNotice(
            error.code === "TOKEN_EXPIRED"
              ? "Este link de verificação expirou ou já foi usado. Entre com seu email e senha para receber um novo link."
              : "Link de verificação inválido. Entre com seu email e senha para receber um novo link.",
          );
          setPage("login");
        } finally {
          if (active) setBooting(false);
        }
        return;
      }

      const oauthHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = oauthHash.get("access_token");
      const refreshToken = oauthHash.get("refresh_token");

      if (accessToken) {
        setAuthTokens({ access_token: accessToken, refresh_token: refreshToken || undefined });
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }

      const token = accessToken || getToken();
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
          // Se o token venceu, o aviso de sessão expirada já levou para o login
          setPage((current) => (current === "login" ? current : "landing"));
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

        {/* O link de opt-out pode ser aberto já logado: o aviso aparece também no painel */}
        {!booting && (page === "landing" || page === "dashboard") && landingNotice && (
          <div className="w-full max-w-4xl mx-auto px-6 pt-6">
            <div
              role="status"
              className={`rounded-xl border py-3 px-4 text-sm ${
                landingNotice.tone === "error"
                  ? "bg-safe-danger/10 border-safe-danger/30 text-safe-danger"
                  : "bg-safe-accent/10 border-safe-accent/30 text-safe-accent"
              }`}
            >
              {landingNotice.text}
            </div>
          </div>
        )}
        {!booting && page === "landing" && <Landing onNav={goTo} />}
        {!booting && page === "register" && <Auth mode="register" onSuccess={(u) => onAuth(u)} onSwitch={() => setPage("login")} onGoToLogin={() => setPage("login")} onOpenPrivacy={openPrivacy} />}
        {!booting && page === "login" && <Auth mode="login" notice={notice} onSuccess={(u) => onAuth(u)} onSwitch={() => { setNotice(""); setPage("register"); }} onOpenPrivacy={openPrivacy} />}
        {!booting && page === "privacy" && <Privacy onBack={() => setPage(privacyReturn)} />}
        {!booting && page === "dashboard" && isAuthenticated && <Dashboard user={user} onDeleteAccount={onAccountDeleted} />}
      </main>

      {/* No painel também: é o caminho da pessoa logada até a Política de Privacidade (LGPD) */}
      {!booting && (
        <footer className="border-t border-safe-border py-5 px-6 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-safe-dim text-xs text-center">
          <div><span className="text-safe-secondary font-bold">SafeID</span> · IFSP São Paulo · TADS 2026</div>
          <div className="flex gap-5">
            {['Privacidade', 'LGPD'].map(l => (
              <button key={l} type="button" onClick={openPrivacy} className="bg-transparent border-none p-0 text-xs text-safe-dim cursor-pointer transition-colors hover:text-safe-text">
                {l}
              </button>
            ))}
            <a href="https://github.com/Safe-ID/safeid-main" target="_blank" rel="noopener noreferrer" className="text-safe-dim no-underline transition-colors hover:text-safe-text">
              GitHub
            </a>
          </div>
        </footer>
      )}
    </div>
  );
}