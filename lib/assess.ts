/**
 * Ocena zakładu — trzy niezależne wymiary i kategoria.
 *
 *   A. PRAWDOPODOBIEŃSTWO — skalibrowane prawdopodobieństwo modelu (z przedziałem niepewności)
 *   B. JAKOŚĆ DANYCH      — czy model ma dość wiarygodnych danych, by ocenić ten zakład
 *   C. OPŁACALNOŚĆ        — EV i przewaga liczone na kursie polskiego bukmachera (Superbet → najlepszy PL)
 *
 * Do tego argumenty ZA i RYZYKA (argumenty przeciw). Ryzyko krytyczne odrzuca zakład niezależnie
 * od EV; słaba ostatnia forma jest ryzykiem nawet przy korzystnej średniej sezonowej.
 * Progi kategorii są w THRESHOLDS — jedno miejsce, łatwe do zmiany.
 */
import { COMBOS, type PlayerMarket, type StatKey } from "./markets";
import type { LeagueContext } from "./model/context";
import type { Explanation } from "./model/explain";
import type { PlayerProjection } from "./model/player";
import { mean, median, sd, slope } from "./model/stats";
import type { PlayerGameRow } from "./store";

export type Category = "najlepsze" | "dobre" | "obserwuj" | "odrzucone";
export type Severity = "krytyczne" | "istotne" | "drobne";

export interface Risk {
  text: string;
  severity: Severity;
}

export interface StatWindow {
  label: string;
  n: number;
  avg: number;
  hits: number; // wyniki po stronie zakładu
  hitRate: number;
}

export interface PlayerStatsBlock {
  recent: { value: number; opp: string; date: string; home: boolean; min: number; hit: boolean }[]; // ostatnie 10, od najstarszego
  windows: StatWindow[]; // L5, L10, L15, L20, sezon
  median: number;
  sd: number;
  cv: number;
  trendPerGame: number;
  consistency: "wysoka" | "średnia" | "niska";
  minutes: { l5: number; season: number; projected: number; sd: number };
  usage: { l5: number | null; season: number | null };
  shooting: { fgaL5: number; fgaSeason: number; fgPctSeason: number | null; fg3aL5: number; fg3aSeason: number; fg3PctL5: number | null; fg3PctSeason: number | null };
  projection: { mean: number; p10: number; p90: number } | null;
  matchup: {
    opp: string;
    oppDrtg: number | null;
    oppDrtgRank: number | null;
    oppPace: number | null;
    gamePace: number | null;
    statFactor: number; // obrona rywala wobec pozycji, na posiadanie (1 = średnia ligi)
    opp3PctAllowed: number | null;
    home: boolean;
    restDays: number | null;
  };
  context: { blowoutProb: number; selfStatus: string | null; teammatesOut: string[]; roleChange: string | null };
  /** „Skąd ta projekcja?” — kroki od średniej sezonu do projekcji */
  explain?: Explanation;
}

export interface Assessment {
  category: Category;
  categoryReasons: string[]; // dlaczego taka kategoria (głównie dla odrzuconych / obserwowanych)
  probability: { value: number; low: number; high: number; label: "wysokie" | "umiarkowane" | "niskie" };
  quality: { score: number; level: "wysoka" | "średnia" | "niska"; factors: { text: string; delta: number }[] };
  value: { ev: number; edge: number; edgeVsFair: number | null; label: "korzystny" | "neutralny" | "niekorzystny" };
  pros: string[];
  risks: Risk[];
  summary: string;
  stats: PlayerStatsBlock | null;
  rankScore: number;
}

export const THRESHOLDS = {
  najlepsze: { prob: 0.58, quality: 70, ev: 0.02, edgeVsFair: 0.015, maxSignificantRisks: 1 },
  dobre: { prob: 0.53, quality: 55, ev: 0.0, maxSignificantRisks: 2 },
  obserwuj: { prob: 0.5, quality: 40, ev: -0.04 },
  preferredOdds: [1.7, 2.2] as const,
  /** poniżej tego kursu zakład nie może być „Najlepszy”, a „Dobry” wymaga wyższego EV */
  lowOdds: 1.4,
  lowOddsMinEv: 0.04,
};

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");

