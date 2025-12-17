import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const SQLITE_PATH = process.env.SQLITE_PATH || "./data/app.sqlite";

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(SQLITE_PATH);
export const db = new Database(SQLITE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'single',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_clients (
      user_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      PRIMARY KEY (user_id, client_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meta_connections (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      token_type TEXT,
      expires_at TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meta_connections_client ON meta_connections(client_id);

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ad_account_id TEXT NOT NULL,
      pixel_id TEXT,
      page_id TEXT,
      lp_url TEXT NOT NULL,
      event_name TEXT,
      country_codes TEXT NOT NULL,
      daily_budget_inr INTEGER NOT NULL,
      creative_type TEXT NOT NULL,
      primary_text TEXT NOT NULL,
      headline TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      meta_campaign_id TEXT,
      meta_adset_id TEXT,
      meta_ad_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_client ON campaigns(client_id);

    CREATE TABLE IF NOT EXISTS meta_insights_daily (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      level TEXT NOT NULL,
      meta_id TEXT NOT NULL,
      date_start TEXT NOT NULL,
      date_stop TEXT NOT NULL,
      spend REAL,
      impressions INTEGER,
      clicks INTEGER,
      inline_link_clicks INTEGER,
      ctr REAL,
      cpc REAL,
      cpm REAL,
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (client_id, level, meta_id, date_start, date_stop),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_insights_client_level ON meta_insights_daily(client_id, level);
  `);
}

export function run(sql, params = []) { return db.prepare(sql).run(params); }
export function get(sql, params = []) { return db.prepare(sql).get(params); }
export function all(sql, params = []) { return db.prepare(sql).all(params); }
