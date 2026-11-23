import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PlayerLab } from "@/components/PlayerLab";
import { Card, InjuryBadge, PageHeader, TeamLogo } from "@/components/ui";
import { getPlayerAnalysis } from "@/lib/analysis";
import { dayLabel, num, shortDate, tipTime } from "@/lib/format";
import { getCalibration } from "@/lib/model/calibrate";

export const dynamic = "force-dynamic";

const COLS: [string, string][] = [["min", "MIN"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["fg3m", "3PM"], ["stl", "STL"], ["blk", "BLK"], ["tov", "TOV"]];

export default async function PlayerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ market?: string; line?: string }> }) {
  const { id } = await params;
  // pojedynek H2H („A:B”) → strona pierwszego zawodnika
  if (decodeURIComponent(id).includes(":")) redirect(`/players/${decodeURIComponent(id).split(":")[0]}`);
  const sp = await searchParams;
  const a = await getPlayerAnalysis(id);
  if (!a) notFound();
  const cal = getCalibration("player");
  const pra = (v: Record<string, number>) => v.pts + v.reb + v.ast;
  return (
    <>
      <PageHeader eyebrow={`${a.team?.name ?? "Wolny agent"} · ${a.pos === "G" ? "obrońca" : a.pos === "F" ? "skrzydłowy" : "środkowy"}`} title={a.name.split(" ").slice(0, -1).join(" ")} accent={a.name.split(" ").at(-1)}>
        <div className="flex items-center gap-4">
          {a.injury && <span className="text-right text-xs"><InjuryBadge status={a.injury.status} /><span className="mt-1 block max-w-64 text-ink-3">{a.injury.comment}</span></span>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {a.headshot && <img src={a.headshot} alt={a.name} width={130} height={95} className="hidden h-24 w-32 rounded-2xl bg-surface object-cover object-top sm:block" />}
        </div>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-sm">
        {a.next ? (
          <>
            <span className="label">Następny mecz</span>
            <TeamLogo src={a.team?.logo} abbr={a.team?.abbr} />
            <span className="font-bold">{a.next.home ? "vs" : "@"} {a.next.opp?.abbr}</span>
            <TeamLogo src={a.next.opp?.logo} abbr={a.next.opp?.abbr} />
            <span className="text-ink-3">{dayLabel(a.next.game.day)} · {tipTime(a.next.game.date)}</span>
            {a.next.restDays === 0 && <span className="rounded-md bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">Mecz dzień po dniu</span>}
            {a.next.opp && <Link href={`/matchups?team=${a.next.opp.id}`} className="ml-auto text-accent">obrona {a.next.opp.abbr} →</Link>}
          </>
        ) : <span className="text-ink-3">Brak meczu w ciągu najbliższych 7 dni.</span>}
      </div>

      <PlayerLab a={a} initialMarket={sp.market} initialLine={sp.line ? Number(sp.line) : undefined} cal={cal} />

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="Średnie">
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead><tr className="label text-left"><th className="py-1">Okres</th><th>Mecze</th>{COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>PRA</th><th>USG%</th></tr></thead>
              <tbody>
                {a.averages.map((r) => (
                  <tr key={r.label} className="border-t border-line"><td className="py-1.5 font-semibold">{r.label}</td><td>{r.n}</td>{COLS.map(([k]) => <td key={k}>{num(r.values[k as keyof typeof r.values])}</td>)}<td>{num(pra(r.values))}</td><td>{num(r.values.usg)}</td></tr>
                ))}
                {a.priorSeason && (
                  <tr className="border-t border-line text-ink-3"><td className="py-1.5">Poprzedni sezon</td><td>{a.priorSeason.games}</td>{COLS.map(([k]) => <td key={k}>{num(a.priorSeason!.avg[k as keyof typeof a.priorSeason.avg])}</td>)}<td>{num(pra(a.priorSeason.avg))}</td><td>—</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Podziały: dom/wyjazd i nieobecności kolegów">
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead><tr className="label text-left"><th className="py-1">Podział</th><th>Mecze</th>{COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>PRA</th></tr></thead>
              <tbody>
                {a.splits.map((r) => (
                  <tr key={r.label} className="border-t border-line"><td className="py-1.5 font-semibold">{r.label}</td><td>{r.n}</td>{COLS.map(([k]) => <td key={k}>{num(r.values[k as keyof typeof r.values])}</td>)}<td>{num(pra(r.values))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-3">„Bez X” = mecze, w których zawodnik grał, a X nie. Małe próbki są niepewne — model mocno je wygładza.</p>
        </Card>
      </div>

      <Card title="Mecze w tym sezonie" className="mt-6">
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead><tr className="label text-left"><th className="py-1">Data</th><th>Rywal</th>{COLS.map(([, l]) => <th key={l}>{l}</th>)}<th>PRA</th><th>USG%</th></tr></thead>
            <tbody>
              {[...a.games].reverse().map((g) => (
                <tr key={g.game_id} className="border-t border-line">
                  <td className="py-1.5">{shortDate(g.date)}</td><td>{g.home ? "vs" : "@"} {a.teams[g.opp_id]?.abbr}</td>
                  {COLS.map(([k]) => <td key={k}>{(g as unknown as Record<string, number>)[k]}</td>)}<td>{g.pts + g.reb + g.ast}</td><td>{num(g.usg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