export function statOf(r: Pick<PlayerGameRow, StatKey>, market: PlayerMarket): number {
  if (market === "dd" || market === "td") {
    const c = (["pts", "reb", "ast", "stl", "blk"] as StatKey[]).filter((s) => r[s] >= 10).length;
    return c >= (market === "dd" ? 2 : 3) ? 1 : 0;
  }
  if (market in COMBOS) return COMBOS[market as keyof typeof COMBOS].reduce((s, k) => s + r[k], 0);
  return r[market as StatKey];
}

const MARKET_NOUN: Record<string, string> = {
  pts: "punktów", reb: "zbiórek", ast: "asyst", fg3m: "trafionych trójek", stl: "przechwytów", blk: "bloków", tov: "strat",
  pra: "pkt+zb+as", pr: "pkt+zb", pa: "pkt+as", ra: "zb+as", stocks: "przechwytów+bloków", dd: "double-double", td: "triple-double",
};

export interface AssessInput {
  market: PlayerMarket;
  side: "over" | "under" | "yes";
  line: number;
  modelProb: number;
  rawProb: number;
  pLow: number;
  pHigh: number;
  marketProb: number | null;
  ev: number;
  edge: number;
  edgeVsFair: number | null;
  price: number;
  playable: boolean; // czy kurs pochodzi od polskiego bukmachera
  manualPrice: { ageMin: number } | null;
  staleMin: number | null; // wiek kursu użytego do EV (min)
  oneWay: boolean;
  lineMovedAgainst: boolean;
  history: PlayerGameRow[]; // mecze przed dniem meczu, chronologicznie (tylko rozegrane i nie)
  teamRecentGameIds: string[]; // ostatnie mecze drużyny (do wykrywania powrotu po absencji)
  proj: PlayerProjection;
  ctx: LeagueContext;
  oppId: string;
  oppAbbr: string;
  teamAbbrById: (id: string) => string;
  home: boolean;
  restDays: number | null;
  selfStatus: string | null;
  injuriesAvailable: boolean;
  calibrated: boolean;
  marketProven: { proven: boolean; detail: string };
  hasPriorSeason: boolean;
}

