import { describe, expect, it } from "vitest";
import { normName } from "@/lib/providers/oddsapi";
import { playerMatcher } from "@/lib/providers/oddspapi";

const idx = new Map([["Jayson Tatum", "1"], ["Jaylen Brown", "2"], ["Jalen Williams", "3"], ["Jaylin Williams", "4"], ["Shai Gilgeous-Alexander", "5"], ["Jaren Jackson Jr.", "6"]].map(([n, id]) => [normName(n), id]));
const find = playerMatcher(idx);

describe("dopasowanie nazwisk z ofert bukmachera", () => {
  it("rozpoznaje różne zapisy tego samego zawodnika", () => {
    expect(find("Jayson Tatum", null)).toBe("1");
    expect(find("Tatum, Jayson", null)).toBe("1");
    expect(find("Tatum Jayson", null)).toBe("1");
    expect(find("J. Tatum", null)).toBe("1");
    expect(find("Tatum J.", null)).toBe("1");
    expect(find("Shai Gilgeous Alexander", null)).toBe("5");
    expect(find("Jaren Jackson", null)).toBe("6");
  });
  it("nie zgaduje przy niejednoznacznym nazwisku", () => {
    expect(find("J. Williams", null)).toBeNull();
    expect(find("Williams", null)).toBeNull();
  });
  it("rozstrzyga niejednoznaczność składami dwóch drużyn", () => {
    const team: Record<string, string> = { "3": "OKC", "4": "OKC", "1": "BOS", "2": "BOS" };
    expect(find("Brown", [(id) => team[id] === "BOS"])).toBe("2");
  });
});
