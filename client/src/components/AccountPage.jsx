import { useEffect, useRef, useState } from "react";
import SkyHeader from "./brand/SkyHeader";
import AccountSettings from "./AccountSettings";
import MonitoringSettings from "./MonitoringSettings";
import { OPEN_DASHBOARD_TAB_EVENT, deleteAccount, fetchMe } from "../lib/api";

function LineIcon({ children, className = "w-[18px] h-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const ICONS = {
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
  key: <><circle cx="8" cy="14" r="3.5" /><path d="M10.5 11.5 19 3M16 6l2.5 2.5M14 8l2 2" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" /><path d="M10 11v5M14 11v5" /></>,
  back: <><path d="M15 5 8 12l7 7" /></>,
};

/** Seções da barra lateral, na ordem em que aparecem */
const ACCOUNT_SECTIONS = [
  { id: "perfil", label: "Perfil", icon: ICONS.user },
  { id: "seguranca", label: "Senha e segurança", icon: ICONS.key },
  { id: "alertas", label: "Alertas", icon: ICONS.bell },
  { id: "dados", label: "Seus dados", icon: ICONS.download },
  { id: "excluir", label: "Excluir conta", icon: ICONS.trash, danger: true },
];
const validSection = (id) => (ACCOUNT_SECTIONS.some((s) => s.id === id) ? id : "perfil");

const CONFIRM_WORD = "EXCLUIR";

function ProfileSection({ profile }) {
  const rows = [
    {
      label: "Email monitorado",
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-safe-text [overflow-wrap:anywhere]">{profile?.email || "—"}</span>
          {profile?.emailVerified !== undefined && (
            <span className={`text-[11px] py-0.5 px-2 rounded-full border ${profile.emailVerified ? "bg-safe-accent/10 border-safe-accent/30 text-safe-accent" : "bg-safe-warn/10 border-safe-warn/30 text-safe-warn"}`}>
              {profile.emailVerified ? "Verificado" : "Não verificado"}
            </span>
          )}
        </span>
      ),
    },
    { label: "Forma de acesso", value: profile?.hasPassword === false ? "Conta Google" : "Email e senha" },
    { label: "Alertas de vazamento", value: profile?.monitoringEnabled === false ? "Desligados" : "Ligados" },
  ];
  return (
    <section aria-labelledby="profile-title" className="bg-safe-card border border-safe-border rounded-2xl p-5 sm:p-6">
      <h2 id="profile-title" className="text-safe-text font-semibold text-base m-0 mb-4">Perfil</h2>
      <dl className="m-0 flex flex-col">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-3 border-t border-safe-border first:border-t-0 first:pt-0">
            <dt className="text-safe-dim text-xs sm:w-44 shrink-0">{row.label}</dt>
            <dd className="m-0 text-safe-text text-sm min-w-0">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-safe-dim text-xs mt-4 mb-0 leading-relaxed">
        O email é o endereço que o SafeID monitora e não pode ser trocado por aqui. Para monitorar outro email, crie uma conta com ele.
      </p>
    </section>
  );
}

/** Exclusão definitiva: explica o que some, sugere a cópia dos dados e pede a palavra de confirmação */
function DeleteAccountSection({ onDeleted, onGoToData }) {
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;

  const submit = async (event) => {
    event.preventDefault();
    if (!ready || deleting) return;
    try {
      setDeleting(true);
      setError("");
      await deleteAccount();
      onDeleted();
    } catch (err) {
      setError(err.message || "Não foi possível excluir a conta. Tente de novo.");
      setDeleting(false);
    }
  };

  return (
    <section aria-labelledby="delete-account-title" className="bg-gradient-to-br from-[#180808] to-[#200A0A] border border-safe-danger/40 rounded-2xl p-5 sm:p-6">
      <h2 id="delete-account-title" className="text-safe-danger font-semibold text-base m-0">Excluir conta</h2>
      <p className="text-safe-muted text-sm mt-2 mb-3 leading-relaxed">
        A exclusão é definitiva e não pode ser desfeita. O SafeID apaga:
      </p>
      <ul className="text-safe-muted text-sm m-0 mb-4 pl-5 flex flex-col gap-1.5 list-disc marker:text-safe-danger">
        <li>sua conta e o acesso a ela (email e senha);</li>
        <li>o histórico de análises e do score de risco;</li>
        <li>os vazamentos encontrados e o plano de ação;</li>
        <li>as notificações. O monitoramento do seu email para.</li>
      </ul>
      <p className="text-safe-muted text-sm m-0 mb-5">
        Quer guardar uma cópia antes?{" "}
        <button type="button" onClick={onGoToData} className="bg-transparent border-none p-0 text-safe-secondary underline underline-offset-4 cursor-pointer hover:text-safe-accent">
          Baixe seus dados
        </button>
        .
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3 max-w-sm">
        <label htmlFor="delete-confirm" className="text-safe-dim text-[13px]">
          Para confirmar, digite <strong className="text-safe-text tracking-wide">{CONFIRM_WORD}</strong>
        </label>
        <input
          id="delete-confirm"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full bg-safe-bg border border-safe-border rounded-xl text-safe-text py-2.5 px-3.5 text-sm outline-none transition-colors focus:border-safe-danger"
        />
        {error && <div role="alert" className="text-safe-danger text-[13px]">{error}</div>}
        <button
          type="submit"
          disabled={!ready || deleting}
          className="self-start bg-safe-danger/15 border border-safe-danger/60 rounded-xl text-safe-danger py-2.5 px-4 text-sm font-semibold cursor-pointer transition-colors hover:bg-safe-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? "Excluindo..." : "Excluir minha conta"}
        </button>
      </form>
    </section>
  );
}

