"use client";
import { useState } from "react";

export interface BarDatum {
  key: string;
  value: number;
  label: string; // x-axis label (e.g. opponent)
  logo?: string;
  tooltip: string[];
}

/**
 * Game-by-game bars against a betting line. Bars over the line use the positive token, others a
 * muted neutral — identity is also given by the legend and the tooltip text, never color alone.
 */
export function LineBarChart({ data, line, height = 260, showValues }: { data: BarDatum[]; line: number | null; height?: number; showValues?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 44, r: 10, t: 26, b: data.some((d) => d.logo) ? 40 : 26 };
  const maxV = Math.max(1, line ?? 0, ...data.map((d) => d.value)) * 1.12;
  const n = Math.max(1, data.length);
  const slot = (W - pad.l - pad.r) / n;
  const bw = Math.max(6, Math.min(44, slot - 2)); // ≥2px surface gap between bars
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / maxV);
  const ticks = niceTicks(maxV);
  const labels = showValues ?? n <= 12;

  return (
    <div className="relative">
      <div className="mb-2 flex gap-4 text-xs text-ink-3" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--pos)" }} />Over the line</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--muted-bar)" }} />Under the line</span>
        {line !== null && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: "var(--ink-2)" }} />Line {line}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Bar chart of ${n} games${line !== null ? ` against a line of ${line}` : ""}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            {(line === null || Math.abs(y(t) - y(line)) > 14) && (
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)" className="num">{t}</text>
            )}
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * slot + (slot - bw) / 2;
          const over = line !== null && d.value > line;
          const top = y(d.value);
          const h = Math.max(0, y(0) - top);
          const r = Math.min(4, bw / 2, h);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
              {/* hit target larger than the mark */}
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
              <path
                d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z`}
                fill={over ? "var(--pos)" : "var(--muted-bar)"}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
              {labels && (
                <text x={x + bw / 2} y={top - 6} textAnchor="middle" fontSize={13} fontWeight={800} fill="var(--ink)" className="num">{fmt(d.value)}</text>
              )}
              {d.logo ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <image href={d.logo} x={x + bw / 2 - 10} y={H - pad.b + 8} width={20} height={20} />
              ) : (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{d.label}</text>
              )}
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        {line !== null && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(line)} y2={y(line)} stroke="var(--ink-2)" strokeWidth={2} strokeDasharray="6 5" />
            {/* line value sits in the y-axis gutter so it never collides with bar labels */}
            <rect x={1} y={y(line) - 9} width={pad.l - 5} height={18} rx={9} fill="var(--ink)" />
            <text x={(pad.l - 4) / 2 + 1} y={y(line) + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--bg)" className="num">{line}</text>
          </g>
        )}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((pad.l + hover * slot + slot / 2) / W) * 100}%`, top: 24, transform: "translateX(-50%)" }}
        >
          {data[hover].tooltip.map((t, i) => <div key={i} className={i === 0 ? "font-semibold text-ink" : "text-ink-2"}>{t}</div>)}
        </div>
      )}
    </div>
  );
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function niceTicks(max: number): number[] {
  const step = [1, 2, 5, 10, 20, 25, 50].find((s) => max / s <= 5) ?? 100;
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  return out;
}
