/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OddsPapi v4 (https://api.oddspapi.io/v4) — optional feed used here for Polish bookmakers.
 * Auth: `apiKey` query parameter (ODDSPAPI_KEY); the key never enters the cache key or logs.
 *
 * Verified against live responses (2026-11-10): Superbet PL (`superbet.pl`) publishes NBA
 * moneyline/spreads/totals and player props — O/U (`playertotals-*`) and "N+" ladders
 * (`players-*`). Fortuna PL (`efortuna.pl`) has game lines only. Betclic PL and Betfan are not
 * in OddsPapi (enter them manually).
 *
 * Shapes used:
 *   /bookmakers                      → [{ slug, bookmakerName, liveOdds, cloneOf }]
 *   /participants?sportId=11         → { [participantId]: name }
 *   /markets?sportId=11              → [{ marketId, marketType, period, handicap, playerProp, outcomes[{outcomeId,outcomeName}] }]
 *   /fixtures?tournamentId=132&from&to → [{ fixtureId, participant1Id (home), participant2Id, startTime, statusId }]
 *   /odds?fixtureId&bookmakers       → { bookmakerOdds: { [slug]: { markets: { [marketId]: { outcomes: { [outcomeId]: { players: { [playerId]: { price, active, playerName } } } } } } } } }
 */
import { config } from "../config";
import { fetchJson } from "../http";
import type { Market } from "../markets";
import { normName, type GameRef, type Offer } from "./oddsapi";

const BASE = "https://api.oddspapi.io/v4";
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
  const keyed = new URLSearchParams(q);
  keyed.set("apiKey", config.oddsPapiKey);
  const r = await fetchJson<T>(`${BASE}${path}?${keyed}`, { ttl, source: `OddsPapi ${path}`, key: `oddspapi4:${path}?${q}` });
  return r.data;
}

export interface PapiBookmaker {
  slug: string;
  bookmakerName: string;
  liveOdds?: boolean;
  cloneOf?: string | null;
}

/** Bookmakers visible to this key; `polish` = Polish site/brand. */
export async function listBookmakers(): Promise<(PapiBookmaker & { polish: boolean })[]> {
  const rows = await get<PapiBookmaker[]>("/bookmakers", {}, 6 * 3600);
  return rows.map((b) => ({ ...b, polish: /\.pl$|\bPL\b|betfan|lvbet|etoto|totolotek/i.test(`${b.slug} ${b.bookmakerName}`) || /\.pl$/.test(b.slug) }));
}

export interface PapiMarket {
  marketId: number;
  marketLength?: number;
  playerProp: boolean;
  handicap: number;
  period: string;
  marketType: string;
  marketName?: string;
  outcomes: { outcomeId: number; outcomeName: string }[];
}

let marketCache: { at: number; byId: Map<number, PapiMarket> } | null = null;
async function marketIndex() {
  if (marketCache && Date.now() - marketCache.at < 6 * 3600 * 1000) return marketCache.byId;
  const markets = await get<PapiMarket[]>("/markets", { sportId: NBA_SPORT }, 24 * 3600);
  marketCache = { at: Date.now(), byId: new Map(markets.map((m) => [m.marketId, m])) };
  return marketCache.byId;
}

const PROP_TYPES: Record<string, Market> = {
  points: "pts", rebounds: "reb", assists: "ast", "3pointers": "fg3m", turnovers: "tov", steals: "stl", blocks: "blk",
  ptsassreb: "pra", ptsreb: "pr", ptsass: "pa", assreb: "ra", stlblk: "stocks", blkstl: "stocks",
  doubledouble: "dd", tripledouble: "td",
};

/**
 * Canonical market for an OddsPapi market, or null. Only full-game markets (incl. overtime,
 * period "result") are used; quarter/half markets and unknown prop types are skipped.
 *   kind "ou"        — two-way line (playertotals-*, totals, spreads, moneyline)
 *   kind "milestone" — one-way "N+" ladder (players-*), each outcome is its own threshold
 */