/** Ocena zakładu na zawodnika. */
export function assessPlayer(x: AssessInput): Assessment {
  const played = x.history.filter((r) => !r.dnp && r.min > 0);
  const values = played.map((r) => statOf(r, x.market));
  const n = values.length;
  const dir = x.side === "under" ? -1 : 1;
  const isHit = (v: number) => (x.side === "under" ? v < x.line : v > x.line);
  const last = (k: number) => values.slice(-k);
  const win = (label: string, vs: number[]): StatWindow => {
    const hits = vs.filter(isHit).length;
    return { label, n: vs.length, avg: mean(vs), hits, hitRate: vs.length ? hits / vs.length : NaN };
  };
  const windows = [win("Ostatnie 5", last(5)), win("Ostatnie 10", last(10)), win("Ostatnie 15", last(15)), win("Ostatnie 20", last(20)), win("Sezon", values)];
  const [w5, w10, , , wS] = windows;
  const med = median(values);
  const sdv = n > 1 ? sd(values) : NaN;
  const avg = mean(values);
  const cv = avg > 0 ? sdv / avg : NaN;
  const tr = slope(last(10));
  const noun = MARKET_NOUN[x.market] ?? x.market;
  const sideWord = x.side === "under" ? "poniżej" : "powyżej";

  const rows = played;
  const lastRows = (k: number) => rows.slice(-k);
  const avgOf = (rs: PlayerGameRow[], f: (r: PlayerGameRow) => number) => (rs.length ? mean(rs.map(f)) : NaN);
  const usg = (rs: PlayerGameRow[]) => {
    const u = rs.filter((r) => r.usg !== null).map((r) => r.usg!);
    return u.length ? mean(u) : null;
  };
  const sumOf = (rs: PlayerGameRow[], f: (r: PlayerGameRow) => number) => rs.reduce((s, r) => s + f(r), 0);
  const fg3PctOf = (rs: PlayerGameRow[]) => (sumOf(rs, (r) => r.fg3a) ? sumOf(rs, (r) => r.fg3m) / sumOf(rs, (r) => r.fg3a) : null);
  const minL5 = avgOf(lastRows(5), (r) => r.min);
  const minL3 = avgOf(lastRows(3), (r) => r.min);
  const minSeason = avgOf(rows, (r) => r.min);
  const usgL5 = usg(lastRows(5));
  const usgSeason = usg(rows);
  const fg3aL5 = avgOf(lastRows(5), (r) => r.fg3a);
  const fg3aSeason = avgOf(rows, (r) => r.fg3a);

  const team = x.ctx.teams.get(x.oppId);
  const drtgRank = team ? [...x.ctx.teams.values()].filter((t) => t.drtg < team.drtg).length + 1 : null;
  const parts: StatKey[] = x.market in COMBOS ? COMBOS[x.market as keyof typeof COMBOS] : x.market === "dd" || x.market === "td" ? ["pts", "reb", "ast"] : [x.market as StatKey];
  const wsum = parts.reduce((s, k) => s + x.proj.stats[k].mean, 0) || 1;
  const statFactor = parts.reduce((s, k) => s + x.proj.stats[k].factors.opponent * x.proj.stats[k].mean, 0) / wsum;
  const paceF = x.proj.stats.pts.factors.pace;

  // ---------------------------------------------------------------- argumenty ZA i RYZYKA
  const pros: string[] = [];
  const risks: Risk[] = [];
  const risk = (severity: Severity, text: string) => risks.push({ severity, text });

  if (x.side !== "yes" && n >= 5) {
    const l5 = last(5);
    if (w5.hits === 0) risk("krytyczne", `Żaden z 5 ostatnich meczów nie skończył się ${sideWord} linii ${x.line} (wyniki: ${l5.join(", ")}).`);
    else if (w5.hits === 1) risk("istotne", `Tylko 1 z 5 ostatnich meczów ${sideWord} linii ${x.line} (wyniki: ${l5.join(", ")}).`);
    else if (w5.hits >= 4) pros.push(`${w5.hits} z 5 ostatnich meczów ${sideWord} linii ${x.line} (${l5.join(", ")}).`);
  }
  if (x.side !== "yes" && n >= 10) {
    if (w10.hitRate >= 0.7) pros.push(`${w10.hits}/10 ostatnich meczów ${sideWord} linii.`);
    if (wS.hitRate >= 0.55 && w10.hitRate <= 0.4)
      risk("istotne", `Sezon wygląda dobrze (${wS.hits}/${wS.n}), ale ostatnie 10 meczów już nie (${w10.hits}/10) — model nie ignoruje słabszej formy.`);
  }
  if (Number.isFinite(sdv) && n >= 6 && dir * tr * 5 < -0.5 * sdv)
    risk("istotne", `Trend ${dir > 0 ? "spadkowy" : "wzrostowy"} w ostatnich 10 meczach (${tr > 0 ? "+" : ""}${tr.toFixed(2)} ${noun} na mecz) — działa przeciw zakładowi.`);
  else if (Number.isFinite(sdv) && n >= 6 && dir * tr * 5 > 0.5 * sdv) pros.push(`Trend ${dir > 0 ? "wzrostowy" : "spadkowy"} w ostatnich 10 meczach sprzyja zakładowi.`);
  if (Number.isFinite(cv) && avg >= 1 && cv >= 0.6) risk("drobne", `Wyniki są bardzo nieregularne (odchylenie ${f1(sdv)} przy średniej ${f1(avg)}).`);
  else if (Number.isFinite(cv) && avg >= 3 && cv <= 0.3) pros.push(`Wyniki są regularne (odchylenie tylko ${f1(sdv)}).`);
  if (x.side !== "yes" && Number.isFinite(med) && Math.abs(med - x.line) <= 0.5) risk("drobne", `Linia ${x.line} leży tuż przy medianie (${f1(med)}) — rozstrzygnie niewielka różnica.`);

  const proj = x.market === "dd" || x.market === "td" ? null : x.proj;
  if (proj && Number.isFinite(sdv) && sdv > 0) {
    const pm = parts.reduce((s, k) => s + proj.stats[k].mean, 0);
    const gap = (pm - x.line) * dir;
    if (gap >= 0.5 * sdv) pros.push(`Projekcja modelu ${f1(pm)} jest wyraźnie ${sideWord} linii ${x.line}.`);
    else if (gap < 0) risk("istotne", `Projekcja modelu ${f1(pm)} jest po drugiej stronie linii ${x.line}.`);
  }

  // minuty i rola
  if (n >= 6 && Number.isFinite(minL3) && Math.abs(minL3 - minSeason) >= 5) {
    const more = minL3 > minSeason;
    const text = `W ostatnich 3 meczach grał średnio ${f1(minL3)} min (sezon ${f1(minSeason)}) — rola się zmienia.`;
    if ((more && dir > 0) || (!more && dir < 0)) pros.push(text);
    else risk("istotne", text);
  }
  const recentTeam = x.teamRecentGameIds.slice(-5);
  const playedSet = new Set(played.map((r) => r.game_id));
  const missed = recentTeam.filter((id) => !playedSet.has(id)).length;
  if (recentTeam.length >= 4 && missed >= 2 && played.length && playedSet.has(recentTeam[recentTeam.length - 1] ?? ""))
    risk("istotne", `Opuścił ${missed} z ${recentTeam.length} ostatnich meczów drużyny — po powrocie możliwy limit minut.`);
  else if (recentTeam.length >= 4 && missed >= 2) risk("istotne", `Opuścił ${missed} z ${recentTeam.length} ostatnich meczów drużyny — niepewna dostępność i minuty.`);
  let roleChange: string | null = null;
  if (usgL5 !== null && usgSeason !== null && Math.abs(usgL5 - usgSeason) >= 3 && n >= 8) {
    const up = usgL5 > usgSeason;
    roleChange = `Usage ${up ? "wzrósł" : "spadł"}: ${f1(usgL5)}% w 5 meczach vs ${f1(usgSeason)}% w sezonie.`;
    const helpsOver = ["pts", "fg3m", "pa", "pr", "pra", "tov"].includes(x.market);
    if (helpsOver && ((up && dir > 0) || (!up && dir < 0))) pros.push(roleChange);
    else if (helpsOver) risk("istotne", roleChange);
  }

  // trójki: próby, skuteczność, obrona rywala na obwodzie
  if (x.market === "fg3m" && n >= 5) {
    const d = fg3aL5 - fg3aSeason;
    if (dir < 0 && d >= 1) risk("istotne", `Liczba prób za 3 rośnie: ${f1(fg3aL5)} na mecz w 5 ostatnich vs ${f1(fg3aSeason)} w sezonie — więcej okazji do przekroczenia linii.`);
    if (dir > 0 && d <= -1) risk("istotne", `Oddaje mniej trójek: ${f1(fg3aL5)} prób w 5 ostatnich vs ${f1(fg3aSeason)} w sezonie.`);
    if (dir > 0 && d >= 1) pros.push(`Więcej prób za 3: ${f1(fg3aL5)} w 5 ostatnich vs ${f1(fg3aSeason)} w sezonie.`);
    if (dir < 0 && d <= -1) pros.push(`Mniej prób za 3: ${f1(fg3aL5)} w 5 ostatnich vs ${f1(fg3aSeason)} w sezonie.`);
    const p5 = fg3PctOf(lastRows(5));
    const pS = fg3PctOf(rows);
    if (p5 !== null && pS !== null) {
      if (dir > 0 && p5 - pS >= 0.1) risk("drobne", `Ostatnio trafia ponad normę (${pct(p5)} vs ${pct(pS)} w sezonie) — skuteczność zwykle wraca do średniej.`);
      if (dir < 0 && pS - p5 >= 0.1) risk("drobne", `Ostatnio trafia poniżej normy (${pct(p5)} vs ${pct(pS)}) — skuteczność może się odbić.`);
    }
    if (team) {
      const loose = team.shooting.fg3aFactor >= 1.05 || team.shooting.fg3PctFactor >= 1.03;
      const tight = team.shooting.fg3aFactor <= 0.95 || team.shooting.fg3PctFactor <= 0.97;
      const desc = `rywale ${x.oppAbbr} oddają ${pct(team.shooting.fg3aFactor - 1)} prób za 3 względem średniej i trafiają ${pct(team.shooting.fg3PctAllowed, 1)}`;
      if (loose && dir < 0) risk("istotne", `${x.oppAbbr} słabo broni obwodu: ${desc}.`);
      if (loose && dir > 0) pros.push(`${x.oppAbbr} słabo broni obwodu: ${desc}.`);
      if (tight && dir > 0) risk("istotne", `${x.oppAbbr} dobrze broni obwodu: ${desc}.`);
      if (tight && dir < 0) pros.push(`${x.oppAbbr} dobrze broni obwodu: ${desc}.`);
    }
  } else if (Math.abs(statFactor - 1) >= 0.05) {
    const t = `${x.oppAbbr} ${statFactor > 1 ? "pozwala na więcej" : "ogranicza"} ${noun} zawodnikom na tej pozycji (${statFactor > 1 ? "+" : ""}${pct(statFactor - 1)} na posiadanie).`;
    if ((statFactor > 1) === (dir > 0)) pros.push(t);
    else risk("istotne", t);
  }
  if (Math.abs(paceF - 1) >= 0.02) {
    const t = `Tempo meczu ${paceF > 1 ? "szybsze" : "wolniejsze"} niż średnio (${paceF > 1 ? "+" : ""}${pct(paceF - 1, 1)} posiadań).`;
    if ((paceF > 1) === (dir > 0)) pros.push(t);
    else risk("drobne", t);
  }

  // blowout, zmęczenie
  const bo = x.proj.blowout;
  const starter = x.proj.minutes.mean >= 28;
  if (starter && bo.prob >= 0.15) {
    const t = `Ryzyko wysokiej różnicy punktowej (${pct(bo.prob)} szans na ≥${bo.threshold} pkt) — podstawowi gracze schodzą wtedy wcześniej.`;
    if (dir > 0) risk(bo.prob >= 0.25 ? "istotne" : "drobne", t);
    else pros.push(t);
  }
  if (x.restDays === 0 && dir > 0) risk("drobne", "Drugi mecz dzień po dniu (back-to-back).");

  // kontuzje i skład
  const self = (x.selfStatus ?? "").toUpperCase();
  if (["OUT", "DOUBTFUL"].includes(self)) risk("krytyczne", `Zawodnik ma status ${self === "OUT" ? "OUT (nie zagra)" : "DOUBTFUL (raczej nie zagra)"}.`);
  else if (["QUESTIONABLE", "DAY-TO-DAY"].includes(self)) risk("krytyczne", "Status niepewny (questionable / day-to-day) — może nie zagrać albo grać krócej.");
  const outMates = x.proj.teammateEffects.filter((t) => t.method !== "already-absent");
  for (const t of outMates) {
    if (["QUESTIONABLE", "DAY-TO-DAY", "DOUBTFUL"].includes(t.status)) risk("drobne", `${t.name} ma niepewny status — rola zawodnika może się zmienić tuż przed meczem.`);
    else if (t.minutes >= 1 && dir > 0) pros.push(`${t.name} nie zagra — więcej minut i piłek (+${f1(t.minutes)} min).`);
    else if (t.minutes >= 1 && dir < 0) risk("istotne", `${t.name} nie zagra — zawodnik dostanie więcej minut (+${f1(t.minutes)} min).`);
  }
  if (!x.injuriesAvailable) risk("istotne", "Raport kontuzji jest niedostępny — nie wiadomo, kto zagra.");

  // rynek i kurs
  if (x.marketProb !== null && Math.abs(x.rawProb - x.marketProb) > 0.12)
    risk("istotne", `Model (${pct(x.rawProb)}) i rynek (${pct(x.marketProb)}) mocno się różnią — rynek może znać informacje, których model nie ma.`);
  else if (x.marketProb !== null && Math.abs(x.rawProb - x.marketProb) <= 0.05 && x.ev > 0) pros.push("Model i rynek oceniają szanse podobnie — przewaga wynika z kursu, a nie z odważnej prognozy.");
  if (x.lineMovedAgainst) risk("drobne", "Linia przesunęła się od otwarcia w niekorzystną stronę.");
  if (x.manualPrice) risk("drobne", `Kurs wpisany ręcznie ${x.manualPrice.ageMin < 60 ? `${Math.round(x.manualPrice.ageMin)} min` : `${f1(x.manualPrice.ageMin / 60)} h`} temu — niezweryfikowany, sprawdź przed zagraniem.`);
  else if (x.staleMin !== null && x.staleMin > 60) risk("drobne", `Kurs pobrany ${f1(x.staleMin / 60)} h temu — mógł się zmienić.`);
  if (!x.marketProven.proven) risk("istotne", `Dla tego typu zakładu model nie był w backteście lepszy od rynku (${x.marketProven.detail}).`);
  if (x.pHigh - x.pLow > 0.25) risk("drobne", `Duża niepewność prawdopodobieństwa (${pct(x.pLow)}–${pct(x.pHigh)}).`);
  if (n < 8) risk("istotne", `Mała próbka: tylko ${n} ${n === 1 ? "mecz" : "meczów"} w tym sezonie.`);

  // ---------------------------------------------------------------- B. jakość danych
  const qf: { text: string; delta: number }[] = [];
  if (n < 5) qf.push({ text: `tylko ${n} meczów w sezonie`, delta: -35 });
  else if (n < 10) qf.push({ text: `${n} meczów w sezonie`, delta: -20 });
  else if (n < 15) qf.push({ text: `${n} meczów w sezonie`, delta: -8 });
  if (n < 10 && !x.hasPriorSeason) qf.push({ text: "brak danych z poprzedniego sezonu", delta: -15 });
  const minCv = n >= 5 ? sd(lastRows(10).map((r) => r.min)) / Math.max(1, avgOf(lastRows(10), (r) => r.min)) : 0;
  if (minCv > 0.3) qf.push({ text: "niestabilne minuty", delta: -10 });
  if (roleChange) qf.push({ text: "zmiana roli w ostatnich meczach", delta: -8 });
  if (["QUESTIONABLE", "DAY-TO-DAY"].includes(self)) qf.push({ text: "niepewny status zawodnika", delta: -20 });
  if (["OUT", "DOUBTFUL"].includes(self)) qf.push({ text: "zawodnik prawdopodobnie nie zagra", delta: -60 });
  const unsure = outMates.filter((t) => ["QUESTIONABLE", "DAY-TO-DAY", "DOUBTFUL"].includes(t.status)).length;
  if (unsure) qf.push({ text: "niepewny skład drużyny", delta: -Math.min(20, unsure * 10) });
  if (outMates.some((t) => t.method === "heuristic")) qf.push({ text: "wpływ nieobecności szacowany bez danych with/without", delta: -5 });
  const width = x.pHigh - x.pLow;
  if (width > 0.25) qf.push({ text: "szeroki przedział prawdopodobieństwa", delta: -15 });
  else if (width > 0.18) qf.push({ text: "umiarkowanie szeroki przedział prawdopodobieństwa", delta: -8 });
  if (x.oneWay) qf.push({ text: "rynek jednostronny — marża bukmachera szacowana", delta: -10 });
  if (x.manualPrice) qf.push({ text: "kurs wpisany ręcznie (niezweryfikowany)", delta: -5 });
  if (!x.calibrated) qf.push({ text: "model nieskalibrowany (brak backtestu)", delta: -10 });
  if (!x.marketProven.proven) qf.push({ text: "typ zakładu niezweryfikowany w backteście", delta: -15 });
  let qScore = Math.max(0, Math.min(100, 100 + qf.reduce((s, q) => s + q.delta, 0)));
  if (!x.injuriesAvailable) {
    qScore = Math.min(qScore, 35);
    qf.push({ text: "brak raportu kontuzji", delta: 0 });
  }

  const stats: PlayerStatsBlock = {
    recent: lastRows(10).map((r) => ({ value: statOf(r, x.market), opp: x.teamAbbrById(r.opp_id), date: r.date, home: !!r.home, min: r.min, hit: isHit(statOf(r, x.market)) })),
    windows,
    median: med,
    sd: sdv,
    cv,
    trendPerGame: tr,
    consistency: !Number.isFinite(cv) ? "średnia" : cv <= 0.3 ? "wysoka" : cv <= 0.55 ? "średnia" : "niska",
    minutes: { l5: minL5, season: minSeason, projected: x.proj.minutes.mean, sd: x.proj.minutes.sd },
    usage: { l5: usgL5, season: usgSeason },
    shooting: {
      fgaL5: avgOf(lastRows(5), (r) => r.fga), fgaSeason: avgOf(rows, (r) => r.fga),
      fgPctSeason: sumOf(rows, (r) => r.fga) ? sumOf(rows, (r) => r.fgm) / sumOf(rows, (r) => r.fga) : null,
      fg3aL5, fg3aSeason, fg3PctL5: fg3PctOf(lastRows(5)), fg3PctSeason: fg3PctOf(rows),
    },
    projection: null,
    matchup: {
      opp: x.oppAbbr, oppDrtg: team?.drtg ?? null, oppDrtgRank: drtgRank, oppPace: team?.pace ?? null,
      gamePace: team ? (x.ctx.teams.get(rows.at(-1)?.team_id ?? "")?.pace ?? x.ctx.lgPace) * team.pace / x.ctx.lgPace : null,
      statFactor, opp3PctAllowed: team?.shooting.fg3PctAllowed ?? null, home: x.home, restDays: x.restDays,
    },
    context: { blowoutProb: bo.prob, selfStatus: x.selfStatus, teammatesOut: outMates.map((t) => `${t.name} (${t.status})`), roleChange },
  };

  return finish({ ...x, kind: "player" }, pros, risks, qScore, qf, stats);
}

