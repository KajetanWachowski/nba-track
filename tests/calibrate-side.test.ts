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

import { pOverTeamTotal, teamPtsSd } from "@/lib/model/game";
import { H2H_STAT, isGameMarket, isH2H } from "@/lib/markets";

describe("nowe rynki Superbetu", () => {
  const gp = { homeId: "H", awayId: "A", possessions: 99, homePts: 115, awayPts: 108, margin: 7, total: 223, marginSd: 13, totalSd: 18, homeWinProb: 0.7, injuryAdj: [], restNote: [], sample: { home: 20, away: 20 } };
  it("punkty drużyny: 50% na średniej, rosną przy niższej linii", () => {
    expect(teamPtsSd(gp)).toBeCloseTo(Math.sqrt(18 ** 2 + 13 ** 2) / 2, 9);
    expect(pOverTeamTotal(gp, "H", 115)).toBeCloseTo(0.5, 6);
    expect(pOverTeamTotal(gp, "A", 100.5)).toBeGreaterThan(pOverTeamTotal(gp, "A", 110.5));
    expect(isGameMarket("team_total")).toBe(true);
  });
  it("pojedynki: rozpoznanie i statystyka", () => {
    expect(isH2H("h2h_pts")).toBe(true);
    expect(isH2H("pts")).toBe(false);
    expect(H2H_STAT.h2h_fg3m).toBe("fg3m");
  });
});
