/**
 * Player projection model.
 *
 *   stat | minutes  ~ NegBin( mean = minutes · rate · Π factors , φ_stat )
 *   rate            ~ Gamma posterior from recency-weighted per-minute production, shrunk toward
 *                     the player's prior-season rate (or the league positional rate for newcomers)
 *   minutes         ~ Normal(projected, sd) truncated to [0, 48]
 *
 * Factors: pace (opponent's pace vs league), opponent per-possession defense vs the player's
 * position group, home/away, back-to-back minutes, teammate absences (empirical with/without
 * splits when available, otherwise a documented redistribution heuristic) and a heavily shrunk
 * head-to-head residual. Monte-Carlo simulation integrates parameter and game-to-game uncertainty;
 * shared minutes induce realistic correlation between stats (needed for PRA, double-doubles).
 */
import { BASE_STATS, COMBOS, type PlayerMarket, type StatKey } from "../markets";
import type { SeasonLogGame } from "../providers/espn";
import type { PlayerGameRow } from "../store";
import { posGroup, type LeagueContext, type PosGroup } from "./context";
import { betaSample, binomialSample, clamp, decayWeights, gammaSample, hashSeed, makeRng, mean, median, normalCdf, scaledNegBinSample, normalSample, quantileSorted, shrinkRatio, slope } from "./stats";

export interface TeammateAbsence {
  athleteId: string;
  name: string;
  /** probability the teammate does not play (OUT=1, DOUBTFUL≈0.75) */
  pOut: number;
  status: string;
}

export interface PlayerGameContext {
  day: string; // YYYYMMDD of the game; history strictly before this
  teamId: string;
  oppId: string;
  home: boolean;
  restDays: number | null;
  absences: TeammateAbsence[];
  selfStatus?: string | null; // injury designation of the player himself
  priorSeason?: SeasonLogGame[];
  sims?: number;
  params?: ModelParams;
  /** projected final margin (any sign) and its SD from the game model — drives blowout risk */
  gameMargin?: number;
  marginSd?: number;
}

export interface FactorBreakdown {
  pace: number;
  opponent: number;
  home: number;
  teammates: number;
  h2h: number;
}

export interface StatProjection {
  rate: number; // posterior mean per-minute rate (before factors)
  factors: FactorBreakdown;
  mean: number;
}

export interface PlayerProjection {
  athleteId: string;
  name: string;
  pos: PosGroup;
  games: number;
  minutes: { mean: number; sd: number; base: number; b2bFactor: number; teammateDelta: number };
  stats: Record<StatKey, StatProjection>;
  /** simulated stat lines: sims[stat][i] */
  sims: Record<StatKey, Int16Array>;
  /** index of the outer (parameter) draw for each sim → probability uncertainty */
  outer: Uint16Array;
  outerDraws: number;
  notes: string[];
  warnings: string[];
  teammateEffects: { name: string; method: "with/without" | "heuristic" | "already-absent"; minutes: number; nWithout: number; status: string }[];
  /** three-pointers are modelled as attempts × make probability */
  threes: { attempts: number; pct: number; pctSeason: number | null; attFactor: number; pctFactor: number };
  /** probability the game is decided by ≥ threshold points, and the minutes multiplier if it is */
  blowout: { prob: number; factor: number; threshold: number };
}

export interface ModelParams {
  /** minutes of prior-season production the prior is worth */
  priorStrength: number;
  /** minutes the league positional prior is worth (players without a usable prior season) */
  posPriorStrength: number;
  /** recency half-life (games) for per-minute rates */
  rateHalfLife: number;
  /** recency half-life (games) for minutes */
  minHalfLife: number;
  /** weight of the recency-weighted minutes vs the plain season average */
  minRecentWeight: number;
  /** multiplicative de-biasing of projected minutes, estimated on backtest training dates */
  minutesAdj: number;
  /** multiplicative de-biasing of per-minute rates by stat, estimated on backtest training dates */
  rateAdj: Partial<Record<StatKey, number>>;
}

export const DEFAULT_PARAMS: ModelParams = {
  priorStrength: 300, posPriorStrength: 150, rateHalfLife: 12, minHalfLife: 4, minRecentWeight: 0.5, minutesAdj: 1, rateAdj: {},
};

