import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Navbar from "./components/Navbar";
import Landing from "./components/Landing";
import Auth from "./components/Auth";
import Dashboard from "./components/Dashboard";
import Privacy from "./components/Privacy";
import ResetPassword from "./components/ResetPassword";
import Terms from "./components/Terms";
import { LEGAL_PATHS } from "./lib/legal";
import NotFound from "./components/NotFound";
import LockMark from "./components/brand/LockMark";
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

// O StrictMode roda o efeito duas vezes em dev: o token do link de recuperação sobrevive à segunda
let pendingResetToken = null;

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

/** "privacy" ou "terms" quando o endereço é de um texto legal; null nos outros casos */
function legalPageFromPath() {
  const path = window.location.pathname.replace(/\/+$/, "");
  return Object.keys(LEGAL_PATHS).find((key) => LEGAL_PATHS[key] === path) ?? null;
}

const isLegalPage = (value) => value in LEGAL_PATHS;

/** Página própria do endereço: fica aberta depois de restaurar a sessão */
const isAddressedPage = (value) => isLegalPage(value) || value === "not-found";

/** Página pedida pelo endereço; null na raiz, onde quem decide é a sessão */
function pageFromPath() {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/index.html") return null;
  return legalPageFromPath() ?? "not-found";
}

/** Ao sair de uma página própria por outro caminho, o endereço volta para a raiz */
function resetPath() {
  if (pageFromPath()) window.history.replaceState({}, document.title, "/");
}
// Telas que o botão voltar do navegador pode reabrir pela memória do histórico (os textos
// legais e a página não encontrada já têm o próprio endereço)
const HISTORY_PAGES = new Set(["landing", "login", "register", "dashboard"]);

/**
 * Troca de tela com transição suave quando o navegador sabe fazer (View Transitions).
 * Sem suporte, com movimento reduzido ou com a aba escondida, troca na hora, como antes.
 */
function withTransition(update) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (typeof document.startViewTransition !== "function" || reduce || document.visibilityState === "hidden") {
    update();
    return;
  }
  try {
    document.startViewTransition(() => flushSync(update));
  } catch {
    update();
  }
}

// Título da aba de cada tela: é o que o leitor de tela anuncia ao trocar de página (WCAG 2.4.2)
const DEFAULT_TITLE = "SafeID: seu email apareceu em algum vazamento?";
const PAGE_TITLES = {
  login: "Entrar · SafeID",
  register: "Criar conta · SafeID",
  dashboard: "Painel · SafeID",
  privacy: "Política de Privacidade · SafeID",
  terms: "Termos de Uso · SafeID",
  "not-found": "Página não encontrada · SafeID",
  "reset-password": "Nova senha · SafeID",
};

