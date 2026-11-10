/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Odds API v4 (https://the-odds-api.com) — optional multi-bookmaker odds.
 * Requires ODDS_API_KEY. Each request costs credits (markets × regions), so responses are
 * cached for config.ttl.oddsApi seconds and player props are only requested per event on demand.
 */
import { config } from "../config";
import { fetchJson } from "../http";
import { ODDS_API_PLAYER_MARKETS, type Market } from "../markets";

const BASE = "https://api.the-odds-api.com/v4/sports/basketball_nba";

export interface Offer {
  gameId: string;
  market: Market;
  subjectId: string; // athleteId for props, teamId for ml/spread, "game" for totals
  side: "over" | "under" | "yes" | "home" | "away";
  line: number | null; // spread from the side's perspective, total, or prop line
  book: string;
  bookTitle: string;
  dec: number;
  /** price of the opposite side at the same book & line (enables no-vig) */
  oppDec: number | null;
  lastUpdate: string | null;
}

export interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export function oddsApiEnabled() {
  return Boolean(config.oddsApiKey);
}

function url(path: string, params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, apiKey: config.oddsApiKey });
  return `${BASE}${path}?${q}`;
}
/** cache key without the secret */
function key(path: string, params: Record<string, string>) {
  return `oddsapi:${path}?${new URLSearchParams(params)}`;
}

export async function fetchEvents(): Promise<OddsApiEvent[]> {
  const params = { dateFormat: "iso" };
  const r = await fetchJson<any[]>(url("/events", params), { ttl: config.ttl.oddsApi, source: "The Odds API events", key: key("/events", params) });
  return r.data;
}

export async function fetchGameOdds(): Promise<{ events: any[]; fetchedAt: number }> {
  const params = { regions: config.oddsApiRegions, markets: "h2h,spreads,totals", oddsFormat: "decimal", dateFormat: "iso" };
  const r = await fetchJson<any[]>(url("/odds", params), { ttl: config.ttl.oddsApi, source: "The Odds API odds", key: key("/odds", params) });
  return { events: r.data, fetchedAt: r.fetchedAt };
}

export async function fetchEventProps(eventId: string): Promise<{ event: any; fetchedAt: number }> {
  const params = { regions: config.oddsApiRegions, markets: config.oddsApiPropMarkets, oddsFormat: "decimal", dateFormat: "iso" };
  const path = `/events/${eventId}/odds`;
  const r = await fetchJson<any>(url(path, params), { ttl: config.ttl.oddsApi, source: "The Odds API props", key: key(path, params) });
  return { event: r.data, fetchedAt: r.fetchedAt };
}

export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface GameRef {
  gameId: string;
  date: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
}

export function matchEvent(ev: OddsApiEvent, games: GameRef[]): GameRef | null {
  return (
    games.find(
      (g) =>
        normName(g.homeName) === normName(ev.home_team) &&
        normName(g.awayName) === normName(ev.away_team) &&
        Math.abs(Date.parse(g.date) - Date.parse(ev.commence_time)) < 12 * 3600 * 1000,
    ) ?? null
  );
}

/** Convert an Odds API event (with bookmakers) into canonical offers. */
export function eventToOffers(ev: any, game: GameRef, playerIndex: Map<string, string>): Offer[] {
  const out: Offer[] = [];
  for (const bk of ev.bookmakers ?? []) {
    for (const mk of bk.markets ?? []) {
      const outcomes: any[] = mk.outcomes ?? [];
      const find = (pred: (o: any) => boolean) => outcomes.find(pred);
      if (mk.key === "h2h") {
        const h = find((o) => normName(o.name) === normName(game.homeName));
        const a = find((o) => normName(o.name) === normName(game.awayName));
        if (h && a) {
          out.push(mk2(game.gameId, "ml", game.homeId, "home", null, bk, h.price, a.price, mk.last_update));
          out.push(mk2(game.gameId, "ml", game.awayId, "away", null, bk, a.price, h.price, mk.last_update));
        }
      } else if (mk.key === "spreads") {
        const h = find((o) => normName(o.name) === normName(game.homeName));
        const a = find((o) => normName(o.name) === normName(game.awayName));
        if (h && a) {
          out.push(mk2(game.gameId, "spread", game.homeId, "home", h.point, bk, h.price, a.price, mk.last_update));
          out.push(mk2(game.gameId, "spread", game.awayId, "away", a.point, bk, a.price, h.price, mk.last_update));
        }
      } else if (mk.key === "totals") {
        const o = find((x) => x.name === "Over");
        const u = find((x) => x.name === "Under");
        if (o && u && o.point === u.point) {
          out.push(mk2(game.gameId, "total", "game", "over", o.point, bk, o.price, u.price, mk.last_update));
          out.push(mk2(game.gameId, "total", "game", "under", u.point, bk, u.price, o.price, mk.last_update));
        }
      } else if (ODDS_API_PLAYER_MARKETS[mk.key]) {
        const market = ODDS_API_PLAYER_MARKETS[mk.key];
        const byPlayerLine = new Map<string, { over?: any; under?: any; yes?: any }>();
        for (const o of outcomes) {
          const athleteId = playerIndex.get(normName(o.description ?? ""));
          if (!athleteId) continue;
          const k = `${athleteId}|${o.point ?? ""}`;
          if (!byPlayerLine.has(k)) byPlayerLine.set(k, {});
          const slot = byPlayerLine.get(k)!;
          if (o.name === "Over") slot.over = o;
          else if (o.name === "Under") slot.under = o;
          else if (o.name === "Yes") slot.yes = o;
        }
        for (const [k, s] of byPlayerLine) {
          const athleteId = k.split("|")[0];
          if (s.yes) {
            const no = outcomes.find((o) => o.name === "No" && playerIndex.get(normName(o.description ?? "")) === athleteId);
            out.push(mk2(game.gameId, market, athleteId, "yes", 0.5, bk, s.yes.price, no?.price ?? null, mk.last_update));
            continue;
          }
          if (s.over)
            out.push(mk2(game.gameId, market, athleteId, "over", s.over.point, bk, s.over.price, s.under?.price ?? null, mk.last_update));
          if (s.under)
            out.push(mk2(game.gameId, market, athleteId, "under", s.under.point, bk, s.under.price, s.over?.price ?? null, mk.last_update));
        }
      }
    }
  }
  return out;
}

function mk2(gameId: string, market: Market, subjectId: string, side: Offer["side"], line: number | null, bk: any, dec: number, oppDec: number | null, lastUpdate: string | null): Offer {
  return { gameId, market, subjectId, side, line: line ?? null, book: bk.key, bookTitle: bk.title, dec, oppDec, lastUpdate: lastUpdate ?? null };
}
