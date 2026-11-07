/**
 * Cadeado da marca SafeID. Aberto, a alça fica levantada; fechado, ela desce com um leve
 * efeito de mola. `orbits` desenha arcos de luz girando em volta (usado no login e na barra).
 * É decorativo: quem usa decide o texto acessível ao redor.
 */
export default function LockMark({ locked = true, orbits = false, className = "" }) {
  return (
    <svg viewBox="0 0 120 140" aria-hidden="true" focusable="false" className={`overflow-visible ${className}`}>
      {orbits && (
        <g className="safe-lock-orbits" fill="none" stroke="#6FE3B4" strokeLinecap="round">
          <path d="M60 -6a76 76 0 0 1 66 38" strokeWidth="2.4" opacity=".9" />
          <path d="M134 78a74 74 0 0 1-34 56" strokeWidth="2" opacity=".55" />
          <path d="M14 128A76 76 0 0 1-12 52" strokeWidth="2" opacity=".4" />
          <path d="M-4 30a80 80 0 0 1 22-24" strokeWidth="1.6" opacity=".3" />
        </g>
      )}
      <path
        className={`safe-lock-shackle ${locked ? "is-locked" : ""}`}
        d="M34 64V42a26 26 0 0 1 52 0v22"
        fill="none"
        stroke="#6FE3B4"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <rect x="16" y="62" width="88" height="70" rx="16" fill="#101829" stroke="#6FE3B4" strokeWidth="3" />
      <g className={`safe-lock-key ${locked ? "is-locked" : ""}`} fill="#6FE3B4">
        <circle cx="60" cy="90" r="8" />
        <path d="M56 94h8l2.5 18h-13z" />
      </g>
    </svg>
  );
}
