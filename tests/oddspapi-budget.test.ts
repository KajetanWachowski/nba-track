import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// isolated DB + config for this file
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "papi-"));
process.env.DATA_DIR = dir;
process.env.ODDSPAPI_KEY = "test-key";
process.env.ODDSPAPI_DAILY_LIMIT = "10";
process.env.ODDSPAPI_BOOKMAKERS = "superbet.pl:superbet,fortuna.pl:fortuna";

const game = { gameId: "g1", date: "2026-11-11T00:30:00Z", homeId: "18", awayId: "15", homeName: "New York Knicks", awayName: "Milwaukee Bucks" };
const calls: string[] = [];

function respond(url: string) {
  const u = new URL(url);
  calls.push(`${u.pathname}?bookmakers=${u.searchParams.get("bookmakers") ?? ""}`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (u.pathname.endsWith("/participants")) return json({ "1": "New York Knicks", "2": "Milwaukee Bucks" });
  if (u.pathname.endsWith("/markets")) return json([{ marketId: 111, playerProp: false, handicap: 0, period: "result", marketType: "moneyline", outcomes: [{ outcomeId: 111, outcomeName: "1" }, { outcomeId: 112, outcomeName: "2" }] }]);
  if (u.pathname.endsWith("/fixtures")) return json([{ fixtureId: "f1", participant1Id: 1, participant2Id: 2, startTime: "2026-11-11T00:30:00.000Z", statusId: 0 }]);
  if (u.pathname.endsWith("/odds")) {
    if ((u.searchParams.get("bookmakers") ?? "").includes("fortuna.pl"))
      return json({ error: { message: "Invalid bookmaker(s) provided.", details: "Invalid bookmakers: fortuna.pl. Valid bookmakers are: superbet.pl, efortuna.pl" } }, 400);
    return json({ bookmakerOdds: { "superbet.pl": { bookmakerIsActive: true, markets: { "111": { outcomes: { "111": { players: { "0": { price: 1.1, active: true } } }, "112": { players: { "0": { price: 7.5, active: true } } } } } } } } });
  }
  return json({}, 404);
}

let papi: typeof import("@/lib/providers/oddspapi");
beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(url)));
  papi = await import("@/lib/providers/oddspapi");
});
beforeEach(() => { calls.length = 0; });
afterAll(() => { vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("OddsPapi request budget", () => {
  it("page renders (network=false) never make requests", async () => {
    const r = await papi.fetchPolishOffers([game], new Map());
    expect(r.notFetched).toBe(true);
    expect(calls).toHaveLength(0);
    expect(papi.getUsage().count).toBe(0);
  });

  it("refresh counts every request; an invalid slug costs one retry and is remembered", async () => {
    const r = await papi.fetchPolishOffers([game], new Map(), undefined, true);
    // participants, markets, fixtures, odds (rejected: fortuna.pl), odds retry without it
    expect(calls).toEqual(["/v4/participants?bookmakers=", "/v4/markets?bookmakers=", "/v4/fixtures?bookmakers=", "/v4/odds?bookmakers=superbet.pl,fortuna.pl", "/v4/odds?bookmakers=superbet.pl"]);
    expect(papi.getUsage().count).toBe(5);
    expect(r.offers.filter((o) => o.market === "ml")).toHaveLength(2);
    expect(r.errors[0]).toContain("„fortuna.pl”");
  });

  it("afterwards renders use the cache (0 requests) and the bad slug is never sent again", async () => {
    const r = await papi.fetchPolishOffers([game], new Map());
    expect(calls).toHaveLength(0);
    expect(r.offers.filter((o) => o.market === "ml")).toHaveLength(2);
    // a second refresh soon after: metadata cached, fixtures+odds re-fetched without fortuna.pl
    await new Promise((res) => setTimeout(res, 5));
    vi.useFakeTimers({ now: Date.now() + 120_000, toFake: ["Date"] });
    await papi.fetchPolishOffers([game], new Map(), undefined, true);
    vi.useRealTimers();
    expect(calls).toEqual(["/v4/fixtures?bookmakers=", "/v4/odds?bookmakers=superbet.pl"]);
    expect(papi.getUsage().count).toBe(7);
  });

  it("refreshes within a minute reuse the cache; at the daily limit cached data is served", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ now: t0 + 600_000, toFake: ["Date"] });
    await papi.fetchPolishOffers([game], new Map(), undefined, true); // 7 → 9
    vi.setSystemTime(t0 + 700_000); // cache expired again
    const r = await papi.fetchPolishOffers([game], new Map(), undefined, true); // fixtures → 10, odds blocked by limit → cached odds
    vi.useRealTimers();
    expect(papi.getUsage().count).toBe(10);
    expect(papi.getUsage().remaining).toBe(0);
    expect(r.offers.length).toBeGreaterThan(0);
  });
});
