"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { BetEval } from "@/lib/engine";
import { american, dec, num, pct, pp, signedPct, tipTime } from "@/lib/format";

type SortKey = "ev" | "modelProb" | "edge";

const MARKET_GROUPS: { value: string; label: string }[] = [
  { value: "all", label: "All markets" },
  { value: "pts", label: "Points" }, { value: "reb", label: "Rebounds" }, { value: "ast", label: "Assists" },
  { value: "pra", label: "Pts+Reb+Ast" }, { value: "pr", label: "Pts+Reb" }, { value: "pa", label: "Pts+Ast" }, { value: "ra", label: "Reb+Ast" },
  { value: "fg3m", label: "3PT Made" }, { value: "stl", label: "Steals" }, { value: "blk", label: "Blocks" }, { value: "tov", label: "Turnovers" },
  { value: "stocks", label: "Stl+Blk" }, { value: "dd", label: "Double Double" }, { value: "td", label: "Triple Double" },
  { value: "ml", label: "Moneyline" }, { value: "spread", label: "Spread" }, { value: "total", label: "Total Points" },
];

export function BetTable({ bets, initial, compact = false, title }: {
  bets: BetEval[];
  initial?: Partial<{ minEv: number; minProb: number; sort: SortKey; valueOnly: boolean; type: string }>;
  compact?: boolean;
  title?: string;
}) {
  const [minEv, setMinEv] = useState(initial?.minEv ?? 0.02);
  const [minProb, setMinProb] = useState(initial?.minProb ?? 0);
  const [sort, setSort] = useState<SortKey>(initial?.sort ?? "ev");
  const [market, setMarket] = useState("all");
  const [type, setType] = useState(initial?.type ?? "all");
  const [team, setTeam] = useState("all");
  const [q, setQ] = useState("");
  const [conf, setConf] = useState("any");
  const [valueOnly, setValueOnly] = useState(initial?.valueOnly ?? true);
  const [limit, setLimit] = useState(compact ? 8 : 50);
  const [open, setOpen] = useState<string | null>(null);

  const teams = useMemo(() => [...new Set(bets.map((b) => b.teamAbbr).filter(Boolean))].sort(), [bets]);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return bets
      .filter((b) => b.ev >= minEv && b.modelProb >= minProb)
      .filter((b) => !valueOnly || b.isValue)
      .filter((b) => market === "all" || b.market === market)
      .filter((b) => type === "all" || b.marketType === type)
      .filter((b) => team === "all" || b.teamAbbr === team || b.oppAbbr === team)
      .filter((b) => conf === "any" || (conf === "high" ? b.confidence === "High" : b.confidence !== "Low"))
      .filter((b) => !ql || b.subjectName.toLowerCase().includes(ql) || b.gameLabel.toLowerCase().includes(ql))
      .sort((a, b) => b[sort] - a[sort]);
  }, [bets, minEv, minProb, valueOnly, market, type, team, conf, q, sort]);

  const sel = "rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink";
  return (
    <div>
      {!compact && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-3">
          <label className="flex flex-col gap-1"><span className="label">Player / team</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${sel} w-40`} />
          </label>
          <label className="flex flex-col gap-1"><span className="label">Market</span>
            <select value={market} onChange={(e) => setMarket(e.target.value)} className={sel}>
              {MARKET_GROUPS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className={sel}>
              <option value="all">All</option><option value="ou">Over/Under</option><option value="milestone">Milestone (X+)</option>
              <option value="yes">Yes/No</option><option value="game">Game lines</option>
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Team</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)} className={sel}>
              <option value="all">All</option>{teams.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Min EV {signedPct(minEv, 0)}</span>
            <input type="range" min={-0.1} max={0.3} step={0.01} value={minEv} onChange={(e) => setMinEv(+e.target.value)} className="w-32 accent-[var(--accent)]" />
          </label>
          <label className="flex flex-col gap-1"><span className="label">Min prob {pct(minProb, 0)}</span>
            <input type="range" min={0} max={0.9} step={0.05} value={minProb} onChange={(e) => setMinProb(+e.target.value)} className="w-32 accent-[var(--accent)]" />
          </label>
          <label className="flex flex-col gap-1"><span className="label">Confidence</span>
            <select value={conf} onChange={(e) => setConf(e.target.value)} className={sel}>
              <option value="any">Any</option><option value="med">Medium+</option><option value="high">High only</option>
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="label">Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={sel}>
              <option value="ev">Expected value</option><option value="modelProb">Probability</option><option value="edge">Edge</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-sm text-ink-2">
            <input type="checkbox" checked={valueOnly} onChange={(e) => setValueOnly(e.target.checked)} className="accent-[var(--accent)]" />
            Value bets only
          </label>
          <span className="ml-auto pb-1.5 text-xs text-ink-3 num">{rows.length} of {bets.length} selections</span>
        </div>
      )}
      {title && <h3 className="label mb-2">{title}</h3>}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-3">
          No selections pass these filters. That is a valid outcome — the model only flags prices it estimates are mispriced.
        </div>
      ) : (
        <ol className="space-y-2">
          {rows.slice(0, limit).map((b, i) => (
            <li key={b.id} className="rounded-2xl border border-line bg-surface">
              <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 p-3 text-left sm:grid-cols-[auto_minmax(0,2.2fr)_repeat(5,minmax(0,1fr))]">
                <span className="num w-6 text-center text-sm font-bold text-ink-3">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate font-bold">{b.subjectName}</span>
                  <span className="block truncate text-sm text-ink-2">{b.selection}</span>
                  <span className="block truncate text-xs text-ink-3">{b.gameLabel} · {tipTime(b.tipoff)} · {b.book}</span>
                </span>
                <Metric label="Odds" value={dec(b.price)} sub={american(b.price)} />
                <Metric label="Model" value={pct(b.modelProb)} sub={`${pct(b.pLow, 0)}–${pct(b.pHigh, 0)}`} />
                <Metric label="Implied" value={pct(b.impliedProb)} sub={b.marketProb !== null ? `no-vig ${pct(b.marketProb)}` : undefined} />
                <Metric label="Edge" value={pp(b.edge)} tone={b.edge > 0 ? "pos" : "neg"} />
                <span className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:block">
                  <Metric label="EV" value={signedPct(b.ev)} tone={b.ev > 0 ? "pos" : "neg"} big />
                  <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${b.confidence === "High" ? "bg-pos-soft text-pos" : b.confidence === "Medium" ? "bg-warn-soft text-warn" : "bg-neg-soft text-neg"}`}>
                    {b.confidence === "High" ? "●●●" : b.confidence === "Medium" ? "●●○" : "●○○"} {b.confidence}
                  </span>
                </span>
              </button>
              {open === b.id && <BetDetail b={b} />}
            </li>
          ))}
        </ol>
      )}
      {rows.length > limit && (
        <button type="button" onClick={() => setLimit(limit + 50)} className="mt-3 w-full rounded-xl border border-line py-2 text-sm text-ink-2 hover:text-ink">
          Show more ({rows.length - limit} remaining)
        </button>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone, big }: { label: string; value: string; sub?: string; tone?: "pos" | "neg"; big?: boolean }) {
  return (
    <span className="block min-w-0">
      <span className="label block text-[10px]">{label}</span>
      <span className={`num block font-bold ${big ? "text-xl" : "text-base"} ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""}`}>{value}</span>
      {sub && <span className="num block truncate text-[11px] text-ink-3">{sub}</span>}
    </span>
  );
}

