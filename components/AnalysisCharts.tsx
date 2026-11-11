/**
 * Wykresy do pełnej analizy zakładu. Kolory mają stałe znaczenie:
 * zielony = po stronie zakładu, czerwony = przeciw, pomarańczowy = na granicy / niepewne.
 * Każdy wykres ma etykiety tekstowe, więc znaczenie nie zależy wyłącznie od koloru.
 */
import type { ReactNode } from "react";

export type Tone = "pos" | "neg" | "warn" | "neutral";
const FILL: Record<Tone, string> = { pos: "var(--pos)", neg: "var(--neg)", warn: "var(--warn)", neutral: "var(--muted-bar)" };
const TEXT: Record<Tone, string> = { pos: "text-pos", neg: "text-neg", warn: "text-warn", neutral: "text-ink-2" };
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1)).replace(".", ",");

export function ChartCard({ title, sub, children, legend }: { title: string; sub?: ReactNode; children: ReactNode; legend?: { tone: Tone; label: string }[] }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-sm font-black">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
      {legend && (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-3">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: FILL[l.tone] }} />{l.label}</span>
          ))}
        </div>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Półokrągły wskaźnik 0–100 dla trzech ocen. */
export function Gauge({ value, max = 100, label, display, tone, sub }: { value: number; max?: number; label: string; display: string; tone: Tone; sub?: string }) {
  const r = 44, cx = 56, cy = 54;
  const t = Math.max(0, Math.min(1, value / max));
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from), a1 = Math.PI * (1 - to);
    return `M ${cx + r * Math.cos(a0)} ${cy - r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)}`;
  };
  return (
    <div className="flex min-w-0 flex-col items-center rounded-xl bg-surface-2 px-2 py-3 text-center">
      <svg viewBox="0 0 112 62" className="w-full max-w-[150px]" role="img" aria-label={`${label}: ${display}`}>
        <path d={arc(0, 1)} stroke="var(--grid)" strokeWidth={10} fill="none" strokeLinecap="round" />
        {t > 0.005 && <path d={arc(0, t)} stroke={FILL[tone]} strokeWidth={10} fill="none" strokeLinecap="round" />}
      </svg>
      <div className={`num -mt-6 text-2xl font-black ${TEXT[tone]}`}>{display}</div>
      <div className="mt-1 text-xs font-semibold">{label}</div>
      {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** Słupki ostatnich meczów względem linii: zielony = trafione, czerwony = nietrafione, pomarańczowy = blisko linii. */
export function GamesVsLine({ games, line, over, height = 200, neutral = false, lineLabel = "linia" }: { games: { value: number; label: string; sub?: string }[]; line: number | null; over: boolean; height?: number; neutral?: boolean; lineLabel?: string }) {
  const W = 640, H = height, pad = { l: 28, r: 8, t: 18, b: 34 };
  const max = Math.max(1, line ?? 0, ...games.map((g) => g.value)) * 1.12;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const slot = iw / Math.max(1, games.length);
  const bw = Math.min(42, slot * 0.7);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const near = line !== null ? Math.max(1, line * 0.1) : 0;
  const toneOf = (v: number): Tone => {
    if (line === null || neutral) return "neutral";
    const hit = over ? v > line : v < line;
    if (Math.abs(v - line) <= near) return "warn";
    return hit ? "pos" : "neg";
  };
  const ticks = [0, max / 2, max].map((t) => Math.round(t));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Wyniki: ${games.map((g) => `${g.label} ${g.value}`).join(", ")}${line !== null ? `; linia ${line}` : ""}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">{t}</text>
        </g>
      ))}
      {games.map((g, i) => {
        const x = pad.l + i * slot + (slot - bw) / 2;
        const tone = toneOf(g.value);
        const h = Math.max(2, y(0) - y(g.value));
        return (
          <g key={i}>
            <title>{`${g.label}${g.sub ? ` · ${g.sub}` : ""}: ${g.value}`}</title>
            <rect x={x - 2} y={pad.t} width={bw + 4} height={ih} fill="transparent" />
            <path d={`M ${x} ${y(0)} V ${y(0) - h + 4} Q ${x} ${y(0) - h} ${x + 4} ${y(0) - h} H ${x + bw - 4} Q ${x + bw} ${y(0) - h} ${x + bw} ${y(0) - h + 4} V ${y(0)} Z`} fill={FILL[tone]} />
            <text x={x + bw / 2} y={y(g.value) - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)">{fmt(g.value)}</text>
            <text x={x + bw / 2} y={H - pad.b + 14} textAnchor="middle" fontSize={10} fill="var(--ink-2)">{g.label}</text>
            {g.sub && <text x={x + bw / 2} y={H - pad.b + 26} textAnchor="middle" fontSize={9} fill="var(--ink-3)">{g.sub}</text>}
          </g>
        );
      })}
      {line !== null && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={y(line)} y2={y(line)} stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 4" />
          <text x={W - pad.r} y={y(line) - 4} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--ink)">{lineLabel} {fmt(line)}</text>
        </g>
      )}
    </svg>
  );
}

