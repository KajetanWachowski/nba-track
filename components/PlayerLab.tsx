"use client";
import { useMemo, useState } from "react";
import type { PlayerAnalysis } from "@/lib/analysis";
import { dec, num, pct, signedPct, shortDate } from "@/lib/format";
import { LineBarChart } from "./LineChart";

const MARKETS: { key: string; label: string; parts: string[] }[] = [
  { key: "pts", label: "Points", parts: ["pts"] },
  { key: "reb", label: "Rebounds", parts: ["reb"] },
  { key: "ast", label: "Assists", parts: ["ast"] },
  { key: "pra", label: "PRA", parts: ["pts", "reb", "ast"] },
  { key: "pr", label: "Pts+Reb", parts: ["pts", "reb"] },
  { key: "pa", label: "Pts+Ast", parts: ["pts", "ast"] },
  { key: "ra", label: "Reb+Ast", parts: ["reb", "ast"] },
  { key: "fg3m", label: "3PT Made", parts: ["fg3m"] },
  { key: "stl", label: "Steals", parts: ["stl"] },
  { key: "blk", label: "Blocks", parts: ["blk"] },
  { key: "tov", label: "Turnovers", parts: ["tov"] },
  { key: "stocks", label: "Stl+Blk", parts: ["stl", "blk"] },
];

interface Cal { a: number; b: number; c: number; fittedAt: number | null }
const logit = (p: number) => Math.log(Math.min(0.9999, Math.max(1e-4, p)) / (1 - Math.min(0.9999, Math.max(1e-4, p))));
const calibrate = (cal: Cal, pm: number, pk: number | null) => 1 / (1 + Math.exp(-(cal.a + cal.b * logit(pm) + cal.c * logit(pk ?? pm))));
function noVig2(a: number, b: number): [number, number] {
  // power method, two outcomes
  const ra = 1 / a, rb = 1 / b;
  let lo = 0.5, hi = 2.5;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if (ra ** k + rb ** k > 1) lo = k; else hi = k;
  }
  const k = (lo + hi) / 2;
  const s = ra ** k + rb ** k;
  return [ra ** k / s, rb ** k / s];
}

