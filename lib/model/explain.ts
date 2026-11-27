/**
 * „Skąd ta projekcja?” — rozkład projekcji na proste kroki w jednostkach statystyki.
 *
 *   średnia sezonu → forma / poprzedni sezon → minuty → obrona rywala → tempo → dom/wyjazd
 *   → nieobecności kolegów → mecze z tym rywalem → rozrzut i blowout = projekcja
 *
 * Kroki sumują się dokładnie do średniej z symulacji. Każdy krok ma zdanie po polsku bez żargonu,
 * a obrona rywala jest opisana miejscem w lidze (1 = najlepiej broni).
 */
import { COMBOS, MARKET_LABEL, type PlayerMarket, type StatKey } from "../markets";
import type { SeasonLogGame } from "../providers/espn";
import type { PlayerGameRow } from "../store";
import type { LeagueContext, PosGroup } from "./context";
import type { PlayerProjection } from "./player";
import { mean } from "./stats";

export interface ExplainStep {
  key: "base" | "form" | "prior" | "debias" | "minutes" | "opponent" | "oppMissing" | "pace" | "home" | "teammates" | "h2h" | "spread";
  label: string;
  text: string;
  delta: number; // w jednostkach statystyki (np. punktach); dla „base” — wartość startowa
}

export interface Explanation {
  steps: ExplainStep[];
  start: number;
  projection: number;
  /** krótkie zdania o rywalu z miejscami w lidze */
  opponent: string[];
  headline: string;
}

