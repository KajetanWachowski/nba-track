/**
 * Team-level game model.
 *   possessions = pace_home · pace_away / league_pace
 *   points_team = (ORtg_team + DRtg_opp − league_ORtg) / 100 · possessions  (± home court / 2)
 * Ratings are recency-weighted, opponent-adjusted and shrunk to league average (see context.ts).
 * Margin and total residuals are Normal with SDs estimated from this season's residuals,
 * shrunk toward long-run NBA values. Injuries: a documented heuristic removes part of an absent
 * player's points created, only when that absence is new (not already reflected in recent games).
 */
import { playedGames } from "./player";
import { type LeagueContext } from "./context";
import { mean, normalCdf } from "./stats";

export interface GameAbsence {
  athleteId: string;
  name: string;
  teamId: string;
  pOut: number;
}

export interface GameProjection {
  homeId: string;
  awayId: string;
  possessions: number;
  homePts: number;
  awayPts: number;
  margin: number; // home − away
  total: number;
  marginSd: number;
  totalSd: number;
  homeWinProb: number;
  injuryAdj: { teamId: string; name: string; pts: number }[];
  restNote: string[];
  sample: { home: number; away: number };
}

/** Fraction of an absent player's points created (pts + 0.8·ast) that a replacement fails to make up. */
const REPLACEMENT_LOSS = 0.15;

export function projectGame(
  ctx: LeagueContext,
  homeId: string,
  awayId: string,
  absences: GameAbsence[],
  rest: { home: number | null; away: number | null },
): GameProjection | null {
  const h = ctx.teams.get(homeId);
  const a = ctx.teams.get(awayId);
  if (!h || !a) return null;
  const poss = (h.pace * a.pace) / ctx.lgPace;
  let homePts = ((h.ortg + a.drtg - ctx.lgOrtg) / 100) * poss + ctx.homeCourt / 2;
  let awayPts = ((a.ortg + h.drtg - ctx.lgOrtg) / 100) * poss - ctx.homeCourt / 2;

  const injuryAdj: GameProjection["injuryAdj"] = [];
  for (const ab of absences) {
    if (ab.pOut < 0.5) continue;
    const rows = ctx.playerGames(ab.athleteId).filter((r) => r.team_id === ab.teamId);
    const played = playedGames(rows);
    if (played.length < 2) continue;
    const teamRecent = ctx.teamGames(ab.teamId).slice(-5).map((r) => r.game_id);
    const playedSet = new Set(played.map((r) => r.game_id));
    const recentPlayed = teamRecent.filter((id) => playedSet.has(id)).length;
    if (recentPlayed < 2) continue; // absence already baked into recent ratings
    const pc = mean(played.map((r) => r.pts + 0.8 * r.ast));
    const loss = REPLACEMENT_LOSS * pc * ab.pOut * (recentPlayed / Math.max(1, teamRecent.length));
    if (loss < 0.3) continue;
    if (ab.teamId === homeId) homePts -= loss;
    else awayPts -= loss;
    injuryAdj.push({ teamId: ab.teamId, name: ab.name, pts: -loss });
  }

  const restNote: string[] = [];
  if (rest.home === 0) restNote.push("home team on 2nd night of back-to-back");
  if (rest.away === 0) restNote.push("away team on 2nd night of back-to-back");

  const margin = homePts - awayPts;
  const total = homePts + awayPts;
  return {
    homeId, awayId, possessions: poss, homePts, awayPts, margin, total,
    marginSd: ctx.marginSd, totalSd: ctx.totalSd,
    homeWinProb: 1 - normalCdf(0, margin, ctx.marginSd),
    injuryAdj, restNote, sample: { home: h.games, away: a.games },
  };
}

/** P(home covers a home spread line), e.g. line −8.5 → P(margin > 8.5). */
export function pHomeCovers(g: GameProjection, homeLine: number): number {
  return 1 - normalCdf(-homeLine, g.margin, g.marginSd);
}

/** Odchylenie punktów jednej drużyny: total = H + A, margin = H − A ⇒ σ_H ≈ √(σ_T² + σ_M²) / 2 (przy braku korelacji). */
export const teamPtsSd = (g: GameProjection) => Math.sqrt(g.totalSd ** 2 + g.marginSd ** 2) / 2;

/** P(drużyna zdobędzie więcej niż `line` punktów). */
export function pOverTeamTotal(g: GameProjection, teamId: string, line: number): number {
  return 1 - normalCdf(line, teamId === g.homeId ? g.homePts : g.awayPts, teamPtsSd(g));
}

export function pOverTotal(g: GameProjection, line: number): number {
  return 1 - normalCdf(line, g.total, g.totalSd);
}