export default function SafeID() {
  const [page, setPage] = useState(() => pageFromPath() ?? "landing");
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState("");
  const [resetToken, setResetToken] = useState(null);
  // Aviso da página inicial (ex.: alertas desativados pelo link do email)
  const [landingNotice, setLandingNotice] = useState(null);
  // Página de onde a pessoa abriu um texto legal, para o botão Voltar
  const [legalReturn, setLegalReturn] = useState("landing");
  const legalExit = user ? "dashboard" : legalReturn;
  const mainRef = useRef(null);
  const previousPage = useRef(page);

  // A cada troca de tela: atualiza o título e leva o foco ao conteúdo, para o teclado e o
  // leitor de tela não ficarem no botão que sumiu (WCAG 2.4.3). Na primeira carga, não mexe no foco
  useEffect(() => {
    document.title = PAGE_TITLES[page] ?? DEFAULT_TITLE;
    if (previousPage.current !== page) {
      previousPage.current = page;
      // Tela nova começa do topo; o foco sem rolagem não esconde o começo da página sob a barra fixa
      mainRef.current?.focus({ preventScroll: true });
      if (window.scrollY) window.scrollTo(0, 0);
    }
  }, [page]);

  // A entrada atual do histórico guarda a tela aberta nela, para o botão voltar saber o que
  // reabrir. Só na raiz: os textos legais e a página não encontrada têm endereço próprio
  useEffect(() => {
    if (booting || pageFromPath()) return;
    if (window.history.state?.safeidPage === page) return;
    window.history.replaceState({ ...(window.history.state ?? {}), safeidPage: page }, document.title);
  }, [booting, page]);

  const openLegal = (target) => {
    if (!isAddressedPage(page)) setLegalReturn(page);
    window.history.pushState({}, document.title, LEGAL_PATHS[target]);
    withTransition(() => setPage(target));
    window.scrollTo(0, 0);
  };

  const closeLegal = () => {
    window.history.pushState({}, document.title, "/");
    withTransition(() => setPage(legalExit));
    window.scrollTo(0, 0);
  };

  // Botões voltar e avançar do navegador: textos legais pelo endereço, as outras telas pela
  // memória do histórico. Painel só com sessão; logado, início, entrar e criar conta levam ao painel
  useEffect(() => {
    const onPopState = (event) => {
      const fromPath = pageFromPath();
      let next = fromPath;
      if (!next) {
        const remembered = event.state?.safeidPage;
        next = HISTORY_PAGES.has(remembered) ? remembered : legalExit;
        if (user && (next === "landing" || next === "login" || next === "register")) next = "dashboard";
        if (!user && next === "dashboard") next = "landing";
      }
      withTransition(() => setPage(next));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [legalExit, user]);

  const goTo = (p) => {
    // Logado, a logo leva ao painel: voltar para a página inicial apagava o usuário da tela
    // sem apagar o token, um "logout pela metade"
    if (p === "landing" && user) p = "dashboard";
    // Saindo de um endereço próprio, ele vira a raiz (sem somar entrada); na raiz, cada tela
    // nova soma uma entrada no histórico, para o botão voltar do navegador funcionar
    if (pageFromPath()) window.history.replaceState({ safeidPage: p }, document.title, "/");
    else if (p !== page) window.history.pushState({ safeidPage: p }, document.title);
    withTransition(() => {
      setNotice("");
      setLandingNotice(null);
      setPage(p);
    });
  };
  const onAuth = (u, token) => {
    if (token) setToken(token);
    resetPath();
    withTransition(() => {
      setNotice("");
      setUser(u);
      setPage("dashboard");
    });
  };

  useEffect(() => {
    const onSessionExpired = () => {
      resetPath();
      setUser(null);
      setNotice("Sua sessão expirou. Entre novamente para continuar.");
      setPage("login");
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);
  const onAccountDeleted = () => { clearToken(); setUser(null); setPage("landing"); };
  const onOut = () => {
    clearToken();
    resetPath();
    withTransition(() => {
      setUser(null);
      setPage("landing");
    });
  };

  useEffect(() => {
    let active = true;
    const restoreSession = async () => {
      const monitoringParam = takeQueryParam("monitoring");
      if (monitoringParam && MONITORING_NOTICES[monitoringParam] && active) {
        setLandingNotice(MONITORING_NOTICES[monitoringParam]);
      }

      // Link do email de recuperação de senha: a tela vale mesmo com outra sessão aberta neste navegador
      pendingResetToken = takeQueryParam("reset_token") ?? pendingResetToken;
      if (pendingResetToken) {
        if (active) {
          setResetToken(pendingResetToken);
          setPage("reset-password");
          setBooting(false);
        }
        return;
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
        // Quem abriu /privacidade ou /termos logado continua na página que pediu
        setPage((current) => (isAddressedPage(current) ? current : "dashboard"));
      } catch {
        clearToken();
        if (active) {
          setUser(null);
          // Se o token venceu, o aviso de sessão expirada já levou para o login
          setPage((current) => (current === "login" || isAddressedPage(current) ? current : "landing"));
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
    <div className="min-h-screen bg-safe-bg font-sans text-safe-text flex flex-col">
      <style>{`
        input { caret-color: #6FE3B4; }
      `}</style>

      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-safe-card focus:border focus:border-safe-secondary focus:px-4 focus:py-2 focus:text-sm focus:text-safe-text"
      >
        Pular para o conteúdo
      </a>

      <Navbar user={user} onSignOut={onOut} onNav={goTo} overlay={!booting && page === "landing" && !landingNotice} />

      <main id="conteudo" ref={mainRef} tabIndex={-1} className="flex-1 focus:outline-none">
        {booting && (
          <div role="status" className="safe-boot min-h-[60svh] flex flex-col items-center justify-center gap-4 px-6 text-center">
            <LockMark className="safe-boot-lock w-14 h-auto" />
            <span className="text-safe-dim text-sm">Carregando sessão...</span>
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
        {!booting && page === "landing" && <Landing onNav={goTo} overlapNav={!landingNotice} />}
        {!booting && page === "register" && <Auth mode="register" onSuccess={(u) => onAuth(u)} onSwitch={() => goTo("login")} onGoToLogin={() => goTo("login")} />}
        {!booting && page === "login" && <Auth mode="login" notice={notice} onSuccess={(u) => onAuth(u)} onSwitch={() => goTo("register")} />}
        {!booting && page === "privacy" && <Privacy onBack={closeLegal} />}
        {!booting && page === "terms" && <Terms onBack={closeLegal} />}
        {!booting && page === "not-found" && <NotFound onBack={() => goTo("landing")} />}
        {!booting && page === "reset-password" && (
          <ResetPassword
            token={resetToken}
            onDone={(message) => {
              // A troca derruba as sessões abertas, inclusive a que estiver salva aqui
              pendingResetToken = null;
              clearToken();
              setUser(null);
              setResetToken(null);
              setNotice(message);
              setPage("login");
            }}
          />
        )}
        {!booting && page === "dashboard" && isAuthenticated && <Dashboard user={user} onDeleteAccount={onAccountDeleted} />}
      </main>

      {/* No painel também: é o caminho da pessoa logada até a Política de Privacidade (LGPD) */}
      {!booting && (
        <footer className="border-t border-safe-border py-5 px-6 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-safe-dim text-xs text-center">
          <div><span className="text-safe-text font-semibold">Safe<span className="text-safe-secondary">ID</span></span> · IFSP São Paulo · TADS 2026</div>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            {[{ key: "privacy", label: "Privacidade" }, { key: "terms", label: "Termos de Uso" }].map(({ key, label }) => (
              <a
                key={key}
                href={LEGAL_PATHS[key]}
                onClick={(event) => { event.preventDefault(); openLegal(key); }}
                className="text-safe-dim no-underline transition-colors hover:text-safe-text"
              >
                {label}
              </a>
            ))}
            <a href="https://haveibeenpwned.com" target="_blank" rel="noopener noreferrer" className="text-safe-dim no-underline transition-colors hover:text-safe-text">
              Dados de vazamentos: Have I Been Pwned
            </a>
            <a href="https://github.com/Safe-ID/safeid-main" target="_blank" rel="noopener noreferrer" className="text-safe-dim no-underline transition-colors hover:text-safe-text">
              GitHub
            </a>
          </div>
        </footer>
      )}
    </div>
  );
}