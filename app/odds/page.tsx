import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Term } from "@/components/Term";
import { Card, Notice, PageHeader, SourceBar } from "@/components/ui";
import type { BetEval } from "@/lib/engine";
import { ago, dec, pct, signedPct } from "@/lib/format";
import { MARKET_LABEL } from "@/lib/markets";
import { loadSlate } from "@/lib/page-data";

export const dynamic = "force-dynamic";

const PL_ORDER = ["superbet", "betclic", "betfan", "fortuna", "sts", "forbet"];

export default async function Odds({ searchParams }: { searchParams: Promise<{ game?: string; market?: string }> }) {
  const sp = await searchParams;
  const { a, error } = await loadSlate();
  if (!a) return <Notice tone="neg">{error}</Notice>;
  const gameId = sp.game ?? a.games.find((g) => g.state === "pre")?.id ?? a.games[0]?.id;
  const game = a.games.find((g) => g.id === gameId);
  const market = sp.market ?? "all";
  const bets = a.bets.filter((b) => b.gameId === gameId && (market === "all" || b.market === market) && b.marketType !== "milestone");
  const keys = new Set(bets.flatMap((b) => b.offers.map((o) => o.bookKey)));
  const plBooks = PL_ORDER.filter((k) => k === "superbet" || k === "betclic" || k === "betfan" || keys.has(k));
  const usBooks = [...keys].filter((k) => !PL_ORDER.includes(k));
  const title = (b: BetEval, k: string) => b.offers.find((o) => o.bookKey === k);
  const markets = [...new Set(a.bets.filter((b) => b.gameId === gameId).map((b) => b.market))];
  const rows = [...bets].sort((x, y) => (x.kind === y.kind ? x.subjectName.localeCompare(y.subjectName) || x.market.localeCompare(y.market) || (x.line ?? 0) - (y.line ?? 0) || x.side.localeCompare(y.side) : x.kind === "game" ? -1 : 1));
  const nameOf: Record<string, string> = { superbet: "Superbet", betclic: "Betclic", betfan: "Betfan", fortuna: "Fortuna", sts: "STS", forbet: "Forbet" };

  return (
    <>
      <AutoRefresh seconds={300} />
      <PageHeader eyebrow="Superbet na pierwszym miejscu · kursy USA tylko do porównania" title="Porównanie" accent="kursów" />
      <SourceBar sources={a.sources} />
      <Notice tone="neutral">
        Najlepszy kurs wśród polskich bukmacherów jest wyróżniony na zielono. Kolumny amerykańskie (<Term k="reference">kurs referencyjny</Term>) pokazują, jak wycenia
        to rynek USA — nie da się ich zagrać w Polsce. Kursy polskie pobierzesz lub wpiszesz na stronie <Link className="underline" href="/pl-odds">Polskie kursy</Link>.
      </Notice>
      <div className="mb-4 flex flex-wrap gap-2">
        {a.games.map((g) => (
          <Link key={g.id} href={`/odds?game=${g.id}`} className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${g.id === gameId ? "border-accent text-accent" : "border-line text-ink-2"}`}>{g.away?.abbr} @ {g.home?.abbr}</Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1 text-xs">
        {["all", ...markets].map((m) => (
          <Link key={m} href={`/odds?game=${gameId}&market=${m}`} className={`rounded-md px-2 py-1 ${m === market ? "bg-ink text-bg" : "bg-surface text-ink-3"}`}>{m === "all" ? "Wszystkie rynki" : MARKET_LABEL[m as keyof typeof MARKET_LABEL]}</Link>
        ))}
      </div>
      <Card title={game ? `${game.away?.name} @ ${game.home?.name}` : "Brak meczu"}>
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[980px] whitespace-nowrap text-sm">
            <thead>
              <tr className="label text-left">
                <th className="py-2">Zakład</th>
                {plBooks.map((k) => <th key={k}>{nameOf[k]}</th>)}
                <th>Różnica w PL</th>
                {usBooks.map((k) => <th key={k} className="text-ink-3">{k === "draftkings" ? "DraftKings (USA)" : `${k} (USA)`}</th>)}
                <th><Term k="novig">Rynek bez marży</Term></th>
                <th><Term k="prob">Model</Term></th>
                <th><Term k="ev">EV</Term></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const pl = b.offers.filter((o) => o.polish);
                const best = pl.length ? Math.max(...pl.map((o) => o.eff)) : null;
                const worst = pl.length ? Math.min(...pl.map((o) => o.eff)) : null;
                return (
                  <tr key={b.id} className="border-t border-line">
                    <td className="py-1.5">
                      {b.kind === "player" ? <Link className="font-semibold hover:text-accent" href={`/players/${b.subjectId}?market=${b.market}&line=${b.line ?? ""}`}>{b.subjectName}</Link> : <span className="font-semibold">{b.subjectName}</span>}
                      <span className="block text-xs text-ink-3">{b.selection}</span>
                    </td>
                    {plBooks.map((k) => {
                      const o = title(b, k);
                      return (
                        <td key={k} className={o && o.eff === best ? "font-bold text-pos" : ""} title={o ? `${o.source === "manual" ? "wpisany ręcznie" : "API"} · ${ago(o.seenAt)}` : ""}>
                          {o ? dec(o.dec) : <span className="text-ink-3">—</span>}
                          {o?.source === "manual" && <span className="ml-1 text-[10px] text-warn">ręcznie</span>}
                        </td>
                      );
                    })}
                    <td className="text-ink-3">{best && worst && pl.length > 1 ? signedPct(best / worst - 1, 1) : "—"}</td>
                    {usBooks.map((k) => <td key={k} className="text-ink-3">{dec(title(b, k)?.dec)}</td>)}
                    <td>{pct(b.marketProb)}</td>
                    <td>{pct(b.modelProb)}</td>
                    <td className={b.ev > 0 ? "font-bold text-pos" : "text-neg"} title={b.playable ? `na kursie ${b.book}` : "na kursie USA — tylko orientacyjnie"}>{signedPct(b.ev)}{!b.playable && <span className="ml-1 text-[10px] text-ink-3">USA</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          „Różnica w PL” = o ile najlepszy polski kurs jest wyższy od najniższego. EV liczone na kursie Superbet (lub najlepszym polskim); oznaczenie „USA” = brak
          polskiego kursu, wartość wyłącznie orientacyjna. Najedź na kurs, aby zobaczyć źródło i czas aktualizacji.
        </p>
      </Card>
    </>
  );
}
