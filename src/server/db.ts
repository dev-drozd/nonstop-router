import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import { getAppDataDir, generateGatewayKey } from './crypto.js';
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
  dbInstance.pragma('busy_timeout = 5000');

  // Cache all prepared statements permanently to prevent Node GC destructor collisions.
  // We keep a reference to the real bound method so `this` is never lost.
  const statementCache = new Map<string, Database.Statement>();
  const nativePrepare = dbInstance.prepare;
  (dbInstance as any).prepare = (sql: string) => {
    let cached = statementCache.get(sql);
    if (!cached) {
      cached = nativePrepare.call(dbInstance, sql);
      statementCache.set(sql, cached);
    }
    return cached;
  };

  initSchema(dbInstance);
  return dbInstance;
}

function tableColumns(db: Database.Database, table: string): string[] {
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c => c.name);
  } catch {
    return [];
  }
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
      tokens_used INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys(provider_id);

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
      is_free INTEGER NOT NULL DEFAULT 0,
      pricing_input REAL,
      pricing_output REAL,
      last_discovered_at INTEGER NOT NULL,
      UNIQUE(provider_id, model_id)
    );
    CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);

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
      response_body TEXT,
      money_saved_usd REAL DEFAULT 0,
      cached INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_request_logs_chain ON request_logs(chain_name);
    CREATE INDEX IF NOT EXISTS idx_request_logs_status ON request_logs(status_code);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_cache (
      hash TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      model_id TEXT NOT NULL,
      messages_normalized TEXT NOT NULL,
      response_json TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      saved_tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_hit_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_cache_last_hit ON prompt_cache(last_hit_at);
    CREATE INDEX IF NOT EXISTS idx_prompt_cache_created ON prompt_cache(created_at);

    CREATE TABLE IF NOT EXISTS model_metadata_cache (
      model_key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_model_metadata_updated ON model_metadata_cache(updated_at);
  `);

  // ------------------------------------------------------------------
  // Migrations for databases created by older versions.
  // ------------------------------------------------------------------
  const modelCols = tableColumns(db, 'models');
  if (modelCols.length && !modelCols.includes('is_free')) {
    db.exec('ALTER TABLE models ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0');
  }

  const keyCols = tableColumns(db, 'provider_keys');
  if (keyCols.length && !keyCols.includes('tokens_used')) {
    db.exec('ALTER TABLE provider_keys ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0');
  }
  if (keyCols.length && !keyCols.includes('last_used_at')) {
    db.exec('ALTER TABLE provider_keys ADD COLUMN last_used_at INTEGER');
  }

  const logCols = tableColumns(db, 'request_logs');
  if (logCols.length && !logCols.includes('money_saved_usd')) {
    db.exec('ALTER TABLE request_logs ADD COLUMN money_saved_usd REAL DEFAULT 0');
  }
  if (logCols.length && !logCols.includes('cached')) {
    db.exec('ALTER TABLE request_logs ADD COLUMN cached INTEGER DEFAULT 0');
  }

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
    const { rawKey, keyHash, keyMasked } = generateGatewayKey();
    const now = Date.now();
    db.prepare(`
      INSERT INTO gateway_keys (id, name, key_hash, key_masked, rate_limit_rpm, created_at, last_used_at)
      VALUES (?, ?, ?, ?, NULL, ?, NULL)
    `).run('gwk_default', 'Default Local Key', keyHash, keyMasked, now);

    // Stash initial key for onboarding output/banner
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('initial_raw_gateway_key', ?)`).run(rawKey);
  }

  // Ensure an admin token exists for dashboard/admin API protection
  ensureAdminToken(db);
}

/**
 * The admin token gates the local /api and /mcp surfaces. It is injected into the
 * served dashboard HTML (same-origin only) and required as a header on admin calls,
 * which blocks drive-by cross-site requests from other pages on the machine.
 */
export function ensureAdminToken(db: Database.Database = getDb()): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_token'").get() as any;
  if (row?.value) {
    // Stored either raw or JSON-encoded depending on version; normalize both.
    const raw = String(row.value);
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { return JSON.parse(raw); } catch { return raw.slice(1, -1); }
    }
    return raw;
  }
  const token = `nsk_admin_${crypto.randomBytes(24).toString('base64url')}`;
  // Stored as a raw string (this key is excluded from the typed settings map).
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('admin_token', token);
  return token;
}

export function getAdminToken(): string {
  return ensureAdminToken(getDb());
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
  enableCache: true,
  cacheTtlMs: 24 * 60 * 60 * 1000,
  cacheMaxEntries: 2000,
  enablePromptOptimizer: false,
  enableRateGovernor: true,
  rateGovernorRpm: 25,
  autoDetectLocal: true,
  chainAutoPolicy: 'free_only',
};

export function getSettings(): Settings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const settings: any = { ...defaultSettings };
  for (const row of rows) {
    if (row.key === 'initial_raw_gateway_key' || row.key === 'admin_token') continue;
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
  const allowed = new Set(Object.keys(defaultSettings));
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(partial)) {
      // Never allow arbitrary keys or secrets to be written through the settings API.
      if (!allowed.has(k)) continue;
      insert.run(k, JSON.stringify(v));
    }
  });
  tx();
  return getSettings();
}

/**
 * Deletes request logs older than the configured retention window and trims the
 * prompt cache to its configured maximum size. Returns counts for observability.
 */
export function pruneStoredData(): { deletedLogs: number; evictedCache: number } {
  const db = getDb();
  const settings = getSettings();
  const now = Date.now();
  let deletedLogs = 0;
  let evictedCache = 0;

  try {
    const cutoff = now - Math.max(1, settings.logRetentionDays) * 24 * 60 * 60 * 1000;
    const res = db.prepare('DELETE FROM request_logs WHERE timestamp < ?').run(cutoff);
    deletedLogs = res.changes;

    const ttlCutoff = now - Math.max(60_000, settings.cacheTtlMs ?? 24 * 60 * 60 * 1000);
    const ttlRes = db.prepare('DELETE FROM prompt_cache WHERE last_hit_at < ?').run(ttlCutoff);
    evictedCache += ttlRes.changes;

    const maxEntries = Math.max(100, settings.cacheMaxEntries ?? 2000);
    const count = (db.prepare('SELECT COUNT(*) as c FROM prompt_cache').get() as any).c;
    if (count > maxEntries) {
      const excess = count - maxEntries;
      const lru = db.prepare('SELECT hash FROM prompt_cache ORDER BY last_hit_at ASC LIMIT ?').all(excess) as any[];
      const del = db.prepare('DELETE FROM prompt_cache WHERE hash = ?');
      const tx = db.transaction(() => {
        for (const r of lru) del.run(r.hash);
      });
      tx();
      evictedCache += lru.length;
    }
  } catch (err: any) {
    console.warn('[NONSTOP ROUTER] pruneStoredData warning:', err?.message);
  }

  return { deletedLogs, evictedCache };
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
}