export function canonicalMarket(m: Pick<PapiMarket, "marketType" | "period" | "playerProp">): { market: Market; kind: "ou" | "milestone" | "game" } | null {
  if (m.period !== "result") return null;
  if (m.marketType === "moneyline") return { market: "ml", kind: "game" };
  if (m.marketType === "spreads") return { market: "spread", kind: "game" };
  if (m.marketType === "totals") return { market: "total", kind: "game" };
  const ou = m.marketType.match(/^playertotals-(.+)$/);
  if (ou && PROP_TYPES[ou[1]]) return { market: PROP_TYPES[ou[1]], kind: "ou" };
  const ms = m.marketType.match(/^players-(.+)$/);
  if (ms && PROP_TYPES[ms[1]]) return { market: PROP_TYPES[ms[1]], kind: "milestone" };
  return null;
}

export type PapiOffer = Offer & { kind: "ou" | "milestone" | "yes" | "game" };

/**
 * Odds for one fixture. If the combined request is refused (e.g. a plan that limits bookmakers
 * per request or does not include one of them), retry one bookmaker at a time and keep the rest.
 */
/** Shorten OddsPapi's "Invalid bookmaker(s)" error (which lists ~400 slugs) to the useful part. */
export function explainPapiError(msg: string): string {
  const valid = msg.match(/Valid bookmakers are:\s*(.+)$/s);
  const invalid = msg.match(/Invalid bookmakers?:\s*(.+?)\.\s+Valid/s)?.[1]?.trim();
  if (!valid) return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
  const pl = valid[1].split(/,\s*/).map((s) => s.trim()).filter((s) => /\.pl$/.test(s));
  return `nieznany slug bukmachera${invalid ? ` „${invalid}”` : ""} — popraw ODDSPAPI_BOOKMAKERS w .env.local. Dostępne polskie: ${pl.join(", ") || "brak"}`;
}

async function fetchFixtureOdds(fixtureId: string, slugs: string[], result: PapiResult): Promise<Record<string, any>> {
  try {
    return (await get<any>("/odds", { fixtureId, bookmakers: slugs.join(",") }, config.ttl.oddsPapi)).bookmakerOdds ?? {};
  } catch (e) {
    if (slugs.length < 2) {
      result.errors.push(`${slugs[0]}: ${explainPapiError((e as Error).message)}`);
      return {};
    }
    const out: Record<string, any> = {};
    for (const slug of slugs) {
      try {
        Object.assign(out, (await get<any>("/odds", { fixtureId, bookmakers: slug }, config.ttl.oddsPapi)).bookmakerOdds ?? {});
      } catch (e2) {
        result.errors.push(`${slug}: ${explainPapiError((e2 as Error).message)}`);
      }
    }
    return out;
  }
}

export interface PapiResult {
  offers: PapiOffer[];
  matchedFixtures: number;
  skippedMarkets: number;
  /** player prices dropped because the player is not on either team's roster (feed mix-ups) */
  foreignPlayers: number;
  books: string[];
  fetchedAt: number;
  /** per-bookmaker/per-game failures that did not stop the rest */
  errors: string[];
}

const flipName = (s: string) => (s.includes(",") ? s.split(",").map((x) => x.trim()).reverse().join(" ") : s);
const titleOf = (key: string) => ({ superbet: "Superbet", betclic: "Betclic", betfan: "Betfan", fortuna: "Fortuna", sts: "STS", forbet: "Forbet" })[key] ?? key;

