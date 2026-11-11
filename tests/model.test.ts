import { describe, expect, it } from "vitest";
import { applyCalibration, fitCalibration, IDENTITY } from "@/lib/model/calibrate";
import { makeRng, negBinSample, normalCdf, poissonSample, scaledNegBinSample } from "@/lib/model/stats";

const moments = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { m, v: xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length };
};

describe("samplers", () => {
  it("poisson has mean = variance = λ (small and large λ)", () => {
    for (const lam of [3, 25]) {
      const rng = makeRng(1);
      const { m, v } = moments(Array.from({ length: 60000 }, () => poissonSample(rng, lam)));
      expect(m).toBeCloseTo(lam, 0);
      expect(v / lam).toBeGreaterThan(0.95);
      expect(v / lam).toBeLessThan(1.05);
    }
  });

  it("negative binomial has var = μ + φμ²", () => {
    const rng = makeRng(2);
    const { m, v } = moments(Array.from({ length: 80000 }, () => negBinSample(rng, 10, 0.1)));
    expect(m).toBeCloseTo(10, 0);
    expect(v).toBeGreaterThan(19);
    expect(v).toBeLessThan(21);
  });

  it("scaled negative binomial has var ≈ κμ + φμ² and unbiased mean", () => {
    const rng = makeRng(3);
    const { m, v } = moments(Array.from({ length: 80000 }, () => scaledNegBinSample(rng, 20, 2, 0.01)));
    expect(m).toBeGreaterThan(19.8);
    expect(m).toBeLessThan(20.2);
    expect(v).toBeGreaterThan(42);
    expect(v).toBeLessThan(46.5); // 2·20 + 0.01·400 = 44 (+1/12 jitter)
  });

  it("normal cdf", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe("calibration", () => {
  it("identity map leaves probabilities unchanged", () => {
    expect(applyCalibration(IDENTITY, 0.63, 0.5)).toBeCloseTo(0.63, 6);
  });

  it("learns to shrink an overconfident model toward the truth", () => {
    const rng = makeRng(4);
    const rows = Array.from({ length: 4000 }, () => {
      const truth = 0.3 + 0.4 * rng();
      const z = Math.log(truth / (1 - truth));
      const model = 1 / (1 + Math.exp(-(2.5 * z + (rng() - 0.5)))); // overconfident & noisy
      return { pModel: model, pMarket: truth, y: (rng() < truth ? 1 : 0) as 0 | 1 };
    });
    const c = fitCalibration(rows, 0.1);
    expect(c.c).toBeGreaterThan(c.b); // the informative input (market) dominates
    expect(c.logLossCal!).toBeLessThan(c.logLossRaw!);
  });
});

describe("przedział niepewności po kalibracji", () => {
  it("skalibrowany punkt leży wewnątrz skalibrowanego przedziału", () => {
    const cal = { a: -0.1, b: 0.17, c: 0.81, n: 1000, fittedAt: 1 };
    const [lo, mid, hi] = [0.86, 0.91, 0.96].map((p) => applyCalibration(cal, p, 0.73));
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
  });
});
