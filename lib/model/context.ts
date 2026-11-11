/**
 * League context as of a given day: every quantity is estimated ONLY from games played on
 * earlier days, so the same code path serves live predictions and leak-free backtests.
 */
import { BASE_STATS, type StatKey } from "../markets";
import { loadSnapshot, type PlayerGameRow, type TeamGameRow } from "../store";
import { decayWeights, shrinkRatio } from "./stats";

export type PosGroup = "G" | "F" | "C";
export function posGroup(pos: string | null | undefined): PosGroup {
  const p = (pos ?? "").toUpperCase();
  if (p.includes("C")) return "C";
  if (p.includes("F")) return "F";
  return "G";
}

export interface TeamRating {
  games: number;
  pace: number; // possessions per 48
  ortg: number; // opponent-adjusted points per 100 possessions
  drtg: number;
  rawOrtg: number;
  rawDrtg: number;
  /** Per-possession defensive factors vs league for stats allowed to each position group. */
  posDefense: Record<PosGroup, Record<StatKey, { factor: number; raw: number; n: number }>>;
  allowedPerGame: Record<StatKey, number>;
  /** opponents' shooting against this team (shrunk toward league) */
  shooting: { fgPctAllowed: number; fg3PctAllowed: number; fg3aFactor: number; fg3PctFactor: number; n: number };
  lastGameDay: string | null;
  gameDays: string[];
}

export interface LeagueContext {
  day: string; // context built from games strictly before this day
  games: number;
  lgPace: number;
  lgOrtg: number;
  homeCourt: number; // points
  marginSd: number;
  totalSd: number;
  teams: Map<string, TeamRating>;
  /** league per-minute rate by position group and stat (priors for players without history) */
  posRate: Record<PosGroup, Record<StatKey, number>>;
  /** home/away multiplicative factors by stat */
  homeFactor: Record<StatKey, number>;
  /** minutes multiplier on the second night of a back-to-back */
  b2bMinutes: { factor: number; n: number };
  /**
   * Per-stat variance model conditional on minutes: var = κ·μ + φ·μ².
   * κ > 1 captures "lumpy" stats (points arrive in 2s and 3s); φ is stat-specific overdispersion.
   */
  dispersion: Record<StatKey, { kappa: number; phi: number }>;
  /** variance of a shared per-game performance multiplier (correlates a player's stats within a game) */
  sharedTau2: number;
  /** three-point model inputs: league 3P% and 3PA per minute by position, 3PA dispersion */
  threes: { lgPct: number; posPct: Record<PosGroup, number>; posRate3a: Record<PosGroup, number>; disp3a: { kappa: number; phi: number } };
  /**
   * Blowout effect on minutes, measured on finished games: ratio of a player's minutes in games
   * decided by ≥ threshold points to his usual minutes (starters lose minutes, bench gains).
   */
  blowout: { threshold: number; pLeague: number; starter: { factor: number; n: number }; bench: { factor: number; n: number } };
  playerGames: (athleteId: string) => PlayerGameRow[]; // chronological, before day
  teamGames: (teamId: string) => TeamGameRow[];
  gamePlayers: (gameId: string) => PlayerGameRow[];
}

const cache = new Map<string, LeagueContext>();

const zeroStats = (): Record<StatKey, number> =>
  Object.fromEntries(BASE_STATS.map((s) => [s, 0])) as Record<StatKey, number>;

