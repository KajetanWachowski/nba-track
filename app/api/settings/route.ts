import { NextResponse } from "next/server";
import { PL_BOOKS, getTaxSettings, saveTaxSettings } from "@/lib/books";
import { invalidateSlate } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** POST {"tax": {"enabled": bool, "exempt": ["superbet"]}} */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { tax?: { enabled?: boolean; exempt?: string[] } };
  const t = getTaxSettings();
  if (body.tax) {
    if (typeof body.tax.enabled === "boolean") t.enabled = body.tax.enabled;
    if (Array.isArray(body.tax.exempt)) t.exempt = body.tax.exempt.filter((k) => PL_BOOKS.some((b) => b.key === k));
  }
  saveTaxSettings(t);
  invalidateSlate();
  return NextResponse.json({ message: t.enabled ? `Podatek ${t.rate * 100}% uwzględniany${t.exempt.length ? ` (bez: ${t.exempt.join(", ")})` : ""}` : "Podatek nieuwzględniany" });
}
