"use client";
import { useState } from "react";

interface Bin { lo: number; hi: number; n: number; predicted: number; observed: number }
const SERIES = [
  { key: "cal", label: "Model skalibrowany", color: "var(--s1)", shape: "circle" },
  { key: "raw", label: "Model surowy", color: "var(--s2)", shape: "square" },
  { key: "market", label: "Rynek bez marży", color: "var(--s3)", shape: "diamond" },
] as const;

/** Reliability diagram: predicted probability (x) vs observed frequency (y); the diagonal is perfect calibration. */
export function ReliabilityChart({ data }: { data: Record<"cal" | "raw" | "market", Bin[]> }) {
  const [hover, setHover] = useState<{ s: string; b: Bin; x: number; y: number } | null>(null);
  const W = 420, H = 360, p = { l: 44, r: 16, t: 12, b: 40 };
  const x = (v: number) => p.l + v * (W - p.l - p.r);
  const y = (v: number) => H - p.b - v * (H - p.t - p.b);
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-2">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5"><svg width="12" height="12" aria-hidden><Marker shape={s.shape} cx={6} cy={6} color={s.color} r={4} /></svg>{s.label}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-ink-3" />Idealna kalibracja</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[520px]" role="img" aria-label="Wykres kalibracji" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={p.l - 6} y={y(t) + 4} fontSize={11} textAnchor="end" fill="var(--ink-3)">{t * 100}%</text>
            <text x={x(t)} y={H - p.b + 16} fontSize={11} textAnchor="middle" fill="var(--ink-3)">{t * 100}%</text>
          </g>
        ))}
        <text x={(x(0) + x(1)) / 2} y={H - 6} fontSize={11} textAnchor="middle" fill="var(--ink-2)">Przewidywane prawdopodobieństwo</text>
        <text x={12} y={(y(0) + y(1)) / 2} fontSize={11} textAnchor="middle" fill="var(--ink-2)" transform={`rotate(-90 12 ${(y(0) + y(1)) / 2})`}>Rzeczywista częstość</text>
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--ink-3)" strokeDasharray="4 4" />
        {SERIES.map((s) => {
          const pts = data[s.key].filter((b) => b.n >= 10);
          return (
            <g key={s.key}>
              <polyline fill="none" stroke={s.color} strokeWidth={2} points={pts.map((b) => `${x(b.predicted)},${y(b.observed)}`).join(" ")} />
              {pts.map((b) => (
                <g key={b.lo} onMouseEnter={() => setHover({ s: s.label, b, x: x(b.predicted), y: y(b.observed) })}>
                  <circle cx={x(b.predicted)} cy={y(b.observed)} r={10} fill="transparent" />
                  <Marker shape={s.shape} cx={x(b.predicted)} cy={y(b.observed)} color={s.color} r={Math.min(7, 3 + Math.sqrt(b.n) / 8)} />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs shadow-lg" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`, transform: "translate(12px,-50%)" }}>
          <div className="font-semibold text-ink">{hover.s}</div>
          <div className="num text-ink-2">przedział {Math.round(hover.b.lo * 100)}–{Math.round(hover.b.hi * 100)}% · n={hover.b.n}</div>
          <div className="num text-ink-2">prognoza {(hover.b.predicted * 100).toFixed(1)}% · wynik {(hover.b.observed * 100).toFixed(1)}%</div>
        </div>
      )}
    </div>
  );
}

function Marker({ shape, cx, cy, color, r }: { shape: string; cx: number; cy: number; color: string; r: number }) {
  // 2px surface ring keeps overlapping markers distinguishable
  if (shape === "square") return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} rx={1.5} fill={color} stroke="var(--surface)" strokeWidth={2} />;
  if (shape === "diamond") return <path d={`M${cx},${cy - r * 1.2} L${cx + r * 1.2},${cy} L${cx},${cy + r * 1.2} L${cx - r * 1.2},${cy} Z`} fill={color} stroke="var(--surface)" strokeWidth={2} />;
  return <circle cx={cx} cy={cy} r={r} fill={color} stroke="var(--surface)" strokeWidth={2} />;
}
