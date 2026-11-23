/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Superbet PL bezpośrednio — publiczne JSON-y, z których korzysta strona superbet.pl (bez logowania i bez klucza,
 * nie zużywa limitu OddsPapi). Sprawdzone na żywo 2026-11-23:
 *   GET {BASE}/v2/pl-PL/events/by-date?currentStatus=active&offerState=prematch&startDate=…&endDate=…&sportId=4
 *       → data[]: eventId, matchName („Charlotte Hornets·Memphis Grizzlies”), utcDate, tournamentId (164 = NBA)
 *   GET {BASE}/v2/pl-PL/events/{eventId}
 *       → data[0].odds[]: marketName, name, price, status, code, specifiers {player, total, milestone, hcp}
 * Rynki: linie zawodników powyżej/poniżej (pkt, zb, as, 3pt, PRA, P+Z, P+A, Z+A, straty, przechwyty, bloki),
 * drabinki „N+”, double-double, pojedynki H2H (pkt, zb, as, 3pt), zwycięzca, wszystkie linie handicapu i sumy,
 * punkty każdej drużyny (wszystko z dogrywką). Pomijane (model ich nie wycenia): kwarty, połowy, faule, oddane rzuty,
 * „pierwszy”, „najwięcej”, wyścig do X pkt, łączne statystyki kilku zawodników i gotowe zakłady łączone.
 * Zasady: ~1 zapytanie na sekundę, kopia w pamięci podręcznej 15 min, przy 403/429 przerywamy (bez obchodzenia blokad).
 */
import { fetchJson } from "../http";
import type { H2HMarket, Market } from "../markets";
import { normName, type GameRef } from "./oddsapi";
import { playerMatcher, type PapiOffer } from "./oddspapi";

const BASE = "https://production-superbet-offer-pl.freetls.fastly.net";
const BASKETBALL = 4;
const NBA_TOURNAMENT = 164;
const TTL = 15 * 60; // s

export interface SuperbetResult {
  offers: PapiOffer[];
  matchedGames: number;
  events: number;
  fetchedAt: number;
  unmatchedPlayers: string[];
  errors: string[];
}

/** O/U zawodnika: „Zawodnik - liczba …” */
const OU: [RegExp, Market][] = [
  [/^zawodnik - liczba punktów \+ zbiórek \+ asyst/i, "pra"],
  [/^zawodnik - liczba punktów \+ zbiórek/i, "pr"],
  [/^zawodnik - liczba punktów \+ asyst/i, "pa"],
  [/^zawodnik - liczba zbiórek \+ asyst/i, "ra"],
  [/^zawodnik - liczba (przechwytów \+ bloków|bloków \+ przechwytów)/i, "stocks"],
  [/^zawodnik - liczba punktów/i, "pts"],
  [/^zawodnik - liczba zbiórek/i, "reb"],
  [/^zawodnik - liczba asyst/i, "ast"],
  [/^zawodnik - liczba (trafionych )?(rzutów )?(trafionych )?za 3\s?pkt|^zawodnik - liczba trafionych trójek/i, "fg3m"],
  [/^zawodnik - liczba przechwytów/i, "stl"],
  [/^zawodnik - liczba bloków/i, "blk"],
  [/^zawodnik - liczba strat/i, "tov"],
];
/** drabinki „N+”: „Punkty zawodnika”, „Asysty zawodnika”… */
const LADDER: [RegExp, Market][] = [
  [/^punkty \+ zbiórki \+ asysty zawodnika/i, "pra"],
  [/^punkty \+ zbiórki zawodnika/i, "pr"],
  [/^punkty \+ asysty zawodnika/i, "pa"],
  [/^zbiórki \+ asysty zawodnika/i, "ra"],
  [/^punkty zawodnika/i, "pts"],
  [/^zbiórki zawodnika/i, "reb"],
  [/^asysty zawodnika/i, "ast"],
  [/^trafione rzuty za 3\s?pkt zawodnika/i, "fg3m"],
  [/^przechwyty zawodnika/i, "stl"],
  [/^bloki zawodnika/i, "blk"],
];

