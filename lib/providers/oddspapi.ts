/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OddsPapi v5 (https://docs.oddspapi.io) — optional feed used here for Polish bookmakers.
 * Auth: X-API-Key header (ODDSPAPI_KEY). Endpoints used: /bookmakers, /fixtures, /markets,
 * /players, /fixtures/odds. Odds are keyed by frozen outcome ids; /markets decodes them into
 * marketType / period / handicap / side, and /players resolves playerId → name.
 *
 * Coverage of Superbet / Betclic / Betfan depends on the OddsPapi plan and is NOT guaranteed:
 * the Settings page lists the Polish books the configured key can actually see.
 */
import { config } from "../config";
import { fetchJson } from "../http";
import type { Market } from "../markets";
import { normName, type GameRef, type Offer } from "./oddsapi";

const BASE = "https://v5.oddspapi.io/en";
const NBA_SPORT = 11;
const NBA_TOURNAMENT = 132;

export function oddsPapiEnabled() {
  return Boolean(config.oddsPapiKey);
}

/** oddspapi slug → local book key (e.g. superbet.pl → superbet) */
export function bookmakerMap(): Map<string, string> {
  return new Map(
    config.oddsPapiBookmakers
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [slug, key] = p.split(":");
        return [slug.trim(), (key ?? slug).trim().toLowerCase()] as [string, string];
      }),
  );
}

async function get<T>(path: string, params: Record<string, string | number>, ttl: number): Promise<T> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetchJson<T>(`${BASE}${path}?${q}`, {
    ttl,
    source: `OddsPapi ${path}`,
    key: `oddspapi:${path}?${q}`, // the key travels in a header, never in the cache key
    headers: { "X-API-Key": config.oddsPapiKey },
  });
  return r.data;
}

export interface PapiBookmaker {
  slug: string;
  bookmakerName: string;
  active: boolean;
  domain?: string;
  availableCountries?: string[];
}

/** Bookmakers visible to this key; `polish` = available in Poland or a Polish brand. */
export async function listBookmakers(): Promise<(PapiBookmaker & { polish: boolean })[]> {
  const rows = await get<PapiBookmaker[]>("/bookmakers", {}, 6 * 3600);
  return rows.map((b) => ({
    ...b,
    polish:
      (b.availableCountries ?? []).map((c) => c.toLowerCase()).includes("pl") ||
      /\.pl\b|superbet|betclic|betfan|\bsts\b|fortuna|lvbet|etoto|totolotek|forbet|betcris/i.test(`${b.slug} ${b.bookmakerName} ${b.domain ?? ""}`),
  }));
}

interface PapiMarket {
  marketId: number;
  marketLength: number;
  playerProp: boolean;
  handicap: number;
  period: string;
  marketType: string;
  marketName?: string;
  outcomes: { outcomeId: number; outcomeName: string }[];
}

let marketCache: { at: number; byOutcome: Map<number, { m: PapiMarket; name: string }> } | null = null;

async function marketIndex() {
  if (marketCache && Date.now() - marketCache.at < 6 * 3600 * 1000) return marketCache.byOutcome;
  const markets = await get<PapiMarket[]>("/markets", { sportId: NBA_SPORT }, 24 * 3600);
  const byOutcome = new Map<number, { m: PapiMarket; name: string }>();
  for (const m of markets) for (const o of m.outcomes ?? []) byOutcome.set(o.outcomeId, { m, name: o.outcomeName });
  marketCache = { at: Date.now(), byOutcome };
  return byOutcome;
}

/**
 * Map an OddsPapi market to a canonical market. Game markets use documented types; player-prop
 * type names are matched on marketType/marketName text (OddsPapi's taxonomy is open), and anything
 * unrecognised is skipped rather than guessed.
 */
export function canonicalMarket(m: PapiMarket): Market | null {
  if (!["result", "fulltime+overtime", "fulltime"].includes(m.period) && !m.playerProp) return null;
  if (m.marketType === "moneyline") return "ml";
  if (m.marketType === "spreads") return "spread";
  if (m.marketType === "totals") return "total";
  if (!m.playerProp) return null;
  const t = `${m.marketType} ${m.marketName ?? ""}`.toLowerCase().replace(/[_\s]+/g, "-");
  const has = (w: string) => t.includes(w);
  const pts = has("point"), reb = has("rebound"), ast = has("assist");
  if (pts && reb && ast) return "pra";
  if (pts && reb) return "pr";
  if (pts && ast) return "pa";
  if (reb && ast) return "ra";
  if (has("double-double")) return "dd";
  if (has("triple-double")) return "td";
  if (has("three") || has("3-point") || has("3pt")) return "fg3m";
  if (has("steal") && has("block")) return "stocks";
  if (pts) return "pts";
  if (reb) return "reb";
  if (ast) return "ast";
  if (has("steal")) return "stl";
  if (has("block")) return "blk";
  if (has("turnover")) return "tov";
  return null;
}

export interface PapiResult {
  offers: Offer[];
  matchedFixtures: number;
  skippedMarkets: number;
  books: string[];
  fetchedAt: number;
}

/**
 * Polish-book offers for the given ESPN games. Player names are matched to ESPN athletes through
 * the supplied index (normalised "first last"); OddsPapi lists names as "Last, First".
 */
