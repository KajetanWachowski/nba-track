import { describe, expect, it } from "vitest";
import { classifyInjury, parsePropItems } from "@/lib/providers/espn";

const item = (athlete: string, type: string, target: number, dec: number, open?: number) => ({
  athlete: { $ref: `http://x/athletes/${athlete}?lang=en` },
  type: { id: type },
  odds: { decimal: { value: String(dec), open: open ? String(open) : undefined } },
  current: { target: { value: target } },
  open: { target: { value: target } },
  lastUpdated: "2026-11-10T18:00Z",
});

describe("ESPN prop parsing", () => {
  it("pairs O/U rows (first = over) and verifies with the milestone ladder", () => {
    const items = [
      item("1", "3", 11.5, 1.75), item("1", "3", 11.5, 2.05), // O/U 11.5 rebounds
      item("1", "220", 11, 1.4), item("1", "220", 12, 1.74), item("1", "220", 13, 2.4), // 12+ ≈ over 11.5
    ];
    const { lines, dropped } = parsePropItems("g", items);
    const ou = lines.find((l) => l.kind === "ou")!;
    expect(ou.overDec).toBe(1.75);
    expect(ou.underDec).toBe(2.05);
    expect(ou.sideCheck).toBe("milestone-verified");
    expect(lines.filter((l) => l.kind === "milestone").map((l) => l.line)).toEqual([10.5, 11.5, 12.5]);
    expect(dropped).toBe(0);
  });

  it("drops a pair whose order contradicts the milestone price", () => {
    const items = [item("1", "3", 11.5, 2.05), item("1", "3", 11.5, 1.75), item("1", "220", 12, 1.74)];
    const { lines, dropped } = parsePropItems("g", items);
    expect(lines.some((l) => l.kind === "ou")).toBe(false);
    expect(dropped).toBe(2);
  });

  it("drops milestone ladders with duplicated thresholds (mixed-up feeds)", () => {
    const items = [item("1", "220", 7, 1.03), item("1", "220", 8, 1.07), item("1", "220", 7, 7.9)];
    const { lines, dropped } = parsePropItems("g", items);
    expect(lines.length).toBe(0);
    expect(dropped).toBe(3);
  });
});

describe("injury classification", () => {
  it("maps ESPN status + report text to official designations", () => {
    expect(classifyInjury("Out", "")).toBe("OUT");
    expect(classifyInjury("Day-To-Day", "Smith is questionable for Tuesday's game")).toBe("QUESTIONABLE");
    expect(classifyInjury("Day-To-Day", "Smith (ankle) is doubtful")).toBe("DOUBTFUL");
    expect(classifyInjury("Day-To-Day", "Smith has been ruled out")).toBe("OUT");
    expect(classifyInjury("Day-To-Day", "Smith is probable")).toBe("PROBABLE");
    expect(classifyInjury("Day-To-Day", "Smith is dealing with soreness")).toBe("DAY-TO-DAY");
  });
});

import { vi } from "vitest";
describe("season log parsing", () => {
  it("uses the regular season, not the play-in block", async () => {
    vi.resetModules();
    vi.doMock("@/lib/http", () => ({
      fetchJson: async () => ({
        fetchedAt: 0, fromCache: true, stale: false,
        data: {
          names: ["minutes", "points", "totalRebounds", "assists", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "steals", "blocks", "turnovers"],
          events: { a: { gameDate: "2026-04-15", opponent: { id: "1" }, atVs: "vs" }, b: { gameDate: "2026-03-01", opponent: { id: "2" }, atVs: "@" }, c: { gameDate: "2026-03-03", opponent: { id: "3" }, atVs: "@" } },
          seasonTypes: [
            { displayName: "2025-26 Play In Regular Season", categories: [{ events: [{ eventId: "a", stats: ["38", "41", "9", "6", "3-7", "1", "0", "2"] }] }] },
            { displayName: "2025-26 Regular Season", categories: [{ events: [{ eventId: "b", stats: ["34", "25", "7", "5", "2-5", "1", "1", "3"] }, { eventId: "c", stats: ["30", "20", "6", "4", "1-4", "2", "0", "1"] }] }] },
          ],
        },
      }),
    }));
    const { fetchSeasonLog } = await import("@/lib/providers/espn");
    const log = await fetchSeasonLog("x", 2026);
    expect(log.map((g) => g.gameId)).toEqual(["b", "c"]);
    expect(log[0].fg3m).toBe(2);
    expect(log[1].home).toBe(false);
  });
});
