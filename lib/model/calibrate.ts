/**
 * Probability calibration.
 *
 *   p_final = σ( a + b·logit(p_model) + c·logit(p_market_novig) )
 *
 * Fitted by L2-regularised logistic regression on walk-forward backtest predictions (every
 * prediction there was made using only games before its date). b and c are learned, not set:
 * if the raw model is overconfident, b < 1 shrinks it; c measures how much the closing market
 * knows that the model does not. Until a backtest has been run the identity map is used
 * (a = 0, b = 1, c = 0) and the UI marks probabilities as "uncalibrated".
 */
import { getMeta, setMeta } from "../db";
import { clampP, logit, sigmoid } from "./stats";

export type CalScope = "player" | "game";

export interface Calibration {
  a: number;
  b: number;
  c: number;
  n: number;
  fittedAt: number | null;
  logLossRaw?: number;
  logLossCal?: number;
}

export const IDENTITY: Calibration = { a: 0, b: 1, c: 0, n: 0, fittedAt: null };

export function getCalibration(scope: CalScope): Calibration {
  return getMeta<Calibration>(`calibration:${scope}`) ?? IDENTITY;
}

export function saveCalibration(scope: CalScope, c: Calibration) {
  setMeta(`calibration:${scope}`, c);
}

export function applyCalibration(c: Calibration, pModel: number, pMarket: number | null): number {
  const zm = logit(clampP(pModel));
  const zk = pMarket === null ? zm : logit(clampP(pMarket));
  return clampP(sigmoid(c.a + c.b * zm + c.c * zk));
}

/**
 * Kalibracja dla dowolnej strony zakładu. Backtest dopasowuje ją do strony „powyżej” / gospodarza,
 * więc dla strony przeciwnej (poniżej, gość) liczymy dopełnienie: 1 − cal(1 − p, 1 − p_rynku).
 * Dzięki temu P(powyżej) + P(poniżej) = 1 także przy wyrazie wolnym a ≠ 0.
 */
export function calibrateSide(c: Calibration, pModel: number, pMarket: number | null, complement: boolean): number {
  if (!complement) return applyCalibration(c, pModel, pMarket);
  return clampP(1 - applyCalibration(c, 1 - pModel, pMarket === null ? null : 1 - pMarket));
}

export interface CalRow {
  pModel: number;
  pMarket: number;
  y: 0 | 1;
}

/**
 * IRLS / Newton for 3-parameter logistic regression. The ridge penalty pulls toward a prior of
 * (a, b, c) = (0, 0.25, 0.75): absent strong evidence, the closing market is assumed to be better
 * informed than a box-score model (an empirical regularity, confirmed by this project's backtests).
 */
export function fitCalibration(rows: CalRow[], lambda = 2): Calibration {
  if (rows.length < 50) return { ...IDENTITY, n: rows.length };
  const X = rows.map((r) => [1, logit(clampP(r.pModel)), logit(clampP(r.pMarket))]);
  const y = rows.map((r) => r.y);
  const prior = [0, 0.25, 0.75];
  let w = [...prior];
  for (let it = 0; it < 50; it++) {
    const g = [0, 0, 0];
    const H = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let i = 0; i < X.length; i++) {
      const z = w[0] * X[i][0] + w[1] * X[i][1] + w[2] * X[i][2];
      const p = sigmoid(z);
      const r = p - y[i];
      const s = p * (1 - p);
      for (let j = 0; j < 3; j++) {
        g[j] += r * X[i][j];
        for (let k = 0; k < 3; k++) H[j][k] += s * X[i][j] * X[i][k];
      }
    }
    for (let j = 0; j < 3; j++) {
      g[j] += lambda * (w[j] - prior[j]);
      H[j][j] += lambda;
    }
    const step = solve3(H, g);
    if (!step) break;
    w = w.map((v, j) => v - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  const cal: Calibration = { a: w[0], b: w[1], c: w[2], n: rows.length, fittedAt: Date.now() };
  cal.logLossRaw = logLoss(rows.map((r) => r.pModel), y);
  cal.logLossCal = logLoss(rows.map((r) => applyCalibration(cal, r.pModel, r.pMarket)), y);
  return cal;
}

function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

export function brier(ps: number[], ys: number[]): number {
  return ps.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / Math.max(1, ps.length);
}

export function logLoss(ps: number[], ys: number[]): number {
  return -ps.reduce((s, p, i) => s + (ys[i] ? Math.log(clampP(p)) : Math.log(1 - clampP(p))), 0) / Math.max(1, ps.length);
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  predicted: number;
  observed: number;
}

export function reliability(ps: number[], ys: number[], bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, predicted: 0, observed: 0 }));
  ps.forEach((p, i) => {
    const b = Math.min(bins - 1, Math.floor(p * bins));
    out[b].n++;
    out[b].predicted += p;
    out[b].observed += ys[i];
  });
  return out.map((b) => ({ ...b, predicted: b.n ? b.predicted / b.n : NaN, observed: b.n ? b.observed / b.n : NaN }));
}
