import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/backtest";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

let running: Promise<unknown> | null = null;

export async function POST(req: Request) {
  if (running) return NextResponse.json({ error: "Backtest już trwa" }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { tune?: boolean; minEv?: number };
  try {
    running = runBacktest({ tune: Boolean(body.tune), minEv: body.minEv });
    const s = (await running) as Awaited<ReturnType<typeof runBacktest>>;
    return NextResponse.json({ message: `Backtest gotowy: ${s.rows.test} linii testowych, log loss ${s.metrics.player.logLossCal.toFixed(4)} (rynek ${s.metrics.player.logLossMarket.toFixed(4)})` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    running = null;
  }
}
