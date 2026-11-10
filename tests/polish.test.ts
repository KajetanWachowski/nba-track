import { describe, expect, it } from "vitest";
import { effectivePrice } from "@/lib/books";
import { manualToOffers } from "@/lib/manual-odds";
import { canonicalMarket } from "@/lib/providers/oddspapi";

describe("Polish stake tax", () => {
  const on = { enabled: true, rate: 0.12, exempt: ["superbet"] };
  it("applies 12% only to Polish books, when enabled, except exempt ones", () => {
    expect(effectivePrice("betclic", 1.9, on)).toBeCloseTo(1.672, 6);
    expect(effectivePrice("superbet", 1.9, on)).toBe(1.9);
    expect(effectivePrice("draftkings", 1.9, on)).toBe(1.9);
    expect(effectivePrice("betfan", 1.9, { ...on, enabled: false })).toBe(1.9);
  });
});

describe("manual odds expansion", () => {
  const ha = new Map([["g", { home: "H", away: "A" }]]);
  const row = (market: string, line: number, over: number | null, under: number | null, subject = "p") =>
    ({ game_id: "g", market, subject_id: subject, line, book: "betfan", over_dec: over, under_dec: under, created_at: 0 });
  it("player O/U produces both sides with opposite prices", () => {
    const o = manualToOffers([row("reb", 11.5, 1.8, 2.0)], ha);
    expect(o.map((x) => [x.side, x.line, x.dec, x.oppDec])).toEqual([["over", 11.5, 1.8, 2.0], ["under", 11.5, 2.0, 1.8]]);
  });
  it("spread stores the home line and mirrors it for the away side", () => {
    const o = manualToOffers([row("spread", -8.5, 1.9, 1.9, "game")], ha);
    expect(o.map((x) => [x.subjectId, x.side, x.line])).toEqual([["H", "home", -8.5], ["A", "away", 8.5]]);
  });
  it("moneyline has no line; one-sided entries are allowed", () => {
    const o = manualToOffers([row("ml", 0, 1.3, null, "game")], ha);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ side: "home", line: null, oppDec: null });
  });
});

describe("OddsPapi market mapping", () => {
  const m = (marketType: string, playerProp = true, period = "result", marketName = "") =>
    ({ marketId: 1, marketLength: 2, playerProp, handicap: 0, period, marketType, marketName, outcomes: [] });
  it("maps game and player markets, rejects unknown/period markets", () => {
    expect(canonicalMarket(m("moneyline", false))).toBe("ml");
    expect(canonicalMarket(m("totals", false))).toBe("total");
    expect(canonicalMarket(m("totals", false, "p1"))).toBeNull();
    expect(canonicalMarket(m("players-points"))).toBe("pts");
    expect(canonicalMarket(m("players-points-rebounds-assists"))).toBe("pra");
    expect(canonicalMarket(m("players-threes-made"))).toBe("fg3m");
    expect(canonicalMarket(m("players-first-basket"))).toBeNull();
  });
});
