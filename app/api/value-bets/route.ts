import { NextResponse } from "next/server";
import { analyzeSlate } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** JSON feed of today's evaluations: /api/value-bets?minEv=0.03&minProb=0.5&all=1 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const minEv = Number(u.searchParams.get("minEv") ?? 0);
  const minProb = Number(u.searchParams.get("minProb") ?? 0);
  const all = u.searchParams.get("all") === "1";
  try {
    const a = await analyzeSlate(u.searchParams.get("day") ?? undefined);
    const bets = a.bets.filter((b) => (all || b.isValue) && b.ev >= minEv && b.modelProb >= minProb);
    return NextResponse.json({ day: a.day, generatedAt: a.generatedAt, sources: a.sources, warnings: a.warnings, count: bets.length, bets });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
