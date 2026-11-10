/**
 * Slate analysis: turns live data into ranked, explained bet evaluations.
 *
 * For every offered price:
 *   implied      = 1 / odds                      (includes vig)
 *   market prob  = no-vig probability (power method on the two-way market; for one-way markets
 *                  the vig is estimated from the same slate's two-way markets and flagged)
 *   raw prob     = model probability (Monte-Carlo player model / Normal game model)
 *   model prob   = calibrated probability (see model/calibrate.ts)
 *   edge         = model prob − implied
 *   EV           = model prob · odds − 1
 *   fair odds    = 1 / model prob
 */
import { config } from "./config";
import { DataUnavailableError, mapLimit } from "./http";
import { BASE_STATS, COMBOS, MARKET_LABEL, isGameMarket, type Market, type PlayerMarket, type StatKey } from "./markets";
import { applyCalibration, getCalibration, type Calibration } from "./model/calibrate";
import { buildContext, posGroup, restDays, type LeagueContext } from "./model/context";
import { pHomeCovers, pOverTotal, projectGame, type GameAbsence, type GameProjection } from "./model/game";
import { distribution, lineHistory, probOver, projectPlayer, type PlayerProjection, type TeammateAbsence } from "./model/player";
import { getModelParams } from "./model/params";
import { latestBacktest } from "./backtest";
import { expectedValue, fairOdds, impliedProb, kelly, noVig, overround } from "./odds/math";
import { easternDay, fetchInjuries, fetchRoster, fetchSeasonLog, type Injury } from "./providers/espn";
import { eventToOffers, fetchEventProps, fetchGameOdds, matchEvent, normName, oddsApiEnabled, type GameRef, type Offer } from "./providers/oddsapi";
import { getGameLine, getGamesByDay, getPropLines, getTeams, type GameRow, type TeamRow } from "./store";
import { syncSlate } from "./sync";
import { getMeta, setMeta } from "./db";
import { effectivePrice, getTaxSettings } from "./books";
import { listManual, manualToOffers } from "./manual-odds";
import { fetchPolishOffers, oddsPapiEnabled } from "./providers/oddspapi";
import { logPredictions } from "./tracking";

export const P_OUT: Record<string, number> = { OUT: 1, DOUBTFUL: 0.75, QUESTIONABLE: 0.35, "DAY-TO-DAY": 0.25, PROBABLE: 0.05 };

export type Confidence = "High" | "Medium" | "Low";

export interface BetEval {
  id: string;
  gameId: string;
  gameLabel: string;
  tipoff: string;
  market: Market;
  marketLabel: string;
  kind: "player" | "game";
  marketType: "ou" | "milestone" | "yes" | "game";
  subjectId: string;
  subjectName: string;
  teamId: string;
  teamAbbr: string;
  oppAbbr: string;
  side: Offer["side"];
  line: number | null;
  selection: string; // human-readable, e.g. "Over 11.5 Rebounds"
  book: string;
  /** price used for EV: after the Polish stake tax when that setting is on */
  price: number;
  priceRaw: number;
  taxed: boolean;
  offers: { book: string; bookKey: string; dec: number; eff: number; oppDec: number | null }[];
  impliedProb: number;
  marketProb: number | null;
  marketProbSource: string;
  rawProb: number;
  modelProb: number;
  pLow: number;
  pHigh: number;
  edge: number;
  edgeVsFair: number | null;
  ev: number;
  fairOdds: number;
  kellyQuarter: number;
  projection: { mean: number; median: number; p10: number; p90: number } | null;
  hitRates: { l5: string; l10: string; l20: string; season: string } | null;
  openLine: number | null;
  openPrice: number | null;
  confidence: Confidence;
  confidenceScore: number;
  reasons: string[];
  warnings: string[];
  isValue: boolean;
}

export interface SlateAnalysis {
  day: string;
  generatedAt: number;
  games: (GameRow & { home: TeamRow | undefined; away: TeamRow | undefined; projection: GameProjection | null })[];
  bets: BetEval[];
  injuries: Injury[];
  injuriesAvailable: boolean;
  calibration: { player: Calibration; game: Calibration };
  sources: { name: string; fetchedAt: number | null; ok: boolean; note?: string }[];
  warnings: string[];
  playersAnalyzed: number;
  projections: Map<string, PlayerProjection>;
  /** whether the latest out-of-sample backtest showed the calibrated model beating the market */
  evidence: Record<"player" | "game", { proven: boolean; detail: string }>;
}

