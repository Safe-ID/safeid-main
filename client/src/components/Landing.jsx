import { useEffect, useRef, useState } from "react";
import CometSky from "./brand/CometSky";
import LockMark from "./brand/LockMark";
import useReveal from "./brand/useReveal";
import { CipherWord, Countdown, RiskThermometer } from "./brand/StatAnimations";

const STEPS = [
  {
    n: "01", tag: "Consulta OSINT", title: "Procuramos seu email onde os vazamentos aparecem",
    desc: "Verificamos seu email nas bases públicas de vazamentos do Have I Been Pwned e mostramos quais serviços expuseram seus dados e quando.",
    noteTitle: "Por que importa", note: "Você só consegue reagir ao que sabe que aconteceu. A consulta mostra o que já está circulando.",
    icon: <><circle cx="21" cy="21" r="12" /><path d="M30 30l10 10" /></>,
  },
  {
    n: "02", tag: "Score de risco", title: "Um número de 0 a 100 que você consegue entender",
    desc: "Um algoritmo ponderado calcula a gravidade a partir dos tipos de dados expostos, da idade e da quantidade de vazamentos.",
    noteTitle: "Na prática", note: "Um vazamento recente com senha pesa mais do que um antigo que expôs só o email.",
    icon: <><path d="M8 36a16 16 0 0 1 32 0" /><path d="M24 36l8-12" /><circle cx="24" cy="36" r="2.5" /></>,
  },
  {
    n: "03", tag: "Plano com IA", title: "Um plano de ação em linguagem simples",
    desc: "Transformamos dados técnicos em passos claros: o que trocar, o que ativar e em que ordem. Dá para exportar em PDF ou tirar dúvidas com a IA.",
    noteTitle: "Privacidade", note: "A IA recebe apenas os tipos de dados expostos, nunca o seu email.",
    icon: <><rect x="10" y="8" width="28" height="34" rx="4" /><path d="M16 18h16M16 25h16M16 32h9" /></>,
  },
  {
    n: "04", tag: "Privacidade por design", title: "Seus dados tratados conforme a LGPD",
    desc: "Seu email é protegido com hash criptográfico e o monitoramento avisa quando surgir um novo vazamento.",
    noteTitle: "Seu controle", note: "Você pode excluir a conta e os seus dados a qualquer momento, direto pelo painel.",
    icon: <><path d="M24 6 10 12v10c0 10 6 16 14 20 8-4 14-10 14-20V12z" /><path d="M18 24l4 4 8-8" /></>,
  },
];

function Step({ step, reverse, last }) {
  const [ref, shown] = useReveal();
  return (
    <article
      ref={ref}
      className={`relative grid grid-cols-1 gap-4 mb-11 lg:items-center lg:gap-12 lg:mb-16 ${reverse ? "safe-step-rev lg:grid-cols-[1fr_172px]" : "lg:grid-cols-[172px_1fr]"} ${shown ? "is-in" : ""}`}
    >
      <div className={`safe-tile ${reverse ? "lg:order-2" : ""}`} aria-hidden="true">
        <i className="safe-q safe-q1" /><i className="safe-q safe-q2" /><i className="safe-q safe-q3" /><i className="safe-q safe-q4" />
        <div className="safe-face">
          <span className="font-serif text-2xl lg:text-3xl text-safe-secondary relative">{step.n}</span>
          <svg viewBox="0 0 48 48">{step.icon}</svg>
        </div>
      </div>
      <div className="safe-step-text">
        <p className="text-xs tracking-[.14em] uppercase text-safe-secondary">{step.tag}</p>
        <h3 className="font-serif font-medium text-[22px] lg:text-[26px] leading-tight mt-2 mb-2.5">{step.title}</h3>
        <p className="text-safe-muted text-[15.5px] leading-relaxed mb-3.5 max-w-[540px]">{step.desc}</p>
        <div className="max-w-[520px] border-l-2 border-safe-secondary py-2.5 pl-3.5 text-[14.5px] leading-relaxed bg-gradient-to-r from-safe-secondary/10 to-transparent">
          <strong className="block text-[11.5px] tracking-[.1em] uppercase text-safe-secondary font-semibold mb-1">{step.noteTitle}</strong>
          {step.note}
        </div>
      </div>
      {!last && (
        <span
          aria-hidden="true"
          className={`hidden lg:block absolute -bottom-14 h-12 w-px bg-gradient-to-b from-safe-accent to-transparent origin-top transition-transform duration-700 [transition-delay:2.2s] ${shown ? "scale-y-100" : "scale-y-0"} ${reverse ? "right-[86px]" : "left-[86px]"}`}
        />
      )}
    </article>
  );
}

