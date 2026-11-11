import { describe, expect, it } from "vitest";
import { explainProjection } from "@/lib/model/explain";

describe("Skąd ta projekcja?", () => {
  it("kroki sumują się dokładnie do projekcji, a rywal ma miejsce w lidze", () => {
    const st = (rate: number, f: Partial<Record<string, number>> = {}) => ({ rate, mean: 0, factors: { pace: 0.98, opponent: 0.95, home: 1.01, teammates: 1, h2h: 1.02, ...f } });
    const proj = {
      pos: "G", stats: { pts: st(0.6), reb: st(0.15), ast: st(0.18), fg3m: st(0.08), stl: st(0.03), blk: st(0.01), tov: st(0.06) },
      minutes: { mean: 28, sd: 5, base: 30, b2bFactor: 1, teammateDelta: 0 }, blowout: { prob: 0.17, factor: 0.85, threshold: 20 }, teammateEffects: [],
    } as never;
    const history = Array.from({ length: 10 }, (_, i) => ({ game_id: `g${i}`, dnp: 0, min: 31, pts: 20, reb: 4, ast: 5, fg3m: 2, fg3a: 6, stl: 1, blk: 0, tov: 2 })) as never;
    const team = (drtg: number, f: number) => ({ drtg, pace: 99, shooting: { fg3PctAllowed: 0.35, fg3aFactor: 1 }, posDefense: { G: { pts: { factor: f }, reb: { factor: f }, ast: { factor: f } } } });
    const ctx = { teams: new Map([["OKC", team(106, 0.9)], ["X", team(112, 1.0)], ["Y", team(115, 1.1)]]), lgPace: 99 } as never;
    const e = explainProjection({ market: "pra", proj, simMean: 22.5, history, ctx, oppId: "OKC", oppAbbr: "OKC", home: true });
    const total = e.start + e.steps.filter((s) => s.key !== "base").reduce((a, s) => a + s.delta, 0);
    expect(total).toBeCloseTo(22.5, 6);
    expect(e.start).toBeCloseTo(29, 6);
    expect(e.opponent.join(" ")).toContain("1. najlepiej broniąca drużyna z 3");
    expect(e.headline).toContain("niższa od średniej sezonu");
  });
});