const POS_PL: Record<PosGroup, string> = { G: "obrońcom", F: "skrzydłowym", C: "środkowym" };
const NOUN: Record<string, string> = {
  pts: "punktów", reb: "zbiórek", ast: "asyst", fg3m: "trójek", stl: "przechwytów", blk: "bloków", tov: "strat",
  pra: "pkt+zb+as", pr: "pkt+zb", pa: "pkt+as", ra: "zb+as", stocks: "przechwytów+bloków",
};
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const sgn = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`;
const ord = (n: number) => `${n}.`;

export function partsOf(market: PlayerMarket): StatKey[] {
  if (market in COMBOS) return COMBOS[market as keyof typeof COMBOS];
  if (market === "dd" || market === "td") return ["pts", "reb", "ast"];
  return [market as StatKey];
}

/** Ranking obrony rywala wobec pozycji (1 = najmniej pozwala) dla rynku ważonego projekcją zawodnika. */
export function defenseRank(ctx: LeagueContext, oppId: string, pos: PosGroup, parts: StatKey[], weights: Record<StatKey, number>) {
  const score = (t: ReturnType<LeagueContext["teams"]["get"]>) => {
    if (!t) return 1;
    const w = parts.reduce((s, k) => s + (weights[k] || 0), 0) || 1;
    return parts.reduce((s, k) => s + t.posDefense[pos][k].factor * (weights[k] || 0), 0) / w;
  };
  const all = [...ctx.teams.entries()].map(([id, t]) => ({ id, f: score(t) })).sort((a, b) => a.f - b.f);
  const i = all.findIndex((x) => x.id === oppId);
  return { rank: i + 1, of: all.length, factor: all[i]?.f ?? 1 };
}

export function explainProjection(args: {
  market: PlayerMarket;
  proj: PlayerProjection;
  simMean: number;
  history: PlayerGameRow[]; // rozegrane mecze sezonu przed meczem
  prior?: SeasonLogGame[];
  ctx: LeagueContext;
  oppId: string;
  oppAbbr: string;
  home: boolean;
  teamPace?: number;
}): Explanation {
  const { market, proj, ctx, oppId, oppAbbr } = args;
  const parts = partsOf(market);
  const played = args.history.filter((r) => !r.dnp && r.min > 0);
  const n = played.length;
  const noun = NOUN[market] ?? MARKET_LABEL[market].toLowerCase();
  const seasonMin = n ? mean(played.map((r) => r.min)) : proj.minutes.base;
  const sum = (rs: { [k: string]: number }[], k: string) => rs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const totMin = sum(played as unknown as Record<string, number>[], "min");

  const split = { recent: 0, prior: 0, debias: 0, ok: parts.every((k) => proj.stats[k].rateParts) };
  const step = { base: 0, form: 0, minutes: 0, opponent: 0, oppMissing: 0, pace: 0, home: 0, teammates: 0, h2h: 0 };
  for (const s of parts) {
    const st = proj.stats[s];
    const seasonAvg = n ? mean(played.map((r) => r[s])) : st.rate * seasonMin;
    step.base += seasonAvg;
    step.form += st.rate * seasonMin - seasonAvg;
    if (st.rateParts) {
      split.recent += st.rateParts.recent * seasonMin - seasonAvg;
      split.prior += (st.rateParts.withPrior - st.rateParts.recent) * seasonMin;
      split.debias += (st.rate - st.rateParts.withPrior) * seasonMin;
    }
    step.minutes += st.rate * (proj.minutes.mean - seasonMin);
    let cur = st.rate * proj.minutes.mean;
    for (const k of ["opponent", "oppMissing", "pace", "home", "teammates", "h2h"] as const) {
      const f = st.factors[k] ?? 1;
      step[k] += cur * (f - 1);
      cur *= f;
    }
  }
  const modelMean = step.base + step.form + step.minutes + step.opponent + step.oppMissing + step.pace + step.home + step.teammates + step.h2h;
  const spread = args.simMean - modelMean;

  // --- teksty ---
  const steps: ExplainStep[] = [];
  steps.push({ key: "base", label: "Średnia w tym sezonie", delta: step.base, text: n ? `${f1(step.base)} ${noun} na mecz w ${n} meczach.` : "Brak meczów w tym sezonie — punktem wyjścia jest poprzedni sezon." });

  // forma / poprzedni sezon / korekta
  const rateOf = (rs: { min: number; [k: string]: number }[]) => {
    const m = rs.reduce((a, r) => a + r.min, 0);
    return m ? parts.reduce((a, k) => a + rs.reduce((b, r) => b + (Number(r[k]) || 0), 0), 0) / m : NaN;
  };
  const seasonRate = totMin ? parts.reduce((a, k) => a + sum(played as unknown as Record<string, number>[], k), 0) / totMin : NaN;
  const l5Rate = rateOf(played.slice(-5) as unknown as { min: number; [k: string]: number }[]);
  const priorPlayed = (args.prior ?? []).filter((r) => r.min > 0);
  const priorRate = priorPlayed.length >= 10 ? rateOf(priorPlayed as unknown as { min: number; [k: string]: number }[]) : NaN;
  const priorSrc = proj.stats[parts[0]].rateParts?.priorSource ?? "poprzedni sezon";
  if (split.ok && n > 0) {
    const l10 = played.slice(-10);
    const l10Avg = l10.length ? l10.reduce((a, r) => a + parts.reduce((b, k) => b + r[k], 0), 0) / l10.length : NaN;
    steps.push({
      key: "form", label: "Forma (ostatnie mecze)", delta: split.recent,
      text: Math.abs(split.recent) < 0.3
        ? "Ostatnie mecze są na poziomie średniej sezonu."
        : `Ostatnie mecze ${split.recent > 0 ? "lepsze" : "słabsze"} niż średnia: ${Number.isFinite(l5Rate) ? `${f1(l5Rate * 36)} vs ${f1(seasonRate * 36)} ${noun} na 36 min w 5 ostatnich` : ""}${Number.isFinite(l10Avg) ? `, średnio ${f1(l10Avg)} w 10 ostatnich` : ""}. Starsze mecze ważą stopniowo mniej.`,
    });
    steps.push({
      key: "prior", label: priorSrc === "poprzedni sezon" ? "Poprzedni sezon" : "Średnia dla pozycji", delta: split.prior,
      text: Math.abs(split.prior) < 0.3
        ? `${priorSrc === "poprzedni sezon" ? "Poprzedni sezon" : "Średnia pozycji"} zgadza się z tym sezonem — brak korekty.`
        : priorSrc === "poprzedni sezon" && Number.isFinite(priorRate)
          ? `W poprzednim sezonie ${f1(priorRate * 36)} ${noun} na 36 min, teraz ${f1(seasonRate * 36)}. Przy ${n} meczach model ${split.prior < 0 ? "nie wierzy jeszcze w pełni w nowy, wyższy poziom" : "zakłada częściowy powrót do poziomu z poprzedniego sezonu"} — im więcej meczów, tym mniejszy wpływ poprzedniego sezonu.`
          : `Mało meczów w tym sezonie (${n}), więc model ${split.prior < 0 ? "obniża" : "podnosi"} wynik w stronę typowego gracza na tej pozycji.`,
    });
    if (Math.abs(split.debias) >= 0.05)
      steps.push({
        key: "debias", label: "Korekta z backtestu", delta: split.debias,
        text: `Na rozegranych meczach model systematycznie ${split.debias < 0 ? "zawyżał" : "zaniżał"} ten typ statystyki, więc wszystkie projekcje są ${split.debias < 0 ? "obniżane" : "podnoszone"} o stały procent (${f1(Math.abs(split.debias / Math.max(1e-9, step.base + split.recent + split.prior)) * 100)}%). Ta sama korekta dotyczy każdego zawodnika.`,
      });
  } else {
    const why: string[] = [];
    if (Number.isFinite(priorRate) && Number.isFinite(seasonRate) && Math.abs(priorRate - seasonRate) / Math.max(1e-9, seasonRate) > 0.06)
      why.push(`w poprzednim sezonie miał ${f1(priorRate * 36)} ${noun} na 36 minut, teraz ${f1(seasonRate * 36)} — przy ${n} meczach model nie przyjmuje w pełni nowego poziomu`);
    if (Number.isFinite(l5Rate) && Number.isFinite(seasonRate) && n >= 8 && Math.abs(l5Rate - seasonRate) / Math.max(1e-9, seasonRate) > 0.08)
      why.push(`ostatnie 5 meczów ${l5Rate > seasonRate ? "lepsze" : "słabsze"} niż średnia (${f1(l5Rate * 36)} vs ${f1(seasonRate * 36)} na 36 min), a nowsze mecze ważą więcej`);
    if (!why.length) why.push(Math.abs(step.form) < 0.3 ? "forma zgodna ze średnią" : "model wygładza wyniki z małej liczby meczów");
    steps.push({ key: "form", label: "Forma i poprzedni sezon", delta: step.form, text: `${why.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()) });
  }

  const l5Min = n ? mean(played.slice(-5).map((r) => r.min)) : NaN;
  const minWhy: string[] = [];
  if (Number.isFinite(l5Min) && Math.abs(l5Min - seasonMin) >= 2) minWhy.push(`w ostatnich 5 meczach grał ${f1(l5Min)} min`);
  if (proj.roleSwitch) minWhy.push(proj.roleSwitch.to === "starter" ? `wszedł do pierwszej piątki — ${proj.roleSwitch.games} ostatnie mecze po ${f1(proj.roleSwitch.min)} min` : `wypadł z pierwszej piątki — ${proj.roleSwitch.games} ostatnie mecze po ${f1(proj.roleSwitch.min)} min`);
  if (proj.minutes.b2bFactor < 0.995) minWhy.push("drugi mecz dzień po dniu");
  for (const t of proj.teammateEffects) if (t.method !== "already-absent" && Math.abs(t.minutes) >= 0.5) minWhy.push(`${t.name} nie zagra (${sgn(t.minutes)} min)`);
  steps.push({
    key: "minutes", label: "Minuty", delta: step.minutes,
    text: `Projekcja ${f1(proj.minutes.mean)} min wobec ${f1(seasonMin)} średnio w sezonie${minWhy.length ? ` (${minWhy.join(", ")})` : ""}.`,
  });

  // rywal z miejscem w lidze
  const weights = Object.fromEntries(parts.map((k) => [k, proj.stats[k].mean])) as Record<StatKey, number>;
  const dr = defenseRank(ctx, oppId, proj.pos, parts, weights);
  const opp = ctx.teams.get(oppId);
  const oppSentences: string[] = [];
  if (opp) {
    const drtgRank = [...ctx.teams.values()].filter((t) => t.drtg < opp.drtg).length + 1;
    oppSentences.push(`Obrona ${oppAbbr} ogólnie: ${ord(drtgRank)} w lidze (traci ${f1(opp.drtg)} pkt na 100 posiadań; 1. = najlepsza).`);
    oppSentences.push(
      `Przeciw ${POS_PL[proj.pos]} w ${noun}: ${ord(dr.rank)} najlepiej broniąca drużyna z ${dr.of} — ${dr.factor < 1 ? `oddaje o ${Math.round((1 - dr.factor) * 100)}% mniej` : `oddaje o ${Math.round((dr.factor - 1) * 100)}% więcej`} niż średnio.`,
    );
    if (parts.includes("fg3m")) {
      const sorted3 = [...ctx.teams.values()].sort((a, b) => a.shooting.fg3PctAllowed - b.shooting.fg3PctAllowed);
      const r3 = sorted3.indexOf(opp) + 1;
      const sortedA = [...ctx.teams.values()].sort((a, b) => a.shooting.fg3aFactor - b.shooting.fg3aFactor);
      const rA = sortedA.indexOf(opp) + 1;
      oppSentences.push(
        `Rzuty za 3 przeciw ${oppAbbr}: rywale trafiają ${(opp.shooting.fg3PctAllowed * 100).toFixed(1)}% (${ord(r3)} najniżej w lidze) i oddają ${opp.shooting.fg3aFactor < 1 ? `${Math.round((1 - opp.shooting.fg3aFactor) * 100)}% mniej` : `${Math.round((opp.shooting.fg3aFactor - 1) * 100)}% więcej`} prób niż średnio (${ord(rA)} najmniej).`,
      );
    }
  }
  steps.push({
    key: "opponent", label: `Obrona ${oppAbbr}`, delta: step.opponent,
    text: opp ? `${oppAbbr} to ${ord(dr.rank)} najlepsza obrona ligi przeciw ${POS_PL[proj.pos]} w ${noun}${dr.rank <= 10 ? " — trudny rywal" : dr.rank >= dr.of - 9 ? " — łatwy rywal" : " — przeciętny rywal"}.` : "Brak danych o rywalu — przyjęto przeciętną obronę.",
  });

  const missing = (proj.oppMissing ?? []).filter((m) => m.effect !== null);
  if (missing.length || Math.abs(step.oppMissing) >= 0.05)
    steps.push({
      key: "oppMissing", label: `Braki w obronie ${oppAbbr}`, delta: step.oppMissing,
      text: missing.length
        ? missing.map((m) => `${m.name} (${m.status}, ${f1(m.min)} min${m.samePos ? ", ta sama pozycja" : ""}) — w ${m.nWithout} meczach bez niego rywale tej pozycji ${m.effect! >= 1 ? "zdobywali więcej" : "zdobywali mniej"} (${m.effect! >= 1 ? "+" : "−"}${Math.abs((m.effect! - 1) * 100).toFixed(0)}%)`).join("; ") + "."
        : "Zmiana obrony rywala po nieobecnościach.",
    });
  const paceF = proj.stats[parts[0]].factors.pace;
  if (opp) {
    const paceRank = [...ctx.teams.values()].filter((t) => t.pace > opp.pace).length + 1;
    steps.push({ key: "pace", label: "Tempo meczu", delta: step.pace, text: `${oppAbbr} gra w tempie ${f1(opp.pace)} posiadań na mecz (${ord(paceRank)} najszybciej w lidze) — ${paceF > 1.005 ? "więcej akcji niż zwykle" : paceF < 0.995 ? "mniej akcji niż zwykle" : "przeciętnie"}.` });
  }
  steps.push({ key: "home", label: args.home ? "Mecz u siebie" : "Mecz na wyjeździe", delta: step.home, text: "Niewielka różnica zmierzona na wszystkich meczach ligi." });
  if (Math.abs(step.teammates) >= 0.05) {
    const names = proj.teammateEffects.filter((t) => t.method !== "already-absent").map((t) => t.name);
    steps.push({ key: "teammates", label: "Nieobecności kolegów", delta: step.teammates, text: names.length ? `Bez ${names.join(", ")} zawodnik dostaje więcej piłek.` : "Zmiana roli po nieobecnościach w składzie." });
  }
  if (Math.abs(step.h2h) >= 0.05) steps.push({ key: "h2h", label: `Wcześniejsze mecze z ${oppAbbr}`, delta: step.h2h, text: `Przeciw ${oppAbbr} grał ${step.h2h > 0 ? "lepiej" : "słabiej"} niż zwykle — model bierze to pod uwagę tylko w małym stopniu (mała próbka).` });
  if (Math.abs(spread) >= 0.05)
    steps.push({ key: "spread", label: "Rozrzut minut i blowout", delta: spread, text: `Uwzględnia możliwość krótszej gry, np. przy wysokim wyniku (szansa na różnicę 20+ pkt: ${Math.round(proj.blowout.prob * 100)}%).` });

  const big = steps.filter((s) => s.key !== "base").sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2).filter((s) => Math.abs(s.delta) >= 0.3);
  const headline = big.length
    ? `Projekcja ${f1(args.simMean)} jest ${args.simMean < step.base ? "niższa" : "wyższa"} od średniej sezonu (${f1(step.base)}) głównie przez: ${big.map((s) => `${s.label.charAt(0).toLowerCase()}${s.label.slice(1)} (${sgn(s.delta)})`).join(" i ")}.`
    : `Projekcja ${f1(args.simMean)} jest bliska średniej sezonu (${f1(step.base)}).`;

  return { steps, start: step.base, projection: args.simMean, opponent: oppSentences, headline };
}
