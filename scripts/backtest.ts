/**
 * Walk-forward backtest on this season's completed games against real DraftKings opening lines.
 *   npm run backtest            # uses current model params
 *   npm run backtest -- --tune  # grid-search params on the training dates first
 */
import { runBacktest } from "../lib/backtest";

const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(d)}%`);
const s = await runBacktest({ tune: process.argv.includes("--tune"), log: (l) => console.log(l) });
console.log(`\nEvaluated ${s.dates.from}–${s.dates.to} (train ≤ ${s.dates.trainTo}); rows`, s.rows);
for (const k of ["player", "game"] as const) {
  const m = s.metrics[k];
  console.log(`${k.padEnd(6)} test n=${m.n}  logloss raw ${m.logLossRaw.toFixed(4)} | market ${m.logLossMarket.toFixed(4)} | calibrated ${m.logLossCal.toFixed(4)}   brier raw ${m.brierRaw.toFixed(4)} | market ${m.brierMarket.toFixed(4)} | cal ${m.brierCal.toFixed(4)}`);
  const c = s.calibration[k];
  console.log(`        calibration (all dates): a=${c.a.toFixed(3)} b=${c.b.toFixed(3)} c=${c.c.toFixed(3)} n=${c.n}`);
}
console.log("\nreliability (test, player props): bin  n  raw→obs | calibrated→obs");
s.reliability.raw.forEach((b, i) => {
  const c = s.reliability.cal[i];
  if (b.n || c.n) console.log(`  ${(b.lo * 100).toFixed(0).padStart(3)}-${(b.hi * 100).toFixed(0).padEnd(3)} ${String(b.n).padStart(5)} ${pct(b.predicted)}→${pct(b.observed)} | ${String(c.n).padStart(5)} ${pct(c.predicted)}→${pct(c.observed)}`);
});
const b = s.betting.overall;
console.log(`\nbetting (test, EV ≥ ${pct(s.betting.minEv, 0)}): ${b.bets} bets, win ${pct(b.winRate)}, avg odds ${b.avgOdds.toFixed(2)}, yield ${pct(b.yield)}, profit ${b.profit.toFixed(1)}u, CLV ${pct(b.clv, 2)} (n=${b.clvN}), beat close ${pct(b.beatClose)}`);
for (const [k, v] of Object.entries(s.betting.byMarket)) console.log(`  ${k.padEnd(7)} ${String(v.bets).padStart(4)} bets  yield ${pct(v.yield).padStart(7)}  CLV ${pct(v.clv, 2)}`);
for (const n of s.notes) console.log("note:", n);
