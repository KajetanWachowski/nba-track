/**
 * Kupony dnia: 2–3 nogi z różnych meczów, o łącznym kursie w zadanym przedziale.
 * Wybieramy kombinację o NAJWYŻSZEJ łącznej szansie (skalibrowane prawdopodobieństwa, mecze traktowane jako niezależne).
 * Ustawienia z testu na rozegranych meczach (część testowa backtestu, kursy otwarcia):
 *  - przy tym samym kursie łącznym mniej nóg = częściej wchodzi (marża bukmachera mnoży się z każdą nogą):
 *    kupon ~3 z 2 nóg wchodził w 47% przypadków, z 3 nóg w 42%;
 *  - bardzo niskie kursy (< 1.60) w kuponach ~4 i ~5 obniżały trafialność (19% vs 31% przy ~4),
 *    bo faworyci u bukmachera są przeceniani;
 *  - nogi z tego samego meczu są pomijane, bo są ze sobą powiązane.
 */
import type { BetEval } from "./engine";

export interface CouponTarget {
  key: string;
  title: string;
  min: number;
  max: number;
  maxLegs: number;
  /** minimalny kurs pojedynczej nogi */
  minLegPrice?: number;
  /** krótki opis dla użytkownika */
  blurb?: string;
}

export const COUPON_TARGETS: CouponTarget[] = [
  { key: "pewniaczek", title: "Pewniaczek", min: 2.5, max: 3.4, maxLegs: 2, minLegPrice: 1.4, blurb: "kurs ok. 3 · 2 typy" },
  { key: "zloty", title: "Złoty środek", min: 3.5, max: 4.6, maxLegs: 3, minLegPrice: 1.6, blurb: "kurs ok. 4 · 2–3 typy" },
  { key: "petarda", title: "Petarda", min: 4.6, max: 5.8, maxLegs: 3, minLegPrice: 1.6, blurb: "kurs ok. 5 · 3 typy" },
];

export interface LegLike { id: string; gameId: string; price: number; modelProb: number }

export interface Coupon<L extends LegLike = BetEval> {
  target: CouponTarget;
  legs: L[];
  odds: number;
  prob: number;
  ev: number;
  allPlayable: boolean;
}

/** Kandydaci na nogi: zakłady zawodników z kategorii „Najlepsze”/„Dobre”/„Warte obserwacji”, bez ryzyk krytycznych. */
export function couponCandidates(bets: BetEval[], opts: { onlyPlayable?: boolean; minProb?: number; minOdds?: number; minEv?: number } = {}): BetEval[] {
  const minProb = opts.minProb ?? 0.55;
  const minOdds = opts.minOdds ?? 1.4;
  const byKey = new Map<string, BetEval>();
  for (const b of bets) {
    if (b.kind !== "player" || b.assessment.category === "odrzucone") continue;
    if (b.assessment.risks.some((r) => r.severity === "krytyczne")) continue;
    // zawodnik właśnie zmienił rolę (np. wszedł do piątki) w stronę przeciw zakładowi — za duża niepewność na kupon
    if (b.assessment.stats?.context.roleSwitchAgainst) continue;
    if (b.modelProb < minProb || b.price < minOdds) continue;
    // marża mnoży się na kuponie — odrzucamy nogi z wyraźnie ujemnym EV
    if (b.ev < (opts.minEv ?? -0.03)) continue;
    if (opts.onlyPlayable && !b.playable) continue;
    // jeden zakład na zawodnika (najwyższa ocena)
    const k = b.subjectId;
    const cur = byKey.get(k);
    if (!cur || b.assessment.rankScore > cur.assessment.rankScore) byKey.set(k, b);
  }
  return [...byKey.values()].sort((a, b) => b.modelProb * 2 + b.ev - (a.modelProb * 2 + a.ev)).slice(0, 30);
}

export function buildCoupon<L extends LegLike>(cands: L[], target: CouponTarget, exclude = new Set<string>()): Omit<Coupon<L>, "allPlayable"> | null {
  const pool = cands.filter((b) => !exclude.has(b.id) && b.price >= (target.minLegPrice ?? 1));
  let best: { legs: L[]; odds: number; prob: number; ev: number } | null = null;
  const score = (prob: number, ev: number) => Math.log(prob) + 0.5 * ev;
  const legs: L[] = [];
  const games = new Set<string>();
  const dfs = (start: number, odds: number, prob: number) => {
    if (odds >= target.min && odds <= target.max && legs.length >= 2) {
      const ev = prob * odds - 1;
      if (!best || score(prob, ev) > score(best.prob, best.ev)) best = { legs: [...legs], odds, prob, ev };
    }
    if (legs.length >= target.maxLegs || odds > target.max) return;
    for (let i = start; i < pool.length; i++) {
      const b = pool[i];
      if (games.has(b.gameId)) continue;
      legs.push(b);
      games.add(b.gameId);
      dfs(i + 1, odds * b.price, prob * b.modelProb);
      legs.pop();
      games.delete(b.gameId);
    }
  };
  dfs(0, 1, 1);
  if (!best) return null;
  const b = best as { legs: L[]; odds: number; prob: number; ev: number };
  return { target, legs: b.legs, odds: b.odds, prob: b.prob, ev: b.ev };
}

/** Trzy kupony; ta sama noga nie powtarza się w kolejnych kuponach, jeśli da się tego uniknąć. */
export function buildDailyCoupons(bets: BetEval[], onlyPlayable: boolean): Coupon[] {
  const cands = couponCandidates(bets, { onlyPlayable });
  const used = new Set<string>();
  const out: Coupon[] = [];
  for (const t of COUPON_TARGETS) {
    const c = buildCoupon(cands, t, used) ?? buildCoupon(cands, t);
    if (c) {
      out.push({ ...c, allPlayable: c.legs.every((l) => l.playable) });
      for (const l of c.legs) used.add(l.id);
    }
  }
  return out;
}

/** Z prostych nóg buduje trzy kupony bez powtórek (używane też w teście historycznym). */
export function buildCouponSet<L extends LegLike>(cands: L[]): Omit<Coupon<L>, "allPlayable">[] {
  const used = new Set<string>();
  const out: Omit<Coupon<L>, "allPlayable">[] = [];
  for (const t of COUPON_TARGETS) {
    const c = buildCoupon(cands, t, used) ?? buildCoupon(cands, t);
    if (c) {
      out.push(c);
      for (const l of c.legs) used.add(l.id);
    }
  }
  return out;
}
