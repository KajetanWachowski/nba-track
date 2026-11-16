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
import { assessGame, assessPlayer, type Assessment } from "./assess";
import { getMeta, setMeta } from "./db";
import { effectivePrice, getTaxSettings, isPolishBook } from "./books";
import { choosePrice } from "./pricing";
import { explainProjection } from "./model/explain";
import { listManual, manualToOffers } from "./manual-odds";
import { fetchPolishOffers, getUsage as getPapiUsage, oddsPapiEnabled } from "./providers/oddspapi";
import { logPredictions } from "./tracking";
import { recordDailyPicks } from "./daily-picks";

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
  selection: string; // np. "Powyżej 11.5 · Zbiórki"
  book: string;
  /** kurs użyty do EV: Superbet → najlepszy polski → (tylko orientacyjnie) referencyjny USA; po podatku, jeśli włączony */
  price: number;
  priceRaw: number;
  taxed: boolean;
  /** true gdy kurs pochodzi od polskiego bukmachera (można go zagrać w Polsce) */
  playable: boolean;
  priceSource: "superbet" | "polski" | "referencja";
  priceSeenAt: number | null;
  priceManual: boolean;
  superbetPrice: number | null;
  bestPl: { book: string; price: number; ev: number } | null;
  referencePrice: { book: string; price: number } | null;
  offers: { book: string; bookKey: string; dec: number; eff: number; oppDec: number | null; polish: boolean; source: "api" | "manual"; seenAt: number | null }[];
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
  assessment: Assessment;
  /** inne linie tego samego zawodnika, rynku i strony — do wyboru linii (szansa vs kurs) */
  alternatives?: { line: number | null; prob: number; price: number; book: string; playable: boolean; ev: number; category: string; current: boolean }[];
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
    sources.push({ name: "ESPN: mecze + kursy DraftKings", fetchedAt: Math.min(s.scoreboardFetchedAt, s.propsFetchedAt), ok: !s.stale, note: s.stale ? "błąd sieci — pokazuję zapisane dane" : undefined });
    for (const e of s.errors) warnings.push(e);
  } catch (e) {
    sources.push({ name: "ESPN: mecze + kursy DraftKings", fetchedAt: null, ok: false, note: (e as Error).message });
    warnings.push(`Nie udało się odświeżyć meczów (${(e as Error).message}) — pokazuję zapisane dane.`);
  }

  let injuries: Injury[] = [];
  let injuriesAvailable = true;
  try {
    const r = await fetchInjuries();
    injuries = r.injuries;
    sources.push({ name: "ESPN: raport kontuzji", fetchedAt: r.fetchedAt, ok: !r.stale });
  } catch (e) {
    injuriesAvailable = false;
    sources.push({ name: "ESPN: raport kontuzji", fetchedAt: null, ok: false, note: (e as Error).message });
    warnings.push("Raport kontuzji jest niedostępny — jakość danych dla wszystkich zakładów na zawodników obniżona.");
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
        ? "nie uruchomiono jeszcze backtestu"
        : `log-loss modelu ${m.logLossCal.toFixed(4)} vs rynku ${m.logLossMarket.toFixed(4)} poza próbą, n=${m.n}`,
    };
    if (!proven) warnings.push(`${k === "player" ? "Zakłady na zawodników" : "Linie meczowe (zwycięzca, handicap, suma)"}: brak rekomendacji — ${evidence[k].detail}${m ? "; model nie był tu lepszy od rynku" : ""}.`);
  }
  if (!cal.player.fittedAt) warnings.push("Prawdopodobieństwa nie są skalibrowane — uruchom backtest (Historia wyników → Uruchom backtest).");

  // ---- offers: DraftKings via ESPN always; other books via The Odds API when configured ----
  const offers: (Offer & { kind: BetEval["marketType"]; openLine: number | null; openPrice: number | null; sideCheck: string; seenAt?: number | null; source?: "api" | "manual" })[] = [];
  const rosterTeam = new Map<string, string>();
  const rosterName = new Map<string, string>();
  await mapLimit([...new Set(games.flatMap((g) => [g.home_id, g.away_id]))], 4, async (t) => {
    try {
      for (const p of await fetchRoster(t)) {
        rosterTeam.set(p.athleteId, t);
        rosterName.set(p.athleteId, p.name);
      }
    } catch (e) {
      warnings.push(`skład ${teams.get(t)?.abbr ?? t}: ${(e as Error).message}`);
    }
  });

  for (const g of games) {
    for (const l of getPropLines(g.id)) {
      if (l.book !== "draftkings") continue;
      const base = { gameId: g.id, market: l.market as Market, subjectId: l.athlete_id, book: "draftkings", bookTitle: "DraftKings", lastUpdate: l.updated_at, kind: l.kind, sideCheck: l.side_check, seenAt: l.fetched_at, source: "api" as const };
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
      const base = { gameId: g.id, book: "draftkings", bookTitle: "DraftKings", lastUpdate: null, kind: "game" as const, sideCheck: "n/a", seenAt: gl.fetched_at, source: "api" as const };
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
            offers.push({ ...o, kind: "game", openLine: null, openPrice: null, sideCheck: "labeled", seenAt: go.fetchedAt, source: "api" });
        const g = games.find((x) => x.id === ref.gameId);
        if (g?.state === "pre") {
          const pr = await fetchEventProps(ev.id);
          fetchedAt = Math.min(fetchedAt, pr.fetchedAt);
          for (const o of eventToOffers(pr.event, ref, playerIndex))
            if (o.book !== "draftkings") // DraftKings props already come from ESPN
              offers.push({ ...o, kind: o.side === "yes" ? "yes" : "ou", openLine: null, openPrice: null, sideCheck: "labeled", seenAt: pr.fetchedAt, source: "api" });
        }
      }
      sources.push({ name: "The Odds API (multi-book)", fetchedAt, ok: true });
    } catch (e) {
      const msg = e instanceof DataUnavailableError ? e.message : String(e);
      sources.push({ name: "The Odds API (multi-book)", fetchedAt: null, ok: false, note: msg });
      warnings.push(`The Odds API: błąd — ${msg}`);
    }
  } else {
    sources.push({ name: "The Odds API (bukmacherzy zagraniczni)", fetchedAt: null, ok: false, note: "wyłączone (brak ODDS_API_KEY)" });
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
      // Page renders never spend OddsPapi requests: cached odds only, unless auto-refresh is configured.
      const u = getPapiUsage();
      const auto = config.oddsPapiAutoRefreshMin > 0 && (!u.lastRefresh || Date.now() - u.lastRefresh > config.oddsPapiAutoRefreshMin * 60_000);
      const r = await fetchPolishOffers(refs, playerIndex, rosterTeam, auto);
      for (const o of r.offers) {
        if (manualKeys.has(`${o.gameId}|${o.market}|${o.subjectId}|${o.side}|${o.line ?? ""}|${o.book}`)) continue; // manual entry wins
        if (o.kind === "milestone" && (o.dec < 1.25 || o.dec > 6)) continue; // extreme ladder rungs carry heavy, unknown vig
        offers.push({ ...o, openLine: null, openPrice: null, sideCheck: "labeled", seenAt: r.fetchedAt || null, source: "api" });
      }
      sources.push(
        r.notFetched && !r.offers.length
          ? { name: "OddsPapi (polscy bukmacherzy)", fetchedAt: null, ok: false, note: "nie pobrano — kliknij „Pobierz kursy” na stronie Polskie kursy" }
          : { name: "OddsPapi (polscy bukmacherzy)", fetchedAt: r.fetchedAt || null, ok: true, note: `${r.books.join(", ") || "brak kursów"} · ${r.matchedFixtures} meczów` },
      );
      if (r.errors.length) warnings.push(`OddsPapi: część zapytań odrzucona — ${[...new Set(r.errors)].slice(0, 3).join(" · ")}`);
      if (r.foreignPlayers) warnings.push(`OddsPapi: pominięto ${r.foreignPlayers} kursów na zawodników spoza składów obu drużyn (błąd w danych bukmachera).`);
    } catch (e) {
      sources.push({ name: "OddsPapi (polscy bukmacherzy)", fetchedAt: null, ok: false, note: (e as Error).message });
      warnings.push(`OddsPapi: błąd — ${(e as Error).message}`);
    }
  }
  for (const o of manual) offers.push({ ...o, openLine: null, openPrice: null, sideCheck: "manual", seenAt: Date.parse(o.lastUpdate ?? "") || null, source: "manual" });
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
  const gameProj = new Map<string, GameProjection | null>();
  for (const g of games) {
    const abs: GameAbsence[] = injuries
      .filter((i) => [g.home_id, g.away_id].includes(rosterTeam.get(i.athleteId) ?? i.teamId))
      .map((i) => ({ athleteId: i.athleteId, name: i.name, teamId: rosterTeam.get(i.athleteId) ?? i.teamId, pOut: P_OUT[i.status] ?? 0.25 }));
    gameProj.set(g.id, projectGame(ctx, g.home_id, g.away_id, abs, { home: restDays(ctx, g.home_id, day), away: restDays(ctx, g.away_id, day) }));
  }

  // Expected margin for blowout risk: the market spread when available (more accurate than our
  // team model in backtests), otherwise the model's margin.
  const expectedMargin = (g: GameRow): number | undefined => {
    const gl = getGameLine(g.id);
    if (gl?.spread_home !== null && gl?.spread_home !== undefined) return -gl.spread_home;
    return gameProj.get(g.id)?.margin;
  };

  const projections = new Map<string, PlayerProjection>();
  const params = getModelParams();
  const subjectTeam = new Map<string, string>();
  const priorByAthlete = new Map<string, number>();
  const priorLogs = new Map<string, Awaited<ReturnType<typeof fetchSeasonLog>>>();
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
    priorByAthlete.set(athleteId, prior.filter((r) => r.min > 0).length);
    priorLogs.set(athleteId, prior);
    const absences: TeammateAbsence[] = (injByTeam.get(teamId) ?? [])
      .filter((i) => i.athleteId !== athleteId)
      .map((i) => ({ athleteId: i.athleteId, name: i.name, pOut: P_OUT[i.status] ?? 0.25, status: i.status }));
    const proj = projectPlayer(ctx, athleteId, {
      day, teamId, oppId, home, restDays: restDays(ctx, teamId, day), absences,
      selfStatus: injOf.get(athleteId)?.status ?? null, priorSeason: prior, sims: 8000, params,
      gameMargin: expectedMargin(g), marginSd: ctx.marginSd,
      oppAbsences: (injByTeam.get(oppId) ?? []).map((i) => ({ athleteId: i.athleteId, name: i.name, pOut: P_OUT[i.status] ?? 0.25, status: i.status })),
    });
    if (proj) {
      subjectTeam.set(k, teamId);
      if (!proj.name) proj.name = rosterName.get(athleteId) ?? athleteId;
      projections.set(k, proj);
    }
  });

  // ---- group offers into bets and evaluate ----
  const groups = new Map<string, typeof offers>();
  for (const o of offers) {
    if (!(o.dec > 1)) continue;
    const k = `${o.gameId}|${o.market}|${o.subjectId}|${o.side}|${o.line ?? ""}`;
    if (!groups.has(k)) groups.set(k, []);
    const grp = groups.get(k)!;
    // One price per book: the same bet can be listed twice (e.g. O/U 12.5 and the "13+" ladder).
    // Keep the higher price; on a tie prefer the two-way quote, which allows de-vigging.
    const i = grp.findIndex((x) => x.book === o.book);
    if (i < 0) grp.push(o);
    else if (o.dec > grp[i].dec || (o.dec === grp[i].dec && o.oppDec && !grp[i].oppDec)) grp[i] = o;
  }
  const bets: BetEval[] = [];
  const blendW = getMeta<Record<string, number>>("projectionBlend") ?? {};
  const marketProven = (market: string, kind: "player" | "game") => {
    const m = bt?.byMarket?.[market];
    if (m && m.n >= 100) {
      const better = m.logLossCal < m.logLossMarket;
      return { proven: better, detail: `log-loss modelu ${m.logLossCal.toFixed(4)} vs rynku ${m.logLossMarket.toFixed(4)}, n=${m.n}` };
    }
    return { proven: false, detail: kind === "player" && evidence.player.proven ? "brak osobnej weryfikacji tego rynku w backteście" : evidence[kind].detail };
  };
  for (const [k, grp] of groups) {
    const g = gameById.get(grp[0].gameId);
    if (!g || g.state !== "pre") continue;
    // Prices: Superbet first, then the best Polish book; US books are a reference only and never
    // the price a Polish bettor can take. Optional stake tax applies to Polish books.
    const eff = (o: (typeof grp)[number]) => effectivePrice(o.book, o.dec, tax);
    const { superbet, bestPl, reference, priceOffer, playable } = choosePrice(grp, eff);
    if (!priceOffer) continue;
    const price = eff(priceOffer);
    const sharp =
      grp.find((o) => o.book === "pinnacle" && o.oppDec) ?? grp.find((o) => o.book === "draftkings" && o.oppDec) ?? grp.find((o) => o.book === "superbet" && o.oppDec) ?? grp.find((o) => o.oppDec);
    let marketProb: number | null = null;
    let marketProbSource = "";
    if (sharp?.oppDec) {
      marketProb = noVig([sharp.dec, sharp.oppDec])[0];
      marketProbSource = `${sharp.bookTitle}: kursy na obie strony, marża usunięta (metoda potęgowa)`;
    } else {
      marketProb = Math.min(0.99, impliedProb(sharp?.dec ?? priceOffer.dec) / typicalOverround);
      marketProbSource = `rynek jednostronny — marża szacowana na ${((typicalOverround - 1) * 100).toFixed(1)}% na podstawie dzisiejszych rynków`;
    }
    const e = isGameMarket(priceOffer.market)
      ? evalGame(priceOffer, g, gameProj.get(g.id) ?? null, teams, cal.game, marketProb)
      : evalPlayer(priceOffer, g, projections.get(`${g.id}|${priceOffer.subjectId}`), ctx, teams, cal.player, marketProb, injOf, injuriesAvailable, subjectTeam.get(`${g.id}|${priceOffer.subjectId}`));
    if (!e) continue;
    const implied = impliedProb(price);
    const ev = expectedValue(e.modelProb, price);
    const now = Date.now();
    const ageMin = (o: (typeof grp)[number]) => (o.seenAt ? (now - o.seenAt) / 60000 : null);
    const offerList = grp
      .map((o) => ({ book: o.bookTitle, bookKey: o.book, dec: o.dec, eff: eff(o), oppDec: o.oppDec, polish: isPolishBook(o.book), source: o.source ?? "api", seenAt: o.seenAt ?? null }))
      .sort((a, b) => Number(b.polish) - Number(a.polish) || (a.bookKey === "superbet" ? -1 : b.bookKey === "superbet" ? 1 : b.eff - a.eff));
    const bet: BetEval = {
      ...e,
      id: k.replaceAll("|", "_"),
      gameId: g.id,
      gameLabel: `${teams.get(g.away_id)?.abbr ?? "?"} @ ${teams.get(g.home_id)?.abbr ?? "?"}`,
      tipoff: g.date,
      market: priceOffer.market,
      marketLabel: MARKET_LABEL[priceOffer.market],
      marketType: priceOffer.kind,
      side: priceOffer.side,
      line: priceOffer.line,
      book: priceOffer.bookTitle,
      price,
      priceRaw: priceOffer.dec,
      taxed: price !== priceOffer.dec,
      playable,
      priceSource: superbet ? "superbet" : bestPl ? "polski" : "referencja",
      priceSeenAt: priceOffer.seenAt ?? null,
      priceManual: priceOffer.source === "manual",
      superbetPrice: superbet ? eff(superbet) : null,
      bestPl: bestPl ? { book: bestPl.bookTitle, price: eff(bestPl), ev: expectedValue(e.modelProb, eff(bestPl)) } : null,
      referencePrice: reference ? { book: reference.bookTitle, price: reference.dec } : null,
      offers: offerList,
      impliedProb: implied,
      marketProb,
      marketProbSource,
      edge: e.modelProb - implied,
      edgeVsFair: marketProb === null ? null : e.modelProb - marketProb,
      ev,
      fairOdds: fairOdds(e.modelProb),
      kellyQuarter: kelly(e.modelProb, price) / 4,
      openLine: priceOffer.openLine,
      openPrice: priceOffer.openPrice,
      isValue: false,
      assessment: null as unknown as Assessment,
    };
    const lineMovedAgainst =
      priceOffer.openLine !== null && priceOffer.line !== null && priceOffer.openLine !== priceOffer.line &&
      ((priceOffer.side === "over" && priceOffer.line > priceOffer.openLine) || (priceOffer.side === "under" && priceOffer.line < priceOffer.openLine));
    const manualPrice = priceOffer.source === "manual" ? { ageMin: ageMin(priceOffer) ?? 0 } : null;
    if (bet.kind === "player") {
      const proj = projections.get(`${g.id}|${bet.subjectId}`)!;
      const teamId = subjectTeam.get(`${g.id}|${bet.subjectId}`)!;
      const home = teamId === g.home_id;
      const oppId = home ? g.away_id : g.home_id;
      bet.assessment = assessPlayer({
        market: bet.market as PlayerMarket, side: bet.side as "over" | "under" | "yes", line: bet.line ?? 0.5,
        modelProb: bet.modelProb, rawProb: bet.rawProb, pLow: bet.pLow, pHigh: bet.pHigh, marketProb, ev, edge: bet.edge, edgeVsFair: bet.edgeVsFair,
        price, playable, manualPrice, staleMin: manualPrice ? null : ageMin(priceOffer), oneWay: !sharp?.oppDec, lineMovedAgainst,
        history: ctx.playerGames(bet.subjectId), teamRecentGameIds: ctx.teamGames(teamId).map((r) => r.game_id),
        proj, ctx, oppId, oppAbbr: teams.get(oppId)?.abbr ?? "", teamAbbrById: (id) => teams.get(id)?.abbr ?? "", home,
        restDays: restDays(ctx, teamId, day), selfStatus: injOf.get(bet.subjectId)?.status ?? null, injuriesAvailable,
        calibrated: Boolean(cal.player.fittedAt), marketProven: marketProven(bet.market, "player"), hasPriorSeason: (priorByAthlete.get(bet.subjectId) ?? 0) >= 10,
        prior: priorLogs.get(bet.subjectId), projectionWeight: blendW[bet.market] ?? 1,
        projSd: bet.projection ? (bet.projection.p90 - bet.projection.p10) / 2.563 : undefined,
      });
      if (bet.assessment.stats && bet.projection) {
        bet.assessment.stats.projection = { mean: bet.projection.mean, p10: bet.projection.p10, p90: bet.projection.p90 };
        bet.assessment.stats.explain = explainProjection({
          market: bet.market as PlayerMarket, proj, simMean: bet.projection.mean, history: ctx.playerGames(bet.subjectId), prior: priorLogs.get(bet.subjectId),
          ctx, oppId, oppAbbr: teams.get(oppId)?.abbr ?? "", home,
        });
      }
    } else {
      const gp = gameProj.get(g.id)!;
      bet.assessment = assessGame({
        modelProb: bet.modelProb, rawProb: bet.rawProb, pLow: bet.pLow, pHigh: bet.pHigh, marketProb, ev, edge: bet.edge, edgeVsFair: bet.edgeVsFair,
        price, playable, manualPrice, staleMin: manualPrice ? null : ageMin(priceOffer), sample: Math.min(gp.sample.home, gp.sample.away),
        injuryNotes: gp.injuryAdj.map((i) => `${i.name} nie zagra: ${teams.get(i.teamId)?.abbr} ${i.pts.toFixed(1)} pkt (szacunek heurystyczny).`),
        restNotes: gp.restNote.map((r) => (r.startsWith("home") ? "Gospodarze grają drugi mecz dzień po dniu." : "Goście grają drugi mecz dzień po dniu.")),
        calibrated: Boolean(cal.game.fittedAt), marketProven: marketProven(bet.market, "game"),
      });
    }
    const a = bet.assessment;
    bet.isValue = a.category === "najlepsze" || a.category === "dobre";
    bet.confidence = a.quality.level === "wysoka" ? "High" : a.quality.level === "średnia" ? "Medium" : "Low";
    bet.confidenceScore = a.quality.score;
    bets.push(bet);
  }
  // line chooser: all lines of the same player / market / side, e.g. Over 10.5 / 11.5 / 12.5 rebounds
  const ladder = new Map<string, BetEval[]>();
  for (const b of bets) {
    if (b.kind !== "player" || b.side === "yes") continue;
    const k = `${b.gameId}|${b.subjectId}|${b.market}|${b.side}`;
    if (!ladder.has(k)) ladder.set(k, []);
    ladder.get(k)!.push(b);
  }
  for (const list of ladder.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((x, y) => (x.line ?? 0) - (y.line ?? 0));
    for (const b of list)
      b.alternatives = sorted.map((o) => ({
        line: o.line, prob: o.modelProb, price: o.price, book: o.book, playable: o.playable, ev: o.ev, category: o.assessment.category, current: o === b,
      }));
  }
  bets.sort((a, b) => b.assessment.rankScore - a.assessment.rankScore);
  try {
    logPredictions(bets);
  } catch (e) {
    warnings.push(`nie udało się zapisać typów: ${(e as Error).message}`);
  }
  try {
    recordDailyPicks(day, bets);
  } catch (e) {
    warnings.push(`nie udało się zapisać typów dnia: ${(e as Error).message}`);
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
  const side = o.side === "yes" ? "Tak" : isUnder ? "Poniżej" : "Powyżej";
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
    warnings.push("Model i rynek różnią się o ponad 15 pp — prawdopodobnie brakuje informacji (newsy, zmiana roli).");
  }
  const self = injOf.get(o.subjectId)?.status;
  if (self === "QUESTIONABLE" || self === "DAY-TO-DAY") score -= 25;
  if (self === "DOUBTFUL" || self === "OUT") score -= 70;
  const uncertainMates = proj.teammateEffects.filter((t) => ["QUESTIONABLE", "DAY-TO-DAY", "DOUBTFUL"].includes(t.status)).length;
  score -= Math.min(20, uncertainMates * 10);
  if (uncertainMates) warnings.push(`${uncertainMates} zawodnik(ów) rotacji z niepewnym statusem`);
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
    selection: o.side === "yes" ? `${label} — Tak` : `${side} ${line} · ${label}`,
    rawProb: raw,
    modelProb,
    // the uncertainty band goes through the same (monotonic) calibration as the point estimate
    pLow: applyCalibration(cal, pLow, marketProb),
    pHigh: applyCalibration(cal, pHigh, marketProb),
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
    selection = `Zwycięstwo ${(o.side === "home" ? home : away)?.abbr}`;
  } else if (o.market === "spread") {
    const homeLine = o.side === "home" ? o.line! : -o.line!;
    const pHome = pHomeCovers(gp, homeLine);
    raw = o.side === "home" ? pHome : 1 - pHome;
    subjectName = (o.side === "home" ? home : away)?.name ?? "";
    selection = `Handicap ${(o.side === "home" ? home : away)?.abbr} ${o.line! > 0 ? "+" : ""}${o.line}`;
  } else {
    const pOver = pOverTotal(gp, o.line!);
    raw = o.side === "over" ? pOver : 1 - pOver;
    subjectName = `${away?.abbr} @ ${home?.abbr}`;
    selection = `${o.side === "over" ? "Powyżej" : "Poniżej"} ${o.line} pkt w meczu`;
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
    warnings.push("Duża różnica model/rynek — model drużynowy nie widzi zmian w składach.");
  }
  if (!cal.fittedAt) score -= 10;
  return {
    kind: "game", subjectId: o.subjectId, subjectName, teamId, teamAbbr: teams.get(teamId)?.abbr ?? "",
    oppAbbr: teams.get(teamId === g.home_id ? g.away_id : g.home_id)?.abbr ?? "",
    selection, rawProb: raw, modelProb, pLow: applyCalibration(cal, pLow, marketProb), pHigh: applyCalibration(cal, pHigh, marketProb),
    projection: o.market === "total" ? { mean: gp.total, median: gp.total, p10: gp.total - 1.28 * gp.totalSd, p90: gp.total + 1.28 * gp.totalSd } : o.market === "spread" ? { mean: gp.margin, median: gp.margin, p10: gp.margin - 1.28 * sdM, p90: gp.margin + 1.28 * sdM } : null,
    hitRates: null, confidence: "Medium", confidenceScore: score, reasons, warnings,
  };
}

export { BASE_STATS, posGroup };