const sumBy = <T>(xs: T[], f: (x: T, i: number) => number) => xs.reduce((s, x, i) => s + f(x, i), 0);

export function playedGames(rows: PlayerGameRow[]): PlayerGameRow[] {
  return rows.filter((r) => !r.dnp && r.min > 0);
}

export function projectPlayer(ctx: LeagueContext, athleteId: string, g: PlayerGameContext): PlayerProjection | null {
  const all = ctx.playerGames(athleteId);
  const played = playedGames(all);
  const prior = (g.priorSeason ?? []).filter((r) => r.min > 0);
  const warnings: string[] = [];
  const notes: string[] = [];
  if (played.length === 0 && prior.length < 5) return null;

  const P = g.params ?? DEFAULT_PARAMS;
  const name = all[all.length - 1]?.name ?? "";
  const pos = posGroup(all.filter((r) => r.pos).at(-1)?.pos);
  const rev = [...played].reverse(); // most recent first
  const n = rev.length;

  // ---------------- minutes ----------------
  const wMin = decayWeights(n, P.minHalfLife);
  const wSum = sumBy(wMin, (x) => x) || 1;
  const recentMin = n ? sumBy(rev, (r, i) => r.min * wMin[i]) / wSum : 0;
  const seasonMin = n ? mean(rev.map((r) => r.min)) : 0;
  const priorMin = prior.length ? mean(prior.map((r) => r.min)) : seasonMin;
  let baseMin: number;
  const wr = P.minRecentWeight;
  if (n >= 10) baseMin = wr * recentMin + (1 - wr) * seasonMin;
  else if (n > 0) {
    // small samples: blend toward last season's minutes (regression to the mean)
    const w = prior.length >= 10 ? 0.5 + n / 20 : 1;
    baseMin = w * (wr * recentMin + (1 - wr) * seasonMin) + (1 - w) * priorMin;
    if (n < 5) warnings.push(`tylko ${n} mecz(e) w sezonie — projekcja opiera się na poprzednim sezonie`);
  } else {
    baseMin = priorMin;
    warnings.push("brak meczów w tym sezonie — projekcja tylko z poprzedniego sezonu");
  }
  const devs = rev.map((r, i) => wMin[i] * (r.min - recentMin) ** 2);
  const minVarObs = n >= 2 ? sumBy(devs, (x) => x) / wSum : 25;
  let minSd = Math.sqrt((minVarObs * n + 25 * 4) / (n + 4)); // shrink toward 5-minute sd
  minSd = Math.max(3, minSd);

  const b2b = g.restDays === 0;
  const b2bFactor = b2b ? ctx.b2bMinutes.factor : 1;
  if (b2b) notes.push(`drugi mecz dzień po dniu (efekt na minuty w lidze ${(b2bFactor * 100 - 100).toFixed(1)}%)`);

  // ---------------- per-minute rates (Gamma posterior) ----------------
  const wRate = decayWeights(n, P.rateHalfLife);
  const priorMinTotal = sumBy(prior, (r) => r.min);
  const stats = {} as Record<StatKey, StatProjection>;
  const posterior = {} as Record<StatKey, { a: number; b: number }>;
  for (const s of BASE_STATS) {
    const C = sumBy(rev, (r, i) => r[s] * wRate[i]);
    const M = sumBy(rev, (r, i) => r.min * wRate[i]);
    let r0: number;
    let K: number;
    if (prior.length >= 10 && priorMinTotal >= 150) {
      r0 = sumBy(prior, (r) => r[s]) / priorMinTotal;
      K = P.priorStrength;
    } else {
      r0 = ctx.posRate[pos][s];
      K = P.posPriorStrength;
    }
    // Overdispersion reduces the information each game carries about the true rate.
    const perGame = n ? C / Math.max(1e-9, sumBy(wRate, (x) => x)) : r0 * baseMin;
    const infl = ctx.dispersion[s].kappa + (ctx.dispersion[s].phi + ctx.sharedTau2) * perGame;
    const a = (C + K * r0 * infl) / infl;
    const b = (M + K * infl) / infl;
    posterior[s] = { a: Math.max(a, 1e-3), b: Math.max(b, 1e-3) };
    const adj = P.rateAdj[s] ?? 1;
    posterior[s].b /= adj; // scales the mean; Gamma CV = 1/√a is unchanged
    stats[s] = {
      rate: posterior[s].a / posterior[s].b,
      factors: { pace: 1, opponent: 1, home: 1, teammates: 1, h2h: 1 },
      mean: 0,
    };
  }

  // ---------------- three-pointers: attempts (Gamma) × make probability (Beta) ----------------
  const C3a = sumBy(rev, (r, i) => r.fg3a * wRate[i]);
  const C3m = sumBy(rev, (r, i) => r.fg3m * wRate[i]);
  const Mw = sumBy(rev, (r, i) => r.min * wRate[i]);
  const prior3a = sumBy(prior, (r) => r.fg3a ?? 0);
  const prior3m = sumBy(prior, (r) => r.fg3m);
  const usePrior3 = prior.length >= 10 && priorMinTotal >= 150 && prior3a > 0;
  const r0a = usePrior3 ? prior3a / priorMinTotal : ctx.threes.posRate3a[pos];
  const K3 = usePrior3 ? P.priorStrength : P.posPriorStrength;
  const d3 = ctx.threes.disp3a;
  const perGame3 = n ? C3a / Math.max(1e-9, sumBy(wRate, (x) => x)) : r0a * baseMin;
  const infl3 = d3.kappa + (d3.phi + ctx.sharedTau2) * perGame3;
  const post3a = { a: Math.max(1e-3, (C3a + K3 * r0a * infl3) / infl3), b: Math.max(1e-3, (Mw + K3 * infl3) / infl3) / (P.rateAdj.fg3m ?? 1) };
  const p0 = prior3a >= 60 ? prior3m / prior3a : ctx.threes.posPct[pos];
  const PCT_PRIOR = 150; // attempts the prior percentage is worth
  const beta3 = { a: C3m + PCT_PRIOR * p0, b: Math.max(0, C3a - C3m) + PCT_PRIOR * (1 - p0) };

  // ---------------- contextual factors ----------------
  const opp = ctx.teams.get(g.oppId);
  const paceFactor = opp ? opp.pace / ctx.lgPace : 1;
  for (const s of BASE_STATS) {
    const f = stats[s].factors;
    f.pace = paceFactor;
    f.opponent = opp ? clamp(opp.posDefense[pos][s].factor, 0.75, 1.3) : 1;
    f.home = g.home ? ctx.homeFactor[s] : 1 / ctx.homeFactor[s];
  }
  if (!opp) warnings.push("rywal nie rozegrał jeszcze meczów — przyjęto przeciętną obronę");

  // ---------------- teammate absences ----------------
  const teammateEffects: PlayerProjection["teammateEffects"] = [];
  let minMult = 1;
  let minAdd = 0;
  const rateMult = Object.fromEntries(BASE_STATS.map((s) => [s, 1])) as Record<StatKey, number>;
  const teamGameIds = rev.map((r) => r.game_id);
  for (const ab of g.absences) {
    if (ab.athleteId === athleteId || ab.pOut <= 0) continue;
    const tmAll = ctx.playerGames(ab.athleteId).filter((r) => r.team_id === g.teamId);
    const tmPlayed = playedGames(tmAll);
    if (tmPlayed.length < 2) continue;
    const tmMin = mean(tmPlayed.map((r) => r.min));
    if (tmMin < 15) continue;
    const playedSet = new Set(tmPlayed.map((r) => r.game_id));
    // Only fresh absences move the projection: if the teammate missed 2+ of this player's last 3
    // games, the recency-weighted baseline already reflects his absence.
    const recent3 = teamGameIds.slice(0, 3);
    if (recent3.filter((id) => playedSet.has(id)).length < Math.min(2, recent3.length)) {
      teammateEffects.push({ name: ab.name, method: "already-absent", minutes: 0, nWithout: 0, status: ab.status });
      continue;
    }
    const without = rev.filter((r) => !playedSet.has(r.game_id));
    const withT = rev.filter((r) => playedSet.has(r.game_id));
    if (without.length >= 3 && withT.length >= 3) {
      const nW = without.length;
      const mRatio = mean(without.map((r) => r.min)) / Math.max(1, mean(rev.map((r) => r.min)));
      const mf = 1 + (shrinkRatio(mRatio, nW, 8) - 1) * ab.pOut;
      minMult *= mf;
      for (const s of BASE_STATS) {
        const rw = sumBy(without, (r) => r[s]) / Math.max(1, sumBy(without, (r) => r.min));
        const ra = sumBy(rev, (r) => r[s]) / Math.max(1, sumBy(rev, (r) => r.min));
        if (ra > 0 && rw > 0) rateMult[s] *= 1 + (shrinkRatio(rw / ra, nW, 12) - 1) * ab.pOut;
      }
      teammateEffects.push({ name: ab.name, method: "with/without", minutes: (mf - 1) * baseMin, nWithout: nW, status: ab.status });
    } else {
      // Heuristic: vacated minutes go mostly to the same position group, proportional to role.
      const samePos = posGroup(tmAll.at(-1)?.pos) === pos;
      const share = samePos ? 0.12 : 0.04;
      const add = Math.min(4, tmMin * share * (baseMin / 30)) * ab.pOut;
      minAdd += add;
      // usage redistribution: a fraction of the absent player's per-minute production share
      const tmPts = mean(tmPlayed.map((r) => r.pts));
      const tmAst = mean(tmPlayed.map((r) => r.ast));
      const usgBoost = 1 + 0.15 * Math.min(0.35, tmPts / 115) * ab.pOut;
      rateMult.pts *= usgBoost;
      rateMult.fg3m *= usgBoost;
      rateMult.ast *= 1 + 0.15 * Math.min(0.4, tmAst / 27) * ab.pOut;
      teammateEffects.push({ name: ab.name, method: "heuristic", minutes: add, nWithout: without.length, status: ab.status });
    }
  }
  for (const s of BASE_STATS) {
    rateMult[s] = clamp(rateMult[s], 0.8, 1.3);
    stats[s].factors.teammates = rateMult[s];
  }

  let projMin = clamp((baseMin * minMult + minAdd) * b2bFactor * P.minutesAdj, 0, 44);
  const self = (g.selfStatus ?? "").toUpperCase();
  if (self === "QUESTIONABLE" || self === "DAY-TO-DAY") {
    minSd *= 1.25;
    projMin *= 0.97;
    warnings.push(`zawodnik ma status ${self.toLowerCase()} — większa niepewność minut`);
  } else if (self === "DOUBTFUL") {
    warnings.push("zawodnik raczej nie zagra (doubtful) — zakład może zostać anulowany");
  }

  // ---------------- head-to-head residual (very weak) ----------------
  const h2hRows = [
    ...rev.filter((r) => r.opp_id === g.oppId).map((r) => ({ r, cur: true })),
    ...prior.filter((r) => r.oppId === g.oppId).map((r) => ({ r, cur: false })),
  ];
  if (h2hRows.length) {
    for (const s of BASE_STATS) {
      const exp = sumBy(h2hRows, ({ r }) => r.min * stats[s].rate);
      const act = sumBy(h2hRows, ({ r }) => (r as unknown as Record<string, number>)[s]);
      if (exp > 0) stats[s].factors.h2h = clamp(shrinkRatio(act / exp, h2hRows.length, 25), 0.9, 1.1);
    }
  }

  // three-pointers: the opponent changes how many 3s are attempted and how often they go in
  const attFactor = opp ? clamp(opp.shooting.fg3aFactor, 0.85, 1.15) : 1;
  const pctFactor = opp ? clamp(1 + (opp.shooting.fg3PctFactor - 1) * 0.7, 0.92, 1.08) : 1;
  const rate3a = post3a.a / post3a.b;
  const pct3 = beta3.a / (beta3.a + beta3.b);
  {
    const f = stats.fg3m.factors;
    f.opponent = attFactor * pctFactor;
    stats.fg3m.rate = rate3a * pct3;
  }

  for (const s of BASE_STATS) {
    const f = stats[s].factors;
    stats[s].mean = projMin * stats[s].rate * f.pace * f.opponent * f.home * f.teammates * f.h2h;
  }

  // ---------------- blowout risk ----------------
  const bo = ctx.blowout;
  const boFactor =
    baseMin >= 28 ? bo.starter.factor : baseMin <= 18 ? bo.bench.factor : bo.bench.factor + ((baseMin - 18) / 10) * (bo.starter.factor - bo.bench.factor);
  const boNorm = bo.pLeague * boFactor + (1 - bo.pLeague); // history already contains the league's usual share of blowouts
  const hasMargin = g.gameMargin !== undefined && g.marginSd !== undefined && g.marginSd > 0;
  const boProb = hasMargin
    ? 1 - normalCdf(bo.threshold, g.gameMargin!, g.marginSd!) + normalCdf(-bo.threshold, g.gameMargin!, g.marginSd!)
    : bo.pLeague;

  // ---------------- Monte-Carlo ----------------
  const N = g.sims ?? 10000;
  const OUTER = 40;
  const inner = Math.ceil(N / OUTER);
  const total = OUTER * inner;
  const rng = makeRng(hashSeed(`${athleteId}|${g.day}|${g.oppId}`));
  const sims = Object.fromEntries(BASE_STATS.map((s) => [s, new Int16Array(total)])) as Record<StatKey, Int16Array>;
  const outer = new Uint16Array(total);
  const mult = Object.fromEntries(
    BASE_STATS.map((s) => {
      const f = stats[s].factors;
      return [s, f.pace * f.opponent * f.home * f.teammates * f.h2h];
    }),
  ) as Record<StatKey, number>;
  let k = 0;
  const f3 = stats.fg3m.factors;
  const mult3a = f3.pace * attFactor * f3.home * f3.teammates;
  for (let o = 0; o < OUTER; o++) {
    const rates = {} as Record<StatKey, number>;
    for (const s of BASE_STATS) rates[s] = gammaSample(rng, posterior[s].a, 1 / posterior[s].b) * mult[s];
    const r3a = gammaSample(rng, post3a.a, 1 / post3a.b) * mult3a;
    const p3 = clamp(betaSample(rng, beta3.a, beta3.b) * pctFactor, 0.05, 0.7);
    // minutes-level parameter uncertainty (role can drift)
    const mCenter = projMin + normalSample(rng) * Math.min(3, minSd / Math.sqrt(Math.max(1, n / 2)));
    const tau2 = ctx.sharedTau2;
    for (let i = 0; i < inner; i++, k++) {
      let m = clamp(mCenter + normalSample(rng) * minSd, 0, 48);
      if (hasMargin) {
        const margin = g.gameMargin! + normalSample(rng) * g.marginSd!;
        m = clamp((m * (Math.abs(margin) >= bo.threshold ? boFactor : 1)) / boNorm, 0, 48);
      }
      // shared "good/bad night" multiplier → positive correlation between a player's stats
      const shared = tau2 > 1e-4 ? gammaSample(rng, 1 / tau2, tau2) : 1;
      outer[k] = o;
      for (const s of BASE_STATS) {
        const d = ctx.dispersion[s];
        sims[s][k] = scaledNegBinSample(rng, rates[s] * m * shared, d.kappa, d.phi);
      }
      const att = scaledNegBinSample(rng, r3a * m * shared, d3.kappa, d3.phi);
      sims.fg3m[k] = binomialSample(rng, att, p3);
    }
  }

  return {
    athleteId, name, pos, games: n,
    minutes: { mean: projMin, sd: minSd, base: baseMin, b2bFactor, teammateDelta: projMin / b2bFactor - baseMin },
    stats, sims, outer, outerDraws: OUTER, notes, warnings, teammateEffects,
    threes: { attempts: projMin * rate3a * mult3a, pct: pct3 * pctFactor, pctSeason: n && sumBy(rev, (r) => r.fg3a) ? sumBy(rev, (r) => r.fg3m) / sumBy(rev, (r) => r.fg3a) : null, attFactor, pctFactor },
    blowout: { prob: boProb, factor: boFactor, threshold: bo.threshold },
  };
}

