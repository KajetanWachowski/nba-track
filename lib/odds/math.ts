/** Pure odds arithmetic. All odds are decimal unless the function name says otherwise. */

export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) return NaN;
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

export function decimalToAmerican(dec: number): number {
  if (!(dec > 1)) return NaN;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

/** Implied probability = 1 / odds (includes the bookmaker margin). */
export function impliedProb(dec: number): number {
  return 1 / dec;
}

/** Overround of a complete two-way (or n-way) market, e.g. 1.0476 for -110/-110. */
export function overround(decs: number[]): number {
  return decs.reduce((s, d) => s + 1 / d, 0);
}

/**
 * Remove the vig from a complete market.
 * - "multiplicative": p_i = (1/d_i) / Σ(1/d_j)  (simple normalisation)
 * - "power": find k with Σ (1/d_i)^k = 1 — accounts for favourite/longshot bias, the default.
 */
export function noVig(decs: number[], method: "power" | "multiplicative" = "power"): number[] {
  const raw = decs.map((d) => 1 / d);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (method === "multiplicative" || decs.length < 2) return raw.map((p) => p / sum);
  let lo = 0.5;
  let hi = 2.5;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const s = raw.reduce((a, p) => a + Math.pow(p, k), 0);
    if (s > 1) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  const ps = raw.map((p) => Math.pow(p, k));
  const t = ps.reduce((a, b) => a + b, 0);
  return ps.map((p) => p / t);
}

/** Edge in probability points: model − implied (implied includes vig, as the price you actually get). */
export function edge(modelProb: number, dec: number): number {
  return modelProb - impliedProb(dec);
}

/** Expected value per 1 unit staked: EV = p·odds − 1. */
export function expectedValue(modelProb: number, dec: number): number {
  return modelProb * dec - 1;
}

export function fairOdds(prob: number): number {
  return prob > 0 ? 1 / prob : Infinity;
}

/** Full Kelly fraction for decimal odds; callers should scale it down (¼ Kelly typical). */
export function kelly(prob: number, dec: number): number {
  const b = dec - 1;
  return Math.max(0, (b * prob - (1 - prob)) / b);
}

/** Closing line value: how much better the taken price was than the fair (no-vig) closing price. */
export function clv(takenDec: number, closingFairProb: number): number {
  return takenDec * closingFairProb - 1;
}
