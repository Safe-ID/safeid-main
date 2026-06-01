import { useState, useEffect, useRef } from "react";
import { C } from "./safeidData";

export default function RiskCircle({ val, size }) {
  const sz = size || 220;
  const [anim, setAnim] = useState(0);
  const raf = useRef();

  useEffect(() => {
    let start = null;
    const dur = 1800;
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = ts => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      setAnim(ease(p) * val);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [val]);

  const r = sz * 0.37;
  const cx = sz / 2, cy = sz / 2;
  const rad = d => d * Math.PI / 180;
  const S = -218, TOTAL = 256;
  const pathD = (a, sw) => {
    const a2 = a + sw;
    const x1 = cx + r * Math.cos(rad(a)), y1 = cy + r * Math.sin(rad(a));
    const x2 = cx + r * Math.cos(rad(a2)), y2 = cy + r * Math.sin(rad(a2));
    const lg = Math.abs(sw) > 180 ? 1 : 0;
    return `M${x1} ${y1} A${r} ${r} 0 ${lg} 1 ${x2} ${y2}`;
  };

  const filled = (anim / 100) * TOTAL;
  const col = anim < 35 ? C.accent : anim < 65 ? C.warn : C.danger;
  const lbl = val === 0 ? "SEGURO" : val < 35 ? "BAIXO" : val < 65 ? "MÉDIO" : "ALTO";
  const sw = sz * 0.057;
  const ticks = Array.from({ length: 21 }, (_, i) => i);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg width={sz} height={sz * 0.86} viewBox={`0 0 ${sz} ${sz * 0.86}`} style={{ overflow: "visible" }}>
        {ticks.map(i => {
          const deg = S + (i / 20) * TOTAL;
          const ir = r - 9, or = r - 2;
          const x1 = cx + ir * Math.cos(rad(deg)), y1 = cy + ir * Math.sin(rad(deg));
          const x2 = cx + or * Math.cos(rad(deg)), y2 = cy + or * Math.sin(rad(deg));
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={(i / 20) * 100 <= anim ? col : C.border}
              strokeWidth={i % 5 === 0 ? 2 : 1} strokeLinecap="round" />
          );
        })}
        <path d={pathD(S, TOTAL)} fill="none" stroke={C.border} strokeWidth={sw} strokeLinecap="round" />
        {anim > 0 && (
          <>
            <path d={pathD(S, filled)} fill="none" stroke={col} strokeWidth={sw + 6} strokeLinecap="round" opacity="0.1" />
            <path d={pathD(S, filled)} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 8px ${col}99)` }} />
          </>
        )}
        <circle cx={cx} cy={cy} r={r - sw * 1.8} fill="none" stroke={C.border} strokeWidth="1" opacity="0.4" />
        <text x={cx} y={cy - 4} textAnchor="middle" fill={col}
          fontSize={sz * 0.19} fontWeight="700" fontFamily="system-ui,sans-serif">
          {Math.round(anim)}
        </text>
        <text x={cx} y={cy + sz * 0.1} textAnchor="middle" fill={C.dim}
          fontSize={sz * 0.05} letterSpacing="2" fontFamily="system-ui,sans-serif">
          RISK SCORE
        </text>
      </svg>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        background: `${col}18`, border: `1px solid ${col}40`,
        borderRadius: 999, padding: "5px 16px",
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: col, display: "inline-block", boxShadow: `0 0 6px ${col}` }} />
        <span style={{ color: col, fontSize: 12, fontWeight: 700, letterSpacing: "1.5px" }}>{lbl}</span>
      </div>
    </div>
  );
}
