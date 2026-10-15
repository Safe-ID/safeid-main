import { useEffect, useState } from "react";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "../lib/api";

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Lista paginada das notificações (dropdown do sino). Clicar numa notificação
 * marca como lida e leva para a aba de vazamentos do painel.
 */
export default function NotificationsPanel({ onChanged, onOpenBreaches, onClose }) {
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (cursor) => {
    try {
      setLoading(true);
      setError("");
      const page = await fetchNotifications(cursor);
      setItems((current) => (cursor ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err.message || "Não foi possível carregar as notificações.");
    } finally {
      setLoading(false);
    }
  };

  // Primeira página ao abrir (o estado inicial já é "carregando")
  useEffect(() => {
    let active = true;
    const loadFirstPage = async () => {
      try {
        const page = await fetchNotifications();
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (err) {
        if (active) setError(err.message || "Não foi possível carregar as notificações.");
      } finally {
        if (active) setLoading(false);
      }
    };
    loadFirstPage();
    return () => { active = false; };
  }, []);

  const markRead = (id) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item)));
  };

  const openItem = async (item) => {
    if (!item.readAt) {
      markRead(item.id);
      try {
        await markNotificationRead(item.id);
      } catch {
        // A leitura é secundária: mesmo se falhar, a pessoa vai para os vazamentos
      }
      onChanged();
    }
    onOpenBreaches();
    onClose();
  };

  const readAll = async () => {
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    try {
      await markAllNotificationsRead();
    } catch (err) {
      setError(err.message || "Não foi possível marcar como lidas.");
    } finally {
      onChanged();
    }
  };

  const hasUnread = items.some((item) => !item.readAt);

  return (
    <div
      role="dialog"
      aria-label="Notificações"
      className="fixed left-4 right-4 top-[68px] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px] bg-safe-card border border-safe-borderL rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden z-50"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-safe-border">
        <span className="text-safe-text text-sm font-semibold">Notificações</span>
        <button
          type="button"
          onClick={readAll}
          disabled={!hasUnread}
          className="bg-transparent border-none p-0 text-xs text-safe-secondary cursor-pointer hover:underline disabled:cursor-default disabled:text-safe-dim disabled:no-underline"
        >
          Marcar todas como lidas
        </button>
      </div>

      <div className="max-h-[360px] overflow-y-auto">
        {error && <div role="alert" className="px-4 py-3 text-safe-danger text-[13px]">{error}</div>}

        {!loading && !error && items.length === 0 && (
          <div className="px-4 py-8 text-center text-safe-dim text-[13px]">
            Nenhuma notificação por enquanto. Avisaremos aqui e por email se seu email aparecer em um vazamento novo.
          </div>
        )}

        <ul className="list-none m-0 p-0">
          {items.map((item) => (
            <li key={item.id} className="border-b border-safe-border last:border-b-0">
              <button
                type="button"
                onClick={() => openItem(item)}
                className={`w-full text-left bg-transparent border-none px-4 py-3 cursor-pointer transition-colors hover:bg-safe-hover flex gap-3 ${item.readAt ? "" : "bg-safe-primary/5"}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${item.readAt ? "bg-transparent" : "bg-safe-danger"}`}
                />
                <span className="flex-1 min-w-0">
                  <span className={`block text-[13px] ${item.readAt ? "text-safe-muted" : "text-safe-text font-semibold"}`}>
                    {item.title}
                    {!item.readAt && <span className="sr-only"> (não lida)</span>}
                  </span>
                  <span className="block text-safe-dim text-[12px] mt-0.5 break-words">{item.body}</span>
                  <span className="block text-safe-dim text-[11px] mt-1">
                    {formatDate(item.createdAt)}
                    {typeof item.riskScoreAfter === "number" && ` · risco ${item.riskScoreAfter}/100`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {loading && <div className="px-4 py-3 text-safe-dim text-[13px]">Carregando...</div>}

        {!loading && nextCursor && (
          <button
            type="button"
            onClick={() => load(nextCursor)}
            className="w-full bg-transparent border-none border-t border-safe-border py-3 text-[13px] text-safe-secondary cursor-pointer hover:bg-safe-hover"
          >
            Carregar mais
          </button>
        )}
      </div>
    </div>
  );
}
