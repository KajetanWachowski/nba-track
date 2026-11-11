import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "papi2-"));
process.env.DATA_DIR = dir;
process.env.ODDSPAPI_KEY = "test-key";
process.env.ODDSPAPI_DAILY_LIMIT = "50";
process.env.ODDSPAPI_BOOKMAKERS = "superbet.pl:superbet,betclic.pl:betclic";

const game = { gameId: "g1", date: "2026-11-11T00:30:00Z", homeId: "18", awayId: "15", homeName: "New York Knicks", awayName: "Milwaukee Bucks" };
const calls: string[] = [];
let rateLimitOnce = true;

function respond(url: string) {
  const u = new URL(url);
  const bk = u.searchParams.get("bookmakers") ?? "";
  calls.push(`${u.pathname}?${bk}`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (u.pathname.endsWith("/participants")) return json({ "1": "New York Knicks", "2": "Milwaukee Bucks" });
  if (u.pathname.endsWith("/markets")) return json([{ marketId: 111, playerProp: false, handicap: 0, period: "result", marketType: "moneyline", outcomes: [{ outcomeId: 111, outcomeName: "1" }, { outcomeId: 112, outcomeName: "2" }] }]);
  if (u.pathname.endsWith("/fixtures")) return json([0, 1].map((i) => ({ fixtureId: `f${i}`, participant1Id: 1, participant2Id: 2, startTime: "2026-11-11T00:30:00.000Z", statusId: 0 })));
  if (u.pathname.endsWith("/odds")) {
    if (rateLimitOnce) {
      rateLimitOnce = false;
      return json({ error: { message: "You are being rate limited.", details: "Please wait 0.05 seconds before making another request to /v4/odds." } }, 429);
    }
    if (bk.includes("betclic.pl")) return json({ error: { message: "Forbidden", details: "Bookmaker not included in your plan." } }, 403);
    return json({ bookmakerOdds: { "superbet.pl": { bookmakerIsActive: true, markets: { "111": { outcomes: { "111": { players: { "0": { price: 1.5, active: true } } }, "112": { players: { "0": { price: 2.6, active: true } } } } } } } } });
  }
  return json({}, 404);
}

let papi: typeof import("@/lib/providers/oddspapi");
beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(url)));
  papi = await import("@/lib/providers/oddspapi");
});
afterAll(() => { vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("OddsPapi: tempo zapytań i bukmacherzy spoza planu", () => {
  it("429 → czeka i ponawia; 403 dla jednego bukmachera → sprawdza każdego raz i pomija niedostępnego", async () => {
    const r = await papi.fetchPolishOffers([game], new Map(), undefined, true);
    expect(r.fatal).toBeUndefined();
    expect(r.offers.filter((o) => o.book === "superbet" && o.market === "ml")).toHaveLength(4); // 2 mecze × 2 strony
    expect(r.errors.join(" ")).toContain("nie obejmuje: betclic.pl");
    // mecz 2 pyta już tylko o superbet.pl
    expect(calls.filter((c) => c.startsWith("/v4/odds")).at(-1)).toBe("/v4/odds?superbet.pl");
    // 429 nie liczy się do limitu: participants+markets+fixtures + (odds 403) + 2 próby + odds mecz 2 = 7
    expect(papi.getUsage().count).toBe(7);
  }, 20000);
});
