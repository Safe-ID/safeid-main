/** Endereço que não existe: o CloudFront devolve o index.html para qualquer caminho */
export default function NotFound({ onBack }) {
  return (
    <div className="min-h-[calc(100vh-60px)] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[420px] bg-safe-card border border-safe-borderL rounded-2xl p-6 sm:p-8 text-center animate-slide-up">
        <h1 className="text-safe-text text-xl sm:text-2xl font-bold tracking-tight mb-2">Página não encontrada</h1>
        <p className="text-safe-muted text-sm leading-relaxed mb-5">O endereço aberto não existe ou mudou de lugar.</p>
        <button type="button" onClick={onBack} className="rounded-xl text-white py-3 px-5 text-sm font-semibold bg-gradient-to-br from-safe-primary to-safe-primaryD cursor-pointer">
          Voltar para o início
        </button>
      </div>
    </div>
  );
}
