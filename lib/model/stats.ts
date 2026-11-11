/** Numerical helpers: seeded RNG, distribution samplers, CDFs, descriptive statistics. */

export type Rng = () => number;

/** mulberry32 — small, fast, seedable PRNG so model output is reproducible run-to-run. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function normalSample(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Marsaglia–Tsang gamma sampler (shape k, scale θ). */
export function gammaSample(rng: Rng, shape: number, scale: number): number {
  if (shape <= 0 || scale <= 0) return 0;
  if (shape < 1) return gammaSample(rng, shape + 1, scale) * Math.pow(rng() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normalSample(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

const LOG_FACT: number[] = [0];
function logFactorial(k: number): number {
  if (k < 0) return 0;
  if (k < 256) {
    for (let i = LOG_FACT.length; i <= k; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
    return LOG_FACT[k];
  }
  // Stirling series
  return k * Math.log(k) - k + 0.5 * Math.log(2 * Math.PI * k) + 1 / (12 * k) - 1 / (360 * k * k * k);
}

/** Poisson sampler: inversion for small λ, Hörmann's PTRS transformed rejection for λ ≥ 10. */
export function poissonSample(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda < 10) {
    let k = 0;
    let p = Math.exp(-lambda);
    let s = p;
    const u = rng();
    while (u > s && k < 200) {
      k++;
      p *= lambda / k;
      s += p;
    }
    return k;
  }
  const slam = Math.sqrt(lambda);
  const loglam = Math.log(lambda);
  const b = 0.931 + 2.53 * slam;
  const a = -0.059 + 0.02483 * b;
  const invalpha = 1.1239 + 1.1328 / (b - 3.4);
  const vr = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const U = rng() - 0.5;
    const V = rng();
    const us = 0.5 - Math.abs(U);
    const k = Math.floor(((2 * a) / us + b) * U + lambda + 0.43);
    if (us >= 0.07 && V <= vr) return k;
    if (k < 0 || (us < 0.013 && V > us)) continue;
    if (Math.log(V) + Math.log(invalpha) - Math.log(a / (us * us) + b) <= -lambda + k * loglam - logFactorial(k)) return k;
  }
}

/** Negative binomial as a gamma–Poisson mixture: mean μ, variance μ + φ·μ². φ = 0 → Poisson. */
export function negBinSample(rng: Rng, mean: number, phi: number): number {
  if (mean <= 0) return 0;
  if (phi <= 1e-6) return poissonSample(rng, mean);
  const shape = 1 / phi;
  return poissonSample(rng, gammaSample(rng, shape, mean * phi));
}

/**
 * Scaled negative binomial with var = κ·μ + φ·μ²: draw y ~ NB(μ/κ, φ) and return ⌊κ·y + U⌋.
 * The uniform jitter keeps integer support without parity artefacts and leaves the mean unchanged.
 */
export function scaledNegBinSample(rng: Rng, mean: number, kappa: number, phi: number): number {
  if (kappa <= 1.02) return negBinSample(rng, mean, phi);
  const y = negBinSample(rng, mean / kappa, phi);
  return Math.floor(kappa * y + rng());
}

/** Binomial(n, p) by direct Bernoulli summation — n is small here (three-point attempts). */
export function binomialSample(rng: Rng, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}

/** Beta(α, β) via two gamma draws. */
export function betaSample(rng: Rng, a: number, b: number): number {
  const x = gammaSample(rng, a, 1);
  const y = gammaSample(rng, b, 1);
  return x + y > 0 ? x / (x + y) : a / (a + b);
}

export function erf(x: number): number {
  // Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7)
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

export function normalCdf(x: number, mu = 0, sigma = 1): number {
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

export const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export const clampP = (p: number) => Math.min(1 - 1e-4, Math.max(1e-4, p));

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** OLS slope of ys against 0..n-1 (chronological order). */
export function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 3) return 0;
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) ** 2;
  }
  return den ? num / den : 0;
}

/** Exponential recency weights: index 0 = most recent game. */
export function decayWeights(n: number, halfLife: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.pow(0.5, i / halfLife));
}

/** Shrink a multiplicative factor toward 1 given n observations and prior strength k. */
export function shrinkRatio(ratio: number, n: number, k: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return 1 + (ratio - 1) * (n / (n + k));
}

export function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