export function PlayerLab({ a, initialMarket, initialLine, cal }: { a: PlayerAnalysis; initialMarket?: string; initialLine?: number; cal: Cal }) {
  const [market, setMarket] = useState(MARKETS.some((m) => m.key === initialMarket) ? initialMarket! : "pts");
  const m = MARKETS.find((x) => x.key === market)!;
  const book = a.offers.find((o) => o.market === market && o.kind === "ou");
  const value = (g: PlayerAnalysis["games"][number]) => m.parts.reduce((s, k) => s + Number((g as unknown as Record<string, number>)[k] ?? 0), 0);
  const all = a.games.map(value);
  const defaultLine = () => {
    if (book) return book.line;
    if (a.projection) return Math.floor(a.projection.markets[market]?.median ?? 0) + 0.5;
    const s = [...all].sort((x, y) => x - y);
    return s.length ? Math.floor(s[s.length >> 1]) + 0.5 : 0.5;
  };
  const [line, setLine] = useState<number>(initialLine && initialMarket === market ? initialLine : defaultLine());
  const [win, setWin] = useState<number>(10);
  const pick = (k: string) => {
    setMarket(k);
    const bk = a.offers.find((o) => o.market === k && o.kind === "ou");
    const mm = MARKETS.find((x) => x.key === k)!;
    const vals = a.games.map((g) => mm.parts.reduce((s, p) => s + Number((g as unknown as Record<string, number>)[p] ?? 0), 0)).sort((x, y) => x - y);
    setLine(bk ? bk.line : a.projection ? Math.floor(a.projection.markets[k]?.median ?? 0) + 0.5 : vals.length ? Math.floor(vals[vals.length >> 1]) + 0.5 : 0.5);
  };

  const games = win === 0 ? a.games : a.games.slice(-win);
  const vals = games.map(value);
  const stats = useMemo(() => {
    const n = vals.length;
    const hits = vals.filter((v) => v > line).length;
    const avg = n ? vals.reduce((s, v) => s + v, 0) / n : NaN;
    const sorted = [...vals].sort((x, y) => x - y);
    const med = n ? (n % 2 ? sorted[n >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : NaN;
    let slope = 0;
    if (n >= 3) {
      const mx = (n - 1) / 2;
      let nu = 0, de = 0;
      vals.forEach((v, i) => { nu += (i - mx) * (v - avg); de += (i - mx) ** 2; });
      slope = nu / de;
    }
    const sd = n > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / (n - 1)) : NaN;
    return { n, hits, avg, med, slope, sd };
  }, [vals, line]);

  const proj = a.projection?.markets[market];
  const pOver = proj ? proj.atLeast[Math.floor(line) + 1] ?? 0 : null;
  const bookAtLine = a.offers.find((o) => o.market === market && o.kind === "ou" && o.line === line);
  const mkt = bookAtLine?.over && bookAtLine.under ? noVig2(bookAtLine.over, bookAtLine.under) : null;
  const calOver = pOver !== null ? calibrate(cal, pOver, mkt ? mkt[0] : null) : null;
  const evOver = calOver !== null && bookAtLine?.over ? calOver * bookAtLine.over - 1 : null;
  const evUnder = calOver !== null && bookAtLine?.under ? (1 - calOver) * bookAtLine.under - 1 : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" role="tablist">
        {MARKETS.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === market} type="button" onClick={() => pick(x.key)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${x.key === market ? "bg-ink text-bg" : "text-ink-3 hover:text-ink"}`}>
            {x.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label">Line</div>
              <div className="flex items-center gap-2">
                <button type="button" className="h-8 w-8 rounded-lg border border-line text-lg" onClick={() => setLine(Math.max(0.5, line - 1))} aria-label="Lower line">−</button>
                <input type="number" step={0.5} value={line} onChange={(e) => setLine(+e.target.value)} className="num w-24 rounded-lg border border-line bg-surface-2 px-2 py-1 text-center text-2xl font-black" />
                <button type="button" className="h-8 w-8 rounded-lg border border-line text-lg" onClick={() => setLine(line + 1)} aria-label="Raise line">+</button>
                {book && <span className="text-xs text-ink-3">book line {book.line}{book.openLine !== null && book.openLine !== book.line ? ` (opened ${book.openLine})` : ""}</span>}
              </div>
            </div>
            <div className="flex gap-1 rounded-lg border border-line p-1 text-sm">
              {[5, 10, 20, 0].map((w) => (
                <button key={w} type="button" onClick={() => setWin(w)} className={`rounded-md px-2.5 py-1 font-semibold ${w === win ? "bg-surface-2 text-ink" : "text-ink-3"}`}>
                  {w === 0 ? "Season" : `L${w}`}
                </button>
              ))}
            </div>
          </div>
          {games.length ? (
            <LineBarChart
              line={line}
              data={games.map((g, i) => ({
                key: g.game_id,
                value: vals[i],
                label: a.teams[g.opp_id]?.abbr ?? "",
                logo: a.teams[g.opp_id]?.logo,
                tooltip: [`${g.home ? "vs" : "@"} ${a.teams[g.opp_id]?.abbr ?? ""} · ${shortDate(g.date)}`, `${m.label}: ${vals[i]} (${vals[i] > line ? "over" : "under"} ${line})`, `${g.min} min${g.usg !== null ? ` · USG ${num(g.usg)}%` : ""}`],
              }))}
            />
          ) : (
            <p className="py-10 text-center text-sm text-ink-3">No games played this season yet.</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label={`Hit rate (${win === 0 ? "season" : `L${win}`})`} value={stats.n ? `${stats.hits}/${stats.n}` : "—"} sub={stats.n ? pct(stats.hits / stats.n, 0) : ""} tone={stats.n && stats.hits / stats.n >= 0.5 ? "pos" : "neg"} />
            <Tile label="Average" value={num(stats.avg)} sub={`σ ${num(stats.sd)}`} />
            <Tile label="Median" value={num(stats.med)} />
            <Tile label="Trend / game" value={`${stats.slope >= 0 ? "+" : ""}${num(stats.slope, 2)}`} tone={stats.slope > 0.15 ? "pos" : stats.slope < -0.15 ? "neg" : undefined} sub="OLS slope" />
            <Tile label="Season avg" value={num(all.length ? all.reduce((s, v) => s + v, 0) / all.length : NaN)} sub={`${all.length} games`} />
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <div className="label">Next game projection</div>
            {proj && a.next ? (
              <>
                <div className="num mt-1 text-5xl font-black">{num(proj.mean)}</div>
                <div className="text-sm text-ink-3">median {num(proj.median, 0)} · 80% range {num(proj.p10, 0)}–{num(proj.p90, 0)}</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Tile label={`P(over ${line})`} value={pct(calOver)} sub={`raw model ${pct(pOver)}`} tone={calOver !== null && calOver >= 0.5 ? "pos" : undefined} />
                  <Tile label={`P(under ${line})`} value={pct(calOver === null ? null : 1 - calOver)} />
                </div>
                {bookAtLine ? (
                  <div className="mt-4 space-y-1 text-sm">
                    <div className="label">DraftKings at {line}</div>
                    <PriceRow side="Over" price={bookAtLine.over} fair={mkt?.[0]} ev={evOver} />
                    <PriceRow side="Under" price={bookAtLine.under} fair={mkt?.[1]} ev={evUnder} />
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-ink-3">No sportsbook price at this exact line{book ? ` (book line ${book.line})` : " for this market"} — EV not computed.</p>
                )}
                {!cal.fittedAt && <p className="mt-3 text-xs text-warn">Uncalibrated: run a backtest to fit calibration.</p>}
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-3">{a.next ? "Not enough data to project this player." : "No upcoming game found in the next 7 days."}</p>
            )}
          </section>
          {a.projection && (
            <section className="rounded-2xl border border-line bg-surface p-4 text-sm">
              <div className="label mb-2">Model inputs ({m.label.toLowerCase()})</div>
              <Factor k="Projected minutes" v={`${num(a.projection.minutes.mean)} ± ${num(a.projection.minutes.sd)}`} />
              {m.parts.map((p) => {
                const f = a.projection!.factors[p as keyof typeof a.projection.factors];
                return (
                  <div key={p} className="mt-2 border-t border-line pt-2">
                    <div className="text-xs font-semibold uppercase text-ink-3">{p}</div>
                    <Factor k="Opponent (per poss.)" v={signedPct(f.opponent - 1)} />
                    <Factor k="Pace" v={signedPct(f.pace - 1)} />
                    <Factor k="Home/away" v={signedPct(f.home - 1)} />
                    <Factor k="Teammate absences" v={signedPct(f.teammates - 1)} />
                    <Factor k="Head-to-head (shrunk)" v={signedPct(f.h2h - 1)} />
                  </div>
                );
              })}
              {a.projection.teammates.filter((t) => t.method !== "already-absent").map((t) => (
                <p key={t.name} className="mt-2 text-xs text-ink-2">{t.name} ({t.status}): {t.minutes >= 0 ? "+" : ""}{num(t.minutes)} min via {t.method}</p>
              ))}
              {[...a.projection.notes, ...a.projection.warnings].map((w) => <p key={w} className="mt-2 text-xs text-warn">⚠ {w}</p>)}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="label text-[10px]">{label}</div>
      <div className={`num text-2xl font-black ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""}`}>{value}</div>
      {sub && <div className="num text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function PriceRow({ side, price, fair, ev }: { side: string; price: number | null; fair?: number; ev: number | null }) {
  return (
    <div className="num flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
      <span className="font-semibold">{side}</span>
      <span>{dec(price)}</span>
      <span className="text-ink-3">no-vig {pct(fair ?? null)}</span>
      <span className={`font-bold ${ev !== null && ev > 0 ? "text-pos" : "text-neg"}`}>EV {signedPct(ev)}</span>
    </div>
  );
}

function Factor({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-ink-3">{k}</span><span className="num font-semibold">{v}</span></div>;
}
