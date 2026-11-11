import { NextResponse } from "next/server";
import { PL_BOOKS } from "@/lib/books";
import { invalidateSlate } from "@/lib/engine";
import { deleteManual, upsertManual } from "@/lib/manual-odds";
import { MARKET_LABEL } from "@/lib/markets";
import { getGame } from "@/lib/store";

export const dynamic = "force-dynamic";

interface Body {
  gameId: string;
  market: string;
  subjectId: string;
  line: number;
  prices: { book: string; over: number | null; under: number | null }[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(String(v).replace(",", ".")));

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Body;
    if (!getGame(b.gameId)) throw new Error("Nieznany mecz");
    if (!(b.market in MARKET_LABEL)) throw new Error("Nieznany rynek");
    const line = b.market === "ml" ? 0 : b.market === "dd" || b.market === "td" ? 0.5 : Number(String(b.line).replace(",", "."));
    if (!Number.isFinite(line)) throw new Error("Linia musi być liczbą");
    const subject = ["ml", "spread", "total"].includes(b.market) ? "game" : b.subjectId;
    if (!subject) throw new Error("Wybierz zawodnika");
    let n = 0;
    for (const p of b.prices ?? []) {
      if (!PL_BOOKS.some((x) => x.key === p.book)) continue;
      const over = num(p.over), under = num(p.under);
      if (over === null && under === null) continue;
      upsertManual({ game_id: b.gameId, market: b.market, subject_id: subject, line, book: p.book, over_dec: over, under_dec: under });
      n++;
    }
    if (!n) throw new Error("Wpisz co najmniej jeden kurs");
    invalidateSlate();
    return NextResponse.json({ message: `Zapisano kursy (${n} bukmacher${n === 1 ? "" : "ów"})` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const u = new URL(req.url);
  deleteManual({
    game_id: u.searchParams.get("gameId") ?? "",
    market: u.searchParams.get("market") ?? "",
    subject_id: u.searchParams.get("subjectId") ?? "",
    line: Number(u.searchParams.get("line")),
    book: u.searchParams.get("book") ?? "",
  });
  invalidateSlate();
  return NextResponse.json({ message: "Usunięto" });
}