/** Simulated values of any player market (combos summed per simulation). */
export function simValues(p: PlayerProjection, market: PlayerMarket): Int16Array {
  if (market === "dd" || market === "td") {
    const need = market === "dd" ? 2 : 3;
    const out = new Int16Array(p.sims.pts.length);
    const cats: StatKey[] = ["pts", "reb", "ast", "stl", "blk"];
    for (let i = 0; i < out.length; i++) {
      let c = 0;
      for (const s of cats) if (p.sims[s][i] >= 10) c++;
      out[i] = c >= need ? 1 : 0;
    }
    return out;
  }
  if (market in COMBOS) {
    const parts = COMBOS[market as keyof typeof COMBOS];
    const out = new Int16Array(p.sims.pts.length);
    for (let i = 0; i < out.length; i++) {
      let v = 0;
      for (const s of parts) v += p.sims[s][i];
      out[i] = v;
    }
    return out;
  }
  return p.sims[market as StatKey];
}

export interface ProbResult {
  p: number; // predictive P(value > line)
  pLow: number; // 10th percentile across parameter draws
  pHigh: number; // 90th percentile
}

export function probOver(p: PlayerProjection, market: PlayerMarket, line: number): ProbResult {
  const v = simValues(p, market);
  const hits = new Float64Array(p.outerDraws);
  const cnt = new Float64Array(p.outerDraws);
  let h = 0;
  for (let i = 0; i < v.length; i++) {
    const o = p.outer[i];
    cnt[o]++;
    if (v[i] > line) {
      hits[o]++;
      h++;
    }
  }
  const per = Array.from(hits, (x, i) => x / cnt[i]).sort((a, b) => a - b);
  const pAll = h / v.length;
  // for very rare events the per-draw quantiles can all be 0 — keep the band around the estimate
  return { p: pAll, pLow: Math.min(pAll, quantileSorted(per, 0.1)), pHigh: Math.max(pAll, quantileSorted(per, 0.9)) };
}

