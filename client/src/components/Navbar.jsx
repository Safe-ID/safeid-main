import { C } from "./safeidData";

export default function Navbar({ user, onSignOut, onNav }) {
  return (
    <nav style={{
      padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: `1px solid ${C.border}`, background: `${C.bg}E0`,
      backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 100,
    }}>
      <div onClick={() => onNav("landing")} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `linear-gradient(135deg,${C.primary},${C.secondary})`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="white">
            <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
          </svg>
        </div>
        <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.5, color: C.text }}>
          Safe<span style={{ color: C.secondary }}>ID</span>
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!user ? (
          <>
            <button onClick={() => onNav("login")} style={{
              background: "transparent", border: `1px solid ${C.borderL}`,
              borderRadius: 8, color: C.muted, padding: "7px 16px",
              fontSize: 13, cursor: "pointer", fontFamily: "inherit",
            }}>Entrar</button>
            <button onClick={() => onNav("register")} style={{
              background: `linear-gradient(135deg,${C.primary},${C.primaryD})`,
              border: "none", borderRadius: 8, color: "#fff",
              padding: "8px 16px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>Criar conta</button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: `linear-gradient(135deg,${C.primary},${C.secondary})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: "#fff",
              }}>{user.name[0].toUpperCase()}</div>
              <span style={{ color: C.muted, fontSize: 13 }}>{user.name}</span>
            </div>
            <button onClick={onSignOut} style={{
              background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 8, color: C.dim, padding: "7px 14px",
              fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>Sair</button>
          </>
        )}
      </div>
    </nav>
  );
}
