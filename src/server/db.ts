import Database from 'better-sqlite3';
import path from 'path';
import { getAppDataDir } from './crypto.js';
import type { Settings } from '../shared/types.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = path.join(getAppDataDir(), 'router.sqlite');
  dbInstance = new Database(dbPath);

  // WAL mode for high concurrency, durability, and crash resistance
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('synchronous = NORMAL');
  dbInstance.pragma('foreign_keys = ON');

  initSchema(dbInstance);
  return dbInstance;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL,
      selection_strategy TEXT NOT NULL DEFAULT 'round-robin',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_keys (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      key_encrypted TEXT NOT NULL,
      key_masked TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'healthy',
      cooldown_until INTEGER,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      last_error_at INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      context_window INTEGER,
      max_output INTEGER,
      supports_tools INTEGER NOT NULL DEFAULT 1,
      supports_vision INTEGER NOT NULL DEFAULT 0,
      supports_streaming INTEGER NOT NULL DEFAULT 1,
      pricing_input REAL,
      pricing_output REAL,
      last_discovered_at INTEGER NOT NULL,
      UNIQUE(provider_id, model_id)
    );

    CREATE TABLE IF NOT EXISTS chains (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'priority',
      active_target_id TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chain_targets (
      id TEXT PRIMARY KEY,
      chain_id TEXT NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      requires_tools INTEGER NOT NULL DEFAULT 0,
      min_context_window INTEGER,
      UNIQUE(chain_id, order_index)
    );

    CREATE TABLE IF NOT EXISTS gateway_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_masked TEXT NOT NULL,
      rate_limit_rpm INTEGER,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS request_logs (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      client_tool TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      chain_name TEXT NOT NULL,
      requested_model TEXT NOT NULL,
      final_provider_id TEXT,
      final_provider_name TEXT,
      final_model_id TEXT,
      targets_attempted TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      ttft_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      stream INTEGER NOT NULL,
      error_message TEXT,
      request_body TEXT,
      response_body TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_request_logs_chain ON request_logs(chain_name);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_metadata_cache (
      model_key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Ensure default auto chain exists
  const autoChain = db.prepare('SELECT id FROM chains WHERE name = ?').get('auto');
  if (!autoChain) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO chains (id, name, mode, active_target_id, description, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?)
    `).run('chain_auto', 'auto', 'priority', 'Default failover chain automatically routing requests', now, now);
  }

  // Ensure initial gateway key if none exist
  const existingKey = db.prepare('SELECT COUNT(*) as count FROM gateway_keys').get() as { count: number };
  if (existingKey.count === 0) {
    const { rawKey, keyHash, keyMasked } = require('./crypto.js').generateGatewayKey();
    const now = Date.now();
    db.prepare(`
      INSERT INTO gateway_keys (id, name, key_hash, key_masked, rate_limit_rpm, created_at, last_used_at)
      VALUES (?, ?, ?, ?, NULL, ?, NULL)
    `).run('gwk_default', 'Default Local Key', keyHash, keyMasked, now);
    
    // Stash initial key for onboarding output/banner
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_raw_gateway_key', ?)`).run(rawKey);
  }
}

export const defaultSettings: Settings = {
  defaultRequestTimeoutMs: 60000,
  cooldownBaseMs: 30000,
  cooldownMaxMs: 300000,
  healthProbeIntervalMs: 30000,
  restartOnMidstreamFailure: false,
  logRetentionDays: 7,
  storePayloads: false,
  allowLan: false,
  theme: 'dark',
};

export function getSettings(): Settings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const settings: any = { ...defaultSettings };
  for (const row of rows) {
    if (row.key === 'initial_raw_gateway_key') continue;
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return settings as Settings;
}

export function updateSettings(partial: Partial<Settings>): Settings {
  const db = getDb();
  const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(partial)) {
      insert.run(k, JSON.stringify(v));
    }
  });
  tx();
  return getSettings();
}
