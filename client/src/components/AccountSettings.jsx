import { useState } from "react";
import { changePassword, exportAccountData } from "../lib/api";

/** Baixa um JSON gerado no navegador, sem o arquivo passar por outro lugar */
function downloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const CHANGE_ERRORS = {
  INVALID_CURRENT_PASSWORD: "A senha atual está incorreta.",
  SAME_PASSWORD: "A nova senha precisa ser diferente da atual.",
};

/** Dados da conta: troca de senha e cópia dos dados (LGPD, art. 18, V) */
export default function AccountSettings({ hasPassword }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setErr("");
    setMessage("");
    if (next.length < 8) { setErr("A nova senha deve ter pelo menos 8 caracteres."); return; }
    if (next !== confirm) { setErr("As senhas não coincidem."); return; }

    try {
      setSaving(true);
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setOpen(false);
      setMessage("Senha alterada. As outras sessões da sua conta foram encerradas.");
    } catch (error) {
      setErr(CHANGE_ERRORS[error.code] || error.message || "Não foi possível alterar a senha.");
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    try {
      setExporting(true);
      setExportErr("");
      downloadJson(await exportAccountData(), `safeid-meus-dados-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (error) {
      setExportErr(error.message || "Não foi possível gerar a cópia dos dados.");
    } finally {
      setExporting(false);
    }
  };

  const inpClass = "w-full bg-safe-bg border border-safe-border rounded-xl text-safe-text py-2.5 px-3.5 text-sm outline-none transition-colors focus:border-safe-secondary";
  const btnClass = "bg-safe-primary/10 border border-safe-primary/30 text-safe-secondary rounded-lg py-2 px-3.5 text-xs font-semibold hover:bg-safe-primary/20 transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-60";

  return (
    <section aria-labelledby="account-settings-title" className="bg-safe-card border border-safe-border rounded-2xl p-5 sm:p-6 mt-6">
      <h2 id="account-settings-title" className="text-safe-text font-semibold text-base m-0 mb-4">Sua conta</h2>

      <div className="flex flex-col gap-5">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-safe-text text-sm font-semibold">Senha</div>
              <p className="text-safe-muted text-sm mt-1 m-0">
                {hasPassword
                  ? "Ao trocar, as outras sessões da sua conta são encerradas."
                  : "Sua conta entra pelo Google. Para ter também uma senha, use \"Esqueci minha senha\" na tela de login."}
              </p>
            </div>
            {hasPassword && !open && (
              <button type="button" onClick={() => { setOpen(true); setMessage(""); }} className={`${btnClass} shrink-0 self-start sm:self-auto`}>
                Trocar senha
              </button>
            )}
          </div>

          {message && <div role="status" className="text-safe-accent text-[13px] mt-3">{message}</div>}

          {open && (
            <form onSubmit={submit} className="flex flex-col gap-3 mt-4 max-w-sm">
              <div>
                <label htmlFor="current-password" className="block text-safe-dim text-[11px] font-semibold mb-1.5 tracking-wide">SENHA ATUAL</label>
                <input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inpClass} />
              </div>
              <div>
                <label htmlFor="new-password" className="block text-safe-dim text-[11px] font-semibold mb-1.5 tracking-wide">NOVA SENHA</label>
                <input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Mínimo 8 caracteres" className={inpClass} />
              </div>
              <div>
                <label htmlFor="new-password-confirm" className="block text-safe-dim text-[11px] font-semibold mb-1.5 tracking-wide">CONFIRMAR NOVA SENHA</label>
                <input id="new-password-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inpClass} />
              </div>
              {err && <div role="alert" className="text-safe-danger text-[13px]">{err}</div>}
              <div className="flex gap-3 items-center">
                <button type="submit" disabled={saving} className={btnClass}>{saving ? "Salvando..." : "Salvar nova senha"}</button>
                <button type="button" onClick={() => { setOpen(false); setErr(""); }} className="bg-transparent border-none p-0 text-xs text-safe-dim cursor-pointer hover:text-safe-muted">Cancelar</button>
              </div>
            </form>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-safe-border pt-5">
          <div className="min-w-0">
            <div className="text-safe-text text-sm font-semibold">Seus dados</div>
            <p className="text-safe-muted text-sm mt-1 m-0">Baixe uma cópia em JSON da sua conta, das análises, dos vazamentos e das notificações.</p>
            {exportErr && <div role="alert" className="text-safe-danger text-[13px] mt-2">{exportErr}</div>}
          </div>
          <button type="button" onClick={download} disabled={exporting} className={`${btnClass} shrink-0 self-start sm:self-auto`}>
            {exporting ? "Gerando..." : "Baixar meus dados"}
          </button>
        </div>
      </div>
    </section>
  );
}