/**
 * Editar cadastro: mesmo cabeçalho do painel e uma barra lateral com as seções da conta.
 * No celular, a barra vira uma fileira rolável acima do conteúdo.
 */
export default function AccountPage({ user, initialSection = "perfil", onBack, onAccountDeleted }) {
  const [profile, setProfile] = useState(user);
  const [section, setSection] = useState(() => validSection(initialSection));
  const panelRef = useRef(null);
  const firstRender = useRef(true);

  // O perfil da sessão pode estar velho (ex.: alertas mudados no painel): busca o atual
  useEffect(() => {
    let active = true;
    fetchMe()
      .then((me) => { if (active) setProfile(me); })
      .catch(() => { /* fica com o perfil da sessão */ });
    return () => { active = false; };
  }, []);

  // Clique numa notificação do sino: volta ao painel já na aba pedida (ex.: vazamentos)
  useEffect(() => {
    const onOpenTab = (event) => onBack?.(event.detail);
    window.addEventListener(OPEN_DASHBOARD_TAB_EVENT, onOpenTab);
    return () => window.removeEventListener(OPEN_DASHBOARD_TAB_EVENT, onOpenTab);
  }, [onBack]);

  // Trocar de seção leva o foco ao conteúdo novo (teclado e leitor de tela não ficam perdidos)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    panelRef.current?.focus({ preventScroll: true });
  }, [section]);

  return (
    <div className="w-full max-w-4xl mx-auto pt-6 sm:pt-10 px-4 sm:px-6 pb-20">
      <SkyHeader capture speed={0.45} lockSide="left">
        <p className="text-safe-dim text-sm mb-1">Sua conta</p>
        <h1 className="text-safe-text text-2xl sm:text-3xl font-serif font-medium tracking-tight">Editar cadastro</h1>
        <p className="text-safe-muted text-base mt-1 [overflow-wrap:anywhere]">{profile?.email}</p>
      </SkyHeader>

      <div className="md:grid md:grid-cols-[210px_minmax(0,1fr)] md:gap-6 md:items-start">
        <nav aria-label="Seções do cadastro" className="mb-6 md:mb-0 md:sticky md:top-24">
          <button
            type="button"
            onClick={() => onBack?.()}
            className="flex items-center gap-1.5 bg-transparent border-none p-0 mb-3 text-sm text-safe-dim cursor-pointer hover:text-safe-text"
          >
            <LineIcon className="w-4 h-4">{ICONS.back}</LineIcon>
            Voltar ao painel
          </button>
          <ul className="list-none m-0 p-1.5 flex md:flex-col gap-1 overflow-x-auto bg-safe-card border border-safe-border rounded-2xl">
            {ACCOUNT_SECTIONS.map((s) => {
              const active = s.id === section;
              const tone = s.danger
                ? active ? "bg-safe-danger/10 border-safe-danger/40 text-safe-danger" : "border-transparent text-safe-danger/80 hover:bg-safe-danger/10"
                : active ? "bg-safe-hover border-safe-borderL text-safe-text font-semibold" : "border-transparent text-safe-dim hover:bg-safe-hover hover:text-safe-text";
              return (
                <li key={s.id} className={`shrink-0 ${s.danger ? "md:mt-2 md:pt-2 md:border-t md:border-safe-border" : ""}`}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setSection(s.id)}
                    className={`w-full flex items-center gap-2.5 whitespace-nowrap rounded-xl border py-2.5 px-3 text-sm text-left cursor-pointer transition-colors bg-transparent ${tone}`}
                  >
                    <LineIcon>{s.icon}</LineIcon>
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div ref={panelRef} key={section} tabIndex={-1} className="min-w-0 animate-fade-in focus:outline-none">
          {section === "perfil" && <ProfileSection profile={profile} />}
          {section === "seguranca" && <AccountSettings only="password" title="Senha e segurança" className="" hasPassword={profile?.hasPassword !== false} />}
          {section === "alertas" && (
            <MonitoringSettings className="" onChange={(status) => setProfile((p) => ({ ...p, monitoringEnabled: status.enabled }))} />
          )}
          {section === "dados" && <AccountSettings only="data" title="Seus dados" className="" hasPassword={profile?.hasPassword !== false} />}
          {section === "excluir" && <DeleteAccountSection onDeleted={onAccountDeleted} onGoToData={() => setSection("dados")} />}
        </div>
      </div>
    </div>
  );
}
