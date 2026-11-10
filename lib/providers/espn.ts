/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ESPN public JSON endpoints (no key required). Used for schedule, scores, box scores,
 * injuries, rosters, and DraftKings odds (game lines + player props) that ESPN publishes.
 *
 * Endpoints verified against live responses:
 *   site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
 *   site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=ID
 *   site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries
 *   site.api.espn.com/apis/site/v2/sports/basketball/nba/teams[/ID/roster]
 *   site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/ID/gamelog?season=YYYY
 *   sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/ID/competitions/ID/odds/100/propBets
 */
import { config } from "../config";
import { fetchJson, type Fetched } from "../http";
import { americanToDecimal } from "../odds/math";
import { ESPN_MILESTONE_TYPES, ESPN_OU_TYPES, ESPN_YES_TYPES, type PlayerMarket } from "../markets";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
export const DK_PROVIDER_ID = "100";
export const DK_BOOK = "draftkings";

export interface GameInfo {
  id: string;
  date: string; // ISO tip-off
  day: string; // YYYYMMDD (US/Eastern scoreboard date)
  season: number;
  seasonType: number;
  homeId: string;
  awayId: string;
  status: string;
  state: "pre" | "in" | "post";
  homeScore: number | null;
  awayScore: number | null;
  statusDetail: string;
}

export interface TeamInfo {
  id: string;
  abbr: string;
  name: string;
  shortName: string;
  logo: string;
  color: string;
}

export interface GameLine {
  gameId: string;
  book: string;
  mlHome: number | null;
  mlAway: number | null;
  spreadHome: number | null;
  spreadHomeDec: number | null;
  spreadAwayDec: number | null;
  total: number | null;
  overDec: number | null;
  underDec: number | null;
  open: {
    mlHome: number | null;
    mlAway: number | null;
    spreadHome: number | null;
    spreadHomeDec: number | null;
    spreadAwayDec: number | null;
    total: number | null;
    overDec: number | null;
    underDec: number | null;
  };
}

export interface PropLine {
  gameId: string;
  athleteId: string;
  market: PlayerMarket;
  kind: "ou" | "milestone" | "yes";
  book: string;
  /** O/U: the half-point line. Milestone "X+": stored as X − 0.5 so that "over line" == "X or more". */
  line: number;
  overDec: number | null;
  underDec: number | null;
  openLine: number | null;
  openOverDec: number | null;
  openUnderDec: number | null;
  /** How the over/under side assignment was established for unlabeled ESPN pairs. */
  sideCheck: "milestone-verified" | "order-assumed" | "n/a";
  updatedAt: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const amToDec = (v: unknown): number | null => {
  const n = num(v);
  if (n === null) return null;
  const d = americanToDecimal(n);
  return Number.isFinite(d) ? Math.round(d * 1000) / 1000 : null;
};

/** Current date on the US/Eastern calendar, which is how ESPN keys NBA scoreboards. */
export function easternDay(d = new Date()): string {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return s.replaceAll("-", "");
}

export function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

export async function fetchTeams(): Promise<TeamInfo[]> {
  const r = await fetchJson<any>(`${SITE}/teams`, { ttl: config.ttl.teams, source: "ESPN teams" });
  return (r.data.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t: any) => ({
    id: String(t.team.id),
    abbr: t.team.abbreviation,
    name: t.team.displayName,
    shortName: t.team.shortDisplayName ?? t.team.name,
    logo: t.team.logos?.[0]?.href ?? "",
    color: t.team.color ? `#${t.team.color}` : "#888888",
  }));
}

export interface ScoreboardResult {
  games: GameInfo[];
  lines: GameLine[];
  fetchedAt: number;
  stale: boolean;
}

export async function fetchScoreboard(day: string, ttl: number): Promise<ScoreboardResult> {
  const r = await fetchJson<any>(`${SITE}/scoreboard?dates=${day}&limit=100`, { ttl, source: "ESPN scoreboard" });
  const games: GameInfo[] = [];
  const lines: GameLine[] = [];
  for (const e of r.data.events ?? []) {
    const c = e.competitions?.[0];
    if (!c) continue;
    const home = c.competitors.find((x: any) => x.homeAway === "home");
    const away = c.competitors.find((x: any) => x.homeAway === "away");
    const st = e.status?.type ?? {};
    games.push({
      id: String(e.id),
      date: e.date,
      day,
      season: e.season?.year ?? config.season,
      seasonType: e.season?.type ?? 2,
      homeId: String(home.team.id),
      awayId: String(away.team.id),
      status: st.name ?? "",
      state: st.state ?? "pre",
      homeScore: st.state === "pre" ? null : num(home.score),
      awayScore: st.state === "pre" ? null : num(away.score),
      statusDetail: st.shortDetail ?? st.detail ?? "",
    });
    const o = c.odds?.find((x: any) => String(x.provider?.id) === DK_PROVIDER_ID) ?? c.odds?.[0];
    if (o) lines.push(parseScoreboardOdds(String(e.id), o));
  }
  return { games, lines, fetchedAt: r.fetchedAt, stale: r.stale };
}

