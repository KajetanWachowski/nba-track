import { config } from "./config";
import { getDb, setMeta, tx } from "./db";
import { mapLimit } from "./http";
import {
  addDays,
  easternDay,
  fetchBoxScore,
  fetchPropLines,
  fetchScoreboard,
  fetchTeams,
  type BoxScore,
  type GameInfo,
  type GameLine,
  type PropLine,
} from "./providers/espn";

export interface SyncReport {
  days: number;
  games: number;
  boxScores: number;
  propGames: number;
  propLines: number;
  droppedPropRows: number;
  errors: string[];
}

export async function syncTeams() {
  const teams = await fetchTeams();
  const st = getDb().prepare(
    "INSERT INTO teams(id, abbr, name, short_name, logo, color) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET abbr=excluded.abbr, name=excluded.name, short_name=excluded.short_name, logo=excluded.logo, color=excluded.color",
  );
  tx(() => teams.forEach((t) => st.run(t.id, t.abbr, t.name, t.shortName, t.logo, t.color)));
  return teams.length;
}

export function upsertGames(games: GameInfo[]) {
  const st = getDb().prepare(`INSERT INTO games(id, date, day, season, season_type, home_id, away_id, status, state, home_score, away_score)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date, day=excluded.day, status=excluded.status,
    state=excluded.state, home_score=excluded.home_score, away_score=excluded.away_score`);
  tx(() =>
    games.forEach((g) =>
      st.run(g.id, g.date, g.day, g.season, g.seasonType, g.homeId, g.awayId, g.status, g.state, g.homeScore, g.awayScore),
    ),
  );
}

export function upsertGameLines(lines: GameLine[]) {
  const st = getDb().prepare(`INSERT INTO game_lines(game_id, book, ml_home, ml_away, spread_home, spread_home_dec, spread_away_dec, total, over_dec, under_dec,
    open_ml_home, open_ml_away, open_spread_home, open_spread_home_dec, open_spread_away_dec, open_total, open_over_dec, open_under_dec, fetched_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(game_id, book) DO UPDATE SET
    ml_home=excluded.ml_home, ml_away=excluded.ml_away, spread_home=excluded.spread_home, spread_home_dec=excluded.spread_home_dec,
    spread_away_dec=excluded.spread_away_dec, total=excluded.total, over_dec=excluded.over_dec, under_dec=excluded.under_dec,
    open_ml_home=COALESCE(excluded.open_ml_home, open_ml_home), open_ml_away=COALESCE(excluded.open_ml_away, open_ml_away),
    open_spread_home=COALESCE(excluded.open_spread_home, open_spread_home), open_spread_home_dec=COALESCE(excluded.open_spread_home_dec, open_spread_home_dec),
    open_spread_away_dec=COALESCE(excluded.open_spread_away_dec, open_spread_away_dec), open_total=COALESCE(excluded.open_total, open_total),
    open_over_dec=COALESCE(excluded.open_over_dec, open_over_dec), open_under_dec=COALESCE(excluded.open_under_dec, open_under_dec),
    fetched_at=excluded.fetched_at`);
  const now = Date.now();
  tx(() =>
    lines.forEach((l) =>
      st.run(l.gameId, l.book, l.mlHome, l.mlAway, l.spreadHome, l.spreadHomeDec, l.spreadAwayDec, l.total, l.overDec, l.underDec,
        l.open.mlHome, l.open.mlAway, l.open.spreadHome, l.open.spreadHomeDec, l.open.spreadAwayDec, l.open.total, l.open.overDec, l.open.underDec, now),
    ),
  );
}

