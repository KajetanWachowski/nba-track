import { NextResponse } from "next/server";
import { settlePredictions } from "@/lib/tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const r = await settlePredictions();
    return NextResponse.json({ message: `Rozliczono ${r.settled} z ${r.open} zakończonych typów`, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
