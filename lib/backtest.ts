/**
 * Walk-forward backtest against real DraftKings prices.
 *
 * Leakage controls:
 *  - For a game on day D, the league context, team ratings, player histories and dispersion are
 *    built only from games on days < D (buildContext(D)).
 *  - Bets are placed at the OPENING price/line; the closing price is used only for CLV.
 *  - Calibration is fitted on the first `trainFrac` of dates and all reported metrics come from
 *    the later, untouched dates. Optional parameter tuning also uses the training dates only.
 *  - The live prediction log is never read by the model.
 * Known approximation: absences are taken from the actual box score (players who did not play),
 *  standing in for the pre-game injury report, which ESPN does not archive.
 */
import { config } from "./config";
import { getDb, setMeta, tx } from "./db";
import { getModelParams } from "./model/params";
import { mapLimit } from "./http";
import { COMBOS, type PlayerMarket, type StatKey } from "./markets";
import { applyCalibration, brier, fitCalibration, logLoss, reliability, saveCalibration, type CalRow, type Calibration, type ReliabilityBin } from "./model/calibrate";
import { buildContext, restDays } from "./model/context";
import { pHomeCovers, pOverTotal, projectGame } from "./model/game";
import { DEFAULT_PARAMS, distribution, playedGames, probOver, projectPlayer, type ModelParams, type TeammateAbsence } from "./model/player";
import { mean } from "./model/stats";
import { clv as clvFn, noVig } from "./odds/math";
import { fetchSeasonLog, type SeasonLogGame } from "./providers/espn";
import type { GameLineRow, GameRow, PlayerGameRow, PropLineRow } from "./store";

export interface BacktestRow {
  gameId: string;
  date: string;
  day: string;
  subjectId: string;
  subjectName: string;
  market: string;
  scope: "player" | "game";
  line: number;
  /** probabilities and prices are for the "over" (player/total) or "home" (ml/spread) side */
  openOver: number;
  openUnder: number;
  closeOver: number | null;
  closeUnder: number | null;
  closeSameLine: boolean;
  rawProb: number;
  marketProb: number;
  calProb?: number;
  projMean?: number;
  games?: number;
  projMin?: number;
  projSd?: number;
  inBand?: number;
  actMin?: number;
  adj?: string;
  actual: number;
  y: 0 | 1 | null; // null = push
  fold: "train" | "test";
}

export interface BetStats {
  bets: number;
  wins: number;
  winRate: number;
  staked: number;
  profit: number;
  yield: number;
  roi: number; // on a 100-unit bankroll, 1-unit flat stakes
  avgOdds: number;
  avgEv: number;
  clv: number | null;
  beatClose: number | null;
  clvN: number;
}

export interface BacktestSummary {
  createdAt: number;
  modelVersion: string;
  params: ModelParams;
  dates: { from: string; to: string; trainTo: string };
  rows: { total: number; train: number; test: number; player: number; game: number };
  calibration: { player: Calibration; game: Calibration };
  metrics: Record<"player" | "game", { brierRaw: number; brierMarket: number; brierCal: number; logLossRaw: number; logLossMarket: number; logLossCal: number; n: number }>;
  reliability: { raw: ReliabilityBin[]; cal: ReliabilityBin[]; market: ReliabilityBin[] };
  betting: {
    minEv: number;
    overall: BetStats;
    byMarket: Record<string, BetStats>;
    byOdds: Record<string, BetStats>;
    byProb: Record<string, BetStats>;
  };
  tuning: { params: ModelParams; trainLogLoss: number }[];
  /** out-of-sample accuracy of the projected distribution (player props, test dates) */
  distributionChecks: { market: string; n: number; coverage80: number; rmseModel: number; rmseLine: number }[];
  notes: string[];
}

const priorCache = new Map<string, Promise<SeasonLogGame[]>>();
function prior(athleteId: string) {
  if (!priorCache.has(athleteId)) priorCache.set(athleteId, fetchSeasonLog(athleteId, config.season - 1).catch(() => []));
  return priorCache.get(athleteId)!;
}