export function buildContext(day: string): LeagueContext {
  const snap = loadSnapshot();
  const ck = `${day}|${snap.key}`;
  const hit = cache.get(ck);
  if (hit) return hit;

  const pg = snap.playerGames.filter((r) => r.day < day);
  const tg = snap.teamGames.filter((r) => r.day < day);
  const gameIds = new Set(tg.map((r) => r.game_id));

  // ---------- pace & efficiency ----------
  const pace48 = (r: TeamGameRow) => (r.poss * 48) / Math.max(48, r.min_total / 5);
  const lgPace = tg.length ? tg.reduce((s, r) => s + pace48(r), 0) / tg.length : 99;
  const lgOrtg = tg.length ? (100 * tg.reduce((s, r) => s + r.pts, 0)) / tg.reduce((s, r) => s + r.poss, 0) : 114;

  const byTeam = new Map<string, TeamGameRow[]>();
  const oppRow = new Map<string, TeamGameRow>(); // `${game}|${team}` → opponent's row
  for (const r of tg) {
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id)!.push(r);
  }
  const byGameT = new Map<string, TeamGameRow[]>();
  for (const r of tg) {
    if (!byGameT.has(r.game_id)) byGameT.set(r.game_id, []);
    byGameT.get(r.game_id)!.push(r);
  }
  for (const r of tg) {
    const o = byGameT.get(r.game_id)!.find((x) => x.team_id !== r.team_id);
    if (o) oppRow.set(`${r.game_id}|${r.team_id}`, o);
  }

  // recency-weighted raw ratings, then iterative opponent adjustment (SRS-style)
  const raw = new Map<string, { o: number; d: number; pace: number; n: number; w: number[]; rows: TeamGameRow[] }>();
  for (const [team, rows] of byTeam) {
    const rev = [...rows].reverse();
    const w = decayWeights(rev.length, 15);
    let o = 0, d = 0, p = 0, ws = 0;
    rev.forEach((r, i) => {
      const opp = oppRow.get(`${r.game_id}|${team}`);
      if (!opp) return;
      o += w[i] * ((100 * r.pts) / r.poss);
      d += w[i] * ((100 * opp.pts) / r.poss);
      p += w[i] * pace48(r);
      ws += w[i];
    });
    raw.set(team, { o: o / ws, d: d / ws, pace: p / ws, n: rev.length, w, rows: rev });
  }
  const adjO = new Map<string, number>();
  const adjD = new Map<string, number>();
  for (const [t, r] of raw) {
    adjO.set(t, r.o);
    adjD.set(t, r.d);
  }
  for (let it = 0; it < 15; it++) {
    for (const [t, r] of raw) {
      let so = 0, sd = 0, ws = 0;
      r.rows.forEach((g, i) => {
        const opp = oppRow.get(`${g.game_id}|${t}`);
        if (!opp) return;
        const oo = adjO.get(g.opp_id) ?? lgOrtg;
        const od = adjD.get(g.opp_id) ?? lgOrtg;
        so += r.w[i] * ((100 * g.pts) / g.poss - (od - lgOrtg));
        sd += r.w[i] * ((100 * opp.pts) / g.poss - (oo - lgOrtg));
        ws += r.w[i];
      });
      adjO.set(t, so / ws);
      adjD.set(t, sd / ws);
    }
  }

  // ---------- positional defense: stats allowed per minute, per position, vs league ----------
  const lgPos: Record<PosGroup, { min: number; s: Record<StatKey, number> }> = {
    G: { min: 0, s: zeroStats() }, F: { min: 0, s: zeroStats() }, C: { min: 0, s: zeroStats() },
  };
  const oppPos = new Map<string, Record<PosGroup, { min: number; s: Record<StatKey, number>; games: Set<string> }>>();
  for (const r of pg) {
    if (r.dnp || r.min <= 0) continue;
    const g = posGroup(r.pos);
    lgPos[g].min += r.min;
    for (const s of BASE_STATS) lgPos[g].s[s] += r[s];
    if (!oppPos.has(r.opp_id))
      oppPos.set(r.opp_id, {
        G: { min: 0, s: zeroStats(), games: new Set() },
        F: { min: 0, s: zeroStats(), games: new Set() },
        C: { min: 0, s: zeroStats(), games: new Set() },
      });
    const o = oppPos.get(r.opp_id)![g];
    o.min += r.min;
    o.games.add(r.game_id);
    for (const s of BASE_STATS) o.s[s] += r[s];
  }
  const posRate = {} as Record<PosGroup, Record<StatKey, number>>;
  for (const g of ["G", "F", "C"] as PosGroup[]) {
    posRate[g] = zeroStats();
    for (const s of BASE_STATS) posRate[g][s] = lgPos[g].min ? lgPos[g].s[s] / lgPos[g].min : 0;
  }

  const tSum = (f: (x: TeamGameRow) => number) => tg.reduce((acc, x) => acc + f(x), 0);
  const lgFgPct = tSum((x) => x.fga) ? tSum((x) => x.fgm) / tSum((x) => x.fga) : 0.47;
  const lgFg3Pct = tSum((x) => x.fg3a) ? tSum((x) => x.fg3m) / tSum((x) => x.fg3a) : 0.36;
  const lgFg3aPerPoss = tSum((x) => x.poss) ? tSum((x) => x.fg3a) / tSum((x) => x.poss) : 0.37;
  const teams = new Map<string, TeamRating>();
  for (const [t, r] of raw) {
    const n = r.n;
    const pace = lgPace + (r.pace - lgPace) * (n / (n + 5));
    const ortg = lgOrtg + ((adjO.get(t) ?? lgOrtg) - lgOrtg) * (n / (n + 6));
    const drtg = lgOrtg + ((adjD.get(t) ?? lgOrtg) - lgOrtg) * (n / (n + 6));
    const op = oppPos.get(t);
    const posDefense = {} as TeamRating["posDefense"];
    for (const g of ["G", "F", "C"] as PosGroup[]) {
      posDefense[g] = {} as Record<StatKey, { factor: number; raw: number; n: number }>;
      for (const s of BASE_STATS) {
        const games = op?.[g].games.size ?? 0;
        const perMin = op && op[g].min ? op[g].s[s] / op[g].min : posRate[g][s];
        const rawRatio = posRate[g][s] ? perMin / posRate[g][s] : 1;
        // remove the opponent's own pace so the factor is per possession (pace is applied separately)
        const perPoss = rawRatio / (r.pace / lgPace);
        posDefense[g][s] = { factor: shrinkRatio(perPoss, games, 10), raw: rawRatio, n: games };
      }
    }
    const allowed = zeroStats();
    for (const row of r.rows) {
      const opp = oppRow.get(`${row.game_id}|${t}`);
      if (!opp) continue;
      for (const s of BASE_STATS) {
        const key = s === "fg3m" ? "fg3m" : s;
        allowed[s] += (opp as unknown as Record<string, number>)[key] ?? 0;
      }
    }
    for (const s of BASE_STATS) allowed[s] /= Math.max(1, r.rows.length);
    // opponents' shooting against this team
    let fgm = 0, fga = 0, f3m = 0, f3a = 0, poss = 0;
    for (const row of r.rows) {
      const opp = oppRow.get(`${row.game_id}|${t}`);
      if (!opp) continue;
      fgm += opp.fgm; fga += opp.fga; f3m += opp.fg3m; f3a += opp.fg3a; poss += row.poss;
    }
    const shrinkPct = (made: number, att: number, lg: number, k: number) => (made + k * lg) / (att + k);
    const fg3aPerPoss = poss ? f3a / poss : lgFg3aPerPoss;
    const fg3PctAllowed = shrinkPct(f3m, f3a, lgFg3Pct, 300);
    const shooting = {
      fgPctAllowed: shrinkPct(fgm, fga, lgFgPct, 400),
      fg3PctAllowed,
      fg3aFactor: shrinkRatio(fg3aPerPoss / lgFg3aPerPoss, n, 10),
      fg3PctFactor: fg3PctAllowed / lgFg3Pct,
      n,
    };
    const days = byTeam.get(t)!.map((x) => x.day);
    teams.set(t, {
      games: n, pace, ortg, drtg, rawOrtg: r.o, rawDrtg: r.d, posDefense, allowedPerGame: allowed, shooting,
      lastGameDay: days.length ? days[days.length - 1] : null, gameDays: days,
    });
  }

  // ---------- home court, residual SDs (game model) ----------
  let hcaSum = 0, hcaN = 0;
  const margins: number[] = [];
  const totals: number[] = [];
  for (const id of gameIds) {
    const h = byGameT.get(id)?.find((x) => x.home === 1);
    const a = byGameT.get(id)?.find((x) => x.home === 0);
    if (!h || !a) continue;
    const th = teams.get(h.team_id);
    const ta = teams.get(a.team_id);
    if (!th || !ta) continue;
    const poss = (th.pace * ta.pace) / lgPace;
    const expH = ((th.ortg + ta.drtg - lgOrtg) / 100) * poss;
    const expA = ((ta.ortg + th.drtg - lgOrtg) / 100) * poss;
    hcaSum += h.pts - a.pts - (expH - expA);
    hcaN++;
    margins.push(h.pts - a.pts - (expH - expA));
    totals.push(h.pts + a.pts - (expH + expA));
  }
  // Bayesian shrinkage toward long-run NBA priors (HCA ≈ 2.5 pts, margin SD ≈ 12.5, total SD ≈ 18.5)
  const homeCourt = (hcaSum + 2.5 * 150) / (hcaN + 150);
  const rms = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length));
  const marginSd = Math.sqrt((rms(margins) ** 2 * margins.length + 12.5 ** 2 * 100) / (margins.length + 100));
  const totalSd = Math.sqrt((rms(totals) ** 2 * totals.length + 18.5 ** 2 * 100) / (totals.length + 100));

  // ---------- home/away per-minute factors ----------
  const ha = { h: { min: 0, s: zeroStats() }, a: { min: 0, s: zeroStats() } };
  for (const r of pg) {
    if (r.dnp || r.min <= 0) continue;
    const b = r.home ? ha.h : ha.a;
    b.min += r.min;
    for (const s of BASE_STATS) b.s[s] += r[s];
  }
  const homeFactor = zeroStats();
  for (const s of BASE_STATS) {
    const rh = ha.h.s[s] / Math.max(1, ha.h.min);
    const ra = ha.a.s[s] / Math.max(1, ha.a.min);
    const ratio = ra > 0 ? Math.sqrt(rh / ra) : 1;
    homeFactor[s] = Number.isFinite(ratio) ? shrinkRatio(ratio, pg.length / 26, 150) : 1;
  }

  // ---------- back-to-back minutes effect ----------
  const teamDaySet = new Map<string, Set<string>>();
  for (const [t, rows] of byTeam) teamDaySet.set(t, new Set(rows.map((r) => r.day)));
  const prevDay = (d: string) => {
    const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) - 1));
    return dt.toISOString().slice(0, 10).replaceAll("-", "");
  };
  const playerAgg = new Map<string, { b2b: number[]; rest: number[] }>();
  for (const r of pg) {
    if (r.dnp || r.min <= 0) continue;
    const isB2B = teamDaySet.get(r.team_id)?.has(prevDay(r.day)) ?? false;
    if (!playerAgg.has(r.athlete_id)) playerAgg.set(r.athlete_id, { b2b: [], rest: [] });
    playerAgg.get(r.athlete_id)![isB2B ? "b2b" : "rest"].push(r.min);
  }
  let bNum = 0, bDen = 0, bN = 0;
  for (const { b2b, rest } of playerAgg.values()) {
    if (!b2b.length || rest.length < 3) continue;
    const mr = rest.reduce((a, b) => a + b, 0) / rest.length;
    if (mr < 15) continue;
    bNum += b2b.reduce((a, b) => a + b, 0);
    bDen += mr * b2b.length;
    bN += b2b.length;
  }
  // Capped at 1: a raw ratio above 1 reflects selection (tired players are rested outright,
  // which voids props) rather than a causal minutes increase.
  const b2bMinutes = { factor: Math.min(1, bDen ? shrinkRatio(bNum / bDen, bN, 200) : 1), n: bN };

  // ---------- overdispersion φ per stat, conditional on minutes (method of moments) ----------
  const seasonRate = new Map<string, { min: number; s: Record<StatKey, number> }>();
  for (const r of pg) {
    if (r.dnp || r.min <= 0) continue;
    if (!seasonRate.has(r.athlete_id)) seasonRate.set(r.athlete_id, { min: 0, s: zeroStats() });
    const a = seasonRate.get(r.athlete_id)!;
    a.min += r.min;
    for (const s of BASE_STATS) a.s[s] += r[s];
  }
  // Moment regression on leave-one-out residuals:  E[r²] = κ·μ·(1 + min/M_loo) + φ·μ²
  // (the min/M_loo term is the sampling variance of the leave-one-out rate itself).
  const dispersion = {} as Record<StatKey, { kappa: number; phi: number }>;
  const resid = new Map<string, Record<StatKey, { r: number; mu: number }>>();
  for (const s of BASE_STATS) {
    let aa = 0, ab = 0, bb = 0, ay = 0, by = 0;
    for (const r of pg) {
      if (r.dnp || r.min < 10) continue;
      const a = seasonRate.get(r.athlete_id)!;
      if (a.min < 150) continue;
      const mLoo = a.min - r.min;
      const mu = ((a.s[s] - r[s]) / mLoo) * r.min;
      const res = r[s] - mu;
      const A = mu * (1 + r.min / mLoo);
      const B = mu * mu;
      const y = res * res;
      aa += A * A; ab += A * B; bb += B * B; ay += A * y; by += B * y;
      const k = `${r.game_id}|${r.athlete_id}`;
      if (!resid.has(k)) resid.set(k, {} as Record<StatKey, { r: number; mu: number }>);
      resid.get(k)![s] = { r: res, mu };
    }
    const det = aa * bb - ab * ab;
    let kappa = det > 0 ? (ay * bb - by * ab) / det : 1;
    let phi = det > 0 ? (aa * by - ab * ay) / det : 0.05;
    if (!(kappa >= 1)) {
      kappa = 1;
      phi = bb > 0 ? (by - ab) / bb : 0.05; // least-squares φ with κ fixed at 1
    }
    dispersion[s] = { kappa: Math.min(3, kappa), phi: Math.min(1, Math.max(0.002, phi)) };
  }
  // Shared game-level factor from cross-moments of pts/reb/ast residuals: E[r_s·r_t] = τ²·μ_s·μ_t
  let cnum = 0, cden = 0;
  for (const v of resid.values()) {
    const pairs: [StatKey, StatKey][] = [["pts", "reb"], ["pts", "ast"], ["reb", "ast"]];
    for (const [x, y] of pairs) {
      if (!v[x] || !v[y]) continue;
      cnum += v[x].r * v[y].r;
      cden += v[x].mu * v[y].mu;
    }
  }
  const sharedTau2 = cden > 0 ? Math.min(0.1, Math.max(0, cnum / cden)) : 0;
  for (const s of BASE_STATS) dispersion[s].phi = Math.max(0.002, dispersion[s].phi - sharedTau2);

  // ---------- three-point attempts: league rates by position + dispersion of 3PA ----------
  const posAgg: Record<PosGroup, { min: number; a: number; m: number }> = { G: { min: 0, a: 0, m: 0 }, F: { min: 0, a: 0, m: 0 }, C: { min: 0, a: 0, m: 0 } };
  const pl3 = new Map<string, { min: number; a: number }>();
  for (const r of pg) {
    if (r.dnp || r.min <= 0) continue;
    const g3 = posAgg[posGroup(r.pos)];
    g3.min += r.min; g3.a += r.fg3a; g3.m += r.fg3m;
    const x = pl3.get(r.athlete_id) ?? { min: 0, a: 0 };
    x.min += r.min; x.a += r.fg3a;
    pl3.set(r.athlete_id, x);
  }
  const posPct = {} as Record<PosGroup, number>;
  const posRate3a = {} as Record<PosGroup, number>;
  for (const g3 of ["G", "F", "C"] as PosGroup[]) {
    posPct[g3] = (posAgg[g3].m + 100 * lgFg3Pct) / (posAgg[g3].a + 100);
    posRate3a[g3] = posAgg[g3].min ? posAgg[g3].a / posAgg[g3].min : 0.1;
  }
  let a3 = 0, ab3 = 0, b3 = 0, ay3 = 0, by3 = 0;
  for (const r of pg) {
    if (r.dnp || r.min < 10) continue;
    const x = pl3.get(r.athlete_id)!;
    if (x.min < 150) continue;
    const mLoo = x.min - r.min;
    const mu = ((x.a - r.fg3a) / mLoo) * r.min;
    const A = mu * (1 + r.min / mLoo), B = mu * mu, y = (r.fg3a - mu) ** 2;
    a3 += A * A; ab3 += A * B; b3 += B * B; ay3 += A * y; by3 += B * y;
  }
  const det3 = a3 * b3 - ab3 * ab3;
  let k3 = det3 > 0 ? (ay3 * b3 - by3 * ab3) / det3 : 1;
  let f3 = det3 > 0 ? (a3 * by3 - ab3 * ay3) / det3 : 0.05;
  if (!(k3 >= 1)) { k3 = 1; f3 = b3 > 0 ? (by3 - ab3) / b3 : 0.05; }
  const threes = { lgPct: lgFg3Pct, posPct, posRate3a, disp3a: { kappa: Math.min(3, k3), phi: Math.min(1, Math.max(0.002, f3 - sharedTau2)) } };

  // ---------- blowout effect on minutes ----------
  const BLOWOUT = 20;
  const marginOf = new Map<string, number>();
  for (const [gid, rows] of byGameT) if (rows.length === 2) marginOf.set(gid, Math.abs(rows[0].pts - rows[1].pts));
  const gp = new Map<string, number>();
  for (const r of pg) if (!r.dnp && r.min > 0) gp.set(r.athlete_id, (gp.get(r.athlete_id) ?? 0) + 1);
  const avgMin = new Map<string, number>();
  for (const [id, x] of seasonRate) avgMin.set(id, x.min / Math.max(1, gp.get(id) ?? 1));
  const bo = { starter: { num: 0, den: 0, n: 0 }, bench: { num: 0, den: 0, n: 0 } };
  for (const r of pg) {
    if (r.dnp || r.min <= 0) continue;
    const m = marginOf.get(r.game_id);
    const avg = avgMin.get(r.athlete_id);
    if (m === undefined || m < BLOWOUT || !avg) continue;
    const grp = avg >= 28 ? bo.starter : avg >= 10 && avg <= 20 ? bo.bench : null;
    if (!grp) continue;
    grp.num += r.min; grp.den += avg; grp.n++;
  }
  const blowGames = [...marginOf.values()];
  const blowout = {
    threshold: BLOWOUT,
    pLeague: blowGames.length ? (blowGames.filter((m) => m >= BLOWOUT).length + 0.15 * 50) / (blowGames.length + 50) : 0.15,
    starter: { factor: bo.starter.den ? shrinkRatio(bo.starter.num / bo.starter.den, bo.starter.n, 60) : 1, n: bo.starter.n },
    bench: { factor: bo.bench.den ? shrinkRatio(bo.bench.num / bo.bench.den, bo.bench.n, 60) : 1, n: bo.bench.n },
  };

  const ctx: LeagueContext = {
    day, games: gameIds.size, lgPace, lgOrtg, homeCourt, marginSd, totalSd, teams, posRate, homeFactor, b2bMinutes, dispersion, sharedTau2, threes, blowout,
    playerGames: (id) => (snap.byAthlete.get(id) ?? []).filter((r) => r.day < day),
    teamGames: (id) => (snap.byTeam.get(id) ?? []).filter((r) => r.day < day),
    gamePlayers: (gid) => snap.byGame.get(gid) ?? [],
  };
  cache.set(ck, ctx);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return ctx;
}

export function restDays(ctx: LeagueContext, teamId: string, day: string): number | null {
  const last = ctx.teams.get(teamId)?.lastGameDay;
  if (!last) return null;
  const toDate = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
  return Math.round((toDate(day) - toDate(last)) / 86400000) - 1; // 0 = back-to-back
}