function BetDetail({ b }: { b: BetEval }) {
  return (
    <div className="grid gap-4 border-t border-line p-4 text-sm md:grid-cols-3">
      <div className="md:col-span-2">
        <div className="label mb-2">Why</div>
        <ul className="space-y-1 text-ink-2">
          {b.reasons.map((r, i) => <li key={i}>• {r}</li>)}
        </ul>
        {b.warnings.length > 0 && (
          <>
            <div className="label mb-1 mt-3 text-warn">Caveats</div>
            <ul className="space-y-1 text-warn">{b.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
          </>
        )}
        <p className="mt-3 text-xs text-ink-3">Market probability: {b.marketProbSource}.</p>
      </div>
      <div className="space-y-2">
        <Row k="Fair odds (model)" v={dec(b.fairOdds)} />
        <Row k="Raw model probability" v={pct(b.rawProb)} />
        <Row k="Calibrated probability" v={pct(b.modelProb)} />
        <Row k="80% probability band" v={`${pct(b.pLow)} – ${pct(b.pHigh)}`} />
        {b.projection && <Row k="Projection (80% range)" v={`${num(b.projection.mean)} (${num(b.projection.p10, 0)}–${num(b.projection.p90, 0)})`} />}
        {b.hitRates && <Row k="Hit rate L5 / L10 / L20" v={`${b.hitRates.l5} · ${b.hitRates.l10} · ${b.hitRates.l20}`} />}
        {b.openPrice && <Row k="Opening price" v={`${b.openLine ?? b.line ?? ""} @ ${dec(b.openPrice)}`} />}
        <Row k="¼ Kelly stake" v={pct(b.kellyQuarter, 2)} />
        <div className="pt-2">
          <div className="label mb-1">Prices</div>
          {b.offers.map((o) => (
            <div key={`${o.book}-${o.dec}`} className="num flex justify-between text-ink-2"><span>{o.book}</span><span>{dec(o.dec)}{o.oppDec ? ` / ${dec(o.oppDec)}` : ""}</span></div>
          ))}
        </div>
        {b.kind === "player" && <Link href={`/players/${b.subjectId}?market=${b.market}&line=${b.line ?? ""}`} className="inline-block pt-2 text-accent hover:underline">Open player analysis →</Link>}
        {b.kind === "game" && <Link href={`/games/${b.gameId}`} className="inline-block pt-2 text-accent hover:underline">Open game →</Link>}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3"><span className="text-ink-3">{k}</span><span className="num text-right font-semibold">{v}</span></div>
  );
}