const slateCache = new Map<string, { at: number; v: Promise<SlateAnalysis>; version: number }>();

/**
 * Drop cached analyses after manual odds or settings change. The version lives in the DB because
 * API routes and pages can run in separate module instances, each with its own in-memory cache.
 */
export function invalidateSlate() {
  slateCache.clear();
  setMeta("slateVersion", Date.now());
}

export function analyzeSlate(day = easternDay(), opts: { force?: boolean } = {}): Promise<SlateAnalysis> {
  const version = getMeta<number>("slateVersion") ?? 0;
  const hit = slateCache.get(day);
  if (hit && !opts.force && hit.version === version && Date.now() - hit.at < 180_000) return hit.v;
  const v = runSlate(day, opts.force ?? false).catch((e) => {
    slateCache.delete(day);
    throw e;
  });
  slateCache.set(day, { at: Date.now(), v, version });
  return v;
}

async function runSlate(day: string, force: boolean): Promise<SlateAnalysis> {
  const warnings: string[] = [];
  const sources: SlateAnalysis["sources"] = [];

  try {
    const s = await syncSlate(day, force);
    sources.push({ name: "ESPN scoreboard + DraftKings odds", fetchedAt: Math.min(s.scoreboardFetchedAt, s.propsFetchedAt), ok: !s.stale, note: s.stale ? "network failed — showing cached data" : undefined });
    for (const e of s.errors) warnings.push(e);
  } catch (e) {
    sources.push({ name: "ESPN scoreboard + DraftKings odds", fetchedAt: null, ok: false, note: (e as Error).message });
    warnings.push(`Live slate refresh failed (${(e as Error).message}); using stored data if any.`);
  }

  let injuries: Injury[] = [];
  let injuriesAvailable = true;
  try {
    const r = await fetchInjuries();
    injuries = r.injuries;
    sources.push({ name: "ESPN injury report", fetchedAt: r.fetchedAt, ok: !r.stale });
  } catch (e) {
    injuriesAvailable = false;
    sources.push({ name: "ESPN injury report", fetchedAt: null, ok: false, note: (e as Error).message });
    warnings.push("Injury report unavailable — every player-prop evaluation is downgraded to Low confidence.");
  }

  const teams = getTeams();
  const games = getGamesByDay(day).filter((g) => g.season_type === 2);
  const ctx = buildContext(day);
  const cal = { player: getCalibration("player"), game: getCalibration("game") };
  // Evidence gate: a market scope may only produce recommendations if the calibrated model beat the
  // de-vigged market out-of-sample in the latest walk-forward backtest.
  const bt = latestBacktest();
  const evidence = {} as SlateAnalysis["evidence"];
  for (const k of ["player", "game"] as const) {
    const m = bt?.metrics[k];
    const proven = Boolean(m && m.n >= 100 && m.logLossCal < m.logLossMarket);
    evidence[k] = {
      proven,
      detail: !m
        ? "no backtest has been run yet"
        : `out-of-sample log-loss ${m.logLossCal.toFixed(4)} vs market ${m.logLossMarket.toFixed(4)} (n=${m.n})`,
    };
    if (!proven) warnings.push(`${k === "player" ? "Player props" : "Game lines (ML/spread/total)"}: not recommended — ${evidence[k].detail}${m ? "; the model has not beaten the market here" : ""}.`);
  }
  if (!cal.player.fittedAt) warnings.push("Model probabilities are uncalibrated — run a backtest (History → Run backtest) to fit calibration.");

  // ---- offers: DraftKings via ESPN always; other books via The Odds API when configured ----
  const offers: (Offer & { kind: BetEval["marketType"]; openLine: number | null; openPrice: number | null; sideCheck: string })[] = [];
  const rosterTeam = new Map<string, string>();
  const rosterName = new Map<string, string>();
  await mapLimit([...new Set(games.flatMap((g) => [g.home_id, g.away_id]))], 4, async (t) => {
    try {
      for (const p of await fetchRoster(t)) {
        rosterTeam.set(p.athleteId, t);
        rosterName.set(p.athleteId, p.name);
      }
    } catch (e) {
      warnings.push(`roster ${teams.get(t)?.abbr ?? t}: ${(e as Error).message}`);
    }
  });

  for (const g of games) {
    for (const l of getPropLines(g.id)) {
      if (l.book !== "draftkings") continue;
      const base = { gameId: g.id, market: l.market as Market, subjectId: l.athlete_id, book: "draftkings", bookTitle: "DraftKings", lastUpdate: l.updated_at, kind: l.kind, sideCheck: l.side_check };
      if (l.kind === "ou") {
        offers.push({ ...base, side: "over", line: l.line, dec: l.over_dec!, oppDec: l.under_dec, openLine: l.open_line, openPrice: l.open_over_dec });
        offers.push({ ...base, side: "under", line: l.line, dec: l.under_dec!, oppDec: l.over_dec, openLine: l.open_line, openPrice: l.open_under_dec });
      } else if (l.kind === "milestone") {
        if (l.over_dec! < 1.25 || l.over_dec! > 6) continue; // extreme ladders carry heavy, unknown vig
        offers.push({ ...base, side: "over", line: l.line, dec: l.over_dec!, oppDec: null, openLine: null, openPrice: null });
      } else {
        offers.push({ ...base, side: "yes", line: 0.5, dec: l.over_dec!, oppDec: null, openLine: null, openPrice: l.open_over_dec });
      }
    }
    const gl = getGameLine(g.id);
    if (gl) {
      const base = { gameId: g.id, book: "draftkings", bookTitle: "DraftKings", lastUpdate: null, kind: "game" as const, sideCheck: "n/a" };
      if (gl.ml_home && gl.ml_away) {
        offers.push({ ...base, market: "ml", subjectId: g.home_id, side: "home", line: null, dec: gl.ml_home, oppDec: gl.ml_away, openLine: null, openPrice: gl.open_ml_home });
        offers.push({ ...base, market: "ml", subjectId: g.away_id, side: "away", line: null, dec: gl.ml_away, oppDec: gl.ml_home, openLine: null, openPrice: gl.open_ml_away });
      }
      if (gl.spread_home !== null && gl.spread_home_dec && gl.spread_away_dec) {
        offers.push({ ...base, market: "spread", subjectId: g.home_id, side: "home", line: gl.spread_home, dec: gl.spread_home_dec, oppDec: gl.spread_away_dec, openLine: gl.open_spread_home, openPrice: gl.open_spread_home_dec });
        offers.push({ ...base, market: "spread", subjectId: g.away_id, side: "away", line: -gl.spread_home, dec: gl.spread_away_dec, oppDec: gl.spread_home_dec, openLine: gl.open_spread_home === null ? null : -gl.open_spread_home, openPrice: gl.open_spread_away_dec });
      }
      if (gl.total !== null && gl.over_dec && gl.under_dec) {
        offers.push({ ...base, market: "total", subjectId: "game", side: "over", line: gl.total, dec: gl.over_dec, oppDec: gl.under_dec, openLine: gl.open_total, openPrice: gl.open_over_dec });
        offers.push({ ...base, market: "total", subjectId: "game", side: "under", line: gl.total, dec: gl.under_dec, oppDec: gl.over_dec, openLine: gl.open_total, openPrice: gl.open_under_dec });
      }
    }
  }

  if (oddsApiEnabled()) {
    try {
      const refs: GameRef[] = games.map((g) => ({ gameId: g.id, date: g.date, homeId: g.home_id, awayId: g.away_id, homeName: teams.get(g.home_id)?.name ?? "", awayName: teams.get(g.away_id)?.name ?? "" }));
      const playerIndex = new Map<string, string>();
      for (const [id, n] of rosterName) playerIndex.set(normName(n), id);
      const go = await fetchGameOdds();
      let fetchedAt = go.fetchedAt;
      for (const ev of go.events) {
        const ref = matchEvent(ev, refs);
        if (!ref) continue;
        for (const o of eventToOffers(ev, ref, playerIndex))
          if (o.book !== "draftkings" || !offers.some((x) => x.book === "draftkings" && x.gameId === o.gameId && x.market === o.market))
            offers.push({ ...o, kind: "game", openLine: null, openPrice: null, sideCheck: "labeled" });
        const g = games.find((x) => x.id === ref.gameId);
        if (g?.state === "pre") {
          const pr = await fetchEventProps(ev.id);
          fetchedAt = Math.min(fetchedAt, pr.fetchedAt);
          for (const o of eventToOffers(pr.event, ref, playerIndex))
            if (o.book !== "draftkings") // DraftKings props already come from ESPN
              offers.push({ ...o, kind: o.side === "yes" ? "yes" : "ou", openLine: null, openPrice: null, sideCheck: "labeled" });
        }
      }
      sources.push({ name: "The Odds API (multi-book)", fetchedAt, ok: true });
    } catch (e) {
      const msg = e instanceof DataUnavailableError ? e.message : String(e);
      sources.push({ name: "The Odds API (multi-book)", fetchedAt: null, ok: false, note: msg });
      warnings.push(`The Odds API failed: ${msg}`);
    }
  } else {
    sources.push({ name: "The Odds API (multi-book)", fetchedAt: null, ok: false, note: "ODDS_API_KEY not set — DraftKings only" });
  }

  // ---- Polish bookmakers: OddsPapi feed (optional) + manually entered prices ----
  const homeAway = new Map(games.map((g) => [g.id, { home: g.home_id, away: g.away_id }]));
  const manual = manualToOffers(listManual(games.map((g) => g.id)), homeAway);
  const manualKeys = new Set(manual.map((o) => `${o.gameId}|${o.market}|${o.subjectId}|${o.side}|${o.line ?? ""}|${o.book}`));
  if (oddsPapiEnabled()) {
    try {
      const refs: GameRef[] = games.filter((g) => g.state === "pre").map((g) => ({ gameId: g.id, date: g.date, homeId: g.home_id, awayId: g.away_id, homeName: teams.get(g.home_id)?.name ?? "", awayName: teams.get(g.away_id)?.name ?? "" }));
      const playerIndex = new Map<string, string>();
      for (const [id, n] of rosterName) playerIndex.set(normName(n), id);
      const r = await fetchPolishOffers(refs, playerIndex);
      for (const o of r.offers)
        if (!manualKeys.has(`${o.gameId}|${o.market}|${o.subjectId}|${o.side}|${o.line ?? ""}|${o.book}`)) // manual entry wins
          offers.push({ ...o, kind: isGameMarket(o.market) ? "game" : o.side === "yes" ? "yes" : "ou", openLine: null, openPrice: null, sideCheck: "labeled" });
      sources.push({ name: "OddsPapi (polscy bukmacherzy)", fetchedAt: r.fetchedAt, ok: true, note: `${r.books.join(", ") || "no Polish books returned"} · ${r.matchedFixtures} games` });
    } catch (e) {
      sources.push({ name: "OddsPapi (polscy bukmacherzy)", fetchedAt: null, ok: false, note: (e as Error).message });
      warnings.push(`OddsPapi failed: ${(e as Error).message}`);
    }
  }
  for (const o of manual) offers.push({ ...o, openLine: null, openPrice: null, sideCheck: "manual" });
  if (manual.length) sources.push({ name: "Ręcznie wpisane kursy", fetchedAt: Math.max(...manual.map((o) => Date.parse(o.lastUpdate ?? "") || 0)), ok: true });
  const tax = getTaxSettings();

  // typical overround of two-way prop markets on this slate → used to de-vig one-way markets
  const ors = offers.filter((o) => o.kind === "ou" && o.side === "over" && o.oppDec).map((o) => overround([o.dec, o.oppDec!]));
  const typicalOverround = ors.length ? ors.sort((a, b) => a - b)[ors.length >> 1] : 1.05;

  const injByTeam = new Map<string, Injury[]>();
  for (const i of injuries) {
    const t = rosterTeam.get(i.athleteId) ?? i.teamId;
    if (!injByTeam.has(t)) injByTeam.set(t, []);
    injByTeam.get(t)!.push(i);
  }
  const injOf = new Map(injuries.map((i) => [i.athleteId, i]));

  // ---- projections ----
  const gameById = new Map(games.map((g) => [g.id, g]));
  const projections = new Map<string, PlayerProjection>();
  const params = getModelParams();
  const subjectTeam = new Map<string, string>();
  const subjects = [...new Set(offers.filter((o) => !isGameMarket(o.market)).map((o) => `${o.gameId}|${o.subjectId}`))];
  await mapLimit(subjects, 6, async (k) => {
    const [gameId, athleteId] = k.split("|");
    const g = gameById.get(gameId)!;
    const teamId = rosterTeam.get(athleteId) ?? ctx.playerGames(athleteId).at(-1)?.team_id;
    if (!teamId || (teamId !== g.home_id && teamId !== g.away_id)) return;
    const home = teamId === g.home_id;
    const oppId = home ? g.away_id : g.home_id;
    let prior: Awaited<ReturnType<typeof fetchSeasonLog>> = [];
    try {
      prior = await fetchSeasonLog(athleteId, config.season - 1);
    } catch {
      /* rookies have no prior season */
    }
    const absences: TeammateAbsence[] = (injByTeam.get(teamId) ?? [])
      .filter((i) => i.athleteId !== athleteId)
      .map((i) => ({ athleteId: i.athleteId, name: i.name, pOut: P_OUT[i.status] ?? 0.25, status: i.status }));
    const proj = projectPlayer(ctx, athleteId, {
      day, teamId, oppId, home, restDays: restDays(ctx, teamId, day), absences,
      selfStatus: injOf.get(athleteId)?.status ?? null, priorSeason: prior, sims: 8000, params,
    });
    if (proj) {
      subjectTeam.set(k, teamId);
      if (!proj.name) proj.name = rosterName.get(athleteId) ?? athleteId;
      projections.set(k, proj);
    }
  });

  const gameProj = new Map<string, GameProjection | null>();
  for (const g of games) {
    const abs: GameAbsence[] = injuries
      .filter((i) => [g.home_id, g.away_id].includes(rosterTeam.get(i.athleteId) ?? i.teamId))
      .map((i) => ({ athleteId: i.athleteId, name: i.name, teamId: rosterTeam.get(i.athleteId) ?? i.teamId, pOut: P_OUT[i.status] ?? 0.25 }));
    gameProj.set(g.id, projectGame(ctx, g.home_id, g.away_id, abs, { home: restDays(ctx, g.home_id, day), away: restDays(ctx, g.away_id, day) }));
  }

  // ---- group offers into bets and evaluate ----
  const groups = new Map<string, typeof offers>();
  for (const o of offers) {
    if (!(o.dec > 1)) continue;
    const k = `${o.gameId}|${o.market}|${o.subjectId}|${o.side}|${o.line ?? ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(o);
  }
  const bets: BetEval[] = [];
  for (const [k, grp] of groups) {
    const g = gameById.get(grp[0].gameId);
    if (!g || g.state !== "pre") continue;
    // best price after the optional Polish stake tax (the price you would actually be paid)
    const eff = (o: (typeof grp)[number]) => effectivePrice(o.book, o.dec, tax);
    const best = grp.reduce((a, b) => (eff(b) > eff(a) ? b : a));
    const bestEff = eff(best);
    const sharp = grp.find((o) => o.book === "pinnacle" && o.oppDec) ?? grp.find((o) => o.book === "draftkings" && o.oppDec) ?? grp.find((o) => o.oppDec);
    let marketProb: number | null = null;
    let marketProbSource = "";
    if (sharp?.oppDec) {
      marketProb = noVig([sharp.dec, sharp.oppDec])[0];
      marketProbSource = `${sharp.bookTitle} two-way, vig removed (power method)`;
    } else {
      marketProb = Math.min(0.99, impliedProb(sharp?.dec ?? best.dec) / typicalOverround);
      marketProbSource = `one-way market — vig estimated at ${((typicalOverround - 1) * 100).toFixed(1)}% from this slate`;
    }
    const e = isGameMarket(best.market)
      ? evalGame(best, g, gameProj.get(g.id) ?? null, teams, cal.game, marketProb)
      : evalPlayer(best, g, projections.get(`${g.id}|${best.subjectId}`), ctx, teams, cal.player, marketProb, injOf, injuriesAvailable, subjectTeam.get(`${g.id}|${best.subjectId}`));
    if (!e) continue;
    const implied = impliedProb(bestEff);
    const ev = expectedValue(e.modelProb, bestEff);
    const id = k.replaceAll("|", "_");
    const bet: BetEval = {
      ...e,
      id,
      gameId: g.id,
      gameLabel: `${teams.get(g.away_id)?.abbr ?? "?"} @ ${teams.get(g.home_id)?.abbr ?? "?"}`,
      tipoff: g.date,
      market: best.market,
      marketLabel: MARKET_LABEL[best.market],
      marketType: best.kind,
      side: best.side,
      line: best.line,
      book: best.bookTitle,
      price: bestEff,
      priceRaw: best.dec,
      taxed: bestEff !== best.dec,
      offers: grp.map((o) => ({ book: o.bookTitle, bookKey: o.book, dec: o.dec, eff: eff(o), oppDec: o.oppDec })).sort((a, b) => b.eff - a.eff),
      impliedProb: implied,
      marketProb,
      marketProbSource,
      edge: e.modelProb - implied,
      edgeVsFair: marketProb === null ? null : e.modelProb - marketProb,
      ev,
      fairOdds: fairOdds(e.modelProb),
      kellyQuarter: kelly(e.modelProb, bestEff) / 4,
      openLine: best.openLine,
      openPrice: best.openPrice,
      isValue: false,
    };
    if (best.sideCheck === "order-assumed") {
      bet.confidenceScore -= 5;
      bet.warnings.push("Over/Under sides inferred from DraftKings feed order (not cross-verified for this line)");
    }
    if (best.kind === "milestone" || best.kind === "yes") bet.warnings.push("One-way market: no-vig probability is an estimate");
    if (best.openLine !== null && best.line !== null && best.openLine !== best.line)
      bet.reasons.push(`Line moved ${best.openLine} → ${best.line} since open`);
    if (!evidence[bet.kind].proven) {
      bet.confidenceScore = Math.min(bet.confidenceScore, 45);
      bet.warnings.unshift(`Evidence gate: ${evidence[bet.kind].detail} — the model has not shown an edge over the market for this bet type.`);
    }
    bet.confidence = bet.confidenceScore >= 75 ? "High" : bet.confidenceScore >= 50 ? "Medium" : "Low";
    bet.isValue = bet.ev > 0 && bet.confidence !== "Low";
    bets.push(bet);
  }
  bets.sort((a, b) => b.ev - a.ev);
  try {
    logPredictions(bets);
  } catch (e) {
    warnings.push(`could not log predictions: ${(e as Error).message}`);
  }

  return {
    day,
    generatedAt: Date.now(),
    games: games.map((g) => ({ ...g, home: teams.get(g.home_id), away: teams.get(g.away_id), projection: gameProj.get(g.id) ?? null })),
    bets,
    injuries,
    injuriesAvailable,
    calibration: cal,
    sources,
    warnings,
    playersAnalyzed: projections.size,
    projections,
    evidence,
  };
}

type EvalCore = Pick<BetEval, "kind" | "subjectId" | "subjectName" | "teamId" | "teamAbbr" | "oppAbbr" | "selection" | "rawProb" | "modelProb" | "pLow" | "pHigh" | "projection" | "hitRates" | "confidence" | "confidenceScore" | "reasons" | "warnings">;

function evalPlayer(
  o: Offer,
  g: GameRow,
  proj: PlayerProjection | undefined,
  ctx: LeagueContext,
  teams: Map<string, TeamRow>,
  cal: Calibration,
  marketProb: number | null,
  injOf: Map<string, Injury>,
  injuriesAvailable: boolean,
  playerTeam: string | undefined,
): EvalCore | null {
  if (!proj || !playerTeam) return null;
  const market = o.market as PlayerMarket;
  const line = o.line ?? 0.5;
  const pr = probOver(proj, market, line);
  const isUnder = o.side === "under";
  const raw = isUnder ? 1 - pr.p : pr.p;
  const pLow = isUnder ? 1 - pr.pHigh : pr.pLow;
  const pHigh = isUnder ? 1 - pr.pLow : pr.pHigh;
  const modelProb = applyCalibration(cal, raw, marketProb);
  const dist = distribution(proj, market);
  const rows = ctx.playerGames(o.subjectId);
  const hr = (n: number) => {
    const h = lineHistory(rows, market, line, n);
    const hits = isUnder ? h.games.filter((x) => x.value < line).length : h.hits;
    return h.n ? `${hits}/${h.n}` : "—";
  };
  const oppId = playerTeam === g.home_id ? g.away_id : g.home_id;
  const opp = teams.get(oppId);
  const parts: StatKey[] = market in COMBOS ? COMBOS[market as keyof typeof COMBOS] : market === "dd" || market === "td" ? ["pts", "reb", "ast"] : [market as StatKey];
  const wsum = parts.reduce((s, k) => s + proj.stats[k].mean, 0) || 1;
  const oppF = parts.reduce((s, k) => s + proj.stats[k].factors.opponent * proj.stats[k].mean, 0) / wsum;
  const paceF = proj.stats.pts.factors.pace;

  const reasons: string[] = [];
  const side = o.side === "yes" ? "Yes" : isUnder ? "Under" : "Over";
  const label = MARKET_LABEL[market];
  reasons.push(
    market === "dd" || market === "td"
      ? `Simulated ${label.toLowerCase()} rate ${(pr.p * 100).toFixed(0)}% from ${proj.minutes.mean.toFixed(1)} projected minutes`
      : `Projection ${dist.mean.toFixed(1)} ${label.toLowerCase()} (80% range ${dist.p10}–${dist.p90}) vs line ${line}`,
  );
  reasons.push(`${side} hit ${hr(10)} last 10 · ${hr(5)} last 5 · ${hr(82)} season`);
  reasons.push(`${proj.minutes.mean.toFixed(1)} min projected (±${proj.minutes.sd.toFixed(1)})`);
  if (Math.abs(oppF - 1) >= 0.03)
    reasons.push(`${opp?.abbr ?? "Opponent"} ${oppF > 1 ? "allows" : "limits"} ${label.toLowerCase()} to ${proj.pos === "G" ? "guards" : proj.pos === "F" ? "forwards" : "centers"}: ${oppF > 1 ? "+" : ""}${((oppF - 1) * 100).toFixed(0)}% per possession`);
  if (Math.abs(paceF - 1) >= 0.015) reasons.push(`Pace ${paceF > 1 ? "boost" : "drag"} ${((paceF - 1) * 100).toFixed(1)}% (${opp?.abbr} ${ctx.teams.get(oppId)?.pace.toFixed(1)} poss/48)`);
  for (const t of proj.teammateEffects) {
    if (t.method === "already-absent") continue;
    reasons.push(`${t.name} ${t.status}: ${t.minutes >= 0 ? "+" : ""}${t.minutes.toFixed(1)} min (${t.method === "with/without" ? `with/without split, ${t.nWithout} g` : "redistribution heuristic"})`);
  }
  reasons.push(...proj.notes);
  if (marketProb !== null) reasons.push(`Raw model ${(raw * 100).toFixed(1)}% · market no-vig ${(marketProb * 100).toFixed(1)}% · calibrated ${(modelProb * 100).toFixed(1)}%`);

  const warnings = [...proj.warnings];
  let score = 100;
  if (proj.games < 5) score -= 40;
  else if (proj.games < 10) score -= 20;
  else if (proj.games < 15) score -= 8;
  const width = pHigh - pLow;
  if (width > 0.25) score -= 30;
  else if (width > 0.18) score -= 15;
  if (marketProb !== null && Math.abs(raw - marketProb) > 0.15) {
    score -= 35;
    warnings.push("Model and market disagree by >15 pp — likely information the model lacks (news, role change). Verify before betting.");
  }
  const self = injOf.get(o.subjectId)?.status;
  if (self === "QUESTIONABLE" || self === "DAY-TO-DAY") score -= 25;
  if (self === "DOUBTFUL" || self === "OUT") score -= 70;
  const uncertainMates = proj.teammateEffects.filter((t) => ["QUESTIONABLE", "DAY-TO-DAY", "DOUBTFUL"].includes(t.status)).length;
  score -= Math.min(20, uncertainMates * 10);
  if (uncertainMates) warnings.push(`${uncertainMates} rotation teammate(s) uncertain — role may change at tip-off`);
  if (proj.teammateEffects.some((t) => t.method === "heuristic")) score -= 10;
  if (!cal.fittedAt) score -= 10;
  if (!injuriesAvailable) score = Math.min(score, 40);

  return {
    kind: "player",
    subjectId: o.subjectId,
    subjectName: proj.name,
    teamId: playerTeam,
    teamAbbr: teams.get(playerTeam)?.abbr ?? "",
    oppAbbr: opp?.abbr ?? "",
    selection: o.side === "yes" ? `${label} — Yes` : `${side} ${line} ${label}`,
    rawProb: raw,
    modelProb,
    pLow,
    pHigh,
    projection: market === "dd" || market === "td" ? null : { mean: dist.mean, median: dist.median, p10: dist.p10, p90: dist.p90 },
    hitRates: { l5: hr(5), l10: hr(10), l20: hr(20), season: hr(82) },
    confidence: "Medium",
    confidenceScore: score,
    reasons,
    warnings,
  };
}

function evalGame(o: Offer, g: GameRow, gp: GameProjection | null, teams: Map<string, TeamRow>, cal: Calibration, marketProb: number | null): EvalCore | null {
  if (!gp) return null;
  const home = teams.get(g.home_id);
  const away = teams.get(g.away_id);
  let raw: number;
  let selection: string;
  let subjectName: string;
  let teamId = o.subjectId;
  const sdM = gp.marginSd;
  if (o.market === "ml") {
    raw = o.side === "home" ? gp.homeWinProb : 1 - gp.homeWinProb;
    subjectName = (o.side === "home" ? home : away)?.name ?? "";
    selection = `${(o.side === "home" ? home : away)?.abbr} Moneyline`;
  } else if (o.market === "spread") {
    const homeLine = o.side === "home" ? o.line! : -o.line!;
    const pHome = pHomeCovers(gp, homeLine);
    raw = o.side === "home" ? pHome : 1 - pHome;
    subjectName = (o.side === "home" ? home : away)?.name ?? "";
    selection = `${(o.side === "home" ? home : away)?.abbr} ${o.line! > 0 ? "+" : ""}${o.line}`;
  } else {
    const pOver = pOverTotal(gp, o.line!);
    raw = o.side === "over" ? pOver : 1 - pOver;
    subjectName = `${away?.abbr} @ ${home?.abbr}`;
    selection = `${o.side === "over" ? "Over" : "Under"} ${o.line} Total Points`;
    teamId = g.home_id;
  }
  // parameter uncertainty: ±1 SE of the projected mean (team ratings from limited games)
  const n = Math.min(gp.sample.home, gp.sample.away);
  const se = (o.market === "total" ? gp.totalSd : sdM) / Math.sqrt(Math.max(1, n));
  const sd = o.market === "total" ? gp.totalSd : sdM;
  const dz = (1.28 * se) / sd;
  const z = Math.log(raw / (1 - raw));
  const pLow = 1 / (1 + Math.exp(-(z - dz * 1.6)));
  const pHigh = 1 / (1 + Math.exp(-(z + dz * 1.6)));
  const modelProb = applyCalibration(cal, raw, marketProb);
  const reasons = [
    `Projected ${away?.abbr} ${gp.awayPts.toFixed(1)} – ${home?.abbr} ${gp.homePts.toFixed(1)} (margin ${gp.margin > 0 ? home?.abbr : away?.abbr} by ${Math.abs(gp.margin).toFixed(1)}, total ${gp.total.toFixed(1)})`,
    `${gp.possessions.toFixed(1)} projected possessions · margin σ ${gp.marginSd.toFixed(1)} · total σ ${gp.totalSd.toFixed(1)}`,
    ...gp.injuryAdj.map((i) => `${i.name} out: ${teams.get(i.teamId)?.abbr} ${i.pts.toFixed(1)} pts (heuristic)`),
    ...gp.restNote,
  ];
  if (marketProb !== null) reasons.push(`Raw model ${(raw * 100).toFixed(1)}% · market no-vig ${(marketProb * 100).toFixed(1)}% · calibrated ${(modelProb * 100).toFixed(1)}%`);
  const warnings: string[] = [];
  let score = 85;
  if (n < 8) score -= 25;
  if (marketProb !== null && Math.abs(raw - marketProb) > 0.12) {
    score -= 35;
    warnings.push("Large model/market disagreement — team-level models miss lineup news; verify.");
  }
  if (!cal.fittedAt) score -= 10;
  return {
    kind: "game", subjectId: o.subjectId, subjectName, teamId, teamAbbr: teams.get(teamId)?.abbr ?? "",
    oppAbbr: teams.get(teamId === g.home_id ? g.away_id : g.home_id)?.abbr ?? "",
    selection, rawProb: raw, modelProb, pLow, pHigh,
    projection: o.market === "total" ? { mean: gp.total, median: gp.total, p10: gp.total - 1.28 * gp.totalSd, p90: gp.total + 1.28 * gp.totalSd } : o.market === "spread" ? { mean: gp.margin, median: gp.margin, p10: gp.margin - 1.28 * sdM, p90: gp.margin + 1.28 * sdM } : null,
    hitRates: null, confidence: "Medium", confidenceScore: score, reasons, warnings,
  };
}

export { BASE_STATS, posGroup };
