/** Manually entered bookmaker prices (for books without an API, e.g. Betfan). */
import { bookTitle } from "./books";
import { getDb } from "./db";
import { isGameMarket, type Market } from "./markets";
import type { Offer } from "./providers/oddsapi";

export interface ManualRow {
  game_id: string;
  market: string;
  subject_id: string;
  line: number;
  book: string;
  over_dec: number | null;
  under_dec: number | null;
  created_at: number;
}

export function upsertManual(r: Omit<ManualRow, "created_at">) {
  const ok = (d: number | null) => d === null || (Number.isFinite(d) && d > 1 && d < 1000);
  if (!ok(r.over_dec) || !ok(r.under_dec) || (r.over_dec === null && r.under_dec === null)) throw new Error("Odds must be decimal prices above 1.00");
  getDb()
    .prepare(`INSERT INTO manual_odds(game_id, market, subject_id, line, book, over_dec, under_dec, created_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(game_id, market, subject_id, line, book) DO UPDATE SET over_dec=excluded.over_dec, under_dec=excluded.under_dec, created_at=excluded.created_at`)
    .run(r.game_id, r.market, r.subject_id, r.line, r.book.toLowerCase(), r.over_dec, r.under_dec, Date.now());
}

export function deleteManual(k: Pick<ManualRow, "game_id" | "market" | "subject_id" | "line" | "book">) {
  getDb().prepare("DELETE FROM manual_odds WHERE game_id = ? AND market = ? AND subject_id = ? AND line = ? AND book = ?").run(k.game_id, k.market, k.subject_id, k.line, k.book);
}

export function listManual(gameIds: string[]): ManualRow[] {
  if (!gameIds.length) return [];
  return JSON.parse(JSON.stringify(getDb().prepare(`SELECT * FROM manual_odds WHERE game_id IN (${gameIds.map(() => "?").join(",")}) ORDER BY created_at DESC`).all(...gameIds))) as ManualRow[];
}

/** Expand stored rows into canonical offers (both sides, with the opposite price for de-vigging). */
export function manualToOffers(rows: ManualRow[], homeAway: Map<string, { home: string; away: string }>): (Offer & { kind: "ou" | "yes" | "game" })[] {
  const out: (Offer & { kind: "ou" | "yes" | "game" })[] = [];
  for (const r of rows) {
    const m = r.market as Market;
    const base = { gameId: r.game_id, market: m, book: r.book, bookTitle: bookTitle(r.book), lastUpdate: new Date(r.created_at).toISOString() };
    const ha = homeAway.get(r.game_id);
    if (m === "ml" && ha) {
      if (r.over_dec) out.push({ ...base, kind: "game", subjectId: ha.home, side: "home", line: null, dec: r.over_dec, oppDec: r.under_dec });
      if (r.under_dec) out.push({ ...base, kind: "game", subjectId: ha.away, side: "away", line: null, dec: r.under_dec, oppDec: r.over_dec });
    } else if (m === "spread" && ha) {
      if (r.over_dec) out.push({ ...base, kind: "game", subjectId: ha.home, side: "home", line: r.line, dec: r.over_dec, oppDec: r.under_dec });
      if (r.under_dec) out.push({ ...base, kind: "game", subjectId: ha.away, side: "away", line: -r.line, dec: r.under_dec, oppDec: r.over_dec });
    } else if (m === "total") {
      if (r.over_dec) out.push({ ...base, kind: "game", subjectId: "game", side: "over", line: r.line, dec: r.over_dec, oppDec: r.under_dec });
      if (r.under_dec) out.push({ ...base, kind: "game", subjectId: "game", side: "under", line: r.line, dec: r.under_dec, oppDec: r.over_dec });
    } else if (m === "dd" || m === "td") {
      if (r.over_dec) out.push({ ...base, kind: "yes", subjectId: r.subject_id, side: "yes", line: 0.5, dec: r.over_dec, oppDec: r.under_dec });
    } else if (!isGameMarket(m)) {
      if (r.over_dec) out.push({ ...base, kind: "ou", subjectId: r.subject_id, side: "over", line: r.line, dec: r.over_dec, oppDec: r.under_dec });
      if (r.under_dec) out.push({ ...base, kind: "ou", subjectId: r.subject_id, side: "under", line: r.line, dec: r.under_dec, oppDec: r.over_dec });
    }
  }
  return out;
}
