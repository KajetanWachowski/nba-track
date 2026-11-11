import { AutoRefresh } from "@/components/AutoRefresh";
import { PickBoard } from "@/components/PickBoard";
import { Term } from "@/components/Term";
import { Notice, PageHeader, SourceBar } from "@/components/ui";
import { dayLabel } from "@/lib/format";
import { boardBets, loadSlate } from "@/lib/page-data";
import { latestBacktest } from "@/lib/backtest";
import { pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ValueBets() {
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">Nie udało się wczytać meczów: {error}</Notice>;
  const { list, totals } = boardBets(a.bets);
  const bt = latestBacktest();
  const ev60 = bt?.highProb?.find((h) => h.threshold === 0.6);
  // najwyższa szansa: skalibrowane ≥ 60%, kurs ≥ 1.50, bez ryzyk krytycznych, typ zweryfikowany w backteście
  const highProb = a.bets
    .filter((b) => b.kind === "player" && b.modelProb >= 0.6 && b.price >= 1.5 && b.assessment.category !== "odrzucone" && !b.assessment.risks.some((r) => r.severity === "krytyczne"))
    .sort((x, y) => y.modelProb - x.modelProb)
    .slice(0, 6);
  return (
    <>
      <AutoRefresh seconds={300} />
      <PageHeader eyebrow={`Wyszukiwarka zakładów · ${dayLabel(a.day)}`} title="Propozycje" accent="zakładów" />
      <SourceBar sources={a.sources} />
      {a.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
      <div className="mb-5 max-w-3xl space-y-2 text-sm text-ink-2">
        <p>
          Każdy zakład oceniamy w trzech niezależnych wymiarach: <Term k="prob">prawdopodobieństwo</Term>, <Term k="quality">jakość danych</Term> i{" "}
          <Term k="value">opłacalność</Term>. Najpierw liczy się solidność prognozy, dopiero potem kurs — samo dodatnie <Term k="ev">EV</Term> nie wystarcza.
        </p>
        <p>
          Kursy: najpierw <b>Superbet</b>, potem najlepszy inny polski bukmacher. Kursy amerykańskie służą wyłącznie do porównania. Przy każdym zakładzie
          znajdziesz też sekcję <b>„Co przemawia przeciwko”</b> — słaba ostatnia forma liczy się nawet przy dobrej średniej sezonowej.
        </p>
      </div>
      <section className="mb-8 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-base font-black">Najwyższa szansa (≥ 60%, kurs ≥ 1.50)</h2>
        <p className="mb-3 mt-1 text-sm text-ink-2">
          Zakłady, którym model daje największą szansę — niezależnie od tego, czy kurs jest już korzystny.
          {ev60 && ev60.n > 0 && <> W teście na rozegranych meczach typy z szansą ≥ 60% wchodziły w <b>{pct(ev60.observed)}</b> przypadków ({ev60.n} typów; model obiecywał {pct(ev60.promised)}).</>}
          {" "}Wysoka szansa nie oznacza opłacalności — sprawdź EV i kurs Superbet.
        </p>
        {highProb.length ? <PickBoard bets={highProb} compact showRejected={false} /> : <p className="text-sm text-ink-3">Brak zakładów spełniających te warunki.</p>}
      </section>
      <PickBoard bets={list} totals={totals} />
    </>
  );
}
