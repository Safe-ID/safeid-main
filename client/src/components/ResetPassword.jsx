import { useState } from "react";
import { resetPassword } from "../lib/api";

/** Tela aberta pelo link do email de recuperação (?reset_token=) */
export default function ResetPassword({ token, onDone }) {
  const [pass, setPass] = useState("");
  const [conf, setConf] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setErr("");
    if (pass.length < 8) { setErr("Senha deve ter pelo menos 8 caracteres."); return; }
    if (pass !== conf) { setErr("As senhas não coincidem."); return; }

    try {
      setLoading(true);
      await resetPassword(token, pass);
      onDone("Senha alterada. Entre com a nova senha.");
    } catch (error) {
      setErr(
        error.code === "TOKEN_EXPIRED" || error.code === "TOKEN_INVALID"
          ? "Este link expirou ou já foi usado. Peça um novo em \"Esqueci minha senha\", na tela de login."
          : error.message || "Não foi possível alterar a senha.",
      );
    } finally {
      setLoading(false);
    }
  };

  const inpClass = "w-full bg-[#040C1A] border border-safe-border rounded-xl text-safe-text py-3 px-3.5 text-sm outline-none transition-colors focus:border-safe-primary";

  return (
    <div className="min-h-[calc(100vh-60px)] flex items-center justify-center p-4 sm:p-6">
      <form onSubmit={submit} className="w-full max-w-[420px] bg-safe-card border border-safe-borderL rounded-2xl p-6 sm:p-8 flex flex-col gap-4 animate-slide-up">
        <div className="text-center">
          <h1 className="text-safe-text text-xl sm:text-2xl font-bold tracking-tight mb-1.5">Criar nova senha</h1>
          <p className="text-safe-dim text-[13px]">As sessões abertas da sua conta serão encerradas.</p>
        </div>
        <div>
          <label htmlFor="reset-password" className="block text-safe-dim text-[11px] font-semibold mb-1.5 tracking-wide">NOVA SENHA</label>
          <input id="reset-password" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Mínimo 8 caracteres" className={inpClass} />
        </div>
        <div>
          <label htmlFor="reset-password-confirm" className="block text-safe-dim text-[11px] font-semibold mb-1.5 tracking-wide">CONFIRMAR SENHA</label>
          <input id="reset-password-confirm" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} placeholder="Repita a senha" className={inpClass} />
        </div>
        {err && <div role="alert" className="bg-safe-danger/10 border border-safe-danger/25 rounded-xl py-2.5 px-3.5 text-safe-danger text-[13px]">{err}</div>}
        <button type="submit" disabled={loading} className="rounded-xl text-white py-3.5 text-sm font-semibold bg-gradient-to-br from-safe-primary to-safe-primaryD cursor-pointer disabled:cursor-wait disabled:opacity-70">
          {loading ? "Salvando..." : "Salvar nova senha"}
        </button>
        <button type="button" onClick={() => onDone("")} className="bg-transparent border-none p-0 text-[13px] text-safe-secondary cursor-pointer font-semibold hover:underline">
          Voltar para o login
        </button>
      </form>
    </div>
  );
}
