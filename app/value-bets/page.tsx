import { AutoRefresh } from "@/components/AutoRefresh";
import { PickBoard } from "@/components/PickBoard";
import { Term } from "@/components/Term";
import { Notice, PageHeader, SourceBar } from "@/components/ui";
import { dayLabel } from "@/lib/format";
import { boardBets, loadSlate } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function ValueBets() {
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">Nie udało się wczytać meczów: {error}</Notice>;
  const { list, totals } = boardBets(a.bets);
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
      <PickBoard bets={list} totals={totals} />
    </>
  );
}
