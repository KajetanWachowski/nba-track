import { getDb } from "./db";

export interface PlayerGameRow {
  game_id: string; athlete_id: string; name: string; team_id: string; opp_id: string; date: string; day: string;
  home: number; pos: string; starter: number; dnp: number; dnp_reason: string | null;
  min: number; pts: number; reb: number; oreb: number; dreb: number; ast: number; fg3m: number; fg3a: number;
  fgm: number; fga: number; ftm: number; fta: number; stl: number; blk: number; tov: number; pf: number; usg: number | null;
}
export interface TeamGameRow {
  game_id: string; team_id: string; opp_id: string; date: string; day: string; home: number;
  pts: number; fgm: number; fga: number; fg3m: number; fg3a: number; ftm: number; fta: number;
  oreb: number; dreb: number; reb: number; ast: number; stl: number; blk: number; tov: number; pf: number;
  min_total: number; poss: number;
}
export interface GameRow {
  id: string; date: string; day: string; season: number; season_type: number; home_id: string; away_id: string;
  status: string; state: string; home_score: number | null; away_score: number | null; box_synced: number; props_synced: number;
}
export interface TeamRow { id: string; abbr: string; name: string; short_name: string; logo: string; color: string }
export interface PropLineRow {
  game_id: string; athlete_id: string; market: string; kind: "ou" | "milestone" | "yes"; book: string; line: number;
  over_dec: number | null; under_dec: number | null; open_line: number | null; open_over_dec: number | null;
  open_under_dec: number | null; side_check: string; updated_at: string | null; fetched_at: number;
}
export interface GameLineRow {
  game_id: string; book: string; ml_home: number | null; ml_away: number | null; spread_home: number | null;
  spread_home_dec: number | null; spread_away_dec: number | null; total: number | null; over_dec: number | null;
  under_dec: number | null; open_ml_home: number | null; open_ml_away: number | null; open_spread_home: number | null;
  open_spread_home_dec: number | null; open_spread_away_dec: number | null; open_total: number | null;
  open_over_dec: number | null; open_under_dec: number | null; fetched_at: number;
}

interface Snapshot {
  key: string;
  playerGames: PlayerGameRow[];
  teamGames: TeamGameRow[];
  byAthlete: Map<string, PlayerGameRow[]>; // chronological
  byTeam: Map<string, TeamGameRow[]>; // chronological
  byGame: Map<string, PlayerGameRow[]>;
}

let snap: Snapshot | null = null;

/** In-memory snapshot of all box-score rows, rebuilt whenever new box scores land in the DB. */
export function loadSnapshot(): Snapshot {
  const db = getDb();
  const k = db.prepare("SELECT COUNT(*) n, MAX(date) d FROM team_games").get() as { n: number; d: string | null };
  const key = `${k.n}|${k.d}`;
  if (snap && snap.key === key) return snap;
  const playerGames = db
    .prepare("SELECT pg.*, g.day FROM player_games pg JOIN games g ON g.id = pg.game_id ORDER BY pg.date")
    .all() as unknown as PlayerGameRow[];
  const teamGames = db
    .prepare("SELECT tg.*, g.day FROM team_games tg JOIN games g ON g.id = tg.game_id ORDER BY tg.date")
    .all() as unknown as TeamGameRow[];
  const byAthlete = new Map<string, PlayerGameRow[]>();
  const byTeam = new Map<string, TeamGameRow[]>();
  const byGame = new Map<string, PlayerGameRow[]>();
  for (const r of playerGames) {
    if (!byAthlete.has(r.athlete_id)) byAthlete.set(r.athlete_id, []);
    byAthlete.get(r.athlete_id)!.push(r);
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
    byGame.get(r.game_id)!.push(r);
  }
  for (const r of teamGames) {
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id)!.push(r);
  }
  snap = { key, playerGames, teamGames, byAthlete, byTeam, byGame };
  return snap;
}

export function getTeams(): Map<string, TeamRow> {
  const rows = getDb().prepare("SELECT * FROM teams").all() as unknown as TeamRow[];
  return new Map(rows.map((t) => [t.id, t]));
}

export function getGamesByDay(day: string): GameRow[] {
  return getDb().prepare("SELECT * FROM games WHERE day = ? ORDER BY date").all(day) as unknown as GameRow[];
}

export function getGame(id: string): GameRow | null {
  return (getDb().prepare("SELECT * FROM games WHERE id = ?").get(id) as unknown as GameRow) ?? null;
}

export function getGamesBetween(fromDay: string, toDay: string): GameRow[] {
  return getDb()
    .prepare("SELECT * FROM games WHERE day >= ? AND day <= ? ORDER BY date")
    .all(fromDay, toDay) as unknown as GameRow[];
}

export function getPropLines(gameId: string): PropLineRow[] {
  return getDb().prepare("SELECT * FROM prop_lines WHERE game_id = ?").all(gameId) as unknown as PropLineRow[];
}

export function getGameLine(gameId: string, book = "draftkings"): GameLineRow | null {
  return (
    (getDb().prepare("SELECT * FROM game_lines WHERE game_id = ? AND book = ?").get(gameId, book) as unknown as GameLineRow) ?? null
  );
}

export interface AthleteRow { id: string; name: string; team_id: string | null; pos: string | null; headshot: string | null }

export function getAthlete(id: string): AthleteRow | null {
  return (getDb().prepare("SELECT * FROM athletes WHERE id = ?").get(id) as unknown as AthleteRow) ?? null;
}

export function searchAthletes(q: string, limit = 20): (AthleteRow & { gp: number; mpg: number })[] {
  const like = `%${q.replace(/[%_]/g, "")}%`;
  return getDb()
    .prepare(
      `SELECT a.*, COUNT(pg.game_id) gp, AVG(CASE WHEN pg.dnp = 0 THEN pg.min END) mpg FROM athletes a
       LEFT JOIN player_games pg ON pg.athlete_id = a.id AND pg.dnp = 0
       WHERE a.name LIKE ? GROUP BY a.id ORDER BY gp DESC, a.name LIMIT ?`,
    )
    .all(like, limit) as unknown as (AthleteRow & { gp: number; mpg: number })[];
}

export function athleteNames(ids: string[]): Map<string, AthleteRow> {
  if (!ids.length) return new Map();
  const rows = getDb()
    .prepare(`SELECT * FROM athletes WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as unknown as AthleteRow[];
  return new Map(rows.map((r) => [r.id, r]));
}