const H2H: [RegExp, H2HMarket][] = [
  [/^zawodnicy h2h - liczba punktów/i, "h2h_pts"],
  [/^zawodnicy h2h - liczba zbiórek/i, "h2h_reb"],
  [/^zawodnicy h2h - liczba asyst/i, "h2h_ast"],
  [/^zawodnicy h2h - liczba trafionych rzutów za 3\s?pkt/i, "h2h_fg3m"],
];
/** alternatywne linie z bardzo nierównymi kursami mają dużą marżę — zostają linie z kursami 1.30–4.00 po obu stronach */
const saneAlt = (a?: number, b?: number) => !!a && !!b && a >= 1.3 && b >= 1.3 && a <= 4 && b <= 4;

const sim = (a: string, b: string) => {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return x.includes(y) || y.includes(x) ? 0.9 : 0;
};
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(path: string): Promise<{ data: T; fromCache: boolean; fetchedAt: number }> {
  const r = await fetchJson<T>(`${BASE}${path}`, { ttl: TTL, source: "Superbet", retries: 1, timeoutMs: 20000 });
  return { data: r.data, fromCache: r.fromCache, fetchedAt: r.fetchedAt };
}

/**
 * Kursy Superbetu na podane mecze ESPN. Zawodnicy dopasowani po nazwisku do składów obu drużyn
 * (`playerIndex`: znormalizowane nazwisko → athleteId, `rosterTeam`: athleteId → teamId).
 */
