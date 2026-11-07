import { useEffect, useState } from "react";
import { RISK_LEVELS } from "../safeidData";

// Sem animação: quem pediu menos movimento, e ambientes sem IntersectionObserver (testes)
const reduced = () =>
  typeof IntersectionObserver === "undefined" || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const SYMBOLS = "ABCDEF0123456789#$%&*@";
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[(Math.random() * 16) | 0]).join("");

/** Letras embaralhadas que se "decifram" uma a uma até formar a palavra */
export function CipherWord({ word, run, delay = 0 }) {
  const [state, setState] = useState(() => ({ chars: word.split(""), locked: word.length, hash: "" }));

  useEffect(() => {
    if (!run || reduced()) return undefined;
    const start = performance.now();
    let timer = 0;
    const tick = () => {
      const t = (performance.now() - start) / 1000 - delay / 1000;
      let locked = 0;
      const chars = word.split("").map((letter, i) => {
        if (t >= 0.5 + i * 0.28) { locked++; return letter; }
        return SYMBOLS[(Math.random() * SYMBOLS.length) | 0];
      });
      setState({ chars, locked, hash: locked < word.length ? `sha256 ${hex(18)}` : "" });
      if (locked < word.length) timer = window.setTimeout(tick, 45);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [run, word, delay]);

  const done = state.locked === word.length;
  return (
    <>
      <span className="sr-only">{word}</span>
      <span aria-hidden="true" className="safe-cipher font-mono text-4xl font-medium tracking-[.06em] leading-none">
        {state.chars.map((c, i) => <span key={i} className={i < state.locked ? "is-ok" : ""}>{c}</span>)}
      </span>
      <span aria-hidden="true" className={`font-mono text-[11px] h-3.5 overflow-hidden ${done ? "text-safe-secondary" : "text-safe-dim"}`}>
        {done ? "consulta protegida" : state.hash}
      </span>
    </>
  );
}

// Os mesmos cinco níveis e cores do círculo de risco do painel
const LEVELS = RISK_LEVELS;

/** Termômetro que sobe pelos cinco níveis do score (os mesmos do RiskCircle) */
export function RiskThermometer({ run, delay = 0 }) {
  const [step, setStep] = useState(() => (reduced() ? LEVELS.length : -1));

  useEffect(() => {
    if (!run || reduced()) return undefined;
    let i = 0, timer = 0;
    const next = () => {
      setStep(i);
      if (i >= LEVELS.length) return;
      i++;
      timer = window.setTimeout(next, i < LEVELS.length ? 430 : 900);
    };
    timer = window.setTimeout(next, delay);
    return () => window.clearTimeout(timer);
  }, [run, delay]);

  const current = LEVELS[Math.min(step, LEVELS.length - 1)];
  const finished = step >= LEVELS.length;
  const width = step < 0 ? 0 : finished ? 100 : Math.max(4, current.value);
  return (
    <div className="w-full max-w-[260px]">
      <span className="sr-only">Escala de 0 a 100 com cinco níveis: Seguro, Baixo, Médio, Alto e Crítico.</span>
      <div aria-hidden="true">
        <div className="flex items-baseline justify-center gap-2 mb-2.5">
          <span className="font-mono text-[34px] font-medium leading-none">{step < 0 ? 0 : finished ? "0–100" : current.value}</span>
          {!finished && step >= 0 && <span className="text-[13px] min-w-14 text-left" style={{ color: current.color }}>{current.label}</span>}
        </div>
        <div className="relative h-3.5 rounded-full bg-safe-hover border border-safe-borderL overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
            style={{ width: `${width}%`, background: `linear-gradient(90deg,${LEVELS.map((l, i) => `${l.color} ${i * 25}%`).join(",")})` }}
          />
        </div>
        <div className="grid grid-cols-5 mt-2 text-[10.5px]">
          {LEVELS.map((level, i) => {
            const on = i <= step;
            return (
              <span key={level.label} className={`transition-colors ${on ? "text-safe-text" : "text-safe-dim"}`}>
                <span className="block w-1.5 h-1.5 rounded-full mx-auto mb-1" style={{ background: on ? level.color : "#2A3654" }} />
                {level.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Contagem regressiva rápida até zero */
export function Countdown({ run, from = 98765, delay = 0 }) {
  const [value, setValue] = useState(() => (reduced() ? 0 : from));

  useEffect(() => {
    if (!run || reduced()) return undefined;
    const start = performance.now() + delay, duration = 1300;
    let raf = 0;
    const tick = (now) => {
      const p = Math.max(0, Math.min(1, (now - start) / duration));
      setValue(Math.round(from * Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, from, delay]);

  return (
    <>
      <span className="sr-only">0</span>
      <span aria-hidden="true" className={`font-mono text-4xl font-medium leading-none tabular-nums ${value === 0 ? "text-safe-secondary" : ""}`}>
        {value.toLocaleString("pt-BR")}
      </span>
    </>
  );
}
