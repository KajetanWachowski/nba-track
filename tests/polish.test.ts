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

describe("OddsPapi v4 market mapping (types seen in the live Superbet PL feed)", () => {
  const m = (marketType: string, period = "result") => ({ marketType, period, playerProp: marketType.startsWith("player") });
  it("maps full-game markets and rejects quarters and unknown props", () => {
    expect(canonicalMarket(m("moneyline"))).toEqual({ market: "ml", kind: "game" });
    expect(canonicalMarket(m("spreads"))).toEqual({ market: "spread", kind: "game" });
    expect(canonicalMarket(m("totals", "p1"))).toBeNull();
    expect(canonicalMarket(m("playertotals-points"))).toEqual({ market: "pts", kind: "ou" });
    expect(canonicalMarket(m("playertotals-ptsassreb"))).toEqual({ market: "pra", kind: "ou" });
    expect(canonicalMarket(m("playertotals-assreb"))).toEqual({ market: "ra", kind: "ou" });
    expect(canonicalMarket(m("playertotals-3pointers"))).toEqual({ market: "fg3m", kind: "ou" });
    expect(canonicalMarket(m("players-assists"))).toEqual({ market: "ast", kind: "milestone" });
    expect(canonicalMarket(m("playertotals-points", "p1"))).toBeNull();
    expect(canonicalMarket(m("players-firstpoint"))).toBeNull();
  });
});

import { explainPapiError } from "@/lib/providers/oddspapi";
describe("OddsPapi error messages", () => {
  it("condenses the invalid-bookmaker error to the Polish slugs", () => {
    const m = "HTTP 400: Invalid bookmaker(s) provided. — Invalid bookmakers: fortuna.pl. Valid bookmakers are: 188bet, betclic.pl, efortuna.pl, superbet, superbet.pl, sts.pl, zebet.fr";
    const out = explainPapiError(m);
    expect(out).toContain("„fortuna.pl”");
    expect(out).toContain("betclic.pl, efortuna.pl, superbet.pl, sts.pl");
    expect(out).not.toContain("zebet");
  });
});