/** Rozkład wyników z symulacji z zaznaczoną linią: słupki po stronie zakładu zielone, po drugiej czerwone. */
export function OutcomeHistogram({ bins, line, over, projection }: { bins: { x: number; p: number }[]; line: number | null; over: boolean; projection?: number | null }) {
  if (!bins.length) return <p className="text-sm text-ink-3">Brak symulacji.</p>;
  const W = 640, H = 200, pad = { l: 8, r: 8, t: 22, b: 24 };
  const xs = bins.map((b) => b.x);
  const step = bins.length > 1 ? Math.min(...bins.slice(1).map((b, i) => b.x - bins[i].x)) : 1;
  const lo = Math.min(...xs), hi = Math.max(...xs) + step;
  const maxP = Math.max(...bins.map((b) => b.p)) * 1.1;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const X = (v: number) => pad.l + ((v - lo) / (hi - lo)) * iw;
  const bw = Math.max(2, (iw / ((hi - lo) / step)) - 2);
  const win = (x: number) => (line === null ? true : over ? x > line : x + step - 1 < line);
  const pWin = bins.filter((b) => win(b.x)).reduce((s, b) => s + b.p, 0);
  const labelEvery = Math.ceil(bins.length / 12);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Rozkład wyników z symulacji, ${Math.round(pWin * 100)}% po stronie zakładu`}>
        {bins.map((b, i) => {
          const h = (b.p / maxP) * ih;
          return (
            <g key={b.x}>
              <title>{`${step > 1 ? `${b.x}–${b.x + step - 1}` : b.x}: ${(b.p * 100).toFixed(1)}%`}</title>
              <rect x={X(b.x) + 1} y={pad.t + ih - h} width={bw} height={Math.max(1, h)} rx={2} fill={win(b.x) ? "var(--pos)" : "var(--neg)"} opacity={0.9} />
              {i % labelEvery === 0 && <text x={X(b.x) + bw / 2 + 1} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{b.x}</text>}
            </g>
          );
        })}
        {line !== null && (
          <g>
            <line x1={X(line + 0.5 * (step === 1 ? 1 : 0))} x2={X(line + 0.5 * (step === 1 ? 1 : 0))} y1={pad.t - 6} y2={pad.t + ih} stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 4" />
            <text x={X(line + 0.5 * (step === 1 ? 1 : 0))} y={pad.t - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)">linia {fmt(line)}</text>
          </g>
        )}
        {projection !== null && projection !== undefined && (
          <g>
            <circle cx={X(projection + 0.5)} cy={pad.t + ih + 2} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-ink-3">
        <span><b className="text-pos">{Math.round(pWin * 100)}%</b> symulacji po stronie zakładu</span>
        <span><b className="text-neg">{Math.round((1 - pWin) * 100)}%</b> przeciw</span>
        {projection !== null && projection !== undefined && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: "var(--accent)" }} />projekcja {fmt(Math.round(projection * 10) / 10)}</span>}
      </div>
    </div>
  );
}

/** Kaskada projekcji: od średniej sezonu przez kolejne czynniki do wyniku. */
export function Waterfall({ start, steps, end, line, over }: { start: number; steps: { label: string; delta: number; text?: string }[]; end: number; line: number | null; over: boolean }) {
  const rows = steps.filter((s) => Math.abs(s.delta) >= 0.05);
  const vals = [start];
  for (const s of rows) vals.push(vals[vals.length - 1] + s.delta);
  const all = [...vals, end, line ?? end, 0];
  const lo = Math.min(...all) * 0.9, hi = Math.max(...all) * 1.05;
  const X = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  const Wd = (a: number, b: number) => `${(Math.abs(b - a) / (hi - lo || 1)) * 100}%`;
  const row = (label: string, a: number, b: number, tone: Tone, value: string, title?: string, solid = false) => (
    <div key={label + a} className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-2 text-xs sm:grid-cols-[12rem_1fr_4rem]" title={title}>
      <span className="truncate text-ink-2">{label}</span>
      <div className="relative h-5 rounded bg-surface-2">
        {line !== null && <span className="absolute inset-y-[-3px] w-0.5 bg-ink" style={{ left: X(line) }} />}
        <span className="absolute inset-y-0.5 rounded" style={{ left: X(Math.min(a, b)), width: solid ? X(b) : Wd(a, b), background: FILL[tone], minWidth: 3, ...(solid ? { left: X(lo) } : {}) }} />
      </div>
      <span className={`num text-right font-bold ${TEXT[tone]}`}>{value}</span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {row("Średnia sezonu", lo, start, "neutral", fmt(Math.round(start * 10) / 10), undefined, true)}
      {rows.map((s, i) => {
        const a = vals[i], b = vals[i + 1];
        const helps = (s.delta > 0) === over;
        return row(s.label, a, b, Math.abs(s.delta) < 0.2 ? "warn" : helps ? "pos" : "neg", `${s.delta >= 0 ? "+" : "−"}${fmt(Math.round(Math.abs(s.delta) * 10) / 10)}`, s.text);
      })}
      {row("Projekcja", lo, end, line === null ? "neutral" : (end > line) === over ? "pos" : "neg", fmt(Math.round(end * 10) / 10), undefined, true)}
      {line !== null && <p className="pt-1 text-[11px] text-ink-3">Czarna pionowa kreska = linia bukmachera {fmt(line)}. Zielony = czynnik pomaga zakładowi, czerwony = szkodzi, pomarańczowy = mały wpływ.</p>}
    </div>
  );
}

/** Poziome paski z wartością — np. kursy u bukmacherów albo procent trafień. */
export function HBars({ items, max, format = (v) => v.toFixed(2) }: { items: { label: string; value: number; tone: Tone; note?: string }[]; max?: number; format?: (v: number) => string }) {
  const m = max ?? Math.max(...items.map((i) => i.value), 0.0001);
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-[minmax(0,8rem)_1fr_3.5rem] items-center gap-2 text-xs sm:grid-cols-[10rem_1fr_4rem]">
          <span className="truncate text-ink-2" title={i.note}>{i.label}</span>
          <div className="h-4 rounded bg-surface-2"><div className="h-4 rounded" style={{ width: `${Math.max(2, (i.value / m) * 100)}%`, background: FILL[i.tone] }} /></div>
          <span className={`num text-right font-bold ${TEXT[i.tone]}`}>{format(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Kafelek z liczbą pokrycia linii (np. „Sezon 12/15”). */
export function CoverageTile({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const [h, n] = value.split("/").map(Number);
  const r = n ? h / n : 0;
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={`num text-xl font-black ${TEXT[tone]}`}>{value}</div>
      <div className="mt-1.5 h-1.5 rounded bg-[var(--grid)]"><div className="h-1.5 rounded" style={{ width: `${r * 100}%`, background: FILL[tone] }} /></div>
    </div>
  );
}

export const toneText = TEXT;
export const toneFill = FILL;