export default function Landing({ onNav, overlapNav = true }) {
  const lockRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [settled, setSettled] = useState(false);
  const [statsRef, statsShown] = useReveal();
  const [finalRef, finalShown] = useReveal();

  // No primeiro movimento para baixo, os cometas se reúnem em volta do cadeado
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="w-full overflow-x-clip">
      {/* Capa: céu com cometas; ao rolar, eles orbitam o cadeado, que tranca */}
      <section className={`safe-cover ${overlapNav ? "-mt-16" : ""} ${settled ? "is-settled" : ""}`} aria-labelledby="landing-title">
        <div className="safe-pin">
          <CometSky ordered={scrolled} anchorRef={lockRef} onSettled={setSettled} />
          <div ref={lockRef} className="safe-cover-lock">
            <LockMark locked={settled} />
          </div>
          <div className="safe-lockup">
            <h1 id="landing-title" className="safe-lockup-phrase m-0 font-serif font-medium text-[21px] sm:text-[26px] lg:text-[32px] leading-tight tracking-[-.01em] max-w-[420px]">
              A informação que <em className="text-safe-secondary">protege</em> seus dados
            </h1>
            <span className="safe-lockup-div" aria-hidden="true" />
            <p className="safe-lockup-word m-0 font-semibold text-[38px] sm:text-[52px] lg:text-[62px] tracking-[-.03em] leading-none">
              Safe<span className="text-safe-secondary">ID</span>
            </p>
          </div>
          <div className="safe-hint absolute left-1/2 bottom-6 -translate-x-1/2 flex flex-col items-center gap-2.5 text-[11px] tracking-[.16em] uppercase text-safe-dim" aria-hidden="true">
            Role para baixo
            <i className="safe-hint-line" />
          </div>
        </div>
      </section>

      <div className="w-full max-w-[1080px] mx-auto px-5 sm:px-8">
        {/* Apresentação e chamadas */}
        <section className="relative -mt-[6vh] pb-16 text-center">
          <p className="text-safe-muted text-[17px] lg:text-[19px] leading-relaxed max-w-[620px] mx-auto mb-7">
            O SafeID verifica se seus dados aparecem em vazamentos públicos, mostra o tamanho do risco e entrega um plano de ação personalizado, para você recuperar o controle da sua identidade digital.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center items-stretch max-w-[340px] sm:max-w-none mx-auto">
            <button onClick={() => onNav("register")} className="bg-safe-primary hover:bg-safe-primaryD border-none rounded-full text-white py-3.5 px-7 text-[15px] font-semibold cursor-pointer transition-colors">
              Criar conta grátis
            </button>
            <button onClick={() => onNav("login")} className="bg-transparent border border-safe-borderL rounded-full text-safe-text py-3.5 px-7 text-[15px] cursor-pointer transition-colors hover:bg-safe-hover">
              Já tenho conta
            </button>
          </div>
          <p className="text-safe-dim text-[13px] mt-4">Gratuito · Sem cartão · Desenvolvido com base na LGPD</p>
        </section>

        {/* Sobre */}
        <section className="pt-14 pb-16 border-t border-safe-border text-center" aria-labelledby="sobre-titulo">
          <p className="text-xs tracking-[.14em] uppercase text-safe-secondary mb-3">Sobre o SafeID</p>
          <h2 id="sobre-titulo" className="font-serif font-medium text-3xl sm:text-[38px] lg:text-[44px] leading-tight tracking-[-.02em] max-w-[720px] mx-auto mb-4 [text-wrap:balance]">
            Transformamos vazamentos em informação que você entende e usa.
          </h2>
          <p className="text-safe-muted text-base leading-relaxed max-w-[640px] mx-auto mb-9">
            Seus dados pessoais podem estar expostos sem que você saiba. O SafeID consulta bases públicas de vazamentos, calcula um score de risco explicável de 0 a 100 e traduz o resultado em passos concretos, sem jargão técnico e sem enviar seu email para a IA.
          </p>
          <ul ref={statsRef} className={`safe-flaps grid grid-cols-1 sm:grid-cols-3 gap-3 list-none p-0 m-0 ${statsShown ? "is-in" : ""}`}>
            <li className="safe-flap bg-safe-card border border-safe-borderL rounded-2xl px-4 py-5 flex flex-col items-center justify-center gap-2.5 min-h-[168px]">
              <CipherWord word="HIBP" run={statsShown} delay={700} />
              <span className="text-sm text-safe-muted">Base de vazamentos consultada</span>
            </li>
            <li className="safe-flap bg-safe-card border border-safe-borderL rounded-2xl px-4 py-5 flex flex-col items-center justify-center gap-2.5 min-h-[168px]">
              <RiskThermometer run={statsShown} delay={950} />
              <span className="text-sm text-safe-muted">5 níveis no score de risco</span>
            </li>
            <li className="safe-flap bg-safe-card border border-safe-borderL rounded-2xl px-4 py-5 flex flex-col items-center justify-center gap-2.5 min-h-[168px]">
              <Countdown run={statsShown} delay={1200} />
              <span className="text-sm text-safe-muted">Emails enviados para a IA</span>
            </li>
          </ul>
        </section>

        {/* Como funciona */}
        <section className="pt-14 pb-6 border-t border-safe-border" aria-labelledby="como-titulo">
          <div className="text-center mb-10">
            <p className="text-xs tracking-[.14em] uppercase text-safe-secondary mb-3">Como funciona</p>
            <h2 id="como-titulo" className="font-serif font-medium text-3xl sm:text-[38px] lg:text-[44px] leading-tight tracking-[-.02em] max-w-[720px] mx-auto [text-wrap:balance]">
              Quatro blocos que transformam um vazamento em proteção.
            </h2>
          </div>
          {STEPS.map((step, i) => <Step key={step.n} step={step} reverse={i % 2 === 1} last={i === STEPS.length - 1} />)}

          <div ref={finalRef} className={`safe-rise flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between text-center sm:text-left bg-safe-card border border-safe-borderL rounded-[18px] px-5 py-6 sm:px-8 sm:py-7 mt-2 ${finalShown ? "is-in" : ""}`}>
            <div>
              <h2 className="font-serif font-medium text-2xl mb-1.5">Proteja sua identidade digital agora</h2>
              <p className="text-safe-muted text-[15px] m-0">Cadastre-se e descubra em segundos se seus dados foram comprometidos.</p>
            </div>
            <button onClick={() => onNav("register")} className="shrink-0 bg-safe-primary hover:bg-safe-primaryD border-none rounded-full text-white py-3.5 px-7 text-[15px] font-semibold cursor-pointer transition-colors">
              Começar gratuitamente
            </button>
          </div>
        </section>

        {/* Assinatura do projeto */}
        <section className="mt-14 pt-10 pb-6 border-t border-safe-border text-center" aria-label="Sobre o projeto">
          <p className="inline-flex items-center gap-2 font-semibold text-[22px] tracking-[-.02em] m-0">
            <LockMark className="w-6 h-7" />
            <span>Safe<span className="text-safe-secondary">ID</span></span>
          </p>
          <p className="font-serif font-medium text-[22px] lg:text-[28px] leading-snug max-w-[640px] mx-auto mt-3.5 mb-4 [text-wrap:balance]">
            Descubra o que vazou, entenda o risco e saiba exatamente o que fazer.
          </p>
          <p className="text-safe-muted text-sm leading-relaxed max-w-[620px] mx-auto m-0">
            Desenvolvido por acadêmicos do 6º semestre do curso de Análise e Desenvolvimento de Sistemas do Instituto Federal de Educação, Ciência e Tecnologia de São Paulo (IFSP).
          </p>
        </section>
      </div>
    </div>
  );
}
