import { describe, expect, it } from "vitest";
import { americanToDecimal, clv, decimalToAmerican, edge, expectedValue, fairOdds, impliedProb, kelly, noVig, overround } from "@/lib/odds/math";

describe("odds math", () => {
  it("converts american ↔ decimal", () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1.9091, 4);
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 6);
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(1.5)).toBe(-200);
  });

  it("reproduces the spec example (Avdija Over 35.5 PRA @ 1.90, model 58%)", () => {
    const p = 0.58, d = 1.9;
    expect(impliedProb(d)).toBeCloseTo(0.5263, 4);
    expect(edge(p, d)).toBeCloseTo(0.0537, 4);
    expect(expectedValue(p, d)).toBeCloseTo(0.102, 3);
    expect(fairOdds(p)).toBeCloseTo(1.724, 3);
  });

  it("removes vig so that probabilities sum to 1", () => {
    const [a, b] = noVig([1.91, 1.91]);
    expect(a).toBeCloseTo(0.5, 6);
    expect(a + b).toBeCloseTo(1, 9);
    const [fav, dog] = noVig([1.27, 4.1]);
    expect(fav + dog).toBeCloseTo(1, 9);
    // power method assigns relatively more of the margin to the longshot than normalisation does
    const [, dogMult] = noVig([1.27, 4.1], "multiplicative");
    expect(dog).toBeLessThan(dogMult);
    expect(overround([1.91, 1.91])).toBeCloseTo(1.0471, 4);
  });

  it("kelly and clv", () => {
    expect(kelly(0.5, 2)).toBe(0);
    expect(kelly(0.6, 2)).toBeCloseTo(0.2, 6);
    expect(clv(2.0, 0.55)).toBeCloseTo(0.1, 6);
  });
});
