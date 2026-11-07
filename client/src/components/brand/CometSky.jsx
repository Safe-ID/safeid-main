import { useEffect, useRef } from "react";

const GLOW = "111,227,180";
const GLOW_RGB = [111, 227, 180];
// Cores dos cometas soltos (resgatados): ao entrar na órbita, eles vão ficando verdes como a marca
const STRAY_COLORS = [
  [125, 211, 252], // azul
  [196, 181, 253], // lilás
  [252, 211, 77], // âmbar
  [249, 168, 212], // rosa
  [111, 227, 180], // verde
];
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",");

function rnd(a, b) { return a + Math.random() * (b - a); }
function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
const canAnimate = () =>
  typeof window !== "undefined" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Céu estrelado com cometas vindos de todas as direções, desenhado em canvas.
 * Com `ordered`, os cometas se reúnem em órbitas ao redor do elemento de `anchorRef`
 * (o cadeado), com uma leva extra de feixes que gira rápido, brilha e é absorvida.
 * `radius` fixa o raio das órbitas em px (padrão: proporcional à tela).
 * `onSettled(true|false)` avisa quando a reunião termina, para trancar o cadeado.
 * `celebrate`: cada vez que passa a `true`, as órbitas dão um giro rápido com brilho de ~2 s,
 * assim que estiverem formadas (celebração do resultado). `speed` multiplica a
 * velocidade da órbita contínua (1 = normal; menor = mais calma). `capture`: depois disso,
 * de tempos em tempos um cometa solto cruza o céu e é resgatado para a órbita (monitoramento).
 * `subtle`: versão para cards (menos astros, traços finos e suaves, captura mais lenta e até
 * 6 cometas resgatados ao mesmo tempo, vindos de todas as bordas).
 * Só decoração: o canvas fica escondido dos leitores de tela. Quem pediu menos movimento
 * no sistema vê o céu parado e, se `ordered`, as órbitas já formadas.
 */
