export default function Landing({ onNav }) {
  return (
    <div className="w-full flex flex-col items-center overflow-x-hidden">
      {/* Hero Section */}
      <section className="w-full max-w-4xl flex flex-col items-center pt-20 px-6 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-safe-accent/10 border border-safe-accent/30 rounded-full py-1.5 px-4 mb-8 animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-safe-accent inline-block" />
          <span className="text-safe-accent text-xs font-semibold tracking-widest">
            MONITORAMENTO DE IDENTIDADE DIGITAL · BRASIL
          </span>
        </div>

        <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight mb-6 font-[system-ui,sans-serif] bg-gradient-to-br from-safe-text via-safe-text to-safe-secondary bg-clip-text text-transparent animate-slide-up [animation-delay:100ms]">
          Seus dados estão<br />nas mãos certas?
        </h1>

        <p className="text-safe-muted text-lg leading-relaxed max-w-xl mx-auto mb-12 animate-slide-up [animation-delay:200ms]">
          O SafeID monitora vazamentos de dados e entrega um plano de ação personalizado com IA — para que você recupere o controle da sua identidade digital.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto justify-center animate-slide-up [animation-delay:300ms]">
          <button onClick={() => onNav("register")} className="bg-gradient-to-br from-safe-primary to-safe-primaryD border-none rounded-xl text-white py-3.5 px-8 text-base font-semibold cursor-pointer shadow-[0_0_30px_rgba(26,111,255,0.25)] transition-all hover:brightness-110 w-full sm:w-auto">
            Criar conta grátis
          </button>
          <button onClick={() => onNav("login")} className="bg-safe-card border border-safe-borderL rounded-xl text-safe-muted py-3.5 px-8 text-base cursor-pointer transition-all hover:bg-safe-hover w-full sm:w-auto">
            Já tenho conta →
          </button>
        </div>
        <p className="text-safe-dim text-sm mt-6">🔒 Gratuito · Sem cartão · Conformidade LGPD</p>
      </section>

      {/* Content Section */}
      <section className="w-full max-w-4xl px-6 pb-20 mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-14">
          {[
            { val: "14B+", label: "Credenciais monitoradas", col: "text-safe-secondary" },
            { val: "780+", label: "Serviços verificados", col: "text-safe-accent" },
            { val: "99.9%", label: "Disponibilidade", col: "text-[#A78BFA]" },
          ].map(s => (
            <div key={s.label} className="bg-safe-card border border-safe-border rounded-2xl p-6 text-center">
              <div className={`${s.col} text-4xl font-bold tracking-tight`}>{s.val}</div>
              <div className="text-safe-dim text-sm mt-2">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="text-center mb-6">
          <span className="text-safe-dim text-xs font-semibold tracking-widest">COMO FUNCIONA</span>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-14">
          {[
            { n: "01", icon: "🔍", title: "Consulta OSINT", desc: "Verificamos seu email em +780 bases de vazamentos via Have I Been Pwned." },
            { n: "02", icon: "⚡", title: "Score de Risco", desc: "Algoritmo ponderado calcula a gravidade real com base na criticidade dos dados expostos." },
            { n: "03", icon: "✦", title: "IA Personalizada", desc: "Transformamos dados técnicos em um plano de ação claro, em linguagem acessível." },
          ].map((f, i) => (
             <div key={i} className="bg-safe-card border border-safe-border rounded-2xl p-6 transition-all duration-200 hover:border-safe-borderL hover:bg-safe-hover">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-safe-dim text-xs font-bold font-mono">{f.n}</span>
                <span className="text-2xl">{f.icon}</span>
              </div>
              <div className="text-safe-text font-semibold text-base mb-2">{f.title}</div>
              <div className="text-safe-dim text-sm leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>

        <div className="bg-gradient-to-br from-safe-card to-[#0B1E38] border border-safe-borderL rounded-3xl p-8 md:p-12 text-center w-full">
          <h2 className="text-safe-text text-2xl md:text-3xl font-bold tracking-tight mb-4 font-[system-ui,sans-serif]">
            Proteja sua identidade digital agora
          </h2>
          <p className="text-safe-muted text-base mb-8 max-w-lg mx-auto">
            Cadastre-se e descubra em segundos se seus dados foram comprometidos.
          </p>
          <button onClick={() => onNav("register")} className="bg-gradient-to-br from-safe-primary to-safe-primaryD border-none rounded-xl text-white py-3.5 px-10 text-base font-semibold cursor-pointer shadow-[0_0_30px_rgba(26,111,255,0.25)] transition-all hover:brightness-110 w-full sm:w-auto">
            Começar gratuitamente
          </button>
        </div>
      </section>
    </div>
  );
}