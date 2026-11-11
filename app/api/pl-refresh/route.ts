import { NextResponse } from "next/server";
import { invalidateSlate } from "@/lib/engine";
import { easternDay } from "@/lib/providers/espn";
import { fetchPolishOffers, getUsage, listBookmakers, oddsPapiEnabled } from "@/lib/providers/oddspapi";
import { getGamesByDay, getTeams } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The only place that spends OddsPapi requests (besides optional auto-refresh). */
export async function POST(req: Request) {
  if (!oddsPapiEnabled()) return NextResponse.json({ error: "ODDSPAPI_KEY nie jest ustawiony" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { day?: string };
  const day = body.day && /^\d{8}$/.test(body.day) ? body.day : easternDay();
  const teams = getTeams();
  const games = getGamesByDay(day).filter((g) => g.state === "pre" && g.season_type === 2);
  if (!games.length) return NextResponse.json({ error: "Brak meczów przed rozpoczęciem w tym dniu" }, { status: 400 });
  const before = getUsage().count;
  try {
    // bookmaker list is metadata for Settings; fetched only if never cached (7-day TTL)
    await listBookmakers(true).catch(() => undefined);
    const refs = games.map((g) => ({ gameId: g.id, date: g.date, homeId: g.home_id, awayId: g.away_id, homeName: teams.get(g.home_id)?.name ?? "", awayName: teams.get(g.away_id)?.name ?? "" }));
    const r = await fetchPolishOffers(refs, new Map(), undefined, true); // fills the cache; mapping happens on render
    invalidateSlate();
    const u = getUsage();
    const used = u.count - before;
    return NextResponse.json({
      message: `Pobrano kursy (${r.matchedFixtures} meczów, ${r.books.join(", ") || "bez kursów"}). Zużyto ${used} zapyt., dziś ${u.count}/${u.limit}.${r.errors.length ? ` Błędy: ${[...new Set(r.errors)].join(" · ")}` : ""}`,
      used, usage: u,
    });
  } catch (e) {
    const u = getUsage();
    return NextResponse.json({ error: `${(e as Error).message} (dziś ${u.count}/${u.limit} zapyt.)` }, { status: 502 });
  }
}