export async function fetchPolishOffers(games: GameRef[], playerIndex: Map<string, string>): Promise<PapiResult> {
  const bmap = bookmakerMap();
  const slugs = [...bmap.keys()].join(",");
  const out: Offer[] = [];
  let skipped = 0;
  if (!games.length) return { offers: out, matchedFixtures: 0, skippedMarkets: 0, books: [], fetchedAt: Date.now() };
  const from = Math.floor(Math.min(...games.map((g) => Date.parse(g.date))) / 1000) - 6 * 3600;
  const to = Math.floor(Math.max(...games.map((g) => Date.parse(g.date))) / 1000) + 6 * 3600;
  const fixtures = await get<any[]>("/fixtures", { sportId: NBA_SPORT, tournamentId: NBA_TOURNAMENT, startTimeFrom: from, startTimeTo: to }, 600);
  const index = await marketIndex();
  const books = new Set<string>();
  let matched = 0;
  for (const f of fixtures) {
    const p = f.participants ?? {};
    // OddsPapi: participant1 = home (first-listed), participant2 = away
    const g = games.find(
      (x) =>
        normName(x.homeName) === normName(p.participant1Name ?? "") &&
        normName(x.awayName) === normName(p.participant2Name ?? "") &&
        Math.abs(Date.parse(x.date) / 1000 - f.startTime) < 12 * 3600,
    );
    if (!g) continue;
    matched++;
    const odds = await get<any>("/fixtures/odds", { fixtureId: f.fixtureId, bookmakers: slugs }, config.ttl.oddsPapi);
    const playerIds = new Set<number>();
    for (const bk of Object.values<any>(odds.odds ?? {})) for (const q of Object.values<any>(bk)) if (q.playerId) playerIds.add(q.playerId);
    const players = new Map<number, string>();
    if (playerIds.size) {
      const ids = [...playerIds];
      for (let i = 0; i < ids.length; i += 100) {
        const rows = await get<{ playerId: number; playerName: string }[]>("/players", { playerIds: ids.slice(i, i + 100).join(",") }, 24 * 3600);
        for (const r of rows) players.set(r.playerId, r.playerName);
      }
    }
    for (const [slug, quotes] of Object.entries<any>(odds.odds ?? {})) {
      const key = bmap.get(slug) ?? slug;
      const rotated = Boolean(odds.bookmakers?.[slug]?.participantsRotated);
      // group quotes by (marketId, playerId) so both sides of a line are paired
      const groups = new Map<string, { m: PapiMarket; sides: Map<string, number> }>();
      for (const q of Object.values<any>(quotes)) {
        if (!q.active) continue;
        const hit = index.get(q.outcomeId);
        if (!hit) continue;
        const k = `${hit.m.marketId}|${q.playerId}`;
        if (!groups.has(k)) groups.set(k, { m: hit.m, sides: new Map() });
        groups.get(k)!.sides.set(hit.name.toLowerCase(), q.price);
      }
      for (const [k, { m, sides }] of groups) {
        const market = canonicalMarket(m);
        if (!market) {
          skipped++;
          continue;
        }
        books.add(key);
        const playerId = Number(k.split("|")[1]);
        const mk = (subjectId: string, side: Offer["side"], line: number | null, dec: number, opp: number | null): Offer => ({
          gameId: g.gameId, market, subjectId, side, line, book: key, bookTitle: titleOf(key), dec, oppDec: opp, lastUpdate: null,
        });
        const s1 = sides.get("1") ?? sides.get("home"), s2 = sides.get("2") ?? sides.get("away");
        const over = sides.get("over"), under = sides.get("under"), yes = sides.get("yes");
        if (market === "ml" && s1 && s2) {
          const [h, a] = rotated ? [s2, s1] : [s1, s2];
          out.push(mk(g.homeId, "home", null, h, a), mk(g.awayId, "away", null, a, h));
        } else if (market === "spread" && s1 && s2) {
          // handicap is quoted for participant 1 (home)
          const [h, a] = rotated ? [s2, s1] : [s1, s2];
          out.push(mk(g.homeId, "home", m.handicap, h, a), mk(g.awayId, "away", -m.handicap, a, h));
        } else if (market === "total" && over && under) {
          out.push(mk("game", "over", m.handicap, over, under), mk("game", "under", m.handicap, under, over));
        } else if (playerId) {
          const raw = players.get(playerId) ?? "";
          const name = raw.includes(",") ? raw.split(",").map((s) => s.trim()).reverse().join(" ") : raw;
          const athleteId = playerIndex.get(normName(name));
          if (!athleteId) {
            skipped++;
            continue;
          }
          if (yes) out.push(mk(athleteId, "yes", 0.5, yes, sides.get("no") ?? null));
          else if (over || under) {
            if (over) out.push(mk(athleteId, "over", m.handicap, over, under ?? null));
            if (under) out.push(mk(athleteId, "under", m.handicap, under, over ?? null));
          }
        }
      }
    }
  }
  return { offers: out, matchedFixtures: matched, skippedMarkets: skipped, books: [...books], fetchedAt: Date.now() };
}

function titleOf(key: string) {
  return { superbet: "Superbet", betclic: "Betclic", betfan: "Betfan" }[key] ?? key;
}