function parseScoreboardOdds(gameId: string, o: any): GameLine {
  const ml = o.moneyline ?? {};
  const ps = o.pointSpread ?? {};
  const tot = o.total ?? {};
  return {
    gameId,
    book: String(o.provider?.id) === DK_PROVIDER_ID ? DK_BOOK : String(o.provider?.name ?? "unknown").toLowerCase(),
    mlHome: amToDec(ml.home?.close?.odds),
    mlAway: amToDec(ml.away?.close?.odds),
    spreadHome: num(ps.home?.close?.line),
    spreadHomeDec: amToDec(ps.home?.close?.odds),
    spreadAwayDec: amToDec(ps.away?.close?.odds),
    total: num(String(tot.over?.close?.line ?? "").replace(/^[ou]/, "")) ?? num(o.overUnder),
    overDec: amToDec(tot.over?.close?.odds),
    underDec: amToDec(tot.under?.close?.odds),
    open: {
      mlHome: amToDec(ml.home?.open?.odds),
      mlAway: amToDec(ml.away?.open?.odds),
      spreadHome: num(ps.home?.open?.line),
      spreadHomeDec: amToDec(ps.home?.open?.odds),
      spreadAwayDec: amToDec(ps.away?.open?.odds),
      total: num(String(tot.over?.open?.line ?? "").replace(/^[ou]/, "")),
      overDec: amToDec(tot.over?.open?.odds),
      underDec: amToDec(tot.under?.open?.odds),
    },
  };
}

export interface BoxPlayer {
  athleteId: string;
  name: string;
  teamId: string;
  pos: string;
  headshot: string | null;
  starter: boolean;
  dnp: boolean;
  dnpReason: string | null;
  min: number;
  pts: number; reb: number; oreb: number; dreb: number; ast: number; fg3m: number; fg3a: number;
  fgm: number; fga: number; ftm: number; fta: number; stl: number; blk: number; tov: number; pf: number;
}
export interface BoxTeam {
  teamId: string;
  home: boolean;
  pts: number; fgm: number; fga: number; fg3m: number; fg3a: number; ftm: number; fta: number;
  oreb: number; dreb: number; reb: number; ast: number; stl: number; blk: number; tov: number; pf: number;
}
export interface BoxScore {
  gameId: string;
  teams: BoxTeam[];
  players: BoxPlayer[];
  closingLine: GameLine | null;
}

const split = (s: string | undefined): [number, number] => {
  const [a, b] = String(s ?? "0-0").split("-");
  return [parseInt(a) || 0, parseInt(b) || 0];
};