const statOf = (r: PlayerGameRow, m: string) =>
  m in COMBOS ? COMBOS[m as keyof typeof COMBOS].reduce((s, k) => s + r[k], 0) : r[m as StatKey];


export async function generateRows(games: GameRow[], params: ModelParams, sims: number, onlyDays?: Set<string>, log?: (s: string) => void): Promise<BacktestRow[]> {
  const db = getDb();
  const rows: BacktestRow[] = [];
  const byDay = new Map<string, GameRow[]>();
  for (const g of games) {
    if (onlyDays && !onlyDays.has(g.day)) continue;
    if (!byDay.has(g.day)) byDay.set(g.day, []);
    byDay.get(g.day)!.push(g);
  }
  for (const [day, dayGames] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ctx = buildContext(day);
    log?.(`  ${day}: ${dayGames.length} games (context: ${ctx.games} prior games)`);
    for (const g of dayGames) {
      const box = ctx.gamePlayers(g.id);
      const playedIds = new Set(box.filter((r) => !r.dnp && r.min > 0).map((r) => r.athlete_id));
      const absencesFor = (teamId: string): TeammateAbsence[] => {
        // rotation players (≥15 mpg before this day) who did not play in this game
        const out: TeammateAbsence[] = [];
        const seen = new Set<string>();
        for (const tgRow of ctx.teamGames(teamId).slice(-10)) {
          for (const r of ctx.gamePlayers(tgRow.game_id)) {
            if (r.team_id !== teamId || seen.has(r.athlete_id)) continue;
            seen.add(r.athlete_id);
            if (playedIds.has(r.athlete_id)) continue;
            const hist = playedGames(ctx.playerGames(r.athlete_id)).filter((x) => x.team_id === teamId);
            if (hist.length >= 2 && mean(hist.map((x) => x.min)) >= 15) out.push({ athleteId: r.athlete_id, name: r.name, pOut: 1, status: "OUT" });
          }
        }
        return out;
      };
      const abs = { [g.home_id]: absencesFor(g.home_id), [g.away_id]: absencesFor(g.away_id) };
      const lines = db.prepare("SELECT * FROM prop_lines WHERE game_id = ? AND kind = 'ou' AND book = 'draftkings'").all(g.id) as unknown as PropLineRow[];
      const byAthlete = new Map<string, PropLineRow[]>();
      for (const l of lines) {
        if (!l.open_over_dec || !l.open_under_dec || l.open_line === null) continue;
        if (!byAthlete.has(l.athlete_id)) byAthlete.set(l.athlete_id, []);
        byAthlete.get(l.athlete_id)!.push(l);
      }
      await mapLimit([...byAthlete], 8, async ([athleteId, ls]) => {
        const row = box.find((r) => r.athlete_id === athleteId);
        if (!row || row.dnp || row.min <= 0) return; // void bet
        const home = row.team_id === g.home_id;
        const proj = projectPlayer(ctx, athleteId, {
          day, teamId: row.team_id, oppId: home ? g.away_id : g.home_id, home, restDays: restDays(ctx, row.team_id, day),
          absences: abs[row.team_id] ?? [], priorSeason: await prior(athleteId), sims, params,
        });
        if (!proj || proj.games < 3) return;
        for (const l of ls) {
          const line = l.open_line!;
          const actual = statOf(row, l.market);
          const pr = probOver(proj, l.market as PlayerMarket, line);
          const [mk] = noVig([l.open_over_dec!, l.open_under_dec!]);
          rows.push({
            gameId: g.id, date: g.date, day, subjectId: athleteId, subjectName: row.name, market: l.market, scope: "player", line,
            openOver: l.open_over_dec!, openUnder: l.open_under_dec!, closeOver: l.over_dec, closeUnder: l.under_dec,
            closeSameLine: l.line === line, rawProb: pr.p, marketProb: mk, actual,
            ...(() => {
              const d = distribution(proj, l.market as PlayerMarket);
              return { projMean: d.mean, projSd: d.sd, inBand: actual >= d.p10 && actual <= d.p90 ? 1 : 0 };
            })(),
            games: proj.games,
            projMin: proj.minutes.mean, actMin: row.min, adj: proj.teammateEffects.filter((t) => t.method !== "already-absent").map((t) => t.method).join(",") || "none",
            y: actual === line ? null : actual > line ? 1 : 0, fold: "train",
          });
        }
      });

      // game markets
      const gl = db.prepare("SELECT * FROM game_lines WHERE game_id = ? AND book = 'draftkings'").get(g.id) as unknown as GameLineRow | undefined;
      if (!gl || g.home_score === null || g.away_score === null) continue;
      const allAbs = [...(abs[g.home_id] ?? []).map((a) => ({ ...a, teamId: g.home_id })), ...(abs[g.away_id] ?? []).map((a) => ({ ...a, teamId: g.away_id }))];
      const gp = projectGame(ctx, g.home_id, g.away_id, allAbs, { home: restDays(ctx, g.home_id, day), away: restDays(ctx, g.away_id, day) });
      if (!gp || Math.min(gp.sample.home, gp.sample.away) < 3) continue;
      const margin = g.home_score - g.away_score;
      const total = g.home_score + g.away_score;
      const base = { gameId: g.id, date: g.date, day, scope: "game" as const, fold: "train" as const };
      // Historical scoreboards keep only closing odds; when no opening price was captured the
      // closing price is used for both (flagged in the summary; CLV is then undefined).
      const oMlH = gl.open_ml_home ?? gl.ml_home, oMlA = gl.open_ml_away ?? gl.ml_away;
      if (oMlH && oMlA)
        rows.push({ ...base, subjectId: g.home_id, subjectName: "home ML", market: "ml", line: 0, openOver: oMlH, openUnder: oMlA,
          closeOver: gl.ml_home, closeUnder: gl.ml_away, closeSameLine: gl.open_ml_home !== null, rawProb: gp.homeWinProb, marketProb: noVig([oMlH, oMlA])[0], actual: margin, y: margin > 0 ? 1 : 0 });
      const oSp = gl.open_spread_home ?? gl.spread_home, oSpH = gl.open_spread_home_dec ?? gl.spread_home_dec, oSpA = gl.open_spread_away_dec ?? gl.spread_away_dec;
      if (oSp !== null && oSpH && oSpA) {
        const cover = margin + oSp;
        rows.push({ ...base, subjectId: g.home_id, subjectName: "home spread", market: "spread", line: oSp, openOver: oSpH, openUnder: oSpA,
          closeOver: gl.spread_home_dec, closeUnder: gl.spread_away_dec, closeSameLine: gl.open_spread_home !== null && gl.spread_home === gl.open_spread_home,
          rawProb: pHomeCovers(gp, oSp), marketProb: noVig([oSpH, oSpA])[0], actual: margin, y: cover === 0 ? null : cover > 0 ? 1 : 0 });
      }
      const oT = gl.open_total ?? gl.total, oTo = gl.open_over_dec ?? gl.over_dec, oTu = gl.open_under_dec ?? gl.under_dec;
      if (oT !== null && oTo && oTu)
        rows.push({ ...base, subjectId: "game", subjectName: "total", market: "total", line: oT, openOver: oTo, openUnder: oTu,
          closeOver: gl.over_dec, closeUnder: gl.under_dec, closeSameLine: gl.open_total !== null && gl.total === gl.open_total, rawProb: pOverTotal(gp, oT),
          marketProb: noVig([oTo, oTu])[0], actual: total, y: total === oT ? null : total > oT ? 1 : 0 });
    }
  }
  return rows;
}

