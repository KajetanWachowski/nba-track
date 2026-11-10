import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BetTable } from "@/components/BetTable";
import { Card, Empty, InjuryBadge, Notice, PageHeader, SourceBar, Stat, TeamLogo } from "@/components/ui";
import { latestBacktest } from "@/lib/backtest";
import { dayLabel, dec, pct, signedPct, tipTime } from "@/lib/format";
import { loadSlate } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { a, error } = await loadSlate();
  if (!a) return <><PageHeader eyebrow="Dashboard" title="Today's" accent="Edge" /><Notice tone="neg">Could not load today's slate: {error}. Run <code>npm run sync</code> and check your network.</Notice></>;
  const bt = latestBacktest();
  const value = a.bets.filter((b) => b.isValue);
  const pre = a.games.filter((g) => g.state === "pre");
  const keyInjuries = a.injuries
    .filter((i) => a.games.some((g) => g.home_id === i.teamId || g.away_id === i.teamId))
    .filter((i) => i.status !== "PROBABLE")
    .slice(0, 14);
  const topProb = [...a.bets].filter((b) => b.ev > 0 && b.confidence !== "Low").sort((x, y) => y.modelProb - x.modelProb);
  return (
    <>
      <AutoRefresh seconds={300} />
      <PageHeader eyebrow={`Dashboard · ${dayLabel(a.day)}`} title="Today's" accent="Edge" />
      <SourceBar sources={a.sources} />
      {a.warnings.map((w) => <Notice key={w}>{w}</Notice>)}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Games today" value={a.games.length} sub={`${pre.length} not started`} />
        <Stat label="Prices analysed" value={a.bets.length.toLocaleString()} sub={`${a.playersAnalyzed} players projected`} />
        <Stat label="Value bets (EV>0, conf ≥ Med)" value={value.length} tone={value.length ? "pos" : undefined} sub={value.length ? `best EV ${signedPct(value[0]?.ev)}` : "none flagged"} />
        <Stat
          label="Out-of-sample log-loss"
          value={bt ? bt.metrics.player.logLossCal.toFixed(4) : "—"}
          sub={bt ? `market ${bt.metrics.player.logLossMarket.toFixed(4)} · lower is better` : "no backtest yet"}
          tone={bt ? (bt.metrics.player.logLossCal < bt.metrics.player.logLossMarket ? "pos" : "neg") : undefined}
        />
      </div>

      {bt && bt.metrics.player.logLossCal >= bt.metrics.player.logLossMarket - 0.002 && (
        <Notice tone="neutral">
          Honest status: in the latest walk-forward backtest the calibrated model was only {(bt.metrics.player.logLossMarket - bt.metrics.player.logLossCal).toFixed(4)} log-loss better than the DraftKings no-vig line,
          and simulated bets had CLV {signedPct(bt.betting.overall.clv, 2)}. Treat flagged edges as hypotheses, not certainties. <Link className="underline" href="/history">See evidence →</Link>
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card title="Top value bets" action={<Link href="/value-bets" className="text-xs text-accent">All value bets →</Link>}>
            <BetTable bets={value} compact initial={{ minEv: 0, valueOnly: true }} />
          </Card>
          {topProb.length > 0 ? (
            <Card title="Highest probability with positive EV">
              <BetTable bets={topProb} compact initial={{ minEv: 0, sort: "modelProb", valueOnly: false }} />
            </Card>
          ) : (
            <Card title="Closest to value — best EV on the slate (may be negative)">
              <p className="mb-3 text-sm text-ink-3">
                No price clears the bookmaker margin after calibration. These are the nearest misses; a negative EV means the bet loses money on
                average at this price. Line shopping across books (set ODDS_API_KEY) is the most direct way to turn near-misses into value.
              </p>
              <BetTable bets={a.bets.filter((b) => b.kind === "player")} compact initial={{ minEv: -1, sort: "ev", valueOnly: false }} />
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Today's games" action={<Link href="/games" className="text-xs text-accent">Details →</Link>}>
            {a.games.length === 0 ? <Empty title="No NBA games today" /> : (
              <ul className="divide-y divide-line">
                {a.games.map((g) => {
                  const ml = a.bets.filter((b) => b.gameId === g.id && b.market === "ml");
                  const spread = a.bets.find((b) => b.gameId === g.id && b.market === "spread" && b.side === "home");
                  const total = a.bets.find((b) => b.gameId === g.id && b.market === "total" && b.side === "over");
                  return (
                    <li key={g.id}>
                      <Link href={`/games/${g.id}`} className="flex items-center gap-3 py-2.5 hover:text-accent">
                        <TeamLogo src={g.away?.logo} abbr={g.away?.abbr} />
                        <span className="w-20 text-sm font-bold">{g.away?.abbr} @ {g.home?.abbr}</span>
                        <TeamLogo src={g.home?.logo} abbr={g.home?.abbr} />
                        <span className="num ml-auto text-right text-xs text-ink-3">
                          {g.state === "pre" ? tipTime(g.date) : g.state === "post" ? `Final ${g.away_score}-${g.home_score}` : `Live ${g.away_score}-${g.home_score}`}
                          <br />
                          {spread ? `${g.home?.abbr} ${spread.line! > 0 ? "+" : ""}${spread.line}` : ""} {total ? `· o/u ${total.line}` : ""}
                          {ml.length === 2 && g.projection ? ` · model ${g.home?.abbr} ${pct(g.projection.homeWinProb, 0)}` : ""}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card title="Key injuries (today's teams)">
            {!a.injuriesAvailable ? <p className="text-sm text-neg">Injury report unavailable.</p> : keyInjuries.length === 0 ? <p className="text-sm text-ink-3">None reported.</p> : (
              <ul className="space-y-2 text-sm">
                {keyInjuries.map((i) => (
                  <li key={i.athleteId} className="flex items-start gap-2">
                    <InjuryBadge status={i.status} />
                    <span className="min-w-0">
                      <Link className="font-semibold hover:text-accent" href={`/players/${i.athleteId}`}>{i.name}</Link>
                      <span className="text-ink-3"> · {a.games.find((g) => g.home_id === i.teamId)?.home?.abbr ?? a.games.find((g) => g.away_id === i.teamId)?.away?.abbr} · {i.detail}</span>
                      <span className="block text-xs text-ink-3">{i.comment}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Market snapshot">
            <ul className="space-y-1 text-sm">
              {a.games.filter((g) => g.projection).map((g) => {
                const home = a.bets.find((b) => b.gameId === g.id && b.market === "ml" && b.side === "home");
                return (
                  <li key={g.id} className="num flex justify-between gap-2">
                    <span>{g.home?.abbr} win</span>
                    <span className="text-ink-3">book {home ? dec(home.price) : "—"} · no-vig {pct(home?.marketProb ?? null, 0)} · model {pct(home?.modelProb ?? g.projection!.homeWinProb, 0)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
