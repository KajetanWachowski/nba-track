import { describe, expect, it } from "vitest";
import { calibrateSide } from "@/lib/model/calibrate";

describe("kalibracja stron zakładu", () => {
  const cal = { a: 0.12, b: 0.6, c: 0.4, n: 1000, fittedAt: 1 };
  it("powyżej + poniżej (oraz gospodarz + gość) sumują się do 1", () => {
    for (const [p, m] of [[0.3, 0.45], [0.55, 0.5], [0.72, 0.6]] as const) {
      expect(calibrateSide(cal, p, m, false) + calibrateSide(cal, 1 - p, 1 - m, true)).toBeCloseTo(1, 9);
      expect(calibrateSide(cal, p, null, false) + calibrateSide(cal, 1 - p, null, true)).toBeCloseTo(1, 9);
    }
  });
});
