/**
 * Live track record. Recommendations are appended the first time they are shown (price at that
 * moment is kept); settlement only fills in results and closing prices. The model never reads
 * this table, so logging cannot leak outcomes into predictions.
 */
import { config } from "./config";
import { getDb } from "./db";
import type { BetEval } from "./engine";
import { COMBOS, H2H_STAT, isH2H, type StatKey } from "./markets";
import { clv, noVig } from "./odds/math";
import type { PlayerGameRow, PropLineRow } from "./store";
import { syncSeason } from "./sync";

export function logPredictions(bets: BetEval[], minEv = 0.02) {
  const db = getDb();
  const st = db.prepare(`INSERT OR IGNORE INTO predictions(created_at, model_version, game_id, game_date, market, subject_id, subject_name,
    side, line, book, price, model_prob, raw_prob, market_prob, implied_prob, edge, ev, confidence, projection)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = Date.now();
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const b of bets) {
      if (!b.isValue || b.ev < minEv) continue;
      const r = st.run(now, config.modelVersion, b.gameId, b.tipoff, b.market, b.subjectId, b.subjectName, b.side, b.line, b.book, b.price,
        b.modelProb, b.rawProb, b.marketProb, b.impliedProb, b.edge, b.ev, b.confidence, b.projection?.mean ?? null);
      n += Number(r.changes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return n;
}

interface PredRow {
  id: number; game_id: string; market: string; subject_id: string; side: string; line: number | null; book: string; price: number;
}

export async function settlePredictions(opts: { sync?: boolean } = {}) {
  if (opts.sync !== false) await syncSeason({});
  const db = getDb();
  const open = db
    .prepare(`SELECT p.id, p.game_id, p.market, p.subject_id, p.side, p.line, p.book, p.price FROM predictions p
      JOIN games g ON g.id = p.game_id WHERE p.status = 'open' AND g.state = 'post' AND g.box_synced = 1`)
    .all() as unknown as PredRow[];
  const upd = db.prepare("UPDATE predictions SET status = ?, actual = ?, won = ?, closing_price = ?, closing_line = ?, clv = ?, settled_at = ? WHERE id = ?");
  let settled = 0;
  for (const p of open) {
    const g = db.prepare("SELECT * FROM games WHERE id = ?").get(p.game_id) as { home_id: string; away_id: string; home_score: number; away_score: number };
    let actual: number | null = null;
    let won: number | null = null;
    let status = "settled";
    let closingPrice: number | null = null;
    let closingLine: number | null = null;
    let clvVal: number | null = null;
    if (p.market === "team_total") {
      // punkty jednej drużyny (z dogrywką); bez linii zamknięcia z DraftKings
      actual = p.subject_id === g.home_id ? g.home_score : g.away_score;
      won = actual === p.line ? null : (p.side === "over") === actual > (p.line ?? 0) ? 1 : 0;
      if (won === null) status = "push";
    } else if (p.market === "ml" || p.market === "spread" || p.market === "total") {
      const gl = db.prepare("SELECT * FROM game_lines WHERE game_id = ? AND book = 'draftkings'").get(p.game_id) as Record<string, number | null> | undefined;
      const margin = g.home_score - g.away_score;
      const isHome = p.side === "home";
      if (p.market === "ml") {
        actual = margin;
        won = (isHome ? margin > 0 : margin < 0) ? 1 : 0;
        closingPrice = (isHome ? gl?.ml_home : gl?.ml_away) ?? null;
        const opp = (isHome ? gl?.ml_away : gl?.ml_home) ?? null;
        if (closingPrice && opp) clvVal = clv(p.price, noVig([closingPrice, opp])[0]);
      } else if (p.market === "spread") {
        actual = margin;
        const cover = (isHome ? margin : -margin) + (p.line ?? 0);
        won = cover === 0 ? null : cover > 0 ? 1 : 0;
        if (won === null) status = "push";
        closingLine = gl?.spread_home === null || gl?.spread_home === undefined ? null : isHome ? gl.spread_home : -gl.spread_home;
        closingPrice = (isHome ? gl?.spread_home_dec : gl?.spread_away_dec) ?? null;
        const opp = (isHome ? gl?.spread_away_dec : gl?.spread_home_dec) ?? null;
        if (closingPrice && opp && closingLine === p.line) clvVal = clv(p.price, noVig([closingPrice, opp])[0]);
      } else {
        actual = g.home_score + g.away_score;
        won = actual === p.line ? null : (p.side === "over") === actual > (p.line ?? 0) ? 1 : 0;
        if (won === null) status = "push";
        closingLine = (gl?.total as number) ?? null;
        closingPrice = (p.side === "over" ? gl?.over_dec : gl?.under_dec) ?? null;
        const opp = (p.side === "over" ? gl?.under_dec : gl?.over_dec) ?? null;
        if (closingPrice && opp && closingLine === p.line) clvVal = clv(p.price, noVig([closingPrice, opp])[0]);
      }
    } else if (isH2H(p.market)) {
      // pojedynek „A więcej niż B”: obaj muszą zagrać; remis = zwrot
      const [a, b] = p.subject_id.split(":");
      const ra = db.prepare("SELECT * FROM player_games WHERE game_id = ? AND athlete_id = ?").get(p.game_id, a) as PlayerGameRow | undefined;
      const rb = db.prepare("SELECT * FROM player_games WHERE game_id = ? AND athlete_id = ?").get(p.game_id, b) as PlayerGameRow | undefined;
      if (!ra || !rb || ra.dnp || rb.dnp || ra.min <= 0 || rb.min <= 0) status = "void";
      else {
        const st = H2H_STAT[p.market];
        actual = ra[st] - rb[st];
        won = actual === 0 ? null : actual > 0 ? 1 : 0;
        if (won === null) status = "push";
      }
    } else {
      const row = db.prepare("SELECT * FROM player_games WHERE game_id = ? AND athlete_id = ?").get(p.game_id, p.subject_id) as PlayerGameRow | undefined;
      if (!row || row.dnp || row.min <= 0) {
        status = "void"; // sportsbooks void props for players who do not play
      } else {
        if (p.market === "dd" || p.market === "td") {
          const c = (["pts", "reb", "ast", "stl", "blk"] as StatKey[]).filter((s) => row[s] >= 10).length;
          actual = c;
          won = c >= (p.market === "dd" ? 2 : 3) ? 1 : 0;
        } else {
          actual = p.market in COMBOS ? COMBOS[p.market as keyof typeof COMBOS].reduce((s, k) => s + row[k], 0) : row[p.market as StatKey];
          won = (p.side === "under" ? actual < (p.line ?? 0) : actual > (p.line ?? 0)) ? 1 : 0;
        }
        const cl = db
          .prepare("SELECT * FROM prop_lines WHERE game_id = ? AND athlete_id = ? AND market = ? AND kind = 'ou' AND book = 'draftkings' AND line = ?")
          .get(p.game_id, p.subject_id, p.market, p.line) as PropLineRow | undefined;
        if (cl?.over_dec && cl.under_dec) {
          closingLine = cl.line;
          closingPrice = p.side === "under" ? cl.under_dec : cl.over_dec;
          const fair = noVig([cl.over_dec, cl.under_dec]);
          clvVal = clv(p.price, p.side === "under" ? fair[1] : fair[0]);
        }
      }
    }
    upd.run(status, actual, won, closingPrice, closingLine, clvVal, Date.now(), p.id);
    settled++;
  }
  return { settled, open: open.length };
}

export interface PredictionRecord {
  id: number; created_at: number; game_id: string; game_date: string; market: string; subject_name: string; side: string;
  line: number | null; book: string; price: number; model_prob: number; raw_prob: number; market_prob: number | null; implied_prob: number;
  edge: number; ev: number; confidence: string; status: string; actual: number | null; won: number | null; closing_price: number | null; clv: number | null;
}

export function listPredictions(limit = 500): PredictionRecord[] {
  return getDb().prepare("SELECT * FROM predictions ORDER BY game_date DESC, ev DESC LIMIT ?").all(limit) as unknown as PredictionRecord[];
}