export function storeBoxScore(g: { id: string; date: string }, box: BoxScore) {
  const db = getDb();
  if (box.teams.length !== 2) throw new Error(`box score for ${g.id} has ${box.teams.length} teams`);
  const [a, b] = box.teams;
  const possOf = (t: typeof a, o: typeof a) => {
    // Basketball-Reference style possession estimate averaged over both teams
    const p = (x: typeof a, y: typeof a) =>
      x.fga + 0.4 * x.fta - 1.07 * (x.oreb / Math.max(1, x.oreb + y.dreb)) * (x.fga - x.fgm) + x.tov;
    return 0.5 * (p(t, o) + p(o, t));
  };
  const teamMin: Record<string, number> = {};
  for (const p of box.players) teamMin[p.teamId] = (teamMin[p.teamId] ?? 0) + p.min;
  const teamById = Object.fromEntries(box.teams.map((t) => [t.teamId, t]));

  const tst = db.prepare(`INSERT OR REPLACE INTO team_games(game_id, team_id, opp_id, date, home, pts, fgm, fga, fg3m, fg3a, ftm, fta,
    oreb, dreb, reb, ast, stl, blk, tov, pf, min_total, poss) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const pst = db.prepare(`INSERT OR REPLACE INTO player_games(game_id, athlete_id, name, team_id, opp_id, date, home, pos, starter, dnp, dnp_reason,
    min, pts, reb, oreb, dreb, ast, fg3m, fg3a, fgm, fga, ftm, fta, stl, blk, tov, pf, usg) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ast = db.prepare(`INSERT INTO athletes(id, name, team_id, pos, headshot, updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, team_id=CASE WHEN excluded.updated_at >= COALESCE(updated_at,0) THEN excluded.team_id ELSE team_id END,
    pos=COALESCE(NULLIF(excluded.pos,''), pos), headshot=COALESCE(excluded.headshot, headshot), updated_at=MAX(COALESCE(updated_at,0), excluded.updated_at)`);
  const gameTs = Date.parse(g.date);
  tx(() => {
    for (const [t, o] of [[a, b], [b, a]] as const) {
      tst.run(g.id, t.teamId, o.teamId, g.date, t.home ? 1 : 0, t.pts, t.fgm, t.fga, t.fg3m, t.fg3a, t.ftm, t.fta,
        t.oreb, t.dreb, t.reb, t.ast, t.stl, t.blk, t.tov, t.pf, teamMin[t.teamId] ?? 240, possOf(t, o));
    }
    for (const p of box.players) {
      const t = teamById[p.teamId];
      const opp = box.teams.find((x) => x.teamId !== p.teamId)!;
      // Usage rate: share of team plays (FGA + 0.44·FTA + TOV) used while on court
      const tm = teamMin[p.teamId] ?? 240;
      const usg =
        !p.dnp && p.min > 0 && t
          ? (100 * (p.fga + 0.44 * p.fta + p.tov) * (tm / 5)) / (p.min * (t.fga + 0.44 * t.fta + t.tov))
          : null;
      pst.run(g.id, p.athleteId, p.name, p.teamId, opp.teamId, g.date, t?.home ? 1 : 0, p.pos, p.starter ? 1 : 0, p.dnp ? 1 : 0,
        p.dnpReason, p.min, p.pts, p.reb, p.oreb, p.dreb, p.ast, p.fg3m, p.fg3a, p.fgm, p.fga, p.ftm, p.fta, p.stl, p.blk, p.tov, p.pf, usg);
      ast.run(p.athleteId, p.name, p.teamId, p.pos, p.headshot, gameTs);
    }
    db.prepare("UPDATE games SET box_synced = 1 WHERE id = ?").run(g.id);
  });
}

export function storePropLines(gameId: string, lines: PropLine[], final: boolean) {
  const db = getDb();
  const st = db.prepare(`INSERT OR REPLACE INTO prop_lines(game_id, athlete_id, market, kind, book, line, over_dec, under_dec,
    open_line, open_over_dec, open_under_dec, side_check, updated_at, fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = Date.now();
  tx(() => {
    // the live feed is a full snapshot: replace this book's lines for the game
    db.prepare("DELETE FROM prop_lines WHERE game_id = ? AND book = 'draftkings'").run(gameId);
    for (const l of lines)
      st.run(l.gameId, l.athleteId, l.market, l.kind, l.book, l.line, l.overDec, l.underDec, l.openLine, l.openOverDec,
        l.openUnderDec, l.sideCheck, l.updatedAt, now);
    if (final) db.prepare("UPDATE games SET props_synced = 1 WHERE id = ?").run(gameId);
  });
}

/** Sync every regular-season day from `fromDay` through `toDay` (inclusive), incrementally. */
export async function syncSeason(opts: { fromDay?: string; toDay?: string; withProps?: boolean; log?: (s: string) => void } = {}): Promise<SyncReport> {
  const log = opts.log ?? (() => {});
  const today = easternDay();
  const from = opts.fromDay ?? `${config.season - 1}1001`;
  const to = opts.toDay ?? today;
  const report: SyncReport = { days: 0, games: 0, boxScores: 0, propGames: 0, propLines: 0, droppedPropRows: 0, errors: [] };
  await syncTeams().catch((e) => report.errors.push(`teams: ${e.message}`));

  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const yesterday = addDays(today, -1);

  await mapLimit(days, 4, async (day) => {
    try {
      const recent = day >= yesterday;
      let sb = await fetchScoreboard(day, recent ? config.ttl.scoreboardToday : Infinity);
      // a past day cached while games were still running → refetch once
      if (!recent && sb.games.some((g) => g.state !== "post" && !/postponed|canceled/i.test(g.status)))
        sb = await fetchScoreboard(day, 0);
      const reg = sb.games.filter((g) => g.seasonType === 2 && g.season === config.season);
      if (!reg.length) return;
      upsertGames(reg);
      upsertGameLines(sb.lines.filter((l) => reg.some((g) => g.id === l.gameId)));
      report.days++;
      report.games += reg.length;
    } catch (e) {
      report.errors.push(`scoreboard ${day}: ${(e as Error).message}`);
    }
  });

  const db = getDb();
  const needBox = db
    .prepare("SELECT id, date FROM games WHERE state = 'post' AND box_synced = 0 AND season = ? ORDER BY date")
    .all(config.season) as { id: string; date: string }[];
  log(`box scores to fetch: ${needBox.length}`);
  await mapLimit(needBox, 4, async (g) => {
    try {
      const box = await fetchBoxScore(g.id, true);
      storeBoxScore(g, box);
      if (box.closingLine) upsertGameLines([box.closingLine]);
      report.boxScores++;
    } catch (e) {
      report.errors.push(`box ${g.id}: ${(e as Error).message}`);
    }
  });

  if (opts.withProps !== false) {
    const needProps = db
      .prepare("SELECT id FROM games WHERE state = 'post' AND props_synced = 0 AND season = ? ORDER BY date")
      .all(config.season) as { id: string }[];
    log(`historical prop snapshots to fetch: ${needProps.length}`);
    await mapLimit(needProps, 4, async (g) => {
      try {
        const r = await fetchPropLines(g.id, true);
        storePropLines(g.id, r.lines, true);
        report.propGames++;
        report.propLines += r.lines.length;
        report.droppedPropRows += r.dropped;
      } catch (e) {
        report.errors.push(`props ${g.id}: ${(e as Error).message}`);
      }
    });
  }
  setMeta("lastSeasonSync", { at: Date.now(), report });
  return report;
}

/** Refresh today's slate: scoreboard + live DraftKings props for games not yet started. */
export async function syncSlate(day = easternDay(), force = false) {
  const sb = await fetchScoreboard(day, force ? 0 : config.ttl.scoreboardToday);
  const reg = sb.games.filter((g) => g.seasonType === 2);
  upsertGames(reg);
  upsertGameLines(sb.lines.filter((l) => reg.some((g) => g.id === l.gameId)));
  const errors: string[] = [];
  let propsFetchedAt = Date.now();
  let stale = sb.stale;
  await mapLimit(
    reg.filter((g) => g.state === "pre"),
    3,
    async (g) => {
      try {
        const r = await fetchPropLines(g.id, false);
        storePropLines(g.id, r.lines, false);
        propsFetchedAt = Math.min(propsFetchedAt, r.fetchedAt);
        stale ||= r.stale;
      } catch (e) {
        errors.push(`props ${g.id}: ${(e as Error).message}`);
      }
    },
  );
  const result = { day, games: reg, scoreboardFetchedAt: sb.fetchedAt, propsFetchedAt, stale, errors };
  setMeta(`slate:${day}`, { at: Date.now(), errors, stale });
  return result;
}