export default function CometSky({ ordered = false, anchorRef, burst = true, radius, onSettled, celebrate = false, speed = 1, capture = false, subtle = false, className = "" }) {
  const canvasRef = useRef(null);
  const orderedRef = useRef(ordered);
  const settledCb = useRef(onSettled);
  const noCanvas = useRef(false);
  const speedRef = useRef(speed);
  const pulseReq = useRef(false);
  const captureRef = useRef(capture);

  useEffect(() => { orderedRef.current = ordered; }, [ordered]);
  useEffect(() => { settledCb.current = onSettled; }, [onSettled]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { captureRef.current = capture; }, [capture]);
  useEffect(() => { if (celebrate) pulseReq.current = true; }, [celebrate]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext?.("2d");
    noCanvas.current = !ctx;
    if (!cv || !ctx) { settledCb.current?.(orderedRef.current); return undefined; } // jsdom e navegadores sem canvas

    const animate = canAnimate();
    // Modo card: espessura, brilho, brilho do fundo, máximo de resgatados e tempo da captura (s)
    const LW = subtle ? 0.55 : 1, AL = subtle ? 0.7 : 1, GL = subtle ? 0.6 : 1;
    const MAX_STRAYS = subtle ? 6 : 3, GLIDE = subtle ? 1.9 : 1.3;
    let W = 0, H = 0, cx = 0, cy = 0, R = 0, T = 0, last = 0, raf = 0;
    let stars = [], beams = [], order = orderedRef.current ? 1 : 0, orderedAt = null, settled = null, pulseAt = null;
    let strays = [], nextStrayAt = null, catchFlashAt = null;
    let visible = true;

    const spawn = (b, initial) => {
      const a = rnd(0, Math.PI * 2), k = W < 640 ? 0.7 : 1;
      b.dx = Math.cos(a); b.dy = Math.sin(a);
      b.speed = rnd(380, 720) * k; b.len = rnd(90, 220) * k; b.w = rnd(1.6, 2.8);
      b.life = rnd(0.7, 1.3); b.age = initial ? -rnd(0, 4) : -rnd(0.2, 3.2);
      const mx = rnd(0.05, 0.95) * W, my = rnd(0.05, 0.95) * H, half = (b.speed * b.life) / 2;
      b.hx = mx - b.dx * half; b.hy = my - b.dy * half;
    };
    const makeBeam = (ring, extra) => {
      const b = { r: 0.42 + ring * 0.16 + rnd(-0.04, 0.04), th: rnd(0, 6.283), arc: rnd(0.35, 0.95), sp: (0.22 + ring * 0.05) * (ring % 2 ? -1 : 1), delay: rnd(0, 0.35), extra };
      if (extra) {
        const phi = rnd(0, 6.283), far = Math.hypot(W, H) * 0.6;
        b.w = rnd(1.4, 2.6); b.len = rnd(120, 260);
        b.dx = -Math.cos(phi); b.dy = -Math.sin(phi);
        b.hx = cx + Math.cos(phi) * far; b.hy = cy + Math.sin(phi) * far;
        b.r = rnd(0.3, 1.05); b.arc = rnd(0.5, 1.3); b.sp *= 1.6; b.delay = rnd(0, 0.25); b.absorb = rnd(0, 0.9);
      } else spawn(b, true);
      return b;
    };
    // Cometa solto: entra por uma borda qualquer, com cor própria, cruza o céu rumo a um ponto
    // do meio e é capturado ali
    const makeStray = (wait) => {
      const k = W < 640 ? 0.7 : 1, speed = rnd(340, 500) * k;
      const edge = ["left", "top", "right", "bottom"][Math.floor(Math.random() * 4)];
      const sx = edge === "left" ? -0.04 * W : edge === "right" ? 1.04 * W : rnd(0.05, 0.8) * W;
      const sy = edge === "top" ? -0.06 * H : edge === "bottom" ? 1.06 * H : rnd(0.1, 0.85) * H;
      const tx = rnd(0.3, 0.68) * W, ty = rnd(0.25, 0.75) * H;
      const dist = Math.hypot(tx - sx, ty - sy) || 1;
      const b = {
        stray: true, caught: false, age: -wait,
        dx: (tx - sx) / dist, dy: (ty - sy) / dist, speed, len: rnd(110, 190) * k, w: rnd(1.8, 2.8),
        hx: sx, hy: sy, color: STRAY_COLORS[Math.floor(Math.random() * STRAY_COLORS.length)],
        r: rnd(0.5, 0.95), arc: rnd(0.5, 0.9), sp: rnd(0.24, 0.34), th: 0,
      };
      b.catchAt = Math.max(0.35, Math.min(2, dist / speed));
      b.ttl = b.catchAt + rnd(5, 7);
      return b;
    };

    const measure = () => {
      const d = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth; H = cv.clientHeight;
      if (!W || !H) return;
      cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
      const box = cv.getBoundingClientRect(), anchor = anchorRef?.current?.getBoundingClientRect();
      cx = anchor ? anchor.left - box.left + anchor.width / 2 : W / 2;
      cy = anchor ? anchor.top - box.top + anchor.height / 2 : H * 0.36;
      R = radius ?? Math.min(W * 0.44, H * 0.27);
      stars = Array.from({ length: Math.round((W * H) / 9000) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: rnd(0.3, 1.1), a: rnd(0.15, 0.6), f: rnd(0.3, 1.4), p: rnd(0, 6.28) }));
      beams = []; strays = [];
      const count = Math.round((W < 640 ? 34 : 52) * (subtle ? 0.3 : 1)), extras = burst ? (W < 640 ? 60 : 110) : 0;
      for (let j = 0; j < count; j++) beams.push(makeBeam(j % 4, false));
      for (let j = 0; j < extras; j++) beams.push(makeBeam(j % 4, true));
    };

    const draw = (dt) => {
      T += dt;
      const target = orderedRef.current ? 1 : 0;
      if (!animate) order = target;
      else {
        const sp = target > order ? 0.55 : 0.9;
        order += target - order > 0 ? Math.min(target - order, dt * sp) : Math.max(target - order, -dt * sp);
      }
      const isSettled = order > 0.88;
      if (isSettled !== settled) { settled = isSettled; settledCb.current?.(isSettled); }
      if (order >= 0.999) { if (orderedAt === null) orderedAt = animate ? T : -10; } else orderedAt = null;
      const since = orderedAt === null ? 0 : T - orderedAt;
      // Celebração pedida por `celebrate`: espera as órbitas se formarem para começar
      if (pulseReq.current && orderedAt !== null) { pulseReq.current = false; pulseAt = T; }
      const settleRush = orderedAt === null ? 0 : Math.max(0, 1 - since / 1.6);
      const pulseRush = pulseAt === null ? 0 : Math.max(0, 1 - (T - pulseAt) / 2);
      // Giro acelerado e brilho extra durante a reunião (ou a celebração), que acalmam depois
      const rush = animate ? 4 * order * (1 - order) + Math.max(settleRush, pulseRush) : 0;

      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        ctx.fillStyle = `rgba(220,230,255,${(s.a * (0.6 + 0.4 * Math.sin(T * s.f + s.p))).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
      // Brilho em volta do cadeado: mais forte na reunião, na celebração e a cada resgate
      const flash = catchFlashAt === null ? 0 : Math.max(0, 1 - (T - catchFlashAt) / 0.9);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
      g.addColorStop(0, `rgba(${GLOW},${((0.04 + 0.13 * order + 0.12 * rush + 0.16 * flash) * GL).toFixed(3)})`);
      g.addColorStop(1, `rgba(${GLOW},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      const N = 14;
      // Rastro de um cometa: `e` mistura a trajetória livre (0) com a órbita em volta do cadeado (1)
      const trail = (b, e, alpha, rr, boost, color = GLOW) => {
        alpha = Math.min(1, alpha * (1 + 0.8 * boost)) * AL;
        const wMul = (1 + 0.6 * boost) * LW, dir = b.sp > 0;
        let px = 0, py = 0;
        for (let m = 0; m <= N; m++) {
          const u = m / N;
          const chx = b.hx - b.dx * b.len * (1 - u), chy = b.hy - b.dy * b.len * (1 - u);
          const t = b.th + (dir ? u : 1 - u) * b.arc;
          const x = chx + (cx + Math.cos(t) * rr - chx) * e, y = chy + (cy + Math.sin(t) * rr - chy) * e;
          if (m) {
            ctx.strokeStyle = `rgba(${color},${(alpha * u * u).toFixed(3)})`;
            ctx.lineWidth = b.w * wMul * (0.25 + u);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          }
          px = x; py = y;
        }
        const hr = b.w * wMul * 4, hg = ctx.createRadialGradient(px, py, 0, px, py, hr);
        hg.addColorStop(0, `rgba(245,250,255,${(alpha * 0.9).toFixed(3)})`);
        hg.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(px, py, hr, 0, 6.283); ctx.fill();
      };

      for (const b of beams) {
        b.th += b.sp * dt * ((0.3 + 0.7 * order) * speedRef.current + 7 * rush);
        const e = ease(Math.max(0, Math.min(1, (order - b.delay) / 0.65)));
        let alpha, rr = R * b.r;
        if (b.extra) {
          const ab = Math.max(0, Math.min(1, (since - b.absorb) / 0.7));
          alpha = animate ? e * (1 - ab) : 0;
          rr = R * (b.r * (1 - ab) + 0.12 * ab);
        } else {
          if (animate) {
            b.age += dt;
            if (b.age > 0) { b.hx += b.dx * b.speed * dt; b.hy += b.dy * b.speed * dt; }
            if (b.age > b.life) spawn(b, false);
          }
          const lifeA = b.age > 0 ? Math.sin(Math.PI * Math.min(1, b.age / b.life)) : 0;
          alpha = lifeA * (1 - e) + e * 0.85;
        }
        if (alpha < 0.01) continue;
        trail(b, e, alpha, rr, rush);
      }

      // `capture`: com as órbitas formadas e a celebração terminada, de tempos em tempos
      // passa um cometa solto (às vezes dois) que é resgatado para a órbita do cadeado
      if (animate && captureRef.current && orderedAt !== null && settleRush === 0 && pulseRush === 0) {
        if (nextStrayAt === null) nextStrayAt = T + rnd(1.2, 2.4);
        else if (T >= nextStrayAt && strays.length < MAX_STRAYS) {
          // Leva de 1 a 3 (modo card) ou 1 a 2, chegando em sequência, sem passar do máximo
          const wave = subtle ? 1 + Math.floor(Math.random() * 3) : Math.random() < 0.35 ? 2 : 1;
          for (let i = 0; i < Math.min(wave, MAX_STRAYS - strays.length); i++) strays.push(makeStray(i * rnd(0.3, 0.9)));
          nextStrayAt = T + (subtle ? rnd(2.5, 4.5) : rnd(4, 7));
        }
      } else nextStrayAt = null;

      for (let i = strays.length - 1; i >= 0; i--) {
        const b = strays[i];
        b.age += dt;
        if (b.age < 0) continue;
        if (b.age > b.ttl + 1.2) { strays.splice(i, 1); continue; }
        b.hx += b.dx * b.speed * dt; b.hy += b.dy * b.speed * dt;
        if (!b.caught && b.age >= b.catchAt) {
          // Captura: entra na órbita no ângulo em que está e no sentido em que vinha
          b.caught = true; catchFlashAt = T;
          const rx = b.hx - cx, ry = b.hy - cy, ang = Math.atan2(ry, rx);
          b.sp = Math.abs(b.sp) * (rx * b.dy - ry * b.dx >= 0 ? 1 : -1);
          b.th = b.sp > 0 ? ang - b.arc : ang;
        }
        if (b.caught) b.th += b.sp * dt * (0.3 + 0.7 * order) * speedRef.current;
        const e = b.caught ? ease(Math.min(1, (b.age - b.catchAt) / GLIDE)) : 0;
        const fadeIn = Math.min(1, b.age / 0.3);
        const fadeOut = 1 - Math.max(0, Math.min(1, (b.age - b.ttl) / 1.2));
        const catchGlow = b.caught ? Math.max(0, 1 - (b.age - b.catchAt) / 0.8) : 0;
        // Resgatado, o cometa vai ganhando a cor da marca: o dado passou a ser vigiado
        trail(b, e, 0.95 * fadeIn * fadeOut, R * b.r, (subtle ? 0.3 : 0.6) * catchGlow, mixRgb(b.color, GLOW_RGB, e));
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const loop = (now) => {
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      draw(dt);
      raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const resume = () => { if (animate && !raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(loop); } };

    measure();
    if (animate) resume(); else draw(0);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { measure(); if (!animate) draw(0); }) : null;
    ro?.observe(cv);
    // Fora da tela ou com a aba escondida, a animação para (bateria e CPU)
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); })
      : null;
    io?.observe(cv);
    const onVisibility = () => resume();
    document.addEventListener("visibilitychange", onVisibility);
    // Sem animação, o desenho muda só quando `ordered` muda
    let poll = 0;
    if (!animate) poll = window.setInterval(() => draw(0), 400);

    return () => {
      cancelAnimationFrame(raf); raf = 0;
      ro?.disconnect(); io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(poll);
    };
  }, [anchorRef, burst, radius, subtle]);

  // Sem canvas não há animação para esperar: a reunião "termina" na hora
  useEffect(() => { if (noCanvas.current) settledCb.current?.(ordered); }, [ordered]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`absolute inset-0 w-full h-full ${className}`} />;
}