function emptyStats(): BetStats {
  return { bets: 0, wins: 0, winRate: 0, staked: 0, profit: 0, yield: 0, roi: 0, avgOdds: 0, avgEv: 0, clv: null, beatClose: null, clvN: 0 };
}

function simulateBets(rows: BacktestRow[], minEv: number) {
  const overall = emptyStats();
  const byMarket: Record<string, BetStats> = {};
  const byOdds: Record<string, BetStats> = {};
  const byProb: Record<string, BetStats> = {};
  const acc = { odds: new Map<BetStats, number>(), ev: new Map<BetStats, number>(), clv: new Map<BetStats, number>(), beat: new Map<BetStats, number>() };
  const add = (s: BetStats, won: boolean, price: number, ev: number, clv: number | null) => {
    s.bets++;
    s.staked++;
    if (won) s.wins++;
    s.profit += won ? price - 1 : -1;
    acc.odds.set(s, (acc.odds.get(s) ?? 0) + price);
    acc.ev.set(s, (acc.ev.get(s) ?? 0) + ev);
    if (clv !== null) {
      s.clvN++;
      acc.clv.set(s, (acc.clv.get(s) ?? 0) + clv);
      acc.beat.set(s, (acc.beat.get(s) ?? 0) + (clv > 0 ? 1 : 0));
    }
  };
  const oddsBucket = (d: number) => (d < 1.7 ? "< 1.70" : d < 2.0 ? "1.70–1.99" : d < 2.5 ? "2.00–2.49" : "≥ 2.50");
  const probBucket = (p: number) => (p < 0.4 ? "< 40%" : p < 0.5 ? "40–50%" : p < 0.6 ? "50–60%" : "≥ 60%");
  for (const r of rows) {
    if (r.y === null || r.calProb === undefined) continue;
    const sides = [
      { p: r.calProb, price: r.openOver, won: r.y === 1, close: r.closeOver, closeOpp: r.closeUnder },
      { p: 1 - r.calProb, price: r.openUnder, won: r.y === 0, close: r.closeUnder, closeOpp: r.closeOver },
    ];
    const best = sides.map((s) => ({ ...s, ev: s.p * s.price - 1 })).sort((a, b) => b.ev - a.ev)[0];
    if (best.ev < minEv) continue;
    const clv = r.closeSameLine && best.close && best.closeOpp ? clvFn(best.price, noVig([best.close, best.closeOpp])[0]) : null;
    for (const s of [
      overall,
      (byMarket[r.market] ??= emptyStats()),
      (byOdds[oddsBucket(best.price)] ??= emptyStats()),
      (byProb[probBucket(best.p)] ??= emptyStats()),
    ])
      add(s, best.won, best.price, best.ev, clv);
  }
  for (const s of [overall, ...Object.values(byMarket), ...Object.values(byOdds), ...Object.values(byProb)]) {
    s.winRate = s.bets ? s.wins / s.bets : 0;
    s.yield = s.staked ? s.profit / s.staked : 0;
    s.roi = s.profit / 100;
    s.avgOdds = s.bets ? (acc.odds.get(s) ?? 0) / s.bets : 0;
    s.avgEv = s.bets ? (acc.ev.get(s) ?? 0) / s.bets : 0;
    s.clv = s.clvN ? (acc.clv.get(s) ?? 0) / s.clvN : null;
    s.beatClose = s.clvN ? (acc.beat.get(s) ?? 0) / s.clvN : null;
  }
  return { minEv, overall, byMarket, byOdds, byProb };
}

