/**
 * Archiwum typów dnia: kupony dnia i najlepsze typy zapisywane PRZED meczami.
 * Zestaw może się aktualizować (nowe kursy, linie) aż do rozpoczęcia pierwszego meczu z tego zestawu —
 * wtedy zostaje zamrożony i już się nie zmienia. Wyniki liczone są później z protokołów ESPN (na żywo i po meczu).
 */
import { buildDailyCoupons, couponCandidates } from "./coupons";
import { getDb } from "./db";
import type { BetEval } from "./engine";

export type SetKind = "typy" | `kupon-${string}`;
export const SET_TITLE: Record<string, string> = {
  typy: "Typy dnia",
  "kupon-pewniaczek": "Pewniaczek (~3)",
  "kupon-zloty": "Złoty środek (~4)",
  "kupon-petarda": "Petarda (~5)",
  // starsze zestawy w archiwum
  "kupon-bezpieczny": "Kupon bezpieczniejszy (2,5–4)",
  "kupon-sredni": "Kupon średni (6–8)",
  "kupon-odwazny": "Kupon odważny (~10)",
};
/** zestawy zapisywane od teraz */
export const SET_ORDER: SetKind[] = ["typy", "kupon-pewniaczek", "kupon-zloty", "kupon-petarda"];
/** kolejność wyświetlania (także starsze rodzaje) */
export const SET_DISPLAY: string[] = [...SET_ORDER, "kupon-bezpieczny", "kupon-sredni", "kupon-odwazny"];

export interface DailySet {
  day: string;
  kind: SetKind;
  createdAt: number;
  updatedAt: number;
  lockedAt: number | null;
  legs: BetEval[];
}

function ensureTable() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS daily_sets (
    day TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, locked_at INTEGER,
    legs TEXT NOT NULL, PRIMARY KEY (day, kind))`);
  // „Kupon bezpieczniejszy” został zastąpiony przez „Pewniaczka” — jego historia liczy się do Pewniaczka
  getDb().exec(`UPDATE OR IGNORE daily_sets SET kind = 'kupon-pewniaczek' WHERE kind = 'kupon-bezpieczny'`);
}

/** Najlepsze typy dnia: „Najlepsze”/„Dobre”, potem najwyższa szansa (≥ 60%, kurs ≥ 1.50); jeden typ na zawodnika, maks. 5. */
export function pickTopBets(bets: BetEval[], n = 5): BetEval[] {
  const ok = (b: BetEval) => b.kind === "player" && b.assessment.category !== "odrzucone" && !b.assessment.risks.some((r) => r.severity === "krytyczne");
  const rec = bets.filter((b) => ok(b) && (b.assessment.category === "najlepsze" || b.assessment.category === "dobre"));
  const high = bets.filter((b) => ok(b) && b.modelProb >= 0.6 && b.price >= 1.5).sort((x, y) => y.modelProb - x.modelProb);
  const out: BetEval[] = [];
  const seen = new Set<string>();
  for (const b of [...rec, ...high]) {
    if (seen.has(b.subjectId)) continue;
    seen.add(b.subjectId);
    out.push(b);
    if (out.length >= n) break;
  }
  return out;
}

/** Lżejsza kopia zakładu do archiwum (bez listy alternatywnych linii). */
const slim = (b: BetEval): BetEval => ({ ...b, alternatives: undefined });
const firstTip = (legs: BetEval[]) => Math.min(...legs.map((l) => Date.parse(l.tipoff)));

export function recordDailyPicks(day: string, bets: BetEval[], now = Date.now()) {
  ensureTable();
  const db = getDb();
  const wantPl = couponCandidates(bets, { onlyPlayable: true }).length >= 2;
  const coupons = buildDailyCoupons(bets, wantPl);
  const fresh: Partial<Record<SetKind, BetEval[]>> = { typy: pickTopBets(bets) };
  for (const c of coupons) fresh[`kupon-${c.target.key}` as SetKind] = c.legs;

  const get = db.prepare("SELECT * FROM daily_sets WHERE day = ? AND kind = ?");
  const lock = db.prepare("UPDATE daily_sets SET locked_at = ? WHERE day = ? AND kind = ?");
  const up = db.prepare(`INSERT INTO daily_sets(day, kind, created_at, updated_at, locked_at, legs) VALUES(?,?,?,?,NULL,?)
    ON CONFLICT(day, kind) DO UPDATE SET updated_at = excluded.updated_at, legs = excluded.legs`);
  for (const kind of SET_ORDER) {
    const cur = get.get(day, kind) as { locked_at: number | null; legs: string } | undefined;
    if (cur?.locked_at) continue;
    if (cur) {
      const legs = JSON.parse(cur.legs) as BetEval[];
      if (legs.length && firstTip(legs) <= now) {
        lock.run(now, day, kind); // pierwszy mecz z zestawu już trwa — zamrażamy
        continue;
      }
    }
    const legs = fresh[kind];
    if (!legs?.length || firstTip(legs) <= now) continue;
    up.run(day, kind, now, now, JSON.stringify(legs.map(slim)));
  }
}

export function listDailySets(limitDays = 14): DailySet[] {
  ensureTable();
  const rows = getDb()
    .prepare("SELECT * FROM daily_sets WHERE day IN (SELECT DISTINCT day FROM daily_sets ORDER BY day DESC LIMIT ?) ORDER BY day DESC")
    .all(limitDays) as unknown as { day: string; kind: SetKind; created_at: number; updated_at: number; locked_at: number | null; legs: string }[];
  return rows.map((r) => ({ day: r.day, kind: r.kind, createdAt: r.created_at, updatedAt: r.updated_at, lockedAt: r.locked_at, legs: JSON.parse(r.legs) }));
}

/** Zapis zakładu sprzed meczu (do „Pełnej analizy” po rozpoczęciu meczu). */
export function findArchivedBet(id: string): { bet: BetEval; savedAt: number } | null {
  ensureTable();
  const rows = getDb().prepare("SELECT updated_at, legs FROM daily_sets WHERE legs LIKE ? ORDER BY day DESC LIMIT 5").all(`%${id}%`) as unknown as { updated_at: number; legs: string }[];
  for (const r of rows) {
    const b = (JSON.parse(r.legs) as BetEval[]).find((x) => x.id === id);
    if (b) return { bet: b, savedAt: r.updated_at };
  }
  return null;
}
