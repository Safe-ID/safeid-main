import { useState } from "react";
import { C } from "./safeidData";

export default function Auth({ mode, onSuccess, onSwitch }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [conf, setConf] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const isReg = mode === "register";

  const submit = async () => {
    setErr("");
    if (isReg) {
      if (name.trim().length < 2) { setErr("Insira seu nome completo."); return; }
      if (!email.includes("@")) { setErr("Email inválido."); return; }
      if (pass.length < 6) { setErr("Senha deve ter pelo menos 6 caracteres."); return; }
      if (pass !== conf) { setErr("As senhas não coincidem."); return; }
    } else {
      if (!email.includes("@") || !pass) { setErr("Preencha todos os campos."); return; }
    }
    setLoading(true);
    await new Promise(r => setTimeout(r, 900));
    setLoading(false);
    onSuccess({ name: isReg ? name.trim() : email.split("@")[0], email: email.trim() });
  };

  const inp = {
    width: "100%", background: "#040C1A", border: `1px solid ${C.border}`,
    borderRadius: 10, color: C.text, padding: "12px 14px",
    fontSize: 14, fontFamily: "inherit", outline: "none", transition: "border-color 0.2s",
  };

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
      <div style={{ width: "100%", maxWidth: 420, animation: "slideUp 0.4s ease" }}>
        <div style={{
          background: C.bgCard, border: `1px solid ${C.borderL}`,
          borderRadius: 20, padding: "36px 32px", boxShadow: `0 0 60px ${C.primary}0D`,
        }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: `linear-gradient(135deg,${C.primary},${C.secondary})`,
              display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
            }}>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="white">
                <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
              </svg>
            </div>
            <h2 style={{ color: C.text, fontSize: 22, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6, fontFamily: "system-ui,sans-serif" }}>
              {isReg ? "Criar sua conta" : "Entrar no SafeID"}
            </h2>
            <p style={{ color: C.dim, fontSize: 13 }}>
              {isReg ? "Monitore sua identidade digital gratuitamente" : "Bem-vindo de volta"}
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {isReg && (
              <div>
                <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>NOME COMPLETO</div>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Seu nome completo" style={inp}
                  onFocus={e => e.target.style.borderColor = C.primary}
                  onBlur={e => e.target.style.borderColor = C.border}
                  onKeyDown={e => e.key === "Enter" && submit()} />
              </div>
            )}
            <div>
              <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>EMAIL</div>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com" style={inp}
                onFocus={e => e.target.style.borderColor = C.primary}
                onBlur={e => e.target.style.borderColor = C.border}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            <div>
              <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>SENHA</div>
              <input type="password" value={pass} onChange={e => setPass(e.target.value)}
                placeholder={isReg ? "Mínimo 6 caracteres" : "••••••••"} style={inp}
                onFocus={e => e.target.style.borderColor = C.primary}
                onBlur={e => e.target.style.borderColor = C.border}
                onKeyDown={e => e.key === "Enter" && submit()} />
            </div>
            {isReg && (
              <div>
                <div style={{ color: C.dim, fontSize: 11, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 }}>CONFIRMAR SENHA</div>
                <input type="password" value={conf} onChange={e => setConf(e.target.value)}
                  placeholder="Repita a senha" style={inp}
                  onFocus={e => e.target.style.borderColor = C.primary}
                  onBlur={e => e.target.style.borderColor = C.border}
                  onKeyDown={e => e.key === "Enter" && submit()} />
              </div>
            )}

            {err && (
              <div style={{ background: "#F8717115", border: "1px solid #F8717140", borderRadius: 8, padding: "10px 14px", color: C.danger, fontSize: 13 }}>
                {err}
              </div>
            )}

            <button onClick={submit} disabled={loading} style={{
              background: loading ? C.border : `linear-gradient(135deg,${C.primary},${C.primaryD})`,
              border: "none", borderRadius: 10, color: "#fff", padding: "13px",
              fontSize: 14, fontWeight: 600, cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "all 0.2s", boxShadow: loading ? "none" : `0 0 20px ${C.primary}33`, marginTop: 4,
            }}>
              {loading
                ? <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #ffffff40", borderTopColor: "#fff", animation: "spin 0.8s linear infinite" }} />{isReg ? "Criando conta..." : "Entrando..."}</>
                : (isReg ? "Criar conta e verificar" : "Entrar")}
            </button>

            <div style={{ textAlign: "center", color: C.dim, fontSize: 13 }}>
              {isReg ? "Já tem uma conta? " : "Não tem conta? "}
              <span onClick={onSwitch} style={{ color: C.secondary, cursor: "pointer", fontWeight: 600 }}>
                {isReg ? "Entrar" : "Criar conta grátis"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
