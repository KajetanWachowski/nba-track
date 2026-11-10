import { NextResponse } from "next/server";
import { analyzeSlate } from "@/lib/engine";
import { syncSeason } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** POST {"scope":"season"} pulls finished games/box scores/closing lines; default refreshes today's slate. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { scope?: string };
  try {
    if (body.scope === "season") {
      const r = await syncSeason({});
      return NextResponse.json({ message: `Synced ${r.boxScores} new box scores, ${r.propGames} prop snapshots (${r.errors.length} errors)`, ...r });
    }
    const a = await analyzeSlate(undefined, { force: true });
    return NextResponse.json({ message: `Slate refreshed: ${a.bets.length} prices, ${a.bets.filter((b) => b.isValue).length} value bets` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
