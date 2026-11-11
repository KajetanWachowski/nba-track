import { ActionButton } from "@/components/ActionButton";
import { ReliabilityChart } from "@/components/ReliabilityChart";
import { Term } from "@/components/Term";
import { Card, Empty, PageHeader, Stat } from "@/components/ui";
import { latestBacktest, type BetStats } from "@/lib/backtest";
import { ago, dayLabel, dec, num, pct, shortDate, signedPct } from "@/lib/format";
import { MARKET_LABEL, type Market } from "@/lib/markets";
import { listPredictions } from "@/lib/tracking";

export const dynamic = "force-dynamic";

const groupLabel = (k: string) => MARKET_LABEL[k as Market] ?? k;

function StatsTable({ rows }: { rows: [string, BetStats][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="num w-full min-w-[420px] text-sm">
        <thead><tr className="label text-left"><th className="py-1">Grupa</th><th>Zakłady</th><th>Trafione</th><th>Śr. kurs</th><th><Term k="roi">Yield</Term></th><th>Zysk</th><th><Term k="clv">CLV</Term></th></tr></thead>
        <tbody>
          {rows.map(([k, s]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5 font-semibold">{groupLabel(k)}</td><td>{s.bets}</td><td>{pct(s.winRate)}</td><td>{dec(s.avgOdds)}</td>
              <td className={s.yield > 0 ? "text-pos" : "text-neg"}>{signedPct(s.yield)}</td><td>{s.profit > 0 ? "+" : ""}{num(s.profit)} j.</td>
              <td className={(s.clv ?? 0) > 0 ? "text-pos" : "text-neg"}>{s.clv === null ? "—" : signedPct(s.clv, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS: Record<string, string> = { open: "oczekuje", void: "anulowany", push: "zwrot", settled: "rozliczony" };

export default function History() {
  const bt = latestBacktest();
  const preds = listPredictions(400);
  const settled = preds.filter((p) => p.status === "settled" && p.won !== null);
  const profit = settled.reduce((s, p) => s + (p.won ? p.price - 1 : -1), 0);
  const clvs = preds.filter((p) => p.clv !== null).map((p) => p.clv!);
  const se = (s: BetStats) => (s.bets ? (Math.sqrt(s.winRate * (1 - s.winRate)) * s.avgOdds) / Math.sqrt(s.bets) : NaN);
  return (
    <>
      <PageHeader eyebrow="Backtest i historia typów" title="Historia" accent="wyników">
        <div className="flex gap-3">
          <ActionButton endpoint="/api/backtest" label="Uruchom backtest" note="ok. 1–4 min · ponownie kalibruje model" />
          <ActionButton endpoint="/api/settle" label="Rozlicz typy" />
        </div>
      </PageHeader>

      <h2 className="label mb-2"><Term k="backtest">Backtest na rozegranych meczach (prawdziwe kursy otwarcia DraftKings)</Term></h2>
      {!bt ? <Empty title="Nie uruchomiono jeszcze backtestu">Uruchom go, aby zmierzyć trafność modelu i skalibrować prawdopodobieństwa.</Empty> : (
        <>
          <p className="mb-4 max-w-4xl text-sm text-ink-2">
            Uruchomiony {ago(bt.createdAt)} · mecze {dayLabel(bt.dates.from)} – {dayLabel(bt.dates.to)} · kalibracja na meczach do {dayLabel(bt.dates.trainTo)};
            wszystkie wyniki poniżej pochodzą z <b>późniejszych meczów, których model nie widział</b> ({bt.rows.test.toLocaleString("pl-PL")} linii).
            Każda prognoza używała tylko danych sprzed danego meczu — bez przecieku danych.
          </p>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Log loss — propsy" value={bt.metrics.player.logLossCal.toFixed(4)} sub={`rynek ${bt.metrics.player.logLossMarket.toFixed(4)} · surowy model ${bt.metrics.player.logLossRaw.toFixed(4)}`} tone={bt.metrics.player.logLossCal < bt.metrics.player.logLossMarket ? "pos" : "neg"} />
            <Stat label="Brier — propsy" value={bt.metrics.player.brierCal.toFixed(4)} sub={`rynek ${bt.metrics.player.brierMarket.toFixed(4)} · surowy ${bt.metrics.player.brierRaw.toFixed(4)}`} tone={bt.metrics.player.brierCal < bt.metrics.player.brierMarket ? "pos" : "neg"} />
            <Stat label={`Symulowany yield (EV ≥ ${pct(bt.betting.minEv, 0)})`} value={signedPct(bt.betting.overall.yield)} sub={`${bt.betting.overall.bets} zakładów · błąd ±${pct(se(bt.betting.overall))}`} tone={bt.betting.overall.yield > 0 ? "pos" : "neg"} />
            <Stat label="CLV" value={signedPct(bt.betting.overall.clv, 2)} sub={`lepszy od zamknięcia w ${pct(bt.betting.overall.beatClose)} z ${bt.betting.overall.clvN}`} tone={(bt.betting.overall.clv ?? 0) > 0 ? "pos" : "neg"} />
          </div>
          <p className="-mt-3 mb-6 text-xs text-ink-3">
            Jak czytać: <Term k="logloss">log loss</Term> i <Term k="brier">Brier</Term> — niżej znaczy lepiej; porównujemy je z rynkiem bez marży. Ujemne <Term k="clv">CLV</Term> oznacza,
            że kursy ruszały się przeciw symulowanym typom — to sygnał, że przewaga nie jest potwierdzona.
          </p>

          {bt.byMarket && (
            <Card title="Model vs rynek według typu zakładu (podstawa rekomendacji)" className="mb-6">
              <div className="overflow-x-auto">
                <table className="num w-full min-w-[520px] text-sm">
                  <thead><tr className="label text-left"><th className="py-1">Typ zakładu</th><th>Linie</th><th>Log loss modelu</th><th>Log loss rynku</th><th>Wynik</th></tr></thead>
                  <tbody>
                    {Object.entries(bt.byMarket).sort((a, b) => b[1].n - a[1].n).map(([m, v]) => {
                      const better = v.logLossCal < v.logLossMarket;
                      return (
                        <tr key={m} className="border-t border-line">
                          <td className="py-1.5 font-semibold">{groupLabel(m)}</td><td>{v.n}</td><td>{v.logLossCal.toFixed(4)}</td><td>{v.logLossMarket.toFixed(4)}</td>
                          <td className={better ? "text-pos" : "text-neg"}>{better ? "model lepszy — może być polecany" : "model nie lepszy — tylko obserwacja"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-ink-3">Różnice są małe — „lepszy” nie oznacza dużej przewagi. Typy, w których model nie był lepszy od rynku, nie trafiają do kategorii „Najlepsze” ani „Dobre”.</p>
            </Card>
          )}

          <div className="mb-6 grid gap-4 xl:grid-cols-2">
            <Card title="Kalibracja — czy np. 60% oznacza w praktyce ok. 60%?">
              <ReliabilityChart data={bt.reliability} />
              <div className="overflow-x-auto">
                <table className="num mt-3 w-full min-w-[480px] text-xs">
                  <thead><tr className="text-left text-ink-3"><th>Przedział</th><th>Liczba</th><th>Skalibrowany → wynik</th><th>Surowy → wynik</th><th>Rynek → wynik</th></tr></thead>
                  <tbody>
                    {bt.reliability.cal.map((b, i) => (bt.reliability.raw[i].n || b.n) ? (
                      <tr key={i} className="border-t border-line"><td>{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</td><td>{b.n}</td>
                        <td>{b.n ? `${pct(b.predicted)} → ${pct(b.observed)}` : "—"}</td>
                        <td>{bt.reliability.raw[i].n ? `${pct(bt.reliability.raw[i].predicted)} → ${pct(bt.reliability.raw[i].observed)}` : "—"}</td>
                        <td>{bt.reliability.market[i].n ? `${pct(bt.reliability.market[i].predicted)} → ${pct(bt.reliability.market[i].observed)}` : "—"}</td></tr>
                    ) : null)}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Dokładność i wykrywanie błędów modelu">
              <table className="num w-full text-sm">
                <thead><tr className="label text-left"><th className="py-1">Zakres</th><th>Linie</th><th>Surowy</th><th>Rynek</th><th>Skalibrowany</th></tr></thead>
                <tbody>
                  {(["player", "game"] as const).map((k) => (
                    <tr key={k} className="border-t border-line"><td className="py-1.5 font-semibold">{k === "player" ? "Zawodnicy" : "Linie meczowe"}</td><td>{bt.metrics[k].n}</td>
                      <td>{bt.metrics[k].logLossRaw.toFixed(4)}</td><td>{bt.metrics[k].logLossMarket.toFixed(4)}</td><td className={bt.metrics[k].logLossCal < bt.metrics[k].logLossMarket ? "text-pos" : "text-neg"}>{bt.metrics[k].logLossCal.toFixed(4)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="label mb-1 mt-4">Czy rozkład wyników jest realistyczny?</div>
              <div className="overflow-x-auto">
                <table className="num w-full min-w-[420px] text-sm">
                  <thead><tr className="text-left text-xs text-ink-3"><th>Rynek</th><th>Linie</th><th>Wynik w przedziale 80%</th><th>Błąd modelu (RMSE)</th><th>Błąd linii bukmachera</th></tr></thead>
                  <tbody>{bt.distributionChecks?.map((d) => (
                    <tr key={d.market} className="border-t border-line"><td className="py-1">{groupLabel(d.market)}</td><td>{d.n}</td><td>{pct(d.coverage80)}</td>
                      <td className={d.rmseModel <= d.rmseLine ? "text-pos" : ""}>{num(d.rmseModel, 2)}</td><td>{num(d.rmseLine, 2)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-ink-3">Około 80% oznacza dobrze dobrany rozrzut. Jeśli błąd modelu jest większy niż błąd linii, bukmacher lepiej trafia średnią — model wtedy mocno opiera się na rynku.</p>
              <div className="label mb-1 mt-4"><Term k="calibration">Parametry kalibracji</Term></div>
              <p className="num text-xs text-ink-2">
                zawodnicy: waga modelu {num(bt.calibration.player.b, 2)}, waga rynku {num(bt.calibration.player.c, 2)} (n={bt.calibration.player.n})<br />
                mecze: waga modelu {num(bt.calibration.game.b, 2)}, waga rynku {num(bt.calibration.game.c, 2)} (n={bt.calibration.game.n})
              </p>
              <ul className="mt-3 space-y-1 text-xs text-ink-3">{bt.notes.map((n) => <li key={n}>• {n}</li>)}</ul>
            </Card>
          </div>
          <div className="mb-8 grid gap-4 xl:grid-cols-3">
            <Card title="Według typu zakładu"><StatsTable rows={Object.entries(bt.betting.byMarket).sort((a, b) => b[1].bets - a[1].bets)} /></Card>
            <Card title="Według przedziału kursów"><StatsTable rows={Object.entries(bt.betting.byOdds).sort()} /></Card>
            <Card title="Według prawdopodobieństwa modelu"><StatsTable rows={Object.entries(bt.betting.byProb).sort()} /></Card>
          </div>
        </>
      )}

      <h2 className="label mb-2">Historia rekomendacji (zapisane w chwili pokazania, rozliczane po meczu)</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Zapisane" value={preds.length} sub={`${preds.filter((p) => p.status === "open").length} oczekuje`} />
        <Stat label="Rozliczone" value={settled.length} sub={`${preds.filter((p) => p.status === "void").length} anulowanych`} />
        <Stat label="Trafione" value={settled.length ? pct(settled.filter((p) => p.won).length / settled.length) : "—"} />
        <Stat label="Yield (stawka 1 j.)" value={settled.length ? signedPct(profit / settled.length) : "—"} sub={settled.length ? `${profit > 0 ? "+" : ""}${num(profit)} j. · ROI na 100 j. ${signedPct(profit / 100)}` : ""} tone={profit > 0 ? "pos" : profit < 0 ? "neg" : undefined} />
        <Stat label="Średnie CLV" value={clvs.length ? signedPct(clvs.reduce((a, b) => a + b, 0) / clvs.length, 2) : "—"} sub={`${clvs.length} z kursem zamknięcia`} />
      </div>
      {preds.length === 0 ? <Empty title="Brak zapisanych rekomendacji">Propozycje z kategorii „Najlepsze” i „Dobre” są zapisywane automatycznie przy pierwszym wyświetleniu.</Empty> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[900px] text-sm">
              <thead><tr className="label text-left"><th className="py-1">Data</th><th>Zakład</th><th>Bukmacher</th><th>Kurs</th><th>Model</th><th>EV</th><th>Jakość</th><th>Wynik</th><th>Zamknięcie</th><th>CLV</th></tr></thead>
              <tbody>
                {preds.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-1.5">{shortDate(p.game_date)}</td>
                    <td><span className="font-semibold">{p.subject_name}</span> <span className="text-ink-3">{p.side === "over" ? "powyżej" : p.side === "under" ? "poniżej" : p.side} {p.line ?? ""} · {groupLabel(p.market)}</span></td>
                    <td>{p.book}</td><td>{dec(p.price)}</td><td>{pct(p.model_prob)}</td><td className="text-pos">{signedPct(p.ev)}</td><td>{p.confidence === "High" ? "wysoka" : p.confidence === "Medium" ? "średnia" : "niska"}</td>
                    <td className={p.won === 1 ? "font-bold text-pos" : p.won === 0 ? "text-neg" : "text-ink-3"}>{p.status === "settled" && p.won !== null ? `${p.won ? "WYGRANY" : "PRZEGRANY"} (${p.actual})` : STATUS[p.status] ?? p.status}</td>
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
