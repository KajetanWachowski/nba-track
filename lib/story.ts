/**
 * Dane do „Historii typu” — serii pionowych grafik (9:16) opowiadających jeden zakład krok po kroku.
 * Wszystkie liczby pochodzą z bazy (ESPN) i z modelu; nic nie jest dopisywane.
 */
import { getPlayerAnalysis } from "./analysis";
import { statOf } from "./assess";
import { config } from "./config";
import { getDb } from "./db";
import type { BetEval } from "./engine";
import type { PlayerMarket } from "./markets";
import { getGame, getGameLine, getTeams, type TeamRow } from "./store";

export interface StoryGame { date: string; opp: string; oppLogo: string | null; home: boolean; value: number; min: number; fgm: number; fga: number; hit: boolean; won: boolean | null; score: string | null }

export interface StoryData {
  bet: BetEval;
  side: "over" | "under";
  noun: string;
  nounShort: string;
  player: { name: string; last: string; headshot: string | null; pos: string };
  team: TeamRow | null;
  opp: TeamRow | null;
  tipoff: string;
  teamForm: { result: "W" | "L"; oppLogo: string | null; opp: string }[];
  streak: { kind: "W" | "L"; n: number } | null;
  games: StoryGame[]; // ten sezon, chronologicznie
  season: { avg: number; min: number; n: number };
  prior: { avg: number; min: number; n: number } | null;
  oppRecord: { w: number; l: number; lastStreak: { kind: "W" | "L"; n: number } | null };
  oppAllowed: { pts: number[]; avg: number; leagueAvg: number };
  line: { spreadHome: number | null; total: number | null; homeAbbr: string; awayAbbr: string } | null;
  vsOpp: StoryGame[];
  oppOut: { name: string; status: string; min: number; headshot: string | null }[];
  teamOut: string[];
}

const NOUN: Record<string, [string, string]> = {
  pts: ["punktów", "PKT"], reb: ["zbiórek", "ZB"], ast: ["asyst", "AS"], fg3m: ["trafionych trójek", "3PT"], stl: ["przechwytów", "PRZ"], blk: ["bloków", "BL"],
  tov: ["strat", "STR"], pra: ["pkt+zb+as", "PZA"], pr: ["pkt+zb", "PZ"], pa: ["pkt+as", "PA"], ra: ["zb+as", "ZA"], stocks: ["przechwytów+bloków", "P+B"],
};

