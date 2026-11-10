import { ActionButton } from "@/components/ActionButton";
import { ReliabilityChart } from "@/components/ReliabilityChart";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { latestBacktest, type BetStats } from "@/lib/backtest";
import { ago, dayLabel, dec, num, pct, shortDate, signedPct } from "@/lib/format";
import { MARKET_LABEL, type Market } from "@/lib/markets";
import { listPredictions } from "@/lib/tracking";

export const dynamic = "force-dynamic";

function StatsTable({ rows }: { rows: [string, BetStats][] }) {
  return (
    <table className="num w-full text-sm">
      <thead><tr className="label text-left"><th className="py-1">Group</th><th>Bets</th><th>Win</th><th>Avg odds</th><th>Yield</th><th>Profit</th><th>CLV</th></tr></thead>
      <tbody>
        {rows.map(([k, s]) => (
          <tr key={k} className="border-t border-line">
            <td className="py-1.5 font-semibold">{MARKET_LABEL[k as Market] ?? k}</td><td>{s.bets}</td><td>{pct(s.winRate)}</td><td>{dec(s.avgOdds)}</td>
            <td className={s.yield > 0 ? "text-pos" : "text-neg"}>{signedPct(s.yield)}</td><td>{s.profit > 0 ? "+" : ""}{num(s.profit)}u</td>
            <td className={(s.clv ?? 0) > 0 ? "text-pos" : "text-neg"}>{s.clv === null ? "—" : signedPct(s.clv, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function History() {
  const bt = latestBacktest();
  const preds = listPredictions(400);
  const settled = preds.filter((p) => p.status === "settled" && p.won !== null);
  const profit = settled.reduce((s, p) => s + (p.won ? p.price - 1 : -1), 0);
  const clvs = preds.filter((p) => p.clv !== null).map((p) => p.clv!);
  const se = (s: BetStats) => (s.bets ? Math.sqrt(s.winRate * (1 - s.winRate)) * s.avgOdds / Math.sqrt(s.bets) : NaN);
  return (
    <>
      <PageHeader eyebrow="Backtesting & track record" title="Historical" accent="Performance">
        <div className="flex gap-3">
          <ActionButton endpoint="/api/backtest" label="Run backtest" note="~1–3 min · refits calibration" />
          <ActionButton endpoint="/api/settle" label="Settle predictions" />
        </div>
      </PageHeader>

      <h2 className="label mb-2">Walk-forward backtest (real DraftKings opening lines)</h2>
      {!bt ? <Empty title="No backtest yet">Run one to measure accuracy and fit the probability calibration.</Empty> : (
        <>
          <p className="mb-4 max-w-4xl text-sm text-ink-2">
            Run {ago(bt.createdAt)} · evaluated {dayLabel(bt.dates.from)} – {dayLabel(bt.dates.to)} · calibration trained on dates ≤ {dayLabel(bt.dates.trainTo)},
            all metrics below are from the <b>later, untouched test dates</b> ({bt.rows.test.toLocaleString()} rows). Each prediction used only games played before its date.
          </p>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Props log-loss (calibrated)" value={bt.metrics.player.logLossCal.toFixed(4)} sub={`market ${bt.metrics.player.logLossMarket.toFixed(4)} · raw ${bt.metrics.player.logLossRaw.toFixed(4)}`} tone={bt.metrics.player.logLossCal < bt.metrics.player.logLossMarket ? "pos" : "neg"} />
            <Stat label="Props Brier (calibrated)" value={bt.metrics.player.brierCal.toFixed(4)} sub={`market ${bt.metrics.player.brierMarket.toFixed(4)} · raw ${bt.metrics.player.brierRaw.toFixed(4)}`} tone={bt.metrics.player.brierCal < bt.metrics.player.brierMarket ? "pos" : "neg"} />
            <Stat label={`Simulated yield (EV ≥ ${pct(bt.betting.minEv, 0)})`} value={signedPct(bt.betting.overall.yield)} sub={`${bt.betting.overall.bets} bets · ±${pct(se(bt.betting.overall))} std. error`} tone={bt.betting.overall.yield > 0 ? "pos" : "neg"} />
            <Stat label="Closing line value" value={signedPct(bt.betting.overall.clv, 2)} sub={`beat close ${pct(bt.betting.overall.beatClose)} of ${bt.betting.overall.clvN}`} tone={(bt.betting.overall.clv ?? 0) > 0 ? "pos" : "neg"} />
          </div>
          <div className="mb-6 grid gap-4 xl:grid-cols-2">
            <Card title="Calibration — player props, test dates">
              <ReliabilityChart data={bt.reliability} />
              <table className="num mt-3 w-full text-xs">
                <thead><tr className="text-left text-ink-3"><th>Bin</th><th>n (cal)</th><th>Calibrated → observed</th><th>Raw → observed</th><th>Market → observed</th></tr></thead>
                <tbody>
                  {bt.reliability.cal.map((b, i) => (bt.reliability.raw[i].n || b.n) ? (
                    <tr key={i} className="border-t border-line"><td>{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</td><td>{b.n}</td>
                      <td>{b.n ? `${pct(b.predicted)} → ${pct(b.observed)}` : "—"}</td>
                      <td>{bt.reliability.raw[i].n ? `${pct(bt.reliability.raw[i].predicted)} → ${pct(bt.reliability.raw[i].observed)}` : "—"}</td>
                      <td>{bt.reliability.market[i].n ? `${pct(bt.reliability.market[i].predicted)} → ${pct(bt.reliability.market[i].observed)}` : "—"}</td></tr>
                  ) : null)}
                </tbody>
              </table>
            </Card>
            <Card title="Accuracy summary">
              <table className="num w-full text-sm">
                <thead><tr className="label text-left"><th className="py-1">Scope</th><th>n</th><th>Log-loss raw</th><th>market</th><th>calibrated</th></tr></thead>
                <tbody>
                  {(["player", "game"] as const).map((k) => (
                    <tr key={k} className="border-t border-line"><td className="py-1.5 font-semibold">{k === "player" ? "Player props" : "Game lines"}</td><td>{bt.metrics[k].n}</td>
                      <td>{bt.metrics[k].logLossRaw.toFixed(4)}</td><td>{bt.metrics[k].logLossMarket.toFixed(4)}</td><td className={bt.metrics[k].logLossCal < bt.metrics[k].logLossMarket ? "text-pos" : "text-neg"}>{bt.metrics[k].logLossCal.toFixed(4)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="label mb-1 mt-4">Projected distribution checks (test dates)</div>
              <table className="num w-full text-sm">
                <thead><tr className="text-left text-xs text-ink-3"><th>Market</th><th>n</th><th>80% interval coverage</th><th>RMSE model</th><th>RMSE book line</th></tr></thead>
                <tbody>{bt.distributionChecks?.map((d) => (
                  <tr key={d.market} className="border-t border-line"><td className="py-1">{MARKET_LABEL[d.market as Market]}</td><td>{d.n}</td><td>{pct(d.coverage80)}</td>
                    <td className={d.rmseModel <= d.rmseLine ? "text-pos" : ""}>{num(d.rmseModel, 2)}</td><td>{num(d.rmseLine, 2)}</td></tr>
                ))}</tbody>
              </table>
              <div className="label mb-1 mt-4">Calibration parameters (live)</div>
              <p className="num text-sm text-ink-2">
                props: p = σ({num(bt.calibration.player.a, 3)} + {num(bt.calibration.player.b, 3)}·logit(model) + {num(bt.calibration.player.c, 3)}·logit(market)) · n={bt.calibration.player.n}<br />
                games: p = σ({num(bt.calibration.game.a, 3)} + {num(bt.calibration.game.b, 3)}·logit(model) + {num(bt.calibration.game.c, 3)}·logit(market)) · n={bt.calibration.game.n}
              </p>
              <ul className="mt-3 space-y-1 text-xs text-ink-3">{bt.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
            </Card>
          </div>
          <div className="mb-8 grid gap-4 xl:grid-cols-3">
            <Card title="By bet type"><StatsTable rows={Object.entries(bt.betting.byMarket).sort((a, b) => b[1].bets - a[1].bets)} /></Card>
            <Card title="By odds range"><StatsTable rows={Object.entries(bt.betting.byOdds).sort()} /></Card>
            <Card title="By model probability"><StatsTable rows={Object.entries(bt.betting.byProb).sort()} /></Card>
          </div>
        </>
      )}

      <h2 className="label mb-2">Live track record (recommendations as shown, settled after games)</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Logged" value={preds.length} sub={`${preds.filter((p) => p.status === "open").length} open`} />
        <Stat label="Settled" value={settled.length} sub={`${preds.filter((p) => p.status === "void").length} void`} />
        <Stat label="Win rate" value={settled.length ? pct(settled.filter((p) => p.won).length / settled.length) : "—"} />
        <Stat label="Yield / ROI (1u flat)" value={settled.length ? signedPct(profit / settled.length) : "—"} sub={settled.length ? `${profit > 0 ? "+" : ""}${num(profit)}u · ROI on 100u ${signedPct(profit / 100)}` : ""} tone={profit > 0 ? "pos" : profit < 0 ? "neg" : undefined} />
        <Stat label="Avg CLV" value={clvs.length ? signedPct(clvs.reduce((a, b) => a + b, 0) / clvs.length, 2) : "—"} sub={`${clvs.length} with closing price`} />
      </div>
      {preds.length === 0 ? <Empty title="No predictions logged yet">Value bets with EV ≥ 2% are logged automatically the first time they are shown.</Empty> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[900px] text-sm">
              <thead><tr className="label text-left"><th className="py-1">Date</th><th>Selection</th><th>Book</th><th>Odds</th><th>Model</th><th>EV</th><th>Conf.</th><th>Result</th><th>Close</th><th>CLV</th></tr></thead>
              <tbody>
                {preds.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-1.5">{shortDate(p.game_date)}</td>
                    <td><span className="font-semibold">{p.subject_name}</span> <span className="text-ink-3">{p.side} {p.line ?? ""} {MARKET_LABEL[p.market as Market]}</span></td>
                    <td>{p.book}</td><td>{dec(p.price)}</td><td>{pct(p.model_prob)}</td><td className="text-pos">{signedPct(p.ev)}</td><td>{p.confidence}</td>
                    <td className={p.won === 1 ? "font-bold text-pos" : p.won === 0 ? "text-neg" : "text-ink-3"}>{p.status === "open" ? "pending" : p.status === "void" ? "void" : p.won === null ? "push" : `${p.won ? "WON" : "LOST"} (${p.actual})`}</td>
                    <td>{dec(p.closing_price)}</td><td className={(p.clv ?? 0) > 0 ? "text-pos" : "text-neg"}>{p.clv === null ? "—" : signedPct(p.clv, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
