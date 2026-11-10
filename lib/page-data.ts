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