export async function fetchBoxScore(gameId: string, final: boolean): Promise<BoxScore> {
  const r = await fetchJson<any>(`${SITE}/summary?event=${gameId}`, {
    ttl: final ? Infinity : 60,
    source: "ESPN summary",
  });
  const d = r.data;
  const header = d.header?.competitions?.[0];
  const homeAway: Record<string, boolean> = {};
  const scores: Record<string, number> = {};
  for (const c of header?.competitors ?? []) {
    homeAway[String(c.team.id)] = c.homeAway === "home";
    scores[String(c.team.id)] = parseInt(c.score) || 0;
  }
  const teams: BoxTeam[] = (d.boxscore?.teams ?? []).map((t: any) => {
    const s: Record<string, string> = {};
    for (const x of t.statistics ?? []) s[x.name] = x.displayValue;
    const [fgm, fga] = split(s["fieldGoalsMade-fieldGoalsAttempted"]);
    const [fg3m, fg3a] = split(s["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]);
    const [ftm, fta] = split(s["freeThrowsMade-freeThrowsAttempted"]);
    const id = String(t.team.id);
    return {
      teamId: id,
      home: homeAway[id] ?? t.homeAway === "home",
      pts: scores[id] ?? 0,
      fgm, fga, fg3m, fg3a, ftm, fta,
      oreb: parseInt(s.offensiveRebounds) || 0,
      dreb: parseInt(s.defensiveRebounds) || 0,
      reb: parseInt(s.totalRebounds) || 0,
      ast: parseInt(s.assists) || 0,
      stl: parseInt(s.steals) || 0,
      blk: parseInt(s.blocks) || 0,
      tov: parseInt(s.totalTurnovers ?? s.turnovers) || 0,
      pf: parseInt(s.fouls) || 0,
    };
  });
  const players: BoxPlayer[] = [];
  for (const tp of d.boxscore?.players ?? []) {
    const teamId = String(tp.team.id);
    const st = tp.statistics?.[0];
    if (!st) continue;
    const labels: string[] = st.labels ?? st.names ?? [];
    const idx = (l: string) => labels.indexOf(l);
    for (const a of st.athletes ?? []) {
      const v: string[] = a.stats ?? [];
      const g = (l: string) => parseInt(v[idx(l)]) || 0;
      const [fgm, fga] = split(v[idx("FG")]);
      const [fg3m, fg3a] = split(v[idx("3PT")]);
      const [ftm, fta] = split(v[idx("FT")]);
      const min = parseFloat(v[idx("MIN")]) || 0;
      const dnp = Boolean(a.didNotPlay) || v.length === 0 || min === 0;
      players.push({
        athleteId: String(a.athlete.id),
        name: a.athlete.displayName,
        teamId,
        pos: a.athlete.position?.abbreviation ?? "",
        headshot: a.athlete.headshot?.href ?? null,
        starter: Boolean(a.starter),
        dnp,
        dnpReason: dnp ? (a.reason ?? null) : null,
        min,
        pts: g("PTS"), reb: g("REB"), oreb: g("OREB"), dreb: g("DREB"), ast: g("AST"),
        fg3m, fg3a, fgm, fga, ftm, fta,
        stl: g("STL"), blk: g("BLK"), tov: g("TO"), pf: g("PF"),
      });
    }
  }
  let closingLine: GameLine | null = null;
  const pc = (d.pickcenter ?? []).find((x: any) => String(x.provider?.id) === DK_PROVIDER_ID);
  if (pc) {
    closingLine = {
      gameId,
      book: DK_BOOK,
      mlHome: amToDec(pc.homeTeamOdds?.moneyLine),
      mlAway: amToDec(pc.awayTeamOdds?.moneyLine),
      // pickcenter "spread" is the home team's signed line (positive when home is the underdog)
      spreadHome: num(pc.spread),
      spreadHomeDec: amToDec(pc.homeTeamOdds?.spreadOdds),
      spreadAwayDec: amToDec(pc.awayTeamOdds?.spreadOdds),
      total: num(pc.overUnder),
      overDec: amToDec(pc.overOdds),
      underDec: amToDec(pc.underOdds),
      open: { mlHome: null, mlAway: null, spreadHome: null, spreadHomeDec: null, spreadAwayDec: null, total: null, overDec: null, underDec: null },
    };
  }
  return { gameId, teams, players, closingLine };
}

/**
 * DraftKings player props via ESPN. ESPN publishes two-way O/U markets as two unlabeled rows;
 * empirically the first row is the Over. Each pair is cross-checked against the matching
 * one-way "X+" milestone price when available; pairs that contradict it are dropped.
 */
export async function fetchPropLines(gameId: string, final: boolean): Promise<{ lines: PropLine[]; fetchedAt: number; stale: boolean; dropped: number }> {
  const items: any[] = [];
  let fetchedAt = Date.now();
  let stale = false;
  for (let page = 1; page <= 5; page++) {
    const url = `${CORE}/events/${gameId}/competitions/${gameId}/odds/${DK_PROVIDER_ID}/propBets?limit=1000&page=${page}`;
    let r: Fetched<any>;
    try {
      r = await fetchJson<any>(url, { ttl: final ? Infinity : config.ttl.propsLive, source: "ESPN/DraftKings props" });
    } catch (e) {
      if (page === 1) throw e;
      break;
    }
    fetchedAt = Math.min(fetchedAt, r.fetchedAt);
    stale ||= r.stale;
    items.push(...(r.data.items ?? []));
    if (page >= (r.data.pageCount ?? 1)) break;
  }
  return { ...parsePropItems(gameId, items), fetchedAt, stale };
}

export function parsePropItems(gameId: string, items: any[]): { lines: PropLine[]; dropped: number } {
  const athleteOf = (i: any) => String(i.athlete?.$ref ?? "").match(/athletes\/(\d+)/)?.[1] ?? null;
  const groups = new Map<string, any[]>();
  for (const i of items) {
    const a = athleteOf(i);
    if (!a) continue;
    const k = `${a}|${i.type?.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  const lines: PropLine[] = [];
  let dropped = 0;
  const milestoneProb = new Map<string, number>(); // `${athlete}|${market}|${threshold}` → implied prob

  // 1) milestones (one-way "X+"). Drop whole groups with duplicate thresholds or non-monotone prices.
  for (const [k, arr] of groups) {
    const [athleteId, typeId] = k.split("|");
    const market = ESPN_MILESTONE_TYPES[typeId];
    if (!market) continue;
    const rows = arr
      .map((i) => ({ t: num(i.current?.target?.value), d: num(i.odds?.decimal?.value), u: i.lastUpdated ?? null }))
      .filter((x) => x.t !== null && x.d !== null && x.d! > 1) as { t: number; d: number; u: string | null }[];
    const thresholds = new Set(rows.map((r) => r.t));
    rows.sort((a, b) => a.t - b.t);
    const monotone = rows.every((r, i) => i === 0 || r.d >= rows[i - 1].d);
    if (thresholds.size !== rows.length || !monotone) {
      dropped += rows.length;
      continue;
    }
    for (const r of rows) {
      milestoneProb.set(`${athleteId}|${market}|${r.t}`, 1 / r.d);
      lines.push({
        gameId, athleteId, market, kind: "milestone", book: DK_BOOK, line: r.t - 0.5,
        overDec: r.d, underDec: null, openLine: null, openOverDec: null, openUnderDec: null,
        sideCheck: "n/a", updatedAt: r.u,
      });
    }
  }

  // 2) two-way over/under pairs
  for (const [k, arr] of groups) {
    const [athleteId, typeId] = k.split("|");
    const market = ESPN_OU_TYPES[typeId];
    if (!market) continue;
    const byLine = new Map<number, any[]>();
    for (const i of arr) {
      const l = num(i.current?.target?.value);
      if (l === null) continue;
      if (!byLine.has(l)) byLine.set(l, []);
      byLine.get(l)!.push(i);
    }
    for (const [line, pair] of byLine) {
      if (pair.length !== 2) {
        dropped += pair.length;
        continue;
      }
      const d0 = num(pair[0].odds?.decimal?.value);
      const d1 = num(pair[1].odds?.decimal?.value);
      if (!d0 || !d1 || d0 <= 1 || d1 <= 1) {
        dropped += 2;
        continue;
      }
      let over = 0;
      let sideCheck: PropLine["sideCheck"] = "order-assumed";
      const m = milestoneProb.get(`${athleteId}|${market}|${Math.ceil(line)}`);
      if (m !== undefined) {
        const g0 = Math.abs(1 / d0 - m);
        const g1 = Math.abs(1 / d1 - m);
        if (Math.abs(g0 - g1) >= 0.02) {
          over = g0 < g1 ? 0 : 1;
          if (over !== 0) {
            // contradicts the observed ordering convention → do not trust this pair
            dropped += 2;
            continue;
          }
          sideCheck = "milestone-verified";
        }
      }
      const o = pair[over];
      const u = pair[1 - over];
      const openLine = num(o.open?.target?.value);
      lines.push({
        gameId, athleteId, market, kind: "ou", book: DK_BOOK, line,
        overDec: num(o.odds?.decimal?.value), underDec: num(u.odds?.decimal?.value),
        openLine, openOverDec: num(o.odds?.decimal?.open), openUnderDec: num(u.odds?.decimal?.open),
        sideCheck, updatedAt: o.lastUpdated ?? null,
      });
    }
  }

  // 3) yes-only markets (double double / triple double)
  for (const [k, arr] of groups) {
    const [athleteId, typeId] = k.split("|");
    const market = ESPN_YES_TYPES[typeId];
    if (!market || arr.length !== 1) continue;
    const d = num(arr[0].odds?.decimal?.value);
    if (!d || d <= 1) continue;
    lines.push({
      gameId, athleteId, market, kind: "yes", book: DK_BOOK, line: 0.5,
      overDec: d, underDec: null, openLine: null, openOverDec: num(arr[0].odds?.decimal?.open), openUnderDec: null,
      sideCheck: "n/a", updatedAt: arr[0].lastUpdated ?? null,
    });
  }
  return { lines, dropped };
}

export type InjuryStatus = "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "PROBABLE" | "DAY-TO-DAY";
export interface Injury {
  athleteId: string;
  name: string;
  teamId: string;
  pos: string;
  status: InjuryStatus;
  rawStatus: string;
  comment: string;
  detail: string;
  date: string;
  returnDate: string | null;
}

/**
 * ESPN only labels injuries "Out" or "Day-To-Day". The official Questionable/Doubtful/Probable
 * designation, when present, is extracted from ESPN's report text.
 */
export function classifyInjury(rawStatus: string, comment: string): InjuryStatus {
  if (/^out$/i.test(rawStatus)) return "OUT";
  const c = comment.toLowerCase();
  if (/\bruled out\b|\bwill (miss|not play)\b|\bout for\b/.test(c)) return "OUT";
  if (/\bdoubtful\b/.test(c)) return "DOUBTFUL";
  if (/\bquestionable\b/.test(c)) return "QUESTIONABLE";
  if (/\bprobable\b/.test(c)) return "PROBABLE";
  return "DAY-TO-DAY";
}

export async function fetchInjuries(): Promise<{ injuries: Injury[]; fetchedAt: number; stale: boolean }> {
  const r = await fetchJson<any>(`${SITE}/injuries`, { ttl: config.ttl.injuries, source: "ESPN injuries" });
  const out: Injury[] = [];
  for (const t of r.data.injuries ?? []) {
    for (const i of t.injuries ?? []) {
      const a = i.athlete ?? {};
      const link = (a.links ?? []).map((l: any) => l.href).find((h: string) => /\/id\/\d+/.test(h)) ?? "";
      const athleteId = link.match(/\/id\/(\d+)/)?.[1];
      if (!athleteId) continue;
      const comment = i.shortComment ?? "";
      out.push({
        athleteId,
        name: a.displayName ?? "",
        teamId: String(t.id),
        pos: a.position?.abbreviation ?? "",
        status: classifyInjury(i.status ?? "", comment),
        rawStatus: i.status ?? "",
        comment,
        detail: [i.details?.side, i.details?.type].filter(Boolean).join(" "),
        date: i.date ?? "",
        returnDate: i.details?.returnDate ?? null,
      });
    }
  }
  return { injuries: out, fetchedAt: r.fetchedAt, stale: r.stale };
}

export interface RosterPlayer {
  athleteId: string;
  name: string;
  pos: string;
  jersey: string;
  headshot: string | null;
}

export async function fetchRoster(teamId: string): Promise<RosterPlayer[]> {
  const r = await fetchJson<any>(`${SITE}/teams/${teamId}/roster`, { ttl: config.ttl.roster, source: "ESPN roster" });
  return (r.data.athletes ?? []).map((a: any) => ({
    athleteId: String(a.id),
    name: a.displayName,
    pos: a.position?.abbreviation ?? "",
    jersey: a.jersey ?? "",
    headshot: a.headshot?.href ?? null,
  }));
}

export interface SeasonLogGame {
  gameId: string;
  date: string;
  oppId: string;
  home: boolean;
  min: number;
  pts: number; reb: number; ast: number; fg3m: number; stl: number; blk: number; tov: number;
}

/** A player's regular-season game log for a past season (used as the prior for the current season). */
export async function fetchSeasonLog(athleteId: string, season: number): Promise<SeasonLogGame[]> {
  const r = await fetchJson<any>(`${WEB}/athletes/${athleteId}/gamelog?season=${season}`, {
    ttl: season < config.season ? config.ttl.priorSeasonLog : 3600,
    source: "ESPN gamelog",
  });
  const d = r.data;
  const names: string[] = d.names ?? [];
  const idx = (n: string) => names.indexOf(n);
  const out: SeasonLogGame[] = [];
  const reg = (d.seasonTypes ?? []).find((s: any) => /regular season/i.test(s.displayName ?? ""));
  if (!reg) return out;
  for (const cat of reg.categories ?? []) {
    for (const e of cat.events ?? []) {
      const meta = d.events?.[e.eventId];
      const v: string[] = e.stats ?? [];
      if (!meta || !v.length) continue;
      const g = (n: string) => parseFloat(v[idx(n)]) || 0;
      out.push({
        gameId: String(e.eventId),
        date: meta.gameDate,
        oppId: String(meta.opponent?.id ?? ""),
        home: meta.atVs !== "@",
        min: g("minutes"),
        pts: g("points"),
        reb: g("totalRebounds"),
        ast: g("assists"),
        fg3m: parseInt(String(v[idx("threePointFieldGoalsMade-threePointFieldGoalsAttempted")] ?? "0")) || 0,
        stl: g("steals"),
        blk: g("blocks"),
        tov: g("turnovers"),
      });
    }
  }
  return out;
}
