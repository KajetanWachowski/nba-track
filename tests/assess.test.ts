import { describe, expect, it } from "vitest";
import { assessPlayer, type AssessInput } from "@/lib/assess";
import { choosePrice } from "@/lib/pricing";
import { binomialSample, makeRng } from "@/lib/model/stats";
import type { PlayerGameRow } from "@/lib/store";

/** Synthetic game rows (oldest first). Not real data — test fixtures only. */
function rows(values: { fg3m: number; fg3a: number; min?: number; pts?: number }[]): PlayerGameRow[] {
  return values.map((v, i) => ({
    game_id: `g${i}`, athlete_id: "p", name: "Test", team_id: "T", opp_id: "O", date: `2026-10-${String(10 + i).padStart(2, "0")}T00:00Z`, day: `202610${10 + i}`,
    home: i % 2, pos: "G", starter: 1, dnp: 0, dnp_reason: null, min: v.min ?? 32, pts: v.pts ?? 15, reb: 4, oreb: 1, dreb: 3, ast: 4,
    fg3m: v.fg3m, fg3a: v.fg3a, fgm: 6, fga: 13, ftm: 2, fta: 3, stl: 1, blk: 0, tov: 2, pf: 2, usg: 22,
  }));
}

const statsStub = (mean: number) => ({ rate: 0, mean, factors: { pace: 1, opponent: 1, home: 1, teammates: 1, h2h: 1 } });
const proj = (fg3mMean: number) =>
  ({
    stats: { pts: statsStub(15), reb: statsStub(4), ast: statsStub(4), fg3m: statsStub(fg3mMean), stl: statsStub(1), blk: statsStub(0.3), tov: statsStub(2) },
    minutes: { mean: 32, sd: 4, base: 32, b2bFactor: 1, teammateDelta: 0 },
    blowout: { prob: 0.1, factor: 0.85, threshold: 20 },
    teammateEffects: [],
  }) as unknown as AssessInput["proj"];
const ctx = {
  teams: new Map([["O", { drtg: 112, pace: 99, shooting: { fg3aFactor: 1, fg3PctFactor: 1, fg3PctAllowed: 0.36, fgPctAllowed: 0.47, n: 10 } }]]),
  lgPace: 99,
} as unknown as AssessInput["ctx"];

function input(over: Partial<AssessInput>): AssessInput {
  return {
    market: "fg3m", side: "under", line: 1.5, modelProb: 0.6, rawProb: 0.6, pLow: 0.52, pHigh: 0.68, marketProb: 0.57, ev: 0.04, edge: 0.04, edgeVsFair: 0.03,
    price: 1.75, playable: true, manualPrice: null, staleMin: 10, oneWay: false, lineMovedAgainst: false,
    history: [], teamRecentGameIds: [], proj: proj(1.1), ctx, oppId: "O", oppAbbr: "OPP", teamAbbrById: () => "OPP", home: true, restDays: 1,
    selfStatus: null, injuriesAvailable: true, calibrated: true, marketProven: { proven: true, detail: "test" }, hasPriorSeason: true,
    ...over,
  };
}

describe("ocena zakładu — przykład Under 1.5 trójek", () => {
  // wyniki 0, 2, 1, 0, 3, 1, 0, 2, 1, 0 — ale w 5 ostatnich meczach liczba prób rośnie z 3 do 7
  const fg3m = [0, 2, 1, 0, 3, 1, 0, 2, 1, 0];
  const fg3a = [3, 3, 3, 3, 3, 7, 7, 7, 7, 7];
  const history = [...rows(Array.from({ length: 10 }, () => ({ fg3m: 1, fg3a: 3 }))), ...rows(fg3m.map((m, i) => ({ fg3m: m, fg3a: fg3a[i] })))].map((r, i) => ({ ...r, game_id: `h${i}` }));
  const teamRecentGameIds = history.map((r) => r.game_id);

  it("nie opiera się na średniej: rosnąca liczba prób za 3 jest ryzykiem dla Under", () => {
    const a = assessPlayer(input({ history, teamRecentGameIds }));
    const risk = a.risks.find((r) => r.text.includes("Liczba prób za 3 rośnie"));
    expect(risk?.severity).toBe("istotne");
    expect(a.stats!.shooting.fg3aL5).toBeCloseTo(7, 5);
    expect(a.stats!.windows.find((w) => w.label === "Ostatnie 10")!.hits).toBe(7); // 7/10 poniżej 1.5
  });

  it("słaba ostatnia forma odrzuca zakład mimo dodatniego EV i dobrej średniej sezonowej", () => {
    // sezon: 15 meczów z 0 trójek (Under wchodzi), ostatnie 5: 2–3 trójki (Under 0/5)
    const h = rows([...Array.from({ length: 15 }, () => ({ fg3m: 0, fg3a: 2 })), ...[2, 3, 2, 2, 3].map((m) => ({ fg3m: m, fg3a: 6 }))]);
    const a = assessPlayer(input({ history: h, teamRecentGameIds: h.map((r) => r.game_id), ev: 0.08 }));
    expect(a.risks[0].severity).toBe("krytyczne");
    expect(a.category).toBe("odrzucone");
    expect(a.categoryReasons[0]).toContain("Ryzyko krytyczne");
  });

  it("dobra średnia sezonowa, ale słabe 10 ostatnich meczów → istotne ryzyko", () => {
    const h = rows([...Array.from({ length: 20 }, () => ({ fg3m: 0, fg3a: 2 })), ...[2, 1, 2, 0, 2, 2, 1, 2, 2, 0].map((m) => ({ fg3m: m, fg3a: 4 }))]);
    const a = assessPlayer(input({ history: h, teamRecentGameIds: h.map((r) => r.game_id) }));
    expect(a.risks.some((r) => r.text.startsWith("Sezon wygląda dobrze") && r.severity === "istotne")).toBe(true);
  });
});