export async function fetchSuperbet(games: GameRef[], playerIndex: Map<string, string>, rosterTeam: Map<string, string>, force = false): Promise<SuperbetResult> {
  const res: SuperbetResult = { offers: [], matchedGames: 0, events: 0, fetchedAt: 0, unmatchedPlayers: [], errors: [] };
  if (!games.length) return res;
  const starts = games.map((g) => Date.parse(g.date)).sort((a, b) => a - b);
  let events: any[] = [];
  try {
    // okno zaokrąglone do godziny, żeby kopia w pamięci podręcznej trafiała przy kolejnych odświeżeniach strony
    const hour = 3600_000;
    const from = Math.floor((starts[0] - 3 * hour) / hour) * hour, to = Math.ceil((starts[starts.length - 1] + 3 * hour) / hour) * hour;
    const path = `/v2/pl-PL/events/by-date?currentStatus=active&offerState=prematch&startDate=${encodeURIComponent(fmt(from))}&endDate=${encodeURIComponent(fmt(to))}&sportId=${BASKETBALL}`;
    events = ((await (force ? fetchJson<any>(`${BASE}${path}`, { ttl: 0, force: true, source: "Superbet", retries: 1 }) : get<any>(path))).data?.data ?? []).filter((e: any) => e.tournamentId === NBA_TOURNAMENT);
  } catch (e) {
    res.errors.push(`lista meczów: ${(e as Error).message.slice(0, 200)}`);
    return res;
  }
  res.events = events.length;
  const findPlayer = playerMatcher(playerIndex);
  for (const ev of events) {
    const [first, second] = String(ev.matchName ?? "").split("·").map((s: string) => s.trim());
    const st = Date.parse(ev.utcDate ?? `${String(ev.matchDate).replace(" ", "T")}Z`);
    let best: { g: GameRef; s: number } | null = null;
    for (const g of games) {
      if (Math.abs(Date.parse(g.date) - st) > 3 * 3600_000) continue;
      const s = Math.max(sim(first, g.homeName) + sim(second, g.awayName), sim(first, g.awayName) + sim(second, g.homeName));
      if (s >= 1.8 && (!best || s > best.s)) best = { g, s };
    }
    if (!best) continue;
    const g = best.g;
    let odds: any[] = [];
    try {
      const r = force ? await fetchJson<any>(`${BASE}/v2/pl-PL/events/${ev.eventId}`, { ttl: 0, force: true, source: "Superbet", retries: 1 }) : await get<any>(`/v2/pl-PL/events/${ev.eventId}`);
      odds = r.data?.data?.[0]?.odds ?? [];
      res.fetchedAt = Math.max(res.fetchedAt, r.fetchedAt);
      if (!r.fromCache) await sleep(1000); // ~1 zapytanie na sekundę
    } catch (e) {
      const msg = (e as Error).message;
      res.errors.push(`${first}–${second}: ${msg.slice(0, 160)}`);
      if (/40[13]|429/.test(msg)) break; // blokada / limit — nie ponawiamy i nie obchodzimy
      continue;
    }
    res.matchedGames++;
    const teamOf = (name: string): { id: string; side: "home" | "away" } | null => {
      const h = sim(name, g.homeName), a = sim(name, g.awayName);
      if (h === a) return null;
      return h > a ? { id: g.homeId, side: "home" } : { id: g.awayId, side: "away" };
    };
    const inGame = [g.homeId, g.awayId].map((t) => (id: string) => rosterTeam.get(id) === t);
    const athlete = (raw: string): string | null => {
      const id = findPlayer(raw, inGame);
      if (!id && res.unmatchedPlayers.length < 15 && !res.unmatchedPlayers.includes(raw)) res.unmatchedPlayers.push(raw);
      return id;
    };
    const mk = (market: Market, subjectId: string, side: PapiOffer["side"], line: number | null, dec: number, opp: number | null, kind: PapiOffer["kind"]): PapiOffer => ({
      gameId: g.gameId, market, subjectId, side, line, book: "superbet", bookTitle: "Superbet", dec, oppDec: opp, lastUpdate: null, kind,
    });
    // grupowanie par (np. powyżej/poniżej tej samej linii)
    const pairs = new Map<string, { market: Market; subj: string; line: number | null; kind: PapiOffer["kind"]; a?: number; b?: number; sideA: PapiOffer["side"]; sideB: PapiOffer["side"]; subjB?: string }>();
    const put = (key: string, init: () => NonNullable<ReturnType<typeof pairs.get>>, slot: "a" | "b", price: number) => {
      const p = pairs.get(key) ?? init();
      p[slot] = price;
      pairs.set(key, p);
    };
    const ouSlot = (name: string): "a" | "b" | null => (/powyżej/i.test(name) ? "a" : /poniżej/i.test(name) ? "b" : null);
    for (const o of odds) {
      if (o.status !== "active" || !(o.price > 1)) continue;
      const mName = String(o.marketName ?? "").trim();
      if (mName.includes(";") || /kwarta|połowa|pierwszy|najwięcej|łączna|wyścig|faul|oddanych/i.test(mName)) continue;
      const sp = o.specifiers ?? {};
      const name = String(o.name ?? "");
      let mm: Market | undefined;
      if (sp.player && sp.total != null && (mm = OU.find(([re]) => re.test(mName))?.[1])) {
        const slot = ouSlot(name);
        const id = slot ? athlete(sp.player) : null;
        if (!slot || !id) continue;
        const line = Number(sp.total);
        put(`${mm}|${id}|${line}`, () => ({ market: mm!, subj: id, line, kind: "ou", sideA: "over", sideB: "under" }), slot, o.price);
      } else if (sp.player && sp.milestone != null && (mm = LADDER.find(([re]) => re.test(mName))?.[1])) {
        const id = athlete(sp.player);
        if (id) res.offers.push(mk(mm, id, "over", Number(sp.milestone) - 0.5, o.price, null, "milestone"));
      } else if (sp.player && /^zawodnik - (double double|triple double)/i.test(mName)) {
        if (!/- tak$/i.test(name)) continue;
        const id = athlete(sp.player);
        if (id) res.offers.push(mk(/triple/i.test(mName) ? "td" : "dd", id, "yes", 0.5, o.price, null, "yes"));
      } else if (/^zwycięzca \(z dogrywką\)$/i.test(mName) && (o.code === "1" || o.code === "2")) {
        // kod 1 = pierwsza drużyna w nazwie meczu Superbetu
        const t = teamOf(o.code === "1" ? first : second);
        if (t) put(`ml`, () => ({ market: "ml", subj: "", line: null, kind: "game", sideA: "home", sideB: "away" }), t.side === "home" ? "a" : "b", o.price);
      } else if (/^handicap \(z dogrywką\)$/i.test(mName)) {
        const m = name.match(/^(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)$/);
        const t = m ? teamOf(m[1]) : null;
        if (!m || !t) continue;
        const homeLine = t.side === "home" ? Number(m[2]) : -Number(m[2]);
        put(`spread|${homeLine}`, () => ({ market: "spread", subj: "", line: homeLine, kind: "game", sideA: "home", sideB: "away" }), t.side === "home" ? "a" : "b", o.price);
      } else if ((mm = H2H.find(([re]) => re.test(mName))?.[1]) && sp.player1 && sp.player2) {
        // „Diabate, Moussa > Wells, Jaylen” — zakład na pierwszego z nazwy (remis = zwrot)
        const [x, y] = name.split(">").map((t) => t.trim());
        const ia = x ? athlete(x) : null, ib = y ? athlete(y) : null;
        if (!ia || !ib) continue;
        const [k1, k2] = [ia, ib].sort();
        put(`${mm}|${k1}:${k2}`, () => ({ market: mm!, subj: `${k1}:${k2}`, line: null, kind: "yes", sideA: "yes", sideB: "yes", subjB: `${k2}:${k1}` }), ia === k1 ? "a" : "b", o.price);
      } else if (sp.total != null && /liczba punktów \(z dogrywką\)$/i.test(mName) && !/^liczba punktów/i.test(mName)) {
        // punkty drużyny: „Charlotte Hornets liczba punktów (z dogrywką)”
        const t = teamOf(mName.replace(/\s*liczba punktów.*$/i, ""));
        const slot = ouSlot(name);
        if (!t || !slot) continue;
        const line = Number(sp.total);
        put(`team_total|${t.id}|${line}`, () => ({ market: "team_total", subj: t.id, line, kind: "game", sideA: "over", sideB: "under" }), slot, o.price);
      } else if (/^liczba punktów \(z dogrywką\)$/i.test(mName) && sp.total != null) {
        const slot = ouSlot(name);
        if (!slot) continue;
        const line = Number(sp.total);
        put(`total|${line}`, () => ({ market: "total", subj: "game", line, kind: "game", sideA: "over", sideB: "under" }), slot, o.price);
      }
    }
    // alternatywne linie handicapu i sum: zostają te z rozsądnymi kursami po obu stronach (bez skrajnych linii z dużą marżą)
    for (const [k, p] of pairs) if ((p.market === "spread" || p.market === "total" || p.market === "team_total") && !saneAlt(p.a, p.b)) pairs.delete(k);
    for (const p of pairs.values()) {
      if (p.market === "ml" || p.market === "spread") {
        // strona gospodarza / gościa; linia handicapu z perspektywy danej strony
        if (p.a) res.offers.push(mk(p.market, g.homeId, "home", p.line, p.a, p.b ?? null, "game"));
        if (p.b) res.offers.push(mk(p.market, g.awayId, "away", p.line == null ? null : -p.line, p.b, p.a ?? null, "game"));
        continue;
      }
      if (p.subjB) {
        // pojedynek: każda strona to osobny „temat” A:B (A więcej niż B), kurs przeciwny = druga strona
        if (p.a) res.offers.push(mk(p.market, p.subj, "yes", null, p.a, p.b ?? null, "yes"));
        if (p.b) res.offers.push(mk(p.market, p.subjB, "yes", null, p.b, p.a ?? null, "yes"));
        continue;
      }
      if (p.a) res.offers.push(mk(p.market, p.subj, p.sideA, p.line, p.a, p.b ?? null, p.kind));
      if (p.b) res.offers.push(mk(p.market, p.subj, p.sideB, p.line, p.b, p.a ?? null, p.kind));
    }
  }
  return res;
}
