/** Read models for the Player Analysis and Matchup Analysis views. */
import { config } from "./config";
import { getDb } from "./db";
import { P_OUT } from "./engine";
import { BASE_STATS, PLAYER_LINE_MARKETS, type PlayerMarket, type StatKey } from "./markets";
import { buildContext, posGroup, restDays, type PosGroup } from "./model/context";
import { getModelParams } from "./model/params";
import { distribution, playedGames, probOver, projectPlayer, type PlayerProjection } from "./model/player";
import { mean, median, normalInv } from "./model/stats";
import { noVig } from "./odds/math";
import { getMeta } from "./db";
import { explainProjection, type Explanation } from "./model/explain";
import { addDays, easternDay, fetchInjuries, fetchRoster, fetchScoreboard, fetchSeasonLog, type Injury, type SeasonLogGame } from "./providers/espn";
import { getAthlete, getGameLine, getTeams, type GameRow, type PlayerGameRow, type TeamRow } from "./store";
import { upsertGames } from "./sync";

/** Make sure the next week of schedule is in the DB (scoreboards only, cheap). */
export async function ensureSchedule(days = 7) {
  const today = easternDay();
  const db = getDb();
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const have = db.prepare("SELECT COUNT(*) n FROM games WHERE day = ?").get(day) as { n: number };
    if (have.n > 0 && i > 0) continue;
    try {
      const sb = await fetchScoreboard(day, i === 0 ? config.ttl.scoreboardToday : 6 * 3600);
      upsertGames(sb.games.filter((g) => g.seasonType === 2));
    } catch {
      /* schedule is best-effort; the page states when the next game is unknown */
    }
  }
}

export function nextGame(teamId: string): GameRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM games WHERE (home_id = ? OR away_id = ?) AND state != 'post' AND day >= ? ORDER BY date LIMIT 1")
      .get(teamId, teamId, easternDay()) as unknown as GameRow) ?? null
  );
}

export type GameStatLine = Pick<PlayerGameRow, "game_id" | "date" | "opp_id" | "home" | "min" | "pts" | "reb" | "ast" | "fg3m" | "stl" | "blk" | "tov" | "usg" | "starter">;

export interface PlayerAnalysis {
  athleteId: string;
  name: string;
  team: TeamRow | null;
  pos: PosGroup;
  headshot: string | null;
  injury: Injury | null;
  games: GameStatLine[]; // chronological, this season
  priorSeason: { games: number; avg: Record<StatKey | "min", number> } | null;
  averages: { label: string; n: number; values: Record<StatKey | "min" | "usg", number> }[];
  splits: { label: string; n: number; values: Record<StatKey | "min", number> }[];
  next: { game: GameRow; opp: TeamRow | null; home: boolean; restDays: number | null } | null;
  projection: {
    minutes: PlayerProjection["minutes"];
    markets: Record<string, { mean: number; median: number; p10: number; p90: number; atLeast: number[]; explain: Explanation | null; estimate: { model: number; market: number | null; combined: number; modelWeight: number; line: number } | null }>;
    factors: Record<StatKey, PlayerProjection["stats"][StatKey]["factors"]>;
    warnings: string[];
    notes: string[];
    teammates: PlayerProjection["teammateEffects"];
  } | null;
  offers: { market: string; kind: string; line: number; over: number | null; under: number | null; openLine: number | null }[];
  teams: Record<string, { abbr: string; logo: string }>;
}

const avgOf = (rows: { [k: string]: unknown }[], keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, rows.length ? mean(rows.map((r) => Number(r[k]) || 0)) : NaN]));