describe("kategorie i kursy", () => {
  const steady = rows(Array.from({ length: 20 }, (_, i) => ({ fg3m: i % 4 === 0 ? 2 : 0, fg3a: 3 })));
  const base = { history: steady, teamRecentGameIds: steady.map((r) => r.game_id), proj: proj(0.6), modelProb: 0.66, ev: 0.06, edgeVsFair: 0.04 };

  it("bez kursu polskiego bukmachera zakład nie może być polecany", () => {
    const a = assessPlayer(input({ ...base, playable: false }));
    expect(["obserwuj", "odrzucone"]).toContain(a.category);
    expect(a.categoryReasons.join(" ")).toContain("Brak kursu polskiego bukmachera");
  });

  it("typ zakładu niezweryfikowany w backteście nie trafia do Najlepszych ani Dobrych", () => {
    const a = assessPlayer(input({ ...base, marketProven: { proven: false, detail: "test" } }));
    expect(["obserwuj", "odrzucone"]).toContain(a.category);
  });

  it("niepewny status zawodnika jest ryzykiem krytycznym", () => {
    const a = assessPlayer(input({ ...base, selfStatus: "QUESTIONABLE" }));
    expect(a.category).toBe("odrzucone");
  });

  it("solidny zakład z kursem Superbet może być polecany", () => {
    const a = assessPlayer(input(base));
    expect(["najlepsze", "dobre"]).toContain(a.category);
    expect(a.quality.score).toBeGreaterThanOrEqual(70);
  });
});

describe("wybór kursu", () => {
  it("Superbet ma pierwszeństwo, USA tylko jako odniesienie", () => {
    const r = choosePrice([{ book: "draftkings", dec: 1.95 }, { book: "betclic", dec: 1.9 }, { book: "superbet", dec: 1.85 }, { book: "betfan", dec: 1.82 }]);
    expect(r.priceOffer?.book).toBe("superbet");
    expect(r.bestPl?.book).toBe("betclic");
    expect(r.reference?.book).toBe("draftkings");
    expect(r.playable).toBe(true);
  });
  it("bez Superbet — najlepszy polski kurs; bez polskich — kurs USA, ale niegrywalny", () => {
    expect(choosePrice([{ book: "betfan", dec: 1.8 }, { book: "betclic", dec: 1.9 }]).priceOffer?.book).toBe("betclic");
    const us = choosePrice([{ book: "draftkings", dec: 2.0 }]);
    expect(us.priceOffer?.book).toBe("draftkings");
    expect(us.playable).toBe(false);
  });
});

describe("rozkład dwumianowy (trafienia z prób)", () => {
  it("średnia n·p, wariancja n·p·(1−p)", () => {
    const rng = makeRng(7);
    const xs = Array.from({ length: 50000 }, () => binomialSample(rng, 6, 0.35));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length;
    expect(m).toBeCloseTo(2.1, 1);
    expect(v).toBeCloseTo(1.365, 1);
  });
});

describe("niskie kursy", () => {
  const steady = rows(Array.from({ length: 20 }, (_, i) => ({ fg3m: i % 4 === 0 ? 2 : 0, fg3a: 3 })));
  const base = { history: steady, teamRecentGameIds: steady.map((r) => r.game_id), proj: proj(0.6), modelProb: 0.86, edgeVsFair: 0.03 };
  it("kurs 1.20 nie może być „Najlepszy”, a „Dobry” wymaga EV ≥ 4%", () => {
    const low = assessPlayer(input({ ...base, price: 1.2, ev: 0.03 }));
    expect(low.category).not.toBe("najlepsze");
    expect(low.category).not.toBe("dobre");
    expect(low.risks.some((r) => r.text.startsWith("Niski kurs 1.20"))).toBe(true);
    const lowButValue = assessPlayer(input({ ...base, price: 1.2, ev: 0.05 }));
    expect(lowButValue.category).toBe("dobre");
  });
  it("niski kurs spada w rankingu względem kursu z preferowanego zakresu", () => {
    const low = assessPlayer(input({ ...base, price: 1.2, ev: 0.05 }));
    const mid = assessPlayer(input({ ...base, price: 1.9, ev: 0.05, modelProb: 0.6 }));
    expect(mid.rankScore - 100 * (0.6 - 0.86)).toBeGreaterThan(low.rankScore - 0);
  });
});
