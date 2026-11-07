import { useEffect, useState } from "react";
import NotificationBell from "./NotificationBell";
import LockMark from "./brand/LockMark";

export default function Navbar({ user, onSignOut, onNav, overlay = false }) {
  const initial = user?.email?.charAt(0)?.toUpperCase() || "U";
  const displayName = user?.email || "Convidado";
  // Na capa da página inicial a barra fica transparente e sem a logo (a capa já mostra a marca)
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    if (!overlay) return undefined;
    const onScroll = () => setAtTop(window.scrollY < window.innerHeight * 0.9);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overlay]);
  const overCover = overlay && atTop;

  return (
    <nav className={`w-full h-16 flex items-center justify-between px-4 sm:px-8 md:px-12 border-b sticky top-0 z-50 transition-colors duration-300 ${overCover ? "border-transparent bg-transparent" : "border-safe-border bg-safe-bg/90 backdrop-blur-md"}`}>
      <div
        role="link"
        tabIndex={0}
        aria-label={user ? "SafeID, ir para o painel" : "SafeID, ir para a página inicial"}
        onClick={() => onNav("landing")}
        onKeyDown={(e) => e.key === "Enter" && onNav("landing")}
        className={`flex items-center gap-2.5 shrink-0 cursor-pointer rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-safe-secondary transition-opacity duration-300 ${overCover ? "invisible opacity-0" : "opacity-100"}`}
      >
        <LockMark orbits className="w-6 h-7" />
        <span className="font-semibold text-lg tracking-tight text-safe-text">
          Safe<span className="text-safe-secondary">ID</span>
        </span>
      </div>

      <div className="flex gap-2 sm:gap-3 items-center min-w-0">
        {!user ? (
          <>
            <button onClick={() => onNav("login")} className="bg-transparent border border-safe-borderL rounded-full text-safe-text py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-hover">
              Entrar
            </button>
            <button onClick={() => onNav("register")} className="bg-safe-primary hover:bg-safe-primaryD border-none rounded-full text-white py-2 px-4 text-sm font-semibold cursor-pointer transition-colors">
              Criar conta
            </button>
          </>
        ) : (
          <>
            <NotificationBell />
            <div className="hidden sm:flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 shrink-0 rounded-full bg-safe-primary border border-safe-secondary/40 flex items-center justify-center text-xs font-bold text-white">
                {initial}
              </div>
              <span className="text-safe-muted text-sm truncate max-w-[220px]" title={displayName}>{displayName}</span>
            </div>
            <button onClick={onSignOut} className="shrink-0 bg-transparent border border-safe-borderL rounded-full text-safe-muted py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-hover hover:text-safe-muted">
              Sair
            </button>
          </>
        )}
      </div>
    </nav>
  );
}