/** Polish-book offers for the given ESPN games; players are matched by name to the two teams' rosters. */
export async function fetchPolishOffers(games: GameRef[], playerIndex: Map<string, string>, rosterTeam?: Map<string, string>): Promise<PapiResult> {
  const result: PapiResult = { offers: [], matchedFixtures: 0, skippedMarkets: 0, foreignPlayers: 0, books: [], fetchedAt: Date.now(), errors: [] };
  if (!games.length) return result;
  const bmap = bookmakerMap();
  const days = games.map((g) => g.date.slice(0, 10)).sort();
  const addDay = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
  const [participants, fixtures, markets] = await Promise.all([
    get<Record<string, string>>("/participants", { sportId: NBA_SPORT, tournamentId: NBA_TOURNAMENT }, 7 * 86400),
    get<any[]>("/fixtures", { tournamentId: NBA_TOURNAMENT, from: addDay(days[0], -1), to: addDay(days[days.length - 1], 1) }, 600),
    marketIndex(),
  ]);
  const books = new Set<string>();
  for (const f of fixtures) {
    if (f.statusId !== 0) continue;
    const home = participants[String(f.participant1Id)] ?? "";
    const away = participants[String(f.participant2Id)] ?? "";
    const g = games.find(
      (x) => normName(x.homeName) === normName(home) && normName(x.awayName) === normName(away) && Math.abs(Date.parse(x.date) - Date.parse(f.startTime)) < 12 * 3600 * 1000,
    );
    if (!g) continue;
    result.matchedFixtures++;
    const bookmakerOdds = await fetchFixtureOdds(f.fixtureId, [...bmap.keys()], result);
    for (const [slug, bk] of Object.entries<any>(bookmakerOdds)) {
      if (!bk.bookmakerIsActive || bk.suspended) continue;
      const key = bmap.get(slug) ?? slug;
      const mk = (market: Market, subjectId: string, side: Offer["side"], line: number | null, dec: number, opp: number | null, kind: PapiOffer["kind"]): PapiOffer => ({
        gameId: g.gameId, market, subjectId, side, line, book: key, bookTitle: titleOf(key), dec, oppDec: opp, lastUpdate: null, kind,
      });
      for (const [mid, m] of Object.entries<any>(bk.markets ?? {})) {
        const meta = markets.get(Number(mid));
        const cm = meta ? canonicalMarket(meta) : null;
        if (!meta || !cm) {
          result.skippedMarkets++;
          continue;
        }
        const nameOf = new Map(meta.outcomes.map((o) => [String(o.outcomeId), o.outcomeName]));
        // price[outcomeName][playerId]
        const price = new Map<string, Map<string, { p: number; name: string | null }>>();
        for (const [oid, o] of Object.entries<any>(m.outcomes ?? {})) {
          const on = nameOf.get(oid);
          if (!on) continue;
          for (const [pid, q] of Object.entries<any>(o.players ?? {})) {
            if (!q.active || !(q.price > 1)) continue;
            if (!price.has(on)) price.set(on, new Map());
            price.get(on)!.set(pid, { p: q.price, name: q.playerName ?? null });
          }
        }
        if (!price.size) continue;
        books.add(key);
        if (cm.kind === "game") {
          const p1 = price.get("1")?.get("0")?.p, p2 = price.get("2")?.get("0")?.p;
          const ov = price.get("Over")?.get("0")?.p, un = price.get("Under")?.get("0")?.p;
          if (cm.market === "ml" && p1 && p2) result.offers.push(mk("ml", g.homeId, "home", null, p1, p2, "game"), mk("ml", g.awayId, "away", null, p2, p1, "game"));
          // spreads: handicap is participant 1's (home) line; outcome "2" takes the opposite line
          if (cm.market === "spread" && p1 && p2) result.offers.push(mk("spread", g.homeId, "home", meta.handicap, p1, p2, "game"), mk("spread", g.awayId, "away", -meta.handicap, p2, p1, "game"));
          if (cm.market === "total" && ov && un) result.offers.push(mk("total", "game", "over", meta.handicap, ov, un, "game"), mk("total", "game", "under", meta.handicap, un, ov, "game"));
          continue;
        }
        const athleteOf = (pid: string, name: string | null): string | null => {
          if (pid === "0" || !name) return null;
          const id = playerIndex.get(normName(flipName(name)));
          if (!id || (rosterTeam && ![g.homeId, g.awayId].includes(rosterTeam.get(id) ?? ""))) {
            result.foreignPlayers++;
            return null;
          }
          return id;
        };
        if (cm.kind === "ou") {
          const overs = price.get("Over") ?? new Map(), unders = price.get("Under") ?? new Map();
          for (const pid of new Set([...overs.keys(), ...unders.keys()])) {
            const o = overs.get(pid), u = unders.get(pid);
            const id = athleteOf(pid, o?.name ?? u?.name ?? null);
            if (!id) continue;
            if (o) result.offers.push(mk(cm.market, id, "over", meta.handicap, o.p, u?.p ?? null, "ou"));
            if (u) result.offers.push(mk(cm.market, id, "under", meta.handicap, u.p, o?.p ?? null, "ou"));
          }
        } else {
          // "N+" ladder: each outcome is a one-way bet on at least N → over N − 0.5
          for (const [on, byPlayer] of price) {
            const n = on.match(/^(\d+)\+$/);
            if (!n) continue;
            for (const [pid, q] of byPlayer) {
              const id = athleteOf(pid, q.name);
              if (id) result.offers.push(mk(cm.market, id, "over", Number(n[1]) - 0.5, q.p, null, "milestone"));
            }
          }
        }
      }
    }
  }
  result.books = [...books];
  result.fetchedAt = Date.now();
  return result;
}
