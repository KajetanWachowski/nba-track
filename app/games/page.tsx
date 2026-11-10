import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Empty, Notice, PageHeader, SourceBar, TeamLogo } from "@/components/ui";
import { dayLabel, dec, num, pct, tipTime } from "@/lib/format";
import { loadSlate } from "@/lib/page-data";
import { addDays, easternDay } from "@/lib/providers/espn";

export const dynamic = "force-dynamic";

export default async function Games({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: qd } = await searchParams;
  const day = qd && /^\d{8}$/.test(qd) ? qd : easternDay();
  const { a, error } = await loadSlate(day);
  return (
    <>
      <AutoRefresh seconds={180} />
      <PageHeader eyebrow={dayLabel(day)} title="NBA" accent="Games">
        <div className="flex gap-2 text-sm">
          <Link className="rounded-lg border border-line px-3 py-1.5" href={`/games?day=${addDays(day, -1)}`}>← Prev</Link>
          <Link className="rounded-lg border border-line px-3 py-1.5" href="/games">Today</Link>
          <Link className="rounded-lg border border-line px-3 py-1.5" href={`/games?day=${addDays(day, 1)}`}>Next →</Link>
        </div>
      </PageHeader>
      {!a ? <Notice tone="neg">Could not load games: {error}</Notice> : (
        <>
          <SourceBar sources={a.sources} />
          {a.games.length === 0 ? <Empty title="No regular-season games on this date" /> : (
            <div className="grid gap-4 md:grid-cols-2">
              {a.games.map((g) => {
                const p = g.projection;
                const line = (m: string, side: string) => a.bets.find((b) => b.gameId === g.id && b.market === m && b.side === side);
                const props = a.bets.filter((b) => b.gameId === g.id && b.kind === "player").length;
                const val = a.bets.filter((b) => b.gameId === g.id && b.isValue).length;
                const inj = a.injuries.filter((i) => (i.teamId === g.home_id || i.teamId === g.away_id) && i.status === "OUT").length;
                return (
                  <Link key={g.id} href={`/games/${g.id}`} className="rounded-2xl border border-line bg-surface p-4 hover:border-ink-3">
                    <div className="flex items-center justify-between text-xs text-ink-3">
                      <span>{g.state === "pre" ? tipTime(g.date) : g.status.replace("STATUS_", "")}</span>
                      <span>{props} props · {val} value · {inj} out</span>
                    </div>
                    <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <TeamSide t={g.away} score={g.away_score} pts={p?.awayPts} />
                      <span className="text-ink-3">@</span>
                      <TeamSide t={g.home} score={g.home_score} pts={p?.homePts} right />
                    </div>
                    <div className="num mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                      <Mini k="Moneyline" book={`${dec(line("ml", "away")?.price)} / ${dec(line("ml", "home")?.price)}`} model={p ? `${g.home?.abbr} ${pct(p.homeWinProb, 0)}` : "—"} />
                      <Mini k="Spread" book={line("spread", "home") ? `${g.home?.abbr} ${line("spread", "home")!.line! > 0 ? "+" : ""}${line("spread", "home")!.line}` : "—"} model={p ? `${g.home?.abbr} ${p.margin > 0 ? "-" : "+"}${num(Math.abs(p.margin))}` : "—"} />
                      <Mini k="Total" book={line("total", "over") ? `${line("total", "over")!.line}` : "—"} model={p ? num(p.total) : "—"} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

function TeamSide({ t, score, pts, right }: { t?: { abbr: string; logo: string; short_name: string } ; score: number | null; pts?: number; right?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse text-right" : ""}`}>
      <TeamLogo src={t?.logo} abbr={t?.abbr} size={40} />
      <div>
        <div className="text-lg font-black">{t?.abbr}</div>
        <div className="num text-xs text-ink-3">{score !== null ? `${score}` : pts ? `proj ${num(pts)}` : ""}</div>
      </div>
    </div>
  );
}

function Mini({ k, book, model }: { k: string; book: string; model: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <div className="label text-[10px]">{k}</div>
      <div className="font-semibold">{book}</div>
      <div className="text-ink-3">model {model}</div>
    </div>
  );
}
