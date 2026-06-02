export default function Navbar({ user, onSignOut, onNav }) {
  const initial = user?.email?.charAt(0)?.toUpperCase() || "U";
  const displayName = user?.email || "Convidado";

  return (
    <nav className="w-full flex items-center justify-between py-4 px-6 md:px-12 border-b border-safe-border bg-safe-bg/90 backdrop-blur-md sticky top-0 z-50">
      <div onClick={() => onNav("landing")} className="flex items-center gap-3 cursor-pointer">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-safe-primary to-safe-secondary flex items-center justify-center">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="white">
            <path d="M8 1L2 3.5v4C2 11 5 14 8 15c3-1 6-4 6-7.5v-4L8 1z" />
          </svg>
        </div>
        <span className="font-bold text-lg tracking-tight text-safe-text">
          Safe<span className="text-safe-secondary">ID</span>
        </span>
      </div>

      <div className="flex gap-3 items-center">
        {!user ? (
          <>
            <button onClick={() => onNav("login")} className="bg-transparent border border-safe-borderL rounded-lg text-safe-muted py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-hover">
              Entrar
            </button>
            <button onClick={() => onNav("register")} className="bg-gradient-to-br from-safe-primary to-safe-primaryD border-none rounded-lg text-white py-2 px-4 text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90">
              Criar conta
            </button>
          </>
        ) : (
          <>
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-safe-primary to-safe-secondary flex items-center justify-center text-xs font-bold text-white">
                {initial}
              </div>
              <span className="text-safe-muted text-sm">{displayName}</span>
            </div>
            <button onClick={onSignOut} className="bg-transparent border border-safe-border rounded-lg text-safe-dim py-2 px-4 text-sm cursor-pointer transition-colors hover:bg-safe-hover hover:text-safe-muted">
              Sair
            </button>
          </>
        )}
      </div>
    </nav>
  );
}