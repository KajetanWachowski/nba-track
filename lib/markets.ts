/** Canonical market keys used across providers, the model and the UI. */
export type StatKey = "pts" | "reb" | "ast" | "fg3m" | "stl" | "blk" | "tov";
export type ComboKey = "pra" | "pr" | "pa" | "ra" | "stocks";
export type PlayerMarket = StatKey | ComboKey | "dd" | "td";
export type GameMarket = "ml" | "spread" | "total";
export type Market = PlayerMarket | GameMarket;

export const BASE_STATS: StatKey[] = ["pts", "reb", "ast", "fg3m", "stl", "blk", "tov"];

export const COMBOS: Record<ComboKey, StatKey[]> = {
  pra: ["pts", "reb", "ast"],
  pr: ["pts", "reb"],
  pa: ["pts", "ast"],
  ra: ["reb", "ast"],
  stocks: ["stl", "blk"],
};

export const MARKET_LABEL: Record<Market, string> = {
  pts: "Punkty",
  reb: "Zbiórki",
  ast: "Asysty",
  fg3m: "Trafione trójki",
  stl: "Przechwyty",
  blk: "Bloki",
  tov: "Straty",
  pra: "Pkt+Zb+As (PRA)",
  pr: "Pkt+Zb",
  pa: "Pkt+As",
  ra: "Zb+As",
  stocks: "Przechwyty+Bloki",
  dd: "Double-double",
  td: "Triple-double",
  ml: "Zwycięzca meczu",
  spread: "Handicap",
  total: "Suma punktów w meczu",
};

export const PLAYER_LINE_MARKETS: (StatKey | ComboKey)[] = [
  "pts", "reb", "ast", "pra", "pr", "pa", "ra", "fg3m", "stl", "blk", "tov", "stocks",
];

export function isGameMarket(m: string): m is GameMarket {
  return m === "ml" || m === "spread" || m === "total";
}

export function statValue(row: Record<StatKey, number>, m: StatKey | ComboKey): number {
  if (m in COMBOS) return COMBOS[m as ComboKey].reduce((s, k) => s + (row[k] ?? 0), 0);
  return row[m as StatKey] ?? 0;
}

/** ESPN/DraftKings prop type ids → canonical market. */
export const ESPN_OU_TYPES: Record<string, StatKey | ComboKey> = {
  "1": "pts", "2": "ast", "3": "reb", "4": "fg3m", "87": "pa", "88": "pr", "89": "ra", "90": "pra",
};
export const ESPN_MILESTONE_TYPES: Record<string, StatKey | ComboKey> = {
  "218": "pts", "219": "ast", "220": "reb", "221": "fg3m", "222": "stl", "223": "blk",
  "225": "pra", "226": "pa", "227": "pr", "327": "ra", "336": "stocks",
};
export const ESPN_YES_TYPES: Record<string, "dd" | "td"> = { "92": "dd", "93": "td" };

/** The Odds API market keys → canonical market. */
export const ODDS_API_PLAYER_MARKETS: Record<string, PlayerMarket> = {
  player_points: "pts",
  player_rebounds: "reb",
  player_assists: "ast",
  player_threes: "fg3m",
  player_steals: "stl",
  player_blocks: "blk",
  player_turnovers: "tov",
  player_points_rebounds_assists: "pra",
  player_points_rebounds: "pr",
  player_points_assists: "pa",
  player_rebounds_assists: "ra",
  player_blocks_steals: "stocks",
  player_double_double: "dd",
  player_triple_double: "td",
};
