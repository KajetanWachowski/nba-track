import { AutoRefresh } from "@/components/AutoRefresh";
import { BetTable } from "@/components/BetTable";
import { Notice, PageHeader, SourceBar } from "@/components/ui";
import { dayLabel } from "@/lib/format";
import { loadSlate } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function ValueBets() {
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">Could not load slate: {error}</Notice>;
  return (
    <>
      <AutoRefresh seconds={300} />
      <PageHeader eyebrow={`Value bet finder · ${dayLabel(a.day)}`} title="Value" accent="Bets" />
      <SourceBar sources={a.sources} />
      {a.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        Every price on today&apos;s slate — player points, rebounds, assists, PRA and other combos, 3PT made, steals, blocks, double/triple doubles,
        moneyline, spread and totals — is scored by the model. A selection is a <b>value bet</b> only when the calibrated probability times the
        odds exceeds 1 (EV &gt; 0) and confidence is at least Medium. High probability alone is never enough: the price must pay more than the risk.
      </p>
      <BetTable bets={a.bets} initial={{ minEv: 0.02, valueOnly: true }} />
    </>
  );
}
