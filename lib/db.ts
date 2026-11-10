import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

let db: DatabaseSync | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS http_cache (
  key TEXT PRIMARY KEY, body TEXT NOT NULL, status INTEGER NOT NULL, fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, abbr TEXT NOT NULL, name TEXT NOT NULL, short_name TEXT, logo TEXT, color TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, day TEXT NOT NULL, season INTEGER NOT NULL, season_type INTEGER NOT NULL,
  home_id TEXT NOT NULL, away_id TEXT NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL,
  home_score INTEGER, away_score INTEGER, box_synced INTEGER NOT NULL DEFAULT 0, props_synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS games_day ON games(day);

CREATE TABLE IF NOT EXISTS team_games (
  game_id TEXT NOT NULL, team_id TEXT NOT NULL, opp_id TEXT NOT NULL, date TEXT NOT NULL, home INTEGER NOT NULL,
  pts INTEGER, fgm INTEGER, fga INTEGER, fg3m INTEGER, fg3a INTEGER, ftm INTEGER, fta INTEGER,
  oreb INTEGER, dreb INTEGER, reb INTEGER, ast INTEGER, stl INTEGER, blk INTEGER, tov INTEGER, pf INTEGER,
  min_total REAL, poss REAL,
  PRIMARY KEY (game_id, team_id)
);
CREATE INDEX IF NOT EXISTS team_games_team ON team_games(team_id, date);

CREATE TABLE IF NOT EXISTS player_games (
  game_id TEXT NOT NULL, athlete_id TEXT NOT NULL, name TEXT NOT NULL, team_id TEXT NOT NULL, opp_id TEXT NOT NULL,
  date TEXT NOT NULL, home INTEGER NOT NULL, pos TEXT, starter INTEGER, dnp INTEGER NOT NULL, dnp_reason TEXT,
  min REAL, pts INTEGER, reb INTEGER, oreb INTEGER, dreb INTEGER, ast INTEGER, fg3m INTEGER, fg3a INTEGER,
  fgm INTEGER, fga INTEGER, ftm INTEGER, fta INTEGER, stl INTEGER, blk INTEGER, tov INTEGER, pf INTEGER, usg REAL,
  PRIMARY KEY (game_id, athlete_id)
);
CREATE INDEX IF NOT EXISTS player_games_athlete ON player_games(athlete_id, date);
CREATE INDEX IF NOT EXISTS player_games_team ON player_games(team_id, date);

CREATE TABLE IF NOT EXISTS athletes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, team_id TEXT, pos TEXT, headshot TEXT, updated_at INTEGER
);

-- Bookmaker player-prop lines. kind = 'ou' (two-way over/under) or 'milestone' (one-way "X+").
-- For finished games the "current" price is the closing price.
CREATE TABLE IF NOT EXISTS prop_lines (
  game_id TEXT NOT NULL, athlete_id TEXT NOT NULL, market TEXT NOT NULL, kind TEXT NOT NULL, book TEXT NOT NULL,
  line REAL NOT NULL, over_dec REAL, under_dec REAL,
  open_line REAL, open_over_dec REAL, open_under_dec REAL,
  side_check TEXT, updated_at TEXT, fetched_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, athlete_id, market, kind, book, line)
);
CREATE INDEX IF NOT EXISTS prop_lines_game ON prop_lines(game_id);

CREATE TABLE IF NOT EXISTS game_lines (
  game_id TEXT NOT NULL, book TEXT NOT NULL,
  ml_home REAL, ml_away REAL, spread_home REAL, spread_home_dec REAL, spread_away_dec REAL,
  total REAL, over_dec REAL, under_dec REAL,
  open_ml_home REAL, open_ml_away REAL, open_spread_home REAL, open_spread_home_dec REAL, open_spread_away_dec REAL,
  open_total REAL, open_over_dec REAL, open_under_dec REAL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, book)
);

-- Append-only log of recommendations as they were shown (no retroactive edits of model inputs).
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL, model_version TEXT NOT NULL,
  game_id TEXT NOT NULL, game_date TEXT NOT NULL, market TEXT NOT NULL, subject_id TEXT NOT NULL, subject_name TEXT NOT NULL,
  side TEXT NOT NULL, line REAL, book TEXT NOT NULL, price REAL NOT NULL,
  model_prob REAL NOT NULL, raw_prob REAL NOT NULL, market_prob REAL, implied_prob REAL NOT NULL,
  edge REAL NOT NULL, ev REAL NOT NULL, confidence TEXT NOT NULL, projection REAL,
  status TEXT NOT NULL DEFAULT 'open', actual REAL, won INTEGER, closing_price REAL, closing_line REAL, clv REAL, settled_at INTEGER,
  UNIQUE (game_id, market, subject_id, side, line, book, model_version)
);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, model_version TEXT NOT NULL,
  params TEXT NOT NULL, summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backtest_rows (
  run_id INTEGER NOT NULL, game_id TEXT NOT NULL, date TEXT NOT NULL, subject_id TEXT NOT NULL, subject_name TEXT NOT NULL,
  market TEXT NOT NULL, line REAL NOT NULL, side TEXT NOT NULL,
  open_price REAL NOT NULL, close_price REAL, raw_prob REAL NOT NULL, market_prob REAL NOT NULL, cal_prob REAL,
  actual REAL NOT NULL, won INTEGER NOT NULL, fold TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS backtest_rows_run ON backtest_rows(run_id);
`;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(path.join(config.dataDir, "nba-edge.db"));
  db.exec(SCHEMA);
  return db;
}

export function getMeta<T>(key: string): T | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setMeta(key: string, value: unknown) {
  getDb()
    .prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
