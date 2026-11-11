import path from "node:path";

/** Central runtime configuration. Secrets come only from environment variables. */
export const config = {
  dataDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.DATA_DIR || "./data"),
  oddsApiKey: process.env.ODDS_API_KEY || "",
  oddsApiRegions: process.env.ODDS_API_REGIONS || "us,eu",
  oddsApiPropMarkets:
    process.env.ODDS_API_PROP_MARKETS ||
    "player_points,player_rebounds,player_assists,player_points_rebounds_assists,player_threes,player_turnovers",
  /** OddsPapi v4 (https://oddspapi.io) — optional feed; covers Superbet PL (props + game lines) and Fortuna PL (game lines). */
  oddsPapiKey: process.env.ODDSPAPI_KEY || "",
  /** "oddspapiSlug:localKey" pairs; verify slugs on the Settings page (list of books your key can see). */
  oddsPapiBookmakers: process.env.ODDSPAPI_BOOKMAKERS || "superbet.pl:superbet,betclic.pl:betclic",
  /**
   * OddsPapi request budget. Requests are only made when the user clicks "Pobierz kursy"
   * (or every N minutes if ODDSPAPI_AUTO_REFRESH_MIN > 0); page refreshes reuse cached odds.
   */
  /** 0 (domyślnie) = bez limitu aplikacji; > 0 = maksymalna liczba zapytań dziennie */
  oddsPapiDailyLimit: Math.max(0, Number(process.env.ODDSPAPI_DAILY_LIMIT || 0)),
  oddsPapiAutoRefreshMin: Number(process.env.ODDSPAPI_AUTO_REFRESH_MIN || 0),
  /** Cache TTLs in seconds. Finished games are immutable and cached forever. */
  ttl: {
    scoreboardToday: 120,
    propsLive: 300,
    injuries: 600,
    roster: 6 * 3600,
    teams: 7 * 86400,
    priorSeasonLog: 30 * 86400,
    oddsApi: 1800,
    oddsPapi: 300,
  },
  /** ESPN numeric season id: 2027 == the 2026-27 season. */
  season: Number(process.env.NBA_SEASON || 2027),
  modelVersion: "edge-1.0",
};

export function seasonLabel(season = config.season) {
  return `${season - 1}-${String(season).slice(2)}`;
}