export interface GameAssessInput {
  modelProb: number;
  rawProb: number;
  pLow: number;
  pHigh: number;
  marketProb: number | null;
  ev: number;
  edge: number;
  edgeVsFair: number | null;
  price: number;
  playable: boolean;
  manualPrice: { ageMin: number } | null;
  staleMin: number | null;
  sample: number;
  injuryNotes: string[];
  restNotes: string[];
  calibrated: boolean;
  marketProven: { proven: boolean; detail: string };
}

/** Ocena linii meczowej (zwycięzca, handicap, suma punktów). */
export function assessGame(x: GameAssessInput): Assessment {
  const pros: string[] = [];
  const risks: Risk[] = [];
  if (!x.marketProven.proven) risks.push({ severity: "istotne", text: `Model meczowy nie był w backteście lepszy od rynku (${x.marketProven.detail}).` });
  if (x.marketProb !== null && Math.abs(x.rawProb - x.marketProb) > 0.1)
    risks.push({ severity: "istotne", text: `Model (${pct(x.rawProb)}) i rynek (${pct(x.marketProb)}) mocno się różnią — model drużynowy nie widzi wszystkich zmian w składach.` });
  for (const t of x.injuryNotes) risks.push({ severity: "drobne", text: t });
  for (const t of x.restNotes) risks.push({ severity: "drobne", text: t });
  if (x.manualPrice) risks.push({ severity: "drobne", text: "Kurs wpisany ręcznie — niezweryfikowany." });
  if (x.sample < 8) risks.push({ severity: "istotne", text: `Mała próbka: drużyny rozegrały dopiero ${x.sample} meczów.` });
  const qf: { text: string; delta: number }[] = [];
  if (x.sample < 8) qf.push({ text: "mało meczów drużyn", delta: -25 });
  if (!x.calibrated) qf.push({ text: "model nieskalibrowany", delta: -10 });
  if (!x.marketProven.proven) qf.push({ text: "model meczowy niezweryfikowany w backteście", delta: -20 });
  const qScore = Math.max(0, Math.min(100, 85 + qf.reduce((s, q) => s + q.delta, 0)));
  return finish({ ...x, kind: "game" }, pros, risks, qScore, qf, null);
}

