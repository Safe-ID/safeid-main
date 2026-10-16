import { useCallback, useEffect, useRef, useState } from "react";
import { NOTIFICATIONS_UPDATED_EVENT, OPEN_DASHBOARD_TAB_EVENT, fetchUnreadCount } from "../lib/api";
import NotificationsPanel from "./NotificationsPanel";

const POLL_INTERVAL_MS = 60 * 1000;

/**
 * Sino do Navbar: busca o contador ao montar e a cada 60 s com a aba visível.
 * Quando o contador sobe, avisa o painel para recarregar o perfil (o score mudou).
 */
export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const lastCount = useRef(null);
  const containerRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const { count: unread } = await fetchUnreadCount();
      if (lastCount.current !== null && unread > lastCount.current) {
        window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
      }
      lastCount.current = unread;
      setCount(unread);
    } catch {
      // Falha passageira: tenta de novo no próximo ciclo
    }
  }, []);

  useEffect(() => {
    const poll = async () => {
      await refresh();
    };
    poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Fecha ao clicar fora ou com Esc
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openBreaches = () => {
    window.dispatchEvent(new CustomEvent(OPEN_DASHBOARD_TAB_EVENT, { detail: "breaches" }));
  };

  const label = count > 0 ? `Notificações, ${count} não lida${count > 1 ? "s" : ""}` : "Notificações";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="relative w-9 h-9 rounded-lg border border-safe-border bg-transparent text-safe-muted flex items-center justify-center cursor-pointer transition-colors hover:bg-safe-hover hover:text-safe-text"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-safe-danger text-white text-[10px] font-bold flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <NotificationsPanel onChanged={refresh} onOpenBreaches={openBreaches} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
