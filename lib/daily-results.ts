/**
 * Wyniki typów dnia: dla każdej nogi stan meczu i aktualna wartość statystyki.
 * Dane wyłącznie z darmowego ESPN (tablica wyników i protokół meczu) — nie zużywa limitu OddsPapi.
 */
import { statOf } from "./assess";
import { getDb } from "./db";
import type { BetEval } from "./engine";
import { listDailySets, SET_ORDER, type DailySet, type SetKind } from "./daily-picks";
import type { PlayerMarket } from "./markets";
import { fetchBoxScore, fetchScoreboard, type BoxPlayer } from "./providers/espn";

export type LegStatus = "oczekuje" | "live" | "weszlo" | "nie-weszlo" | "zwrot";
export interface LegResult {
  bet: BetEval;
  status: LegStatus;
  value: number | null; // aktualna / końcowa wartość statystyki
  min: number | null;
  gameState: "pre" | "in" | "post";
  gameDetail: string; // np. „3. kwarta 5:12”, „Koniec”
  score: string | null;
}
export interface SetResult {
  set: DailySet;
  legs: LegResult[];
  status: LegStatus;
  odds: number; // kurs łączny (bez nóg ze zwrotem)
  prob: number;
  locked: boolean;
}

/** Status meczu z ESPN po polsku, np. „End of 3rd” → „Koniec 3. kwarty”, „5:12 - 4th” → „4. kwarta 5:12”. */
export function statusPl(s: string): string {
  const q = (n: string) => ({ "1st": "1.", "2nd": "2.", "3rd": "3.", "4th": "4." } as Record<string, string>)[n] ?? n;
  let t = s.trim();
  if (/^final/i.test(t)) return "Koniec";
  if (/halftime/i.test(t)) return "Przerwa";
  let m = t.match(/^End of (\d(?:st|nd|rd|th))(?: Quarter)?/i);
  if (m) return `Koniec ${q(m[1])} kwarty`;
  m = t.match(/^(\d+:\d+|\d+\.\d+)\s*-\s*(\d(?:st|nd|rd|th))/i);
  if (m) return `${q(m[2])} kwarta · ${m[1]}`;
  m = t.match(/^(\d+:\d+|\d+\.\d+)\s*-\s*(\d*)\s*OT/i);
  if (m) return `Dogrywka${m[2] ? ` ${m[2]}` : ""} · ${m[1]}`;
  t = t.replace(/\bOT\b/g, "dogrywka").replace(/Delayed/i, "Opóźniony").replace(/Postponed/i, "Przełożony");
  return t;
}

type GameState = { state: "pre" | "in" | "post"; detail: string; score: string | null; synced: boolean };

async function gameStates(days: string[]): Promise<Map<string, GameState>> {
  const db = getDb();
  const out = new Map<string, GameState>();
  for (const day of days) {
    const rows = db.prepare("SELECT id, state, status, home_score, away_score, box_synced FROM games WHERE day = ?").all(day) as unknown as {
      id: string; state: "pre" | "in" | "post"; status: string; home_score: number | null; away_score: number | null; box_synced: number;
    }[];
    const allDone = rows.length > 0 && rows.every((r) => r.state === "post" && r.box_synced);
    if (allDone) {
      for (const r of rows) out.set(r.id, { state: "post", detail: "Koniec", score: `${r.away_score}-${r.home_score}`, synced: true });
      continue;
    }
    try {
      const sb = await fetchScoreboard(day, 30);
      for (const g of sb.games) {
        const synced = rows.find((r) => r.id === g.id)?.box_synced === 1 && g.state === "post";
        out.set(g.id, { state: g.state, detail: g.state === "post" ? "Koniec" : g.state === "pre" ? "Przed meczem" : statusPl(g.statusDetail), score: g.homeScore !== null ? `${g.awayScore}-${g.homeScore}` : null, synced });
      }
    } catch {
      for (const r of rows) out.set(r.id, { state: r.state, detail: r.status, score: r.home_score !== null ? `${r.away_score}-${r.home_score}` : null, synced: !!r.box_synced });
    }
  }
  return out;
}

