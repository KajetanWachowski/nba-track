import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PickBoard } from "@/components/PickBoard";
import { Term } from "@/components/Term";
import { Card, Empty, InjuryBadge, Notice, PageHeader, SourceBar, Stat, TeamLogo } from "@/components/ui";
import { latestBacktest } from "@/lib/backtest";
import { dayLabel, pct, signedPct, tipTime } from "@/lib/format";
import { boardBets, loadSlate } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { a, error } = await loadSlate();
  if (!a) return <><PageHeader eyebrow="Pulpit" title="NBA" accent="Edge" /><Notice tone="neg">Nie udało się wczytać dzisiejszych meczów: {error}. Uruchom <code>npm run sync</code> i sprawdź połączenie.</Notice></>;
  const bt = latestBacktest();
  const { totals } = boardBets(a.bets);
  const top = a.bets.filter((b) => (b.assessment.category === "najlepsze" || b.assessment.category === "dobre") && b.price >= 1.5).slice(0, 6);
  // pulpit: obserwowane zakłady na zawodników (linie meczowe są na stronie Propozycji)
  const watch = a.bets.filter((b) => b.assessment.category === "obserwuj" && b.kind === "player" && b.price >= 1.5).slice(0, 4);
  const pre = a.games.filter((g) => g.state === "pre");
  const playable = a.bets.filter((b) => b.playable).length;
  const keyInjuries = a.injuries.filter((i) => a.games.some((g) => g.home_id === i.teamId || g.away_id === i.teamId)).filter((i) => i.status !== "PROBABLE").slice(0, 12);
  return (
    <>
      <AutoRefresh seconds={300} />
      <PageHeader eyebrow={`Pulpit · ${dayLabel(a.day)}`} title="Dzisiejsze" accent="mecze" />
      <SourceBar sources={a.sources} />
      {a.warnings.map((w) => <Notice key={w}>{w}</Notice>)}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Mecze dziś" value={a.games.length} sub={`${pre.length} przed rozpoczęciem`} />
        <Stat label="Przeanalizowane zakłady" value={a.bets.length.toLocaleString("pl-PL")} sub={`${a.playersAnalyzed} zawodników · ${playable} z kursem PL`} />
        <Stat label="Najlepsze / dobre" value={`${totals.najlepsze} / ${totals.dobre}`} tone={totals.najlepsze + totals.dobre ? "pos" : undefined} sub={`${totals.obserwuj} wartych obserwacji · ${totals.odrzucone} odrzuconych`} />
        <Stat
          label="Model vs rynek (backtest)"
          value={bt ? bt.metrics.player.logLossCal.toFixed(4) : "—"}
          sub={bt ? `rynek ${bt.metrics.player.logLossMarket.toFixed(4)} · niżej = lepiej` : "brak backtestu"}
          tone={bt ? (bt.metrics.player.logLossCal < bt.metrics.player.logLossMarket ? "pos" : "neg") : undefined}
        />
      </div>

      {bt && (
        <Notice tone="neutral">
          Uczciwie: w ostatnim teście na rozegranych meczach model był tylko nieznacznie lepszy od rynku (<Term k="logloss">log loss</Term>{" "}
          {bt.metrics.player.logLossCal.toFixed(4)} vs {bt.metrics.player.logLossMarket.toFixed(4)}), a <Term k="clv">CLV</Term> symulowanych zakładów wyniosło{" "}
          {signedPct(bt.betting.overall.clv, 2)}. Traktuj propozycje jako dobrze uzasadnione hipotezy, nie pewniki. <Link className="underline" href="/history">Szczegóły →</Link>
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between"><h2 className="label">Najlepsze i dobre propozycje</h2><Link href="/value-bets" className="text-xs text-accent">Wszystkie propozycje →</Link></div>
            <PickBoard bets={top} compact showRejected={false} emptyMessage />
          </div>
          {watch.length > 0 && (
            <div>
              <h2 className="label mb-3">Warte obserwacji</h2>
              <PickBoard bets={watch} compact showRejected={false} />
            </div>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Dzisiejsze mecze" action={<Link href="/games" className="text-xs text-accent">Szczegóły →</Link>}>
            {a.games.length === 0 ? <Empty title="Dziś nie ma meczów NBA" /> : (
              <ul className="divide-y divide-line">
                {a.games.map((g) => (
                  <li key={g.id}>
                    <Link href={`/games/${g.id}`} className="flex items-center gap-3 py-2.5 hover:text-accent">
                      <TeamLogo src={g.away?.logo} abbr={g.away?.abbr} />
                      <span className="w-24 text-sm font-bold">{g.away?.abbr} @ {g.home?.abbr}</span>
                      <TeamLogo src={g.home?.logo} abbr={g.home?.abbr} />
                      <span className="num ml-auto text-right text-xs text-ink-3">
                        {g.state === "pre" ? tipTime(g.date) : g.state === "post" ? `koniec ${g.away_score}:${g.home_score}` : `trwa ${g.away_score}:${g.home_score}`}
                        {g.projection ? <><br />szansa {g.home?.abbr}: {pct(g.projection.homeWinProb, 0)}</> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Najważniejsze kontuzje">
            {!a.injuriesAvailable ? <p className="text-sm text-neg">Raport kontuzji jest niedostępny.</p> : keyInjuries.length === 0 ? <p className="text-sm text-ink-3">Brak zgłoszeń.</p> : (
              <ul className="space-y-2 text-sm">
                {keyInjuries.map((i) => (
                  <li key={i.athleteId} className="flex items-start gap-2">
                    <InjuryBadge status={i.status} />
                    <span className="min-w-0">
                      <Link className="font-semibold hover:text-accent" href={`/players/${i.athleteId}`}>{i.name}</Link>
                      <span className="text-ink-3"> · {i.detail}</span>
                      <span className="block text-xs text-ink-3">{i.comment}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
