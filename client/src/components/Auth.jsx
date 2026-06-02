import { useState } from "react";
import { clearToken, login, setToken, signup } from "../lib/api";

export default function Auth({ mode, onSuccess, onSwitch }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [conf, setConf] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const isReg = mode === "register";

  const submit = async () => {
    setErr("");
    if (!email.includes("@")) { setErr("Email inválido."); return; }
    if (pass.length < 8) { setErr("Senha deve ter pelo menos 8 caracteres."); return; }
    if (isReg && pass !== conf) { setErr("As senhas não coincidem."); return; }

    try {
      setLoading(true);
      clearToken();
      const payload = isReg ? await signup(email.trim(), pass) : await login(email.trim(), pass);
      if (payload?.access_token) {
        setToken(payload.access_token);
      }
      onSuccess(payload.user);
    } catch (error) {
      setErr(error.message || "Não foi possível autenticar.");
    } finally {
      setLoading(false);
    }
  };

  const inpClass = "w-full bg-[#040C1A] border border-safe-border rounded-xl text-safe-text py-3 px-3.5 text-sm outline-none transition-colors focus:border-safe-primary";

  return (
    <div className="min-h-[calc(100vh-60px)] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[420px] animate-slide-up">
        <div className="bg-safe-card border border-safe-borderL rounded-2xl p-6 sm:p-8 shadow-[0_0_60px_rgba(26,111,255,0.05)]">
          <div className="text-center mb-7">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-safe-primary to-safe-secondary flex items-center justify-center mx-auto mb-4">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="white">
                <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
              </svg>
            </div>
            <h2 className="text-safe-text text-xl sm:text-2xl font-bold tracking-tight mb-1.5 font-[system-ui,sans-serif]">
              {isReg ? "Criar sua conta" : "Entrar no SafeID"}
            </h2>
            <p className="text-safe-dim text-[13px]">
              {isReg ? "Monitore sua identidade digital gratuitamente" : "Bem-vindo de volta"}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <div className="text-safe-dim text-[11px] font-semibold mb-1.5 tracking-wide">EMAIL</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" className={inpClass}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            <div>
              <div className="text-safe-dim text-[11px] font-semibold mb-1.5 tracking-wide">SENHA</div>
              <input type="password" value={pass} onChange={e => setPass(e.target.value)}
                placeholder={isReg ? "Mínimo 8 caracteres" : "••••••••"} className={inpClass}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            {isReg && (
              <div>
                <div className="text-safe-dim text-[11px] font-semibold mb-1.5 tracking-wide">CONFIRMAR SENHA</div>
                <input type="password" value={conf} onChange={e => setConf(e.target.value)}
                  placeholder="Repita a senha" className={inpClass}
                  onKeyDown={e => e.key === "Enter" && submit()} />
              </div>
            )}

            {err && (
              <div className="bg-safe-danger/10 border border-safe-danger/25 rounded-xl py-2.5 px-3.5 text-safe-danger text-[13px]">
                {err}
              </div>
            )}

            <button onClick={submit} disabled={loading} 
              className={`mt-1 rounded-xl text-white py-3.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                loading ? "bg-safe-border cursor-wait" : "bg-gradient-to-br from-safe-primary to-safe-primaryD cursor-pointer shadow-[0_0_20px_rgba(26,111,255,0.2)] hover:shadow-[0_0_30px_rgba(26,111,255,0.3)]"
              }`}>
              {loading
                ? <><div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />{isReg ? "Criando conta..." : "Entrando..."}</>
                : (isReg ? "Criar conta e verificar" : "Entrar")}
            </button>

            <div className="text-center text-safe-dim text-[13px] mt-2">
              {isReg ? "Já tem uma conta? " : "Não tem conta? "}
              <span onClick={onSwitch} className="text-safe-secondary cursor-pointer font-semibold hover:underline">
                {isReg ? "Entrar" : "Criar conta grátis"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}