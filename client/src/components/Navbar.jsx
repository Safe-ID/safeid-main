import { useEffect, useRef, useState } from "react";
import NotificationBell from "./NotificationBell";
import LockMark from "./brand/LockMark";

function MenuIcon({ children }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/**
 * Avatar com a inicial: abre o menu da conta (Editar cadastro e Excluir conta).
 * Padrão de menu do WAI-ARIA: setas, Home e End andam pelos itens; Esc fecha e devolve o foco.
 */
function UserMenu({ initial, displayName, onAccount }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onMenuKeyDown = (event) => {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement);
    const next = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  const pick = (section) => {
    setOpen(false);
    onAccount?.(section);
  };

  const itemClass = "w-full flex items-center gap-2.5 rounded-xl border-none bg-transparent py-2.5 px-3 text-sm text-left cursor-pointer transition-colors focus:outline-none";

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "menu-da-conta" : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 min-w-0 rounded-full border border-transparent bg-transparent p-0.5 sm:pr-3 cursor-pointer transition-colors hover:bg-safe-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-safe-secondary"
      >
        <span aria-hidden="true" className="w-8 h-8 shrink-0 rounded-full bg-safe-primary border border-safe-secondary/40 flex items-center justify-center text-xs font-bold text-white">
          {initial}
        </span>
        <span className="sr-only">Menu da conta</span>
        <span className="hidden sm:inline text-safe-muted text-sm truncate max-w-[220px]" title={displayName}>{displayName}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={`hidden sm:block w-4 h-4 text-safe-dim transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          id="menu-da-conta"
          role="menu"
          aria-label="Conta"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-safe-borderL bg-safe-card shadow-2xl shadow-black/40 p-1.5 z-50 animate-fade-in"
        >
          <div role="none" className="px-3 pt-2 pb-2.5 mb-1 border-b border-safe-border">
            <div className="text-safe-dim text-[11px]">Conectado como</div>
            <div className="text-safe-text text-sm truncate" title={displayName}>{displayName}</div>
          </div>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick("perfil")} className={`${itemClass} text-safe-text hover:bg-safe-hover focus:bg-safe-hover`}>
            <MenuIcon><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></MenuIcon>
            Editar cadastro
          </button>
          <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick("excluir")} className={`${itemClass} text-safe-danger hover:bg-safe-danger/10 focus:bg-safe-danger/10`}>
            <MenuIcon><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" /><path d="M10 11v5M14 11v5" /></MenuIcon>
            Excluir conta
          </button>
        </div>
      )}
    </div>
  );
}

export default function Navbar({ user, onSignOut, onNav, onAccount, overlay = false }) {
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
    <nav style={{ viewTransitionName: "safe-nav" }} className={`w-full h-16 flex items-center justify-between px-4 sm:px-8 md:px-12 border-b sticky top-0 z-50 transition-colors duration-300 ${overCover ? "border-transparent bg-transparent" : "border-safe-border bg-safe-bg/90 backdrop-blur-md"}`}>
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
            <UserMenu initial={initial} displayName={displayName} onAccount={onAccount} />
            <button onClick={onSignOut} className="shrink-0 bg-transparent border border-safe-borderL rounded-full text-safe-muted py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-hover hover:text-safe-muted">
              Sair
            </button>
          </>
        )}
      </div>
    </nav>
  );
}