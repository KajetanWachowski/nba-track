import Link from "next/link";
import { Term } from "@/components/Term";
import { Card, InjuryBadge, PageHeader, TeamLogo } from "@/components/ui";
import { getLeagueDefense, type TeamDefense } from "@/lib/analysis";
import { num, shortDate, signedPct } from "@/lib/format";
import { BASE_STATS, MARKET_LABEL, type StatKey } from "@/lib/markets";
import { fetchInjuries } from "@/lib/providers/espn";

export const dynamic = "force-dynamic";

const POS = [["G", "Obrońcy"], ["F", "Skrzydłowi"], ["C", "Środkowi"]] as const;

function cellStyle(f: number) {
  const d = Math.max(-0.25, Math.min(0.25, f - 1)) / 0.25; // −1 … 1
  if (Math.abs(d) < 0.08) return { background: "var(--surface-2)" };
  const c = d > 0 ? "var(--pos)" : "var(--neg)";
  return { background: `color-mix(in srgb, ${c} ${Math.round(Math.abs(d) * 45)}%, var(--surface-2))` };
}

export default async function Matchups({ searchParams }: { searchParams: Promise<{ team?: string; vs?: string; sort?: string }> }) {
  const sp = await searchParams;
  const league = getLeagueDefense();
  const sel = league.teams.find((t) => t.team.id === sp.team);
  const vs = league.teams.find((t) => t.team.id === sp.vs);
  let injuries: Awaited<ReturnType<typeof fetchInjuries>>["injuries"] = [];
  let injErr = false;
  try {
    injuries = (await fetchInjuries()).injuries;
  } catch {
    injErr = true;
  }
  const sortKey = (sp.sort ?? "drtg") as string;
  const sorted = [...league.teams].sort((a, b) => {
    if (sortKey === "pace") return a.ranks.pace - b.ranks.pace;
    if (sortKey === "net") return a.ranks.net - b.ranks.net;
    if (BASE_STATS.includes(sortKey as StatKey)) return a.allowed[sortKey as StatKey].rank - b.allowed[sortKey as StatKey].rank;
    return a.ranks.drtg - b.ranks.drtg;
  });

  return (
    <>
      <PageHeader eyebrow="Obrona, tempo i statystyki tracone przez rywali" title="Analiza" accent="rywala" />
      {sel && (
        <div className={`mb-6 grid gap-4 ${vs ? "lg:grid-cols-2" : ""}`}>
          {[sel, vs].filter(Boolean).map((t) => <TeamPanel key={t!.team.id} t={t!} league={league} injuries={injuries.filter((i) => i.teamId === t!.team.id)} injErr={injErr} />)}
        </div>
      )}
      <Card title="Obrona drużyn ligi — kliknij kolumnę, aby posortować, lub drużynę, aby zobaczyć jej profil">
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[900px] whitespace-nowrap text-sm">
            <thead>
              <tr className="label text-left">
                <th className="py-2">Drużyna</th>
                <th><Link href="?sort=drtg"><Term k="drtg">Obrona</Term></Link></th>
                <th><Link href="?sort=net">Bilans pkt</Link></th>
                <th><Link href="?sort=pace"><Term k="pace">Tempo</Term></Link></th>
                {BASE_STATS.map((s) => <th key={s}><Link href={`?sort=${s}`}>{MARKET_LABEL[s]} traconych</Link></th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.team.id} className="border-t border-line hover:bg-surface-2">
                  <td className="py-1.5"><Link href={`?team=${t.team.id}`} className="flex items-center gap-2 font-semibold hover:text-accent"><TeamLogo src={t.team.logo} abbr={t.team.abbr} size={18} />{t.team.abbr}<span className="text-xs font-normal text-ink-3">{t.record.w}-{t.record.l}</span></Link></td>
                  <td>{num(t.drtg)} <span className="text-xs text-ink-3">#{t.ranks.drtg}</span></td>
                  <td className={t.net >= 0 ? "text-pos" : "text-neg"}>{t.net > 0 ? "+" : ""}{num(t.net)}</td>
                  <td>{num(t.pace)} <span className="text-xs text-ink-3">#{t.ranks.pace}</span></td>
                  {BASE_STATS.map((s) => <td key={s}>{num(t.allowed[s].perGame)} <span className="text-xs text-ink-3">#{t.allowed[s].rank}</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-3">Oceny na 100 posiadań, z korektą na siłę rywali i większą wagą ostatnich meczów, wygładzone w stronę średniej ligi ({num(league.lgOrtg)}) przy małej liczbie meczów. Miejsce 1 w kolumnach „traconych” = drużyna traci najwięcej.</p>
      </Card>
    </>
  );
}

function TeamPanel({ t, league, injuries, injErr }: { t: TeamDefense; league: { lgPace: number; lgOrtg: number }; injuries: { athleteId: string; name: string; status: string; detail: string; comment: string }[]; injErr: boolean }) {
  const reb = t.allowed.reb;
  return (
    <Card title={<span className="flex items-center gap-2"><TeamLogo src={t.team.logo} abbr={t.team.abbr} size={20} />{t.team.name} · {t.games} games</span>}>
      <div className="num mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Big k="Bilans" v={`${t.record.w}–${t.record.l}`} sub={t.record.streak ? `seria ${t.record.streak.replace("W", "Z").replace("L", "P")}` : ""} />
        <Big k="Obrona (DRtg)" v={num(t.drtg)} sub={`#${t.ranks.drtg} z 30`} />
        <Big k="Tempo" v={num(t.pace)} sub={`${signedPct(t.pace / league.lgPace - 1)} vs liga`} />
        <Big k="Tracone zbiórki" v={num(reb.perGame)} sub={`#${reb.rank} najwięcej`} />
      </div>
      <div className="label mb-1">Ostatnie wyniki (od najstarszego)</div>
      <div className="mb-4 flex flex-wrap gap-1">
        {t.recent.map((g) => (
          <span key={g.gameId} title={`${shortDate(g.date)} ${g.home ? "u siebie" : "na wyjeździe"}: ${g.pts}:${g.oppPts}`}
            className={`num flex h-9 w-9 items-center justify-center rounded-md text-sm font-black ${g.won ? "bg-pos text-black" : "bg-neg-soft text-neg"}`}>
            {g.won ? "Z" : "P"}
          </span>
        ))}
      </div>
      <div className="label mb-1">Statystyki tracone względem średniej ligi, na posiadanie, wg pozycji</div>
      <div className="overflow-x-auto">
        <table className="num w-full text-xs">
          <thead><tr className="text-left text-ink-3"><th className="py-1"></th>{BASE_STATS.map((s) => <th key={s} className="px-1">{MARKET_LABEL[s]}</th>)}</tr></thead>
          <tbody>
            {POS.map(([p, label]) => (
              <tr key={p}>
                <td className="py-1 pr-2 font-semibold">{label}</td>
                {BASE_STATS.map((s) => {
                  const f = t.posDefense[p][s].factor;
                  return <td key={s} className="px-0.5 py-0.5"><span className="block rounded px-1 py-1 text-center" style={cellStyle(f)} title={`${label} · ${MARKET_LABEL[s]}: ${signedPct(f - 1)} (${t.posDefense[p][s].n} meczów, wygładzone)`}>{signedPct(f - 1, 0)}</span></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-ink-3">Zielony = rywal traci więcej niż średnio (sprzyja zakładom „powyżej”); czerwony = ogranicza. Przy małych próbkach wartości są wygładzone w stronę zera.</p>
      <div className="label mb-1 mt-4">Kontuzje i nieobecności</div>
      {injErr ? <p className="text-sm text-neg">Raport kontuzji niedostępny.</p> : injuries.length === 0 ? <p className="text-sm text-ink-3">Brak zgłoszeń.</p> : (
        <ul className="space-y-1 text-sm">
          {injuries.map((i) => <li key={i.athleteId} className="flex gap-2"><InjuryBadge status={i.status} /><Link href={`/players/${i.athleteId}`} className="font-semibold hover:text-accent">{i.name}</Link><span className="truncate text-ink-3">{i.detail}</span></li>)}
        </ul>
      )}
    </Card>
  );
}

function Big({ k, v, sub }: { k: string; v: string; sub: string }) {
  return <div className="rounded-xl bg-surface-2 p-3"><div className="label text-[10px]">{k}</div><div className="text-2xl font-black">{v}</div><div className="text-xs text-ink-3">{sub}</div></div>;
}