function finish(
  x: { kind: "player" | "game"; modelProb: number; pLow: number; pHigh: number; ev: number; edge: number; edgeVsFair: number | null; price: number; playable: boolean; marketProven: { proven: boolean } },
  pros: string[],
  risks: Risk[],
  qScore: number,
  qf: { text: string; delta: number }[],
  stats: PlayerStatsBlock | null,
): Assessment {
  const order: Record<Severity, number> = { krytyczne: 0, istotne: 1, drobne: 2 };
  risks.sort((a, b) => order[a.severity] - order[b.severity]);
  const T = THRESHOLDS;
  if (x.price < T.lowOdds && x.price > 1) {
    risks.push({
      severity: "drobne",
      text: `Niski kurs ${x.price.toFixed(2)}: wygrana daje tylko ${Math.round((x.price - 1) * 100)} gr na każdą złotówkę, a jedna przegrana kasuje zysk z ok. ${Math.max(1, Math.round(1 / (x.price - 1)))} wygranych.`,
    });
    risks.sort((a, b) => order[a.severity] - order[b.severity]);
  }
  const critical = risks.filter((r) => r.severity === "krytyczne").length;
  const significant = risks.filter((r) => r.severity === "istotne").length;
  const reasons: string[] = [];
  let category: Category;
  if (critical) {
    category = "odrzucone";
    reasons.push(`Ryzyko krytyczne: ${risks[0].text}`);
  } else if (
    x.price >= T.lowOdds &&
    x.playable && x.marketProven.proven && x.modelProb >= T.najlepsze.prob && qScore >= T.najlepsze.quality && x.ev >= T.najlepsze.ev &&
    (x.edgeVsFair ?? 0) >= T.najlepsze.edgeVsFair && significant <= T.najlepsze.maxSignificantRisks
  ) {
    category = "najlepsze";
  } else if (
    x.playable && x.marketProven.proven && x.modelProb >= T.dobre.prob && qScore >= T.dobre.quality &&
    x.ev >= (x.price < T.lowOdds ? T.lowOddsMinEv : T.dobre.ev) && significant <= T.dobre.maxSignificantRisks
  ) {
    category = "dobre";
  } else if (x.modelProb >= T.obserwuj.prob && qScore >= T.obserwuj.quality && x.ev >= T.obserwuj.ev) {
    category = "obserwuj";
    if (!x.playable) reasons.push("Brak kursu polskiego bukmachera — wpisz kurs Superbet, aby ocenić opłacalność.");
    if (!x.marketProven.proven) reasons.push("Ten typ zakładu nie przeszedł weryfikacji w backteście.");
    if (x.ev < T.dobre.ev) reasons.push(`Kurs jest za niski względem szans (EV ${(x.ev * 100).toFixed(1)}%).`);
    else if (x.price < T.lowOdds && x.ev < T.lowOddsMinEv) reasons.push(`Przy kursie poniżej ${T.lowOdds.toFixed(2)} wymagamy EV co najmniej ${Math.round(T.lowOddsMinEv * 100)}% (jest ${(x.ev * 100).toFixed(1)}%).`);
    if (significant > T.dobre.maxSignificantRisks) reasons.push(`Zbyt wiele istotnych ryzyk (${significant}).`);
    if (x.modelProb < T.dobre.prob) reasons.push(`Prawdopodobieństwo ${pct(x.modelProb)} — poniżej progu ${pct(T.dobre.prob)}.`);
    if (qScore < T.dobre.quality) reasons.push(`Jakość danych ${qScore}/100 — poniżej progu ${T.dobre.quality}.`);
  } else {
    category = "odrzucone";
    if (x.modelProb < T.obserwuj.prob) reasons.push(`Szansa realizacji tylko ${pct(x.modelProb)}.`);
    if (qScore < T.obserwuj.quality) reasons.push(`Za mało wiarygodnych danych (jakość ${qScore}/100).`);
    if (x.ev < T.obserwuj.ev) reasons.push(`Kurs wyraźnie nieopłacalny (EV ${(x.ev * 100).toFixed(1)}%).`);
  }

  const probLabel = x.modelProb >= 0.58 ? "wysokie" : x.modelProb >= 0.5 ? "umiarkowane" : "niskie";
  const level = qScore >= 75 ? "wysoka" : qScore >= 55 ? "średnia" : "niska";
  const valueLabel = x.ev >= 0.02 ? "korzystny" : x.ev >= -0.02 ? "neutralny" : "niekorzystny";
  const [lo, hi] = T.preferredOdds;
  // preferowany zakres 1.70–2.20; niskie kursy spadają w rankingu (np. 1.20 → −12)
  const oddsBonus = x.price >= lo && x.price <= hi ? 3 : x.price < 1.5 ? -(1.5 - x.price) * 40 : 0;
  const catBase = { najlepsze: 300, dobre: 200, obserwuj: 100, odrzucone: 0 }[category];
  const rankScore = catBase + x.modelProb * 100 + qScore * 0.2 + Math.max(-10, Math.min(10, x.ev * 100)) + oddsBonus - significant * 2;

  const topPro = pros[0];
  const summary =
    category === "odrzucone"
      ? reasons[0] ?? "Model odrzucił ten zakład."
      : `Szansa ${pct(x.modelProb)}${topPro ? ` · ${topPro.replace(/\.$/, "")}` : ""}${risks.length ? ` · główne ryzyko: ${risks[0].text.replace(/\.$/, "").toLowerCase()}` : ""}.`;

  return {
    category,
    categoryReasons: reasons,
    probability: { value: x.modelProb, low: x.pLow, high: x.pHigh, label: probLabel },
    quality: { score: qScore, level, factors: qf },
    value: { ev: x.ev, edge: x.edge, edgeVsFair: x.edgeVsFair, label: valueLabel },
    pros,
    risks,
    summary,
    stats,
    rankScore,
  };
}