export async function getPlayerAnalysis(athleteId: string): Promise<PlayerAnalysis | null> {
  await ensureSchedule();
  const day = easternDay();
  const ctx = buildContext(addDays(day, 1)); // include everything completed so far
  const all = ctx.playerGames(athleteId);
  const a = getAthlete(athleteId);
  if (!a && !all.length) return null;
  const teams = getTeams();
  const played = playedGames(all);
  const teamId = a?.team_id ?? played.at(-1)?.team_id ?? null;

  let roster: Awaited<ReturnType<typeof fetchRoster>> = [];
  if (teamId) roster = await fetchRoster(teamId).catch(() => []);
  const rosterEntry = roster.find((r) => r.athleteId === athleteId);
  let injuries: Injury[] = [];
  try {
    injuries = (await fetchInjuries()).injuries;
  } catch {
    /* shown as unavailable */
  }
  let prior: SeasonLogGame[] = [];
  try {
    prior = await fetchSeasonLog(athleteId, config.season - 1);
  } catch {
    /* rookie */
  }

  const keys = [...BASE_STATS, "min"];
  const lines: GameStatLine[] = played.map((r) => ({ game_id: r.game_id, date: r.date, opp_id: r.opp_id, home: r.home, min: r.min, pts: r.pts, reb: r.reb, ast: r.ast, fg3m: r.fg3m, stl: r.stl, blk: r.blk, tov: r.tov, usg: r.usg, starter: r.starter }));
  const last = (n: number) => lines.slice(-n);
  const averages = [
    { label: "Sezon", rows: lines },
    { label: "Ostatnie 20", rows: last(20) },
    { label: "Ostatnie 15", rows: last(15) },
    { label: "Ostatnie 10", rows: last(10) },
    { label: "Ostatnie 5", rows: last(5) },
  ].map(({ label, rows }) => ({
    label,
    n: rows.length,
    values: { ...avgOf(rows, keys), usg: mean(rows.filter((r) => r.usg !== null).map((r) => r.usg!)) } as Record<StatKey | "min" | "usg", number>,
  }));
  averages.push({
    label: "Mediana (sezon)",
    n: lines.length,
    values: Object.fromEntries([...keys, "usg"].map((k) => [k, median(lines.map((r) => Number((r as unknown as Record<string, number>)[k]) || 0))])) as Record<StatKey | "min" | "usg", number>,
  });

  // splits: home/away + with/without the team's main rotation players
  const splits: PlayerAnalysis["splits"] = [
    { label: "U siebie", rows: lines.filter((r) => r.home) },
    { label: "Na wyjeździe", rows: lines.filter((r) => !r.home) },
  ].map(({ label, rows }) => ({ label, n: rows.length, values: avgOf(rows, keys) as Record<StatKey | "min", number> }));
  if (teamId) {
    const mates = new Map<string, { name: string; mins: number[]; games: Set<string> }>();
    for (const r of played) {
      for (const m of ctx.gamePlayers(r.game_id)) {
        if (m.team_id !== teamId || m.athlete_id === athleteId) continue;
        if (!mates.has(m.athlete_id)) mates.set(m.athlete_id, { name: m.name, mins: [], games: new Set() });
        if (!m.dnp && m.min > 0) {
          mates.get(m.athlete_id)!.mins.push(m.min);
          mates.get(m.athlete_id)!.games.add(m.game_id);
        }
      }
    }
    const top = [...mates.entries()].filter(([, v]) => v.mins.length >= 3).sort((x, y) => mean(y[1].mins) * y[1].mins.length - mean(x[1].mins) * x[1].mins.length).slice(0, 4);
    for (const [, v] of top) {
      const without = lines.filter((r) => !v.games.has(r.game_id));
      if (without.length >= 1) splits.push({ label: `Bez ${v.name}`, n: without.length, values: avgOf(without, keys) as Record<StatKey | "min", number> });
    }
  }

  // next game + projection
  let next: PlayerAnalysis["next"] = null;
  let projection: PlayerAnalysis["projection"] = null;
  const offers: PlayerAnalysis["offers"] = [];
  const ng = teamId ? nextGame(teamId) : null;
  if (ng && teamId) {
    const home = ng.home_id === teamId;
    const oppId = home ? ng.away_id : ng.home_id;
    const gctx = buildContext(ng.day);
    next = { game: ng, opp: teams.get(oppId) ?? null, home, restDays: restDays(gctx, teamId, ng.day) };
    const rosterIds = new Set(roster.map((r) => r.athleteId));
    const absences = injuries
      .filter((i) => i.athleteId !== athleteId && (rosterIds.size ? rosterIds.has(i.athleteId) : i.teamId === teamId))
      .map((i) => ({ athleteId: i.athleteId, name: i.name, pOut: P_OUT[i.status] ?? 0.25, status: i.status }));
    const proj = projectPlayer(gctx, athleteId, {
      day: ng.day, teamId, oppId, home, restDays: next.restDays, absences, priorSeason: prior, params: getModelParams(),
      selfStatus: injuries.find((i) => i.athleteId === athleteId)?.status ?? null, sims: 10000,
      gameMargin: (() => { const gl = getGameLine(ng.id); return gl?.spread_home !== null && gl?.spread_home !== undefined ? (home ? -gl.spread_home : gl.spread_home) : undefined; })(),
      marginSd: gctx.marginSd,
    });
    if (proj) {
      const markets: NonNullable<PlayerAnalysis["projection"]>["markets"] = {};
      const blendW = getMeta<Record<string, number>>("projectionBlend") ?? {};
      const bookLines = getDb().prepare("SELECT market, line, over_dec, under_dec FROM prop_lines WHERE game_id = ? AND athlete_id = ? AND book = 'draftkings' AND kind = 'ou'").all(ng.id, athleteId) as { market: string; line: number; over_dec: number | null; under_dec: number | null }[];
      for (const m of [...PLAYER_LINE_MARKETS, "dd", "td"] as PlayerMarket[]) {
        const d = distribution(proj, m);
        const isYes = m === "dd" || m === "td";
        markets[m] = {
          mean: d.mean, median: d.median, p10: d.p10, p90: d.p90, atLeast: isYes ? [1, probOver(proj, m, 0.5).p] : d.atLeast,
          explain: isYes ? null : explainProjection({ market: m, proj, simMean: d.mean, history: gctx.playerGames(athleteId), prior, ctx: gctx, oppId, oppAbbr: teams.get(oppId)?.abbr ?? "", home }),
          estimate: (() => {
            const bl = bookLines.find((l) => l.market === m && l.over_dec && l.under_dec);
            if (isYes || !bl) return null;
            const pOver = noVig([bl.over_dec!, bl.under_dec!])[0];
            const market = bl.line + d.sd * normalInv(pOver);
            const w = blendW[m] ?? 1;
            return { model: d.mean, market, combined: w * d.mean + (1 - w) * market, modelWeight: w, line: bl.line };
          })(),
        };
      }
      projection = {
        minutes: proj.minutes, markets,
        factors: Object.fromEntries(BASE_STATS.map((s) => [s, proj.stats[s].factors])) as Record<StatKey, PlayerProjection["stats"][StatKey]["factors"]>,
        warnings: proj.warnings, notes: proj.notes, teammates: proj.teammateEffects,
      };
    }
    const pl = getDb().prepare("SELECT * FROM prop_lines WHERE game_id = ? AND athlete_id = ? AND book = 'draftkings' ORDER BY market, line").all(ng.id, athleteId) as { market: string; kind: string; line: number; over_dec: number | null; under_dec: number | null; open_line: number | null }[];
    for (const l of pl) offers.push({ market: l.market, kind: l.kind, line: l.line, over: l.over_dec, under: l.under_dec, openLine: l.open_line });
  }

  const name = a?.name ?? rosterEntry?.name ?? all.at(-1)?.name ?? athleteId;
  const priorPlayed = prior.filter((r) => r.min > 0);
  const result: PlayerAnalysis = {
    athleteId,
    name,
    team: teamId ? teams.get(teamId) ?? null : null,
    pos: posGroup(rosterEntry?.pos ?? a?.pos),
    headshot: rosterEntry?.headshot ?? a?.headshot ?? `https://a.espncdn.com/i/headshots/nba/players/full/${athleteId}.png`,
    injury: injuries.find((i) => i.athleteId === athleteId) ?? null,
    games: lines,
    priorSeason: priorPlayed.length ? { games: priorPlayed.length, avg: avgOf(priorPlayed as unknown as Record<string, unknown>[], keys) as Record<StatKey | "min", number> } : null,
    averages,
    splits,
    next,
    projection,
    offers,
    teams: Object.fromEntries([...teams].map(([id, t]) => [id, { abbr: t.abbr, logo: t.logo }])),
  };
  // SQLite rows have null prototypes; hand React plain JSON (NaN → null)
  return JSON.parse(JSON.stringify(result)) as PlayerAnalysis;
}