export async function dailyResults(limitDays = 14): Promise<SetResult[]> {
  const sets = listDailySets(limitDays);
  const states = await gameStates([...new Set(sets.map((s) => s.day))]);
  const db = getDb();
  const boxCache = new Map<string, BoxPlayer[] | null>();
  const playerLine = async (gameId: string, athleteId: string, gs: GameState): Promise<{ row: Record<string, number> | null; dnp: boolean }> => {
    if (gs.synced) {
      const r = db.prepare("SELECT * FROM player_games WHERE game_id = ? AND athlete_id = ?").get(gameId, athleteId) as (Record<string, number> & { dnp: number }) | undefined;
      return { row: r && !r.dnp && r.min > 0 ? r : null, dnp: !r || !!r.dnp || r.min <= 0 };
    }
    if (!boxCache.has(gameId)) boxCache.set(gameId, await fetchBoxScore(gameId, gs.state === "post").then((b) => b.players).catch(() => null));
    const p = boxCache.get(gameId)?.find((x) => x.athleteId === athleteId);
    if (!p) return { row: null, dnp: gs.state === "post" };
    return { row: p.dnp ? null : (p as unknown as Record<string, number>), dnp: p.dnp || (gs.state === "post" && p.min <= 0) };
  };

  const out: SetResult[] = [];
  for (const set of sets) {
    const legs: LegResult[] = [];
    for (const b of set.legs) {
      const gs = states.get(b.gameId) ?? { state: Date.parse(b.tipoff) > Date.now() ? "pre" : "in", detail: "", score: null, synced: false } as GameState;
      let status: LegStatus = "oczekuje";
      let value: number | null = null;
      let min: number | null = null;
      if (gs.state !== "pre" && b.line !== null) {
        const { row, dnp } = await playerLine(b.gameId, b.subjectId, gs);
        if (row) {
          value = statOf(row as never, b.market as PlayerMarket);
          min = Math.round(Number(row.min) || 0);
        }
        const over = b.side !== "under";
        if (gs.state === "post") {
          status = dnp || value === null ? "zwrot" : (over ? value > b.line : value < b.line) ? "weszlo" : "nie-weszlo";
        } else {
          status = "live";
          if (value !== null && value > b.line) status = over ? "weszlo" : "nie-weszlo"; // przekroczona linia rozstrzyga już w trakcie
          if (value === null) value = 0;
        }
      }
      legs.push({ bet: b, status, value, min, gameState: gs.state, gameDetail: gs.detail, score: gs.score });
    }
    const active = legs.filter((l) => l.status !== "zwrot");
    const status: LegStatus = legs.some((l) => l.status === "nie-weszlo")
      ? "nie-weszlo"
      : active.length && active.every((l) => l.status === "weszlo")
        ? "weszlo"
        : !active.length && legs.length
          ? "zwrot"
          : legs.some((l) => l.status === "live" || l.status === "weszlo")
            ? "live"
            : "oczekuje";
    out.push({
      set,
      legs,
      status,
      odds: active.reduce((a, l) => a * l.bet.price, 1),
      prob: active.reduce((a, l) => a * l.bet.modelProb, 1),
      locked: !!set.lockedAt || (set.legs.length > 0 && Math.min(...set.legs.map((l) => Date.parse(l.tipoff))) <= Date.now()),
    });
  }
  return out.sort((a, b) => (a.set.day === b.set.day ? SET_ORDER.indexOf(a.set.kind) - SET_ORDER.indexOf(b.set.kind) : a.set.day < b.set.day ? 1 : -1));
}

/** Podsumowanie skuteczności zamkniętych zestawów i pojedynczych typów dnia. */
export function summarize(results: SetResult[]) {
  const by = new Map<SetKind, { done: number; won: number; profit: number }>();
  let legsDone = 0, legsWon = 0;
  for (const r of results) {
    if (r.set.kind === "typy") {
      for (const l of r.legs) {
        if (l.status === "weszlo" && l.gameState === "post") { legsDone++; legsWon++; }
        if (l.status === "nie-weszlo") legsDone++;
      }
      continue;
    }
    if (r.status !== "weszlo" && r.status !== "nie-weszlo") continue;
    if (r.status === "weszlo" && r.legs.some((l) => l.gameState !== "post")) continue;
    const a = by.get(r.set.kind) ?? { done: 0, won: 0, profit: 0 };
    a.done++;
    if (r.status === "weszlo") { a.won++; a.profit += r.odds - 1; } else a.profit -= 1;
    by.set(r.set.kind, a);
  }
  return { coupons: by, typy: { done: legsDone, won: legsWon } };
}
