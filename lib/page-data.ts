import { analyzeSlate, type BetEval, type SlateAnalysis } from "./engine";
import { easternDay } from "./providers/espn";

/** Serializable slice of a slate analysis for pages (drops the in-memory simulation arrays). */
export async function loadSlate(day?: string, force = false): Promise<{ a: Omit<SlateAnalysis, "projections"> | null; error: string | null }> {
  try {
    const { projections: _p, ...a } = await analyzeSlate(day ?? easternDay(), { force });
    void _p;
    return { a, error: null };
  } catch (e) {
    return { a: null, error: (e as Error).message };
  }
}

export const playerBets = (bets: BetEval[]) => bets.filter((b) => b.kind === "player");

import type { Category } from "./assess";

/** Bets for a board: every recommended/watched bet (capped) and the best-ranked rejected ones. */
export function boardBets(bets: BetEval[], rejectedCap = 60, cap = 200) {
  const totals: Record<Category, number> = { najlepsze: 0, dobre: 0, obserwuj: 0, odrzucone: 0 };
  for (const b of bets) totals[b.assessment.category]++;
  const take = (c: Category, n: number) => bets.filter((b) => b.assessment.category === c).slice(0, n);
  return { list: [...take("najlepsze", cap), ...take("dobre", cap), ...take("obserwuj", cap), ...take("odrzucone", rejectedCap)], totals };
}