const headshotOf = (id: string) => `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;

export async function buildStory(b: BetEval): Promise<StoryData | null> {
  if (b.kind !== "player" || b.line === null) return null;
  const db = getDb();
  const teams = getTeams();
  const team = teams.get(b.teamId) ?? null;
  const opp = [...teams.values()].find((t) => t.abbr === b.oppAbbr) ?? null;
  const side: "over" | "under" = b.side === "under" ? "under" : "over";
  const hitOf = (v: number) => (side === "over" ? v > b.line! : v < b.line!);
  const market = b.market as PlayerMarket;

  const rows = db
    .prepare(`SELECT pg.*, g.home_score, g.away_score, g.home_id FROM player_games pg JOIN games g ON g.id = pg.game_id
      WHERE pg.athlete_id = ? AND g.season = ? AND g.season_type = 2 AND g.state = 'post' AND pg.dnp = 0 AND pg.min > 0 ORDER BY pg.date`)
    .all(b.subjectId, config.season) as unknown as (Record<string, number> & { opp_id: string; team_id: string; date: string; home_id: string; home: number })[];
  const toGame = (r: (typeof rows)[number]): StoryGame => {
    const v = statOf(r as never, market);
    const my = r.home ? r.home_score : r.away_score, their = r.home ? r.away_score : r.home_score;
    const o = teams.get(r.opp_id);
    return {
      date: r.date, opp: o?.abbr ?? "", oppLogo: o?.logo ?? null, home: !!r.home, value: v, min: Math.round(r.min), fgm: r.fgm ?? 0, fga: r.fga ?? 0,
      hit: hitOf(v), won: my !== null && their !== null ? my > their : null, score: my !== null && their !== null ? `${my}-${their}` : null,
    };
  };
  const games = rows.map(toGame);

  // forma drużyny: ostatnie 8 meczów
  const teamGames = db
    .prepare(`SELECT g.* FROM games g WHERE g.season = ? AND g.season_type = 2 AND g.state = 'post' AND (g.home_id = ? OR g.away_id = ?) ORDER BY g.date`)
    .all(config.season, b.teamId, b.teamId) as unknown as { home_id: string; away_id: string; home_score: number; away_score: number }[];
  const resultsOf = (gs: typeof teamGames, tid: string) =>
    gs.filter((g) => g.home_score !== null).map((g) => {
      const home = g.home_id === tid;
      const won = home ? g.home_score > g.away_score : g.away_score > g.home_score;
      const o = teams.get(home ? g.away_id : g.home_id);
      return { result: (won ? "W" : "L") as "W" | "L", oppLogo: o?.logo ?? null, opp: o?.abbr ?? "" };
    });
  const tr = resultsOf(teamGames, b.teamId);
  const streakOf = (r: { result: "W" | "L" }[]) => {
    if (!r.length) return null;
    const kind = r[r.length - 1].result;
    let n = 0;
    for (let i = r.length - 1; i >= 0 && r[i].result === kind; i--) n++;
    return { kind, n };
  };

  // rywal: bilans i punkty tracone
  let oppRecord: StoryData["oppRecord"] = { w: 0, l: 0, lastStreak: null };
  let oppAllowed: StoryData["oppAllowed"] = { pts: [], avg: NaN, leagueAvg: NaN };
  if (opp) {
    const og = db
      .prepare(`SELECT g.* FROM games g WHERE g.season = ? AND g.season_type = 2 AND g.state = 'post' AND (g.home_id = ? OR g.away_id = ?) ORDER BY g.date`)
      .all(config.season, opp.id, opp.id) as unknown as typeof teamGames;
    const orr = resultsOf(og, opp.id);
    oppRecord = { w: orr.filter((r) => r.result === "W").length, l: orr.filter((r) => r.result === "L").length, lastStreak: streakOf(orr) };
    const allowed = og.filter((g) => g.home_score !== null).map((g) => (g.home_id === opp.id ? g.away_score : g.home_score));
    const last8 = allowed.slice(-8);
    const lg = db.prepare(`SELECT AVG(home_score + away_score) / 2.0 AS a FROM games WHERE season = ? AND season_type = 2 AND state = 'post'`).get(config.season) as { a: number | null };
    oppAllowed = { pts: last8, avg: last8.length ? last8.reduce((a, x) => a + x, 0) / last8.length : NaN, leagueAvg: lg.a ?? NaN };
  }

  const pa = await getPlayerAnalysis(b.subjectId).catch(() => null);
  const sumParts = (avg: Record<string, number>) => statOf(avg as never, market);
  const season = { avg: games.length ? games.reduce((a, g) => a + g.value, 0) / games.length : NaN, min: games.length ? games.reduce((a, g) => a + g.min, 0) / games.length : NaN, n: games.length };
  const prior = pa?.priorSeason ? { avg: sumParts(pa.priorSeason.avg), min: pa.priorSeason.avg.min, n: pa.priorSeason.games } : null;

  const g = getGame(b.gameId);
  const gl = getGameLine(b.gameId);
  const line = g ? { spreadHome: gl?.spread_home ?? null, total: gl?.total ?? null, homeAbbr: teams.get(g.home_id)?.abbr ?? "", awayAbbr: teams.get(g.away_id)?.abbr ?? "" } : null;

  const st = b.assessment.stats;
  const oppOut = (st?.oppMissing ?? []).slice(0, 3).map((m) => ({ name: m.name, status: m.status, min: m.min, headshot: m.athleteId ? headshotOf(m.athleteId) : null }));
  const parts = b.subjectName.split(" ");
  return {
    bet: b,
    side,
    noun: (NOUN[b.market] ?? [b.marketLabel.toLowerCase()])[0],
    nounShort: (NOUN[b.market] ?? ["", b.marketLabel.toUpperCase()])[1],
    player: { name: b.subjectName, last: parts.length > 1 ? parts.slice(1).join(" ") : b.subjectName, headshot: pa?.headshot ?? headshotOf(b.subjectId), pos: pa?.pos ?? "" },
    team,
    opp,
    tipoff: b.tipoff,
    teamForm: tr.slice(-8),
    streak: streakOf(tr),
    games,
    season,
    prior,
    oppRecord,
    oppAllowed,
    line,
    vsOpp: games.filter((x) => x.opp === b.oppAbbr),
    oppOut,
    teamOut: st?.context.teammatesOut ?? [],
  };
}
