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
