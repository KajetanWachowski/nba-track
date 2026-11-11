/**
 * Test historyczny kuponów: dla każdego dnia z części testowej ostatniego backtestu budujemy te same trzy kupony
 * (te same reguły co dziś: szansa ≥ 55%, kurs ≥ 1.40, jeden zakład na zawodnika, różne mecze, tylko rynki,
 * na których model wygrał z rynkiem), po kursach otwarcia DraftKings, i sprawdzamy, ile weszło.
 */
import { latestBacktest } from "./backtest";
import { buildCouponSet, COUPON_TARGETS, type LegLike } from "./coupons";
import { getDb } from "./db";

interface Row { game_id: string; day: string; subject_id: string; market: string; line: number; open_price: number; open_under: number | null; cal_prob: number | null; actual: number }

export interface CouponHistory {
  days: number;
  byTarget: { key: string; title: string; coupons: number; won: number; avgOdds: number; avgProb: number; profit: number; roi: number }[];
  legs: { n: number; won: number };
}

export function couponHistory(): CouponHistory | null {
  const bt = latestBacktest();
  const db = getDb();
  const run = db.prepare("SELECT MAX(run_id) AS id FROM backtest_rows").get() as { id: number | null };
  if (!bt || !run.id) return null;
  const rows = db
    .prepare(`SELECT r.game_id, g.day, r.subject_id, r.market, r.line, r.open_price, r.open_under, r.cal_prob, r.actual
      FROM backtest_rows r JOIN games g ON g.id = r.game_id
      WHERE r.run_id = ? AND r.fold = 'test' AND r.market NOT IN ('ml','spread','total') AND r.open_under IS NOT NULL AND r.cal_prob IS NOT NULL`)
    .all(run.id) as unknown as Row[];
  if (!rows.length) return null;
  const proven = (m: string) => {
    const s = bt.byMarket?.[m];
    return !!s && s.n >= 100 && s.logLossCal < s.logLossMarket;
  };
  type Leg = LegLike & { win: boolean };
  const byDay = new Map<string, Leg[]>();
  for (const r of rows) {
    if (!proven(r.market)) continue;
    const over = r.cal_prob! >= 0.5;
    const p = over ? r.cal_prob! : 1 - r.cal_prob!;
    const price = over ? r.open_price : r.open_under!;
    if (p < 0.55 || price < 1.4 || p * price - 1 < -0.03 || r.actual === r.line) continue;
    const leg: Leg = { id: `${r.game_id}|${r.subject_id}|${r.market}|${r.line}`, gameId: r.game_id, price, modelProb: p, win: over ? r.actual > r.line : r.actual < r.line };
    (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(leg);
  }
  const acc = new Map(COUPON_TARGETS.map((t) => [t.key, { coupons: 0, won: 0, odds: 0, prob: 0, profit: 0 }]));
  let legsN = 0, legsWon = 0;
  for (const legs of byDay.values()) {
    // jeden zakład na zawodnika: najwyższa szansa
    const best = new Map<string, Leg>();
    for (const l of legs) {
      const k = l.id.split("|").slice(0, 2).join("|");
      const cur = best.get(k);
      if (!cur || l.modelProb > cur.modelProb) best.set(k, l);
    }
    const cands = [...best.values()].sort((a, b) => b.modelProb - a.modelProb).slice(0, 30);
    for (const c of buildCouponSet(cands)) {
      const a = acc.get(c.target.key)!;
      const won = c.legs.every((l) => l.win);
      a.coupons++;
      a.odds += c.odds;
      a.prob += c.prob;
      if (won) a.won++;
      a.profit += won ? c.odds - 1 : -1;
      legsN += c.legs.length;
      legsWon += c.legs.filter((l) => l.win).length;
    }
  }
  return {
    days: byDay.size,
    byTarget: COUPON_TARGETS.map((t) => {
      const a = acc.get(t.key)!;
      return { key: t.key, title: t.title, coupons: a.coupons, won: a.won, avgOdds: a.coupons ? a.odds / a.coupons : 0, avgProb: a.coupons ? a.prob / a.coupons : 0, profit: a.profit, roi: a.coupons ? a.profit / a.coupons : 0 };
    }),
    legs: { n: legsN, won: legsWon },
  };
}