export interface TeamDefense {
  team: TeamRow;
  games: number;
  pace: number;
  ortg: number;
  drtg: number;
  net: number;
  ranks: { pace: number; ortg: number; drtg: number; net: number };
  allowed: Record<StatKey, { perGame: number; rank: number }>; // rank 1 = allows the most
  posDefense: Record<PosGroup, Record<StatKey, { factor: number; n: number }>>;
  recent: { gameId: string; date: string; oppId: string; home: boolean; pts: number; oppPts: number; won: boolean }[];
  record: { w: number; l: number; streak: string };
}

export function getLeagueDefense(): { lgPace: number; lgOrtg: number; teams: TeamDefense[] } {
  const ctx = buildContext(addDays(easternDay(), 1));
  const teams = getTeams();
  const list: TeamDefense[] = [];
  for (const [id, r] of ctx.teams) {
    const t = teams.get(id);
    if (!t) continue;
    const tg = ctx.teamGames(id);
    const recent = tg.map((g) => {
      const opp = ctx.teamGames(g.opp_id).find((x) => x.game_id === g.game_id);
      return { gameId: g.game_id, date: g.date, oppId: g.opp_id, home: !!g.home, pts: g.pts, oppPts: opp?.pts ?? 0, won: g.pts > (opp?.pts ?? 0) };
    });
    let streak = "";
    if (recent.length) {
      const lastW = recent.at(-1)!.won;
      let n = 0;
      for (let i = recent.length - 1; i >= 0 && recent[i].won === lastW; i--) n++;
      streak = `${lastW ? "W" : "L"}${n}`;
    }
    list.push({
      team: t, games: r.games, pace: r.pace, ortg: r.ortg, drtg: r.drtg, net: r.ortg - r.drtg,
      ranks: { pace: 0, ortg: 0, drtg: 0, net: 0 },
      allowed: Object.fromEntries(BASE_STATS.map((s) => [s, { perGame: r.allowedPerGame[s], rank: 0 }])) as TeamDefense["allowed"],
      posDefense: Object.fromEntries((["G", "F", "C"] as PosGroup[]).map((p) => [p, Object.fromEntries(BASE_STATS.map((s) => [s, { factor: r.posDefense[p][s].factor, n: r.posDefense[p][s].n }]))])) as TeamDefense["posDefense"],
      recent: recent.slice(-10),
      record: { w: recent.filter((x) => x.won).length, l: recent.filter((x) => !x.won).length, streak },
    });
  }
  const rank = (f: (t: TeamDefense) => number, desc: boolean, set: (t: TeamDefense, r: number) => void) =>
    [...list].sort((x, y) => (desc ? f(y) - f(x) : f(x) - f(y))).forEach((t, i) => set(t, i + 1));
  rank((t) => t.pace, true, (t, r) => (t.ranks.pace = r));
  rank((t) => t.ortg, true, (t, r) => (t.ranks.ortg = r));
  rank((t) => t.drtg, false, (t, r) => (t.ranks.drtg = r)); // 1 = best defense
  rank((t) => t.net, true, (t, r) => (t.ranks.net = r));
  for (const s of BASE_STATS) rank((t) => t.allowed[s].perGame, true, (t, r) => (t.allowed[s].rank = r));
  return { lgPace: ctx.lgPace, lgOrtg: ctx.lgOrtg, teams: list.sort((x, y) => x.team.abbr.localeCompare(y.team.abbr)) };
}
