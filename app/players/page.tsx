import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { num } from "@/lib/format";
import { loadSlate } from "@/lib/page-data";
import { getTeams, searchAthletes } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Players({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const teams = getTeams();
  const results = q && q.trim().length >= 2 ? searchAthletes(q.trim(), 40) : [];
  const { a } = await loadSlate();
  const today = new Map<string, { name: string; team: string; game: string; props: number }>();
  for (const b of a?.bets ?? []) {
    if (b.kind !== "player") continue;
    const e = today.get(b.subjectId) ?? { name: b.subjectName, team: b.teamAbbr, game: b.gameLabel, props: 0 };
    e.props++;
    today.set(b.subjectId, e);
  }
  return (
    <>
      <PageHeader eyebrow="Wyszukaj dowolnego zawodnika NBA" title="Analiza" accent="zawodnika" />
      <form className="mb-6 flex max-w-xl gap-2" action="/players">
        <input name="q" defaultValue={q} placeholder="np. Deni Avdija" autoFocus className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-lg" />
        <button className="rounded-xl bg-accent px-5 font-bold text-black">Szukaj</button>
      </form>
      {q && (
        <section className="mb-8">
          <h2 className="label mb-2">Wyniki dla „{q}”</h2>
          {results.length === 0 ? <p className="text-sm text-ink-3">Nie znaleziono zawodnika w meczach tego sezonu. Spróbuj innej pisowni.</p> : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((r) => (
                <li key={r.id}>
                  <Link href={`/players/${r.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:border-ink-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.headshot ?? `https://a.espncdn.com/i/headshots/nba/players/full/${r.id}.png`} alt="" width={44} height={32} className="h-8 w-11 rounded object-cover" />
                    <span><span className="block font-semibold">{r.name}</span><span className="text-xs text-ink-3">{teams.get(r.team_id ?? "")?.abbr} · {r.pos} · {r.gp} meczów · {num(r.mpg)} min/mecz</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section>
        <h2 className="label mb-2">Zawodnicy z zakładami na dziś</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[...today].sort((x, y) => x[1].name.localeCompare(y[1].name)).map(([id, p]) => (
            <li key={id}><Link href={`/players/${id}`} className="block rounded-xl border border-line bg-surface px-3 py-2 hover:border-ink-3">
              <span className="font-semibold">{p.name}</span> <span className="text-xs text-ink-3">{p.team} · {p.game} · {p.props} kursów</span>
            </Link></li>
          ))}
        </ul>
      </section>
    </>
  );
}
