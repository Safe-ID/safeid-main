import CometSky from "./brand/CometSky";
import LockMark from "./brand/LockMark";

/** Endereço que não existe: o CloudFront devolve o index.html para qualquer caminho */
export default function NotFound({ onBack }) {
  return (
    <div className="relative isolate min-h-[calc(100svh-64px)] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
      <CometSky burst={false} className="-z-10" />
      <div className="w-full max-w-[420px] bg-safe-card/85 backdrop-blur-md border border-safe-borderL rounded-2xl p-6 sm:p-8 text-center animate-slide-up">
        <LockMark locked={false} className="w-11 h-[52px] mx-auto mb-5" />
        <h1 className="text-safe-text text-xl sm:text-2xl font-serif font-medium tracking-tight mb-2">Página não encontrada</h1>
        <p className="text-safe-muted text-sm leading-relaxed mb-5">O endereço aberto não existe ou mudou de lugar.</p>
        <button type="button" onClick={onBack} className="rounded-full text-white py-3 px-6 text-sm font-semibold bg-safe-primary hover:bg-safe-primaryD cursor-pointer transition-colors">
          Voltar para o início
        </button>
      </div>
    </div>
  );
}