export interface Distribution {
  mean: number;
  median: number;
  p10: number;
  p90: number;
  sd: number;
  /** P(X ≥ k) for k = 0..max — lets the UI evaluate any line without the raw sims */
  atLeast: number[];
}

export function distribution(p: PlayerProjection, market: PlayerMarket): Distribution {
  const v = Array.from(simValues(p, market)).sort((a, b) => a - b);
  const max = v[v.length - 1] ?? 0;
  const counts = new Array(max + 2).fill(0);
  for (const x of v) counts[x]++;
  const atLeast: number[] = new Array(max + 2).fill(0);
  let acc = 0;
  for (let k = max + 1; k >= 0; k--) {
    acc += counts[k] ?? 0;
    atLeast[k] = acc / v.length;
  }
  const m = mean(v);
  return {
    mean: m,
    median: median(v),
    p10: quantileSorted(v, 0.1),
    p90: quantileSorted(v, 0.9),
    sd: Math.sqrt(mean(v.map((x) => (x - m) ** 2))),
    atLeast,
  };
}

/** Descriptive line analysis over the most recent games (what the screenshots show). */
export function lineHistory(rows: PlayerGameRow[], market: PlayerMarket, line: number, last: number) {
  const played = playedGames(rows).slice(-last);
  const val = (r: PlayerGameRow) => {
    if (market === "dd" || market === "td") {
      const c = (["pts", "reb", "ast", "stl", "blk"] as StatKey[]).filter((s) => r[s] >= 10).length;
      return c >= (market === "dd" ? 2 : 3) ? 1 : 0;
    }
    if (market in COMBOS) return COMBOS[market as keyof typeof COMBOS].reduce((s, k) => s + r[k], 0);
    return r[market as StatKey];
  };
  const values = played.map(val);
  const hits = values.filter((v) => v > line).length;
  return {
    games: played.map((r, i) => ({ gameId: r.game_id, date: r.date, oppId: r.opp_id, home: !!r.home, min: r.min, value: values[i] })),
    hits,
    n: values.length,
    hitRate: values.length ? hits / values.length : NaN,
    avg: mean(values),
    median: median(values),
    trend: slope(values),
  };
}
