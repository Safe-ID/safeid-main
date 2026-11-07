import { useRef } from "react";
import CometSky from "./CometSky";
import LockMark from "./LockMark";

/**
 * Card de cabeçalho das telas logadas: o céu de cometas da página inicial em volta do cadeado
 * da marca. As props do céu (`ordered`, `celebrate`, `capture`, `speed`) e do cadeado
 * (`locked`, `orbits`) passam direto; `skyClass` ajusta o brilho do fundo.
 * `lockSide`: "left" põe o cadeado à esquerda, centralizado na altura, ao lado do texto;
 * "corner" (padrão) o deixa no canto inferior direito.
 * `status` é anunciado aos leitores de tela (o céu é só decoração).
 */
export default function SkyHeader({
  ordered = true,
  celebrate = false,
  capture = false,
  speed = 1,
  locked = true,
  // Os astros do céu já orbitam o cadeado: os arcos fixos dele ficariam sobrando no card
  orbits = false,
  lockSide = "corner",
  skyClass = "opacity-75",
  status = "",
  className = "",
  children,
}) {
  const lockRef = useRef(null);
  const left = lockSide === "left";
  const lock = (
    <div
      ref={lockRef}
      className={
        left
          ? "shrink-0 ml-2 sm:ml-3 w-10 h-12 sm:w-12 sm:h-14"
          : "absolute right-6 bottom-6 sm:right-7 w-9 h-11 sm:w-12 sm:h-14"
      }
    >
      <LockMark orbits={orbits} locked={locked} className="w-full h-full" />
    </div>
  );

  return (
    <div className={`relative isolate overflow-hidden mb-8 animate-slide-up rounded-3xl border border-safe-borderL bg-safe-card/70 px-5 py-6 sm:px-8 sm:py-8 ${className}`}>
      <CometSky
        ordered={ordered}
        celebrate={celebrate}
        capture={capture}
        speed={speed}
        subtle
        anchorRef={lockRef}
        burst={false}
        radius={52}
        className={`-z-10 transition-opacity duration-700 ${skyClass}`}
      />
      <span className="sr-only" role="status">{status}</span>
      {left ? (
        // A órbita precisa de folga em volta do cadeado: o texto começa depois dela
        <div className="flex items-center gap-8 sm:gap-12">
          {lock}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        <>
          {lock}
          {/* Espaço à direita para o texto não passar por baixo do cadeado */}
          <div className="min-w-0 pr-16 sm:pr-24">{children}</div>
        </>
      )}
    </div>
  );
}