export async function runBacktest(opts: { trainFrac?: number; minEv?: number; sims?: number; tune?: boolean; log?: (s: string) => void } = {}): Promise<BacktestSummary> {
  const log = opts.log ?? (() => {});
  const trainFrac = opts.trainFrac ?? 0.6;
  const minEv = opts.minEv ?? 0.03;
  const sims = opts.sims ?? 3000;
  const db = getDb();
  const all = db
    .prepare("SELECT * FROM games WHERE state = 'post' AND season = ? AND season_type = 2 AND box_synced = 1 ORDER BY date")
    .all(config.season) as unknown as GameRow[];
  const days = [...new Set(all.map((g) => g.day))].sort();
  // need some league history before the first evaluated day
  const evalDays = days.slice(Math.min(days.length - 1, 6));
  if (evalDays.length < 4) throw new Error("Not enough completed game days to backtest yet (need ≥ 10). Run a sync first.");
  const cut = Math.max(1, Math.floor(evalDays.length * trainFrac));
  const trainDays = new Set(evalDays.slice(0, cut));
  const notes: string[] = [];

  let params = getModelParams();
  const tuning: BacktestSummary["tuning"] = [];
  if (opts.tune) {
    log("tuning on training dates only…");
    const grid: ModelParams[] = [];
    for (const priorStrength of [150, 300, 600])
      for (const rateHalfLife of [8, 15, 30]) grid.push({ ...DEFAULT_PARAMS, priorStrength, rateHalfLife });
    for (const p of grid) {
      const rows = (await generateRows(all, p, 1500, trainDays)).filter((r) => r.scope === "player" && r.y !== null);
      const ll = logLoss(rows.map((r) => r.rawProb), rows.map((r) => r.y as number));
      tuning.push({ params: p, trainLogLoss: ll });
      log(`  prior=${p.priorStrength} hl=${p.rateHalfLife}: logloss ${ll.toFixed(4)} (n=${rows.length})`);
    }
    params = tuning.reduce((a, b) => (b.trainLogLoss < a.trainLogLoss ? b : a)).params;
    setMeta("modelParams", params);
    notes.push(`Parameters tuned on training dates only: priorStrength=${params.priorStrength}, rateHalfLife=${params.rateHalfLife}.`);
  }

  // Pass A (training dates only): estimate multiplicative de-bias factors for minutes and rates.
  log("estimating de-bias factors on training dates…");
  params = { ...params, minutesAdj: 1, rateAdj: {} };
  const trainRows = await generateRows(all, params, 1500, trainDays);
  const uniq = new Map<string, BacktestRow>();
  for (const r of trainRows) if (r.scope === "player") uniq.set(`${r.gameId}|${r.subjectId}`, r);
  const pm = [...uniq.values()];
  const minutesAdj = pm.reduce((s, r) => s + r.actMin!, 0) / Math.max(1, pm.reduce((s, r) => s + r.projMin!, 0));
  const rateAdj: ModelParams["rateAdj"] = {};
  for (const stat of ["pts", "reb", "ast", "fg3m"] as const) {
    const rs = trainRows.filter((r) => r.market === stat);
    const act = rs.reduce((s, r) => s + r.actual, 0);
    const proj = rs.reduce((s, r) => s + r.projMean!, 0) * minutesAdj;
    // shrink toward 1 with the amount of evidence (≈ games)
    if (proj > 0) rateAdj[stat] = 1 + (act / proj - 1) * (rs.length / (rs.length + 200));
  }
  params = { ...params, minutesAdj: 1 + (minutesAdj - 1) * (pm.length / (pm.length + 200)), rateAdj };
  notes.push(`De-bias factors from training dates: minutes ×${params.minutesAdj.toFixed(3)}, ` +
    Object.entries(rateAdj).map(([k, v]) => `${k} ×${v!.toFixed(3)}`).join(", ") + ".");
  setMeta("modelParams", params);

  log("generating walk-forward predictions…");
  const rows = await generateRows(all, params, sims, new Set(evalDays), log);
  for (const r of rows) r.fold = trainDays.has(r.day) ? "train" : "test";

  const cal = {} as Record<"player" | "game", Calibration>;
  const metrics = {} as BacktestSummary["metrics"];
  for (const scope of ["player", "game"] as const) {
    const tr: CalRow[] = rows.filter((r) => r.scope === scope && r.fold === "train" && r.y !== null).map((r) => ({ pModel: r.rawProb, pMarket: r.marketProb, y: r.y as 0 | 1 }));
    const trainCal = fitCalibration(tr, scope === "game" ? 10 : 2);
    const test = rows.filter((r) => r.scope === scope && r.fold === "test");
    for (const r of rows.filter((x) => x.scope === scope)) r.calProb = applyCalibration(trainCal, r.rawProb, r.marketProb);
    const t = test.filter((r) => r.y !== null);
    const ys = t.map((r) => r.y as number);
    metrics[scope] = {
      n: t.length,
      brierRaw: brier(t.map((r) => r.rawProb), ys),
      brierMarket: brier(t.map((r) => r.marketProb), ys),
      brierCal: brier(t.map((r) => r.calProb!), ys),
      logLossRaw: logLoss(t.map((r) => r.rawProb), ys),
      logLossMarket: logLoss(t.map((r) => r.marketProb), ys),
      logLossCal: logLoss(t.map((r) => r.calProb!), ys),
    };
    // final calibration for live use: refit on every evaluated date (all strictly in the past)
    const allRows: CalRow[] = rows.filter((r) => r.scope === scope && r.y !== null).map((r) => ({ pModel: r.rawProb, pMarket: r.marketProb, y: r.y as 0 | 1 }));
    cal[scope] = fitCalibration(allRows, scope === "game" ? 10 : 2);
    if (cal[scope].fittedAt) saveCalibration(scope, cal[scope]);
    else notes.push(`${scope}: fewer than 50 settled rows — calibration not fitted.`);
  }

  const testPlayer = rows.filter((r) => r.fold === "test" && r.scope === "player" && r.y !== null);
  const ysP = testPlayer.map((r) => r.y as number);
  const betting = simulateBets(rows.filter((r) => r.fold === "test"), minEv);
  notes.push("Bets simulated at DraftKings OPENING prices, 1-unit flat stakes, best side per market only if calibrated EV ≥ threshold.");
  notes.push("Game markets (ML/spread/total): ESPN archives only closing odds for past games, so game-market backtests use closing prices (a harder benchmark; no CLV).");
  notes.push("Absences in historical games come from box scores (who did not play) — a stand-in for the pre-game injury report.");

  const distributionChecks = [...new Set(testPlayer.map((r) => r.market))].sort().map((market) => {
    const rs = testPlayer.filter((r) => r.market === market);
    const rmse = (f: (r: BacktestRow) => number) => Math.sqrt(rs.reduce((s, r) => s + (r.actual - f(r)) ** 2, 0) / rs.length);
    return { market, n: rs.length, coverage80: rs.reduce((s, r) => s + (r.inBand ?? 0), 0) / rs.length, rmseModel: rmse((r) => r.projMean ?? r.line), rmseLine: rmse((r) => r.line) };
  });

  const summary: BacktestSummary = {
    createdAt: Date.now(),
    modelVersion: config.modelVersion,
    params,
    dates: { from: evalDays[0], to: evalDays.at(-1)!, trainTo: evalDays[cut - 1] },
    rows: {
      total: rows.length, train: rows.filter((r) => r.fold === "train").length, test: rows.filter((r) => r.fold === "test").length,
      player: rows.filter((r) => r.scope === "player").length, game: rows.filter((r) => r.scope === "game").length,
    },
    calibration: cal,
    metrics,
    reliability: {
      raw: reliability(testPlayer.map((r) => r.rawProb), ysP),
      cal: reliability(testPlayer.map((r) => r.calProb!), ysP),
      market: reliability(testPlayer.map((r) => r.marketProb), ysP),
    },
    betting,
    tuning,
    distributionChecks,
    notes,
  };

  const runId = Number(
    db.prepare("INSERT INTO backtest_runs(created_at, model_version, params, summary) VALUES(?,?,?,?)").run(Date.now(), config.modelVersion, JSON.stringify(params), JSON.stringify(summary)).lastInsertRowid,
  );
  const st = db.prepare(`INSERT INTO backtest_rows(run_id, game_id, date, subject_id, subject_name, market, line, side, open_price, close_price, raw_prob, market_prob, cal_prob, actual, won, fold)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  tx(() => {
    for (const r of rows)
      if (r.y !== null)
        st.run(runId, r.gameId, r.date, r.subjectId, r.subjectName, r.market, r.line, r.scope === "player" || r.market === "total" ? "over" : "home",
          r.openOver, r.closeOver, r.rawProb, r.marketProb, r.calProb ?? null, r.actual, r.y, r.fold);
    db.prepare("DELETE FROM backtest_rows WHERE run_id < ?").run(runId - 4);
  });
  return summary;
}

export function latestBacktest(): BacktestSummary | null {
  const r = getDb().prepare("SELECT summary FROM backtest_runs ORDER BY id DESC LIMIT 1").get() as { summary: string } | undefined;
  return r ? (JSON.parse(r.summary) as BacktestSummary) : null;
}
