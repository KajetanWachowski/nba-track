import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BetTable } from "@/components/BetTable";
import { Card, InjuryBadge, Notice, PageHeader, SourceBar, TeamLogo } from "@/components/ui";
import { getLeagueDefense } from "@/lib/analysis";
import { dec, num, pct, pp, signedPct, tipTime } from "@/lib/format";
import { loadSlate } from "@/lib/page-data";
import { getGame } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g0 = getGame(id);
  if (!g0) notFound();
  const { a, error } = await loadSlate(g0.day);
  if (!a) return <Notice tone="neg">{error}</Notice>;
  const g = a.games.find((x) => x.id === id);
  if (!g) notFound();
  const bets = a.bets.filter((b) => b.gameId === id);
  const gameBets = bets.filter((b) => b.kind === "game");
  const def = getLeagueDefense();
  const th = def.teams.find((t) => t.team.id === g.home_id);
  const ta = def.teams.find((t) => t.team.id === g.away_id);
  const inj = (teamId: string) => a.injuries.filter((i) => i.teamId === teamId);
  const p = g.projection;
  return (
    <>
      <AutoRefresh seconds={180} />
      <PageHeader eyebrow={`${tipTime(g.date)} · ${g.state === "pre" ? "scheduled" : g.status.replace("STATUS_", "").toLowerCase()}`} title={`${g.away?.abbr} @`} accent={g.home?.abbr}>
        <Link href={`/matchups?team=${g.home_id}&vs=${g.away_id}`} className="rounded-lg border border-line px-3 py-1.5 text-sm">Matchup analysis →</Link>
      </PageHeader>
      <SourceBar sources={a.sources} />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Model projection" className="lg:col-span-1">
          {p ? (
            <div className="space-y-3">
              <div className="flex items-center justify-around text-center">
                <div><TeamLogo src={g.away?.logo} abbr={g.away?.abbr} size={48} /><div className="num text-3xl font-black">{num(p.awayPts)}</div></div>
                <div className="text-ink-3">–</div>
                <div><TeamLogo src={g.home?.logo} abbr={g.home?.abbr} size={48} /><div className="num text-3xl font-black">{num(p.homePts)}</div></div>
              </div>
              <div className="num grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-surface-2 p-2"><div className="label text-[10px]">{g.home?.abbr} win</div><div className="text-lg font-bold">{pct(p.homeWinProb, 0)}</div></div>
                <div className="rounded-lg bg-surface-2 p-2"><div className="label text-[10px]">Margin σ</div><div className="text-lg font-bold">{num(p.marginSd)}</div></div>
                <div className="rounded-lg bg-surface-2 p-2"><div className="label text-[10px]">Possessions</div><div className="text-lg font-bold">{num(p.possessions)}</div></div>
              </div>
              {p.injuryAdj.map((i) => <p key={i.name} className="text-xs text-ink-2">{i.name} out: {num(i.pts)} pts (heuristic)</p>)}
              {p.restNote.map((r) => <p key={r} className="text-xs text-warn">{r}</p>)}
            </div>
          ) : <p className="text-sm text-ink-3">Not enough games to rate both teams yet.</p>}
        </Card>
        <Card title="Game markets — model vs DraftKings" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead><tr className="label text-left"><th className="py-1">Selection</th><th>Odds</th><th>No-vig</th><th>Raw</th><th>Calibrated</th><th>Edge</th><th>EV</th></tr></thead>
              <tbody>
                {gameBets.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="py-2 font-semibold">{b.selection}</td><td>{dec(b.price)}</td><td>{pct(b.marketProb)}</td><td>{pct(b.rawProb)}</td>
                    <td>{pct(b.modelProb)}</td><td className={b.edge > 0 ? "text-pos" : "text-neg"}>{pp(b.edge)}</td>
                    <td className={b.ev > 0 ? "font-bold text-pos" : "text-neg"}>{signedPct(b.ev)}</td>
                  </tr>
                ))}
                {!gameBets.length && <tr><td colSpan={7} className="py-4 text-ink-3">No game odds available.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {[{ t: ta, team: g.away }, { t: th, team: g.home }].map(({ t, team }) => (
          <Card key={team?.id} title={<span className="flex items-center gap-2"><TeamLogo src={team?.logo} abbr={team?.abbr} size={18} />{team?.name}</span>}>
            {t && (
              <div className="num mb-3 grid grid-cols-4 gap-2 text-center text-xs">
                <Rk k="Record" v={`${t.record.w}-${t.record.l}`} sub={t.record.streak} />
                <Rk k="Off. rtg" v={num(t.ortg)} sub={`#${t.ranks.ortg}`} />
                <Rk k="Def. rtg" v={num(t.drtg)} sub={`#${t.ranks.drtg}`} />
                <Rk k="Pace" v={num(t.pace)} sub={`#${t.ranks.pace}`} />
              </div>
            )}
            <div className="label mb-1">Injuries</div>
            {inj(team?.id ?? "").length === 0 ? <p className="text-sm text-ink-3">None reported.</p> : (
              <ul className="space-y-1 text-sm">
                {inj(team!.id).map((i) => (
                  <li key={i.athleteId} className="flex gap-2"><InjuryBadge status={i.status} /><Link href={`/players/${i.athleteId}`} className="font-semibold hover:text-accent">{i.name}</Link><span className="truncate text-ink-3">{i.detail}</span></li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <h2 className="label mb-2">Player props in this game</h2>
      <BetTable bets={bets.filter((b) => b.kind === "player")} initial={{ minEv: -0.1, valueOnly: false }} />
    </>
  );
}

function Rk({ k, v, sub }: { k: string; v: string; sub: string }) {
  return <div className="rounded-lg bg-surface-2 p-2"><div className="label text-[10px]">{k}</div><div className="text-base font-bold">{v}</div><div className="text-ink-3">{sub}</div></div>;
}
