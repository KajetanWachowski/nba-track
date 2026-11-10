import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Card, Notice, PageHeader, SourceBar } from "@/components/ui";
import type { BetEval } from "@/lib/engine";
import { dec, pct, signedPct } from "@/lib/format";
import { loadSlate } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function Odds({ searchParams }: { searchParams: Promise<{ game?: string; market?: string }> }) {
  const sp = await searchParams;
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">{error}</Notice>;
  const gameId = sp.game ?? a.games.find((g) => g.state === "pre")?.id ?? a.games[0]?.id;
  const game = a.games.find((g) => g.id === gameId);
  const bets = a.bets.filter((b) => b.gameId === gameId);
  const books = [...new Set(bets.flatMap((b) => b.offers.map((o) => o.book)))];
  const market = sp.market ?? "all";

  // pair over/under (or home/away) rows
  const pairs: { over: BetEval; under: BetEval | undefined }[] = [];
  for (const b of bets) {
    if (b.side === "under" || b.side === "away") continue;
    if (market !== "all" && b.market !== market) continue;
    const under = bets.find((x) => x.market === b.market && x.line !== null && b.line !== null && (b.kind === "game" ? x.side === (b.side === "home" ? "away" : "under") && (b.market === "spread" ? x.line === -b.line : x.line === b.line) : x.subjectId === b.subjectId && x.side === "under" && x.line === b.line));
    pairs.push({ over: b, under: b.market === "ml" ? bets.find((x) => x.market === "ml" && x.side === "away") : under });
  }
  pairs.sort((x, y) => (x.over.kind === y.over.kind ? x.over.subjectName.localeCompare(y.over.subjectName) || x.over.market.localeCompare(y.over.market) || (x.over.line ?? 0) - (y.over.line ?? 0) : x.over.kind === "game" ? -1 : 1));
  const markets = [...new Set(bets.map((b) => b.market))];

  return (
    <>
      <AutoRefresh seconds={300} />
      <PageHeader eyebrow="Prices, vig and line movement" title="Odds" accent="Comparison" />
      <SourceBar sources={a.sources} />
      {books.length <= 1 && (
        <Notice tone="neutral">
          Showing DraftKings (published via ESPN). Set <code>ODDS_API_KEY</code> to add FanDuel, BetMGM, Caesars, Pinnacle and more for line shopping and a sharper no-vig reference.
        </Notice>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {a.games.map((g) => (
          <Link key={g.id} href={`/odds?game=${g.id}`} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${g.id === gameId ? "border-accent text-accent" : "border-line text-ink-2"}`}>{g.away?.abbr} @ {g.home?.abbr}</Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1 text-xs">
        {["all", ...markets].map((m) => (
          <Link key={m} href={`/odds?game=${gameId}&market=${m}`} className={`rounded-md px-2 py-1 ${m === market ? "bg-ink text-bg" : "bg-surface text-ink-3"}`}>{m.toUpperCase()}</Link>
        ))}
      </div>
      <Card title={game ? `${game.away?.name} @ ${game.home?.name}` : "No game"}>
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[980px] text-sm">
            <thead>
              <tr className="label text-left">
                <th className="py-2">Subject</th><th>Market</th><th>Line</th>
                {books.map((bk) => <th key={bk}>{bk} O / U</th>)}
                <th>Vig</th><th>No-vig over</th><th>Model over</th><th>Best EV</th><th>Open</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map(({ over, under }) => {
                const vig = over.marketProb !== null && under ? 1 / over.price + 1 / under.price - 1 : null;
                const bestEv = Math.max(over.ev, under?.ev ?? -1);
                return (
                  <tr key={over.id} className="border-t border-line">
                    <td className="py-1.5 font-semibold">{over.kind === "player" ? <Link className="hover:text-accent" href={`/players/${over.subjectId}?market=${over.market}&line=${over.line}`}>{over.subjectName}</Link> : over.subjectName}</td>
                    <td>{over.marketLabel}{over.marketType === "milestone" ? " (X+)" : ""}</td>
                    <td>{over.market === "ml" ? "—" : over.line}</td>
                    {books.map((bk) => {
                      const o = over.offers.find((x) => x.book === bk);
                      const u = under?.offers.find((x) => x.book === bk);
                      const bestO = o && o.dec === over.price;
                      const bestU = u && under && u.dec === under.price;
                      return <td key={bk}><span className={bestO ? "font-bold text-pos" : ""}>{dec(o?.dec)}</span> / <span className={bestU ? "font-bold text-pos" : ""}>{dec(u?.dec ?? o?.oppDec)}</span></td>;
                    })}
                    <td className="text-ink-3">{vig !== null ? pct(vig) : over.marketType === "game" ? "—" : "1-way"}</td>
                    <td>{pct(over.marketProb)}</td>
                    <td>{pct(over.modelProb)} <span className="text-xs text-ink-3">raw {pct(over.rawProb, 0)}</span></td>
                    <td className={bestEv > 0 ? "font-bold text-pos" : "text-neg"}>{signedPct(bestEv)}</td>
                    <td className="text-ink-3">{over.openLine !== null && over.openLine !== over.line ? `${over.openLine} → ${over.line}` : over.openPrice ? dec(over.openPrice) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-3">Best price per side in green. Vig = overround of the two-way market. No-vig uses the power method. Model over = calibrated probability of the over/home/yes side.</p>
      </Card>
    </>
  );
}
