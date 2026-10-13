import { getDb, getSettings } from './db.js';
import { decryptKey } from './crypto.js';
import type { HealthStatus, KeySelectionStrategy } from '../shared/types.js';

export interface DecryptedKey {
  id: string;
  providerId: string;
  label: string;
  rawKey: string;
  status: HealthStatus;
  cooldownUntil: number | null;
  consecutiveFailures: number;
  usageCount: number;
}

/**
 * Parses Retry-After header or rate limit reset headers.
 * Returns cooldown duration in ms, or null if not present.
 */
export function parseRetryAfterMs(headers: Headers): number | null {
  // 1. Retry-After header (either seconds or HTTP date)
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return Math.max(1000, seconds * 1000);
    }
    const dateMs = Date.parse(retryAfter);
    if (!isNaN(dateMs)) {
      return Math.max(1000, dateMs - Date.now());
    }
  }

  // 2. x-ratelimit-reset-requests / x-ratelimit-reset-tokens (seconds or ms or timestamp)
  const resetHeader = headers.get('x-ratelimit-reset-requests') ||
                      headers.get('x-ratelimit-reset-tokens') ||
                      headers.get('x-ratelimit-reset');
  if (resetHeader) {
    const num = parseFloat(resetHeader);
    if (!isNaN(num)) {
      // If it looks like a Unix timestamp in seconds (e.g. > 1e9)
      if (num > 1e9) {
        return Math.max(1000, (num * 1000) - Date.now());
      }
      // If seconds format like "1.5s" or raw seconds
      return Math.max(1000, Math.round(num * 1000));
    }
  }

  return null;
}

/**
 * Selects candidate keys for a provider according to selectionStrategy.
 * Filters out keys that are currently down or still cooling down.
 */
export function getAvailableKeysForProvider(providerId: string, strategy: KeySelectionStrategy): DecryptedKey[] {
  const db = getDb();
  const now = Date.now();

  // Retrieve all keys for provider
  const rows = db.prepare(`
    SELECT id, provider_id, label, key_encrypted, key_masked, status,
           cooldown_until, consecutive_failures, usage_count
    FROM provider_keys
    WHERE provider_id = ?
  `).all(providerId) as any[];

  if (rows.length === 0) return [];

  // Check cooldown expiration
  const updateStatusStmt = db.prepare('UPDATE provider_keys SET status = ?, cooldown_until = NULL WHERE id = ?');
  const validKeys: DecryptedKey[] = [];

  for (const r of rows) {
    let currentStatus: HealthStatus = r.status;
    let cooldownUntil: number | null = r.cooldown_until;

    if (currentStatus === 'cooling_down' && cooldownUntil && now >= cooldownUntil) {
      currentStatus = 'healthy';
      cooldownUntil = null;
      updateStatusStmt.run('healthy', r.id);
    }

    if (currentStatus === 'down' || (currentStatus === 'cooling_down' && cooldownUntil && now < cooldownUntil)) {
      continue;
    }

    try {
      const rawKey = decryptKey(r.key_encrypted);
      validKeys.push({
        id: r.id,
        providerId: r.provider_id,
        label: r.label,
        rawKey,
        status: currentStatus,
        cooldownUntil,
        consecutiveFailures: r.consecutive_failures,
        usageCount: r.usage_count,
      });
    } catch (err: any) {
      console.error(`Failed to decrypt key ${r.id}:`, err.message);
    }
  }

  // Sort keys deterministically. Round-robin rotation is applied by the router
  // engine at dispatch time; least-used sorts by usage here.
  if (strategy === 'least-used') {
    return validKeys.sort((a, b) => a.usageCount - b.usageCount);
  }
  // fill-first and round-robin both preserve insertion order at this layer.
  return validKeys;
}

/**
 * Records per-key token usage for cost/accounting views.
 */
export function addKeyTokens(keyId: string, tokens: number): void {
  if (!keyId || !Number.isFinite(tokens) || tokens <= 0) return;
  const db = getDb();
  db.prepare(`
    UPDATE provider_keys
    SET tokens_used = COALESCE(tokens_used, 0) + ?, last_used_at = ?
    WHERE id = ?
  `).run(Math.round(tokens), Date.now(), keyId);
}

/**
 * Record a key success: marks healthy, resets consecutive failures, increments usage count.
 */
export function markKeySuccess(keyId: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    UPDATE provider_keys
    SET status = 'healthy',
        cooldown_until = NULL,
        consecutive_failures = 0,
        usage_count = usage_count + 1,
        updated_at = ?
    WHERE id = ?
  `).run(now, keyId);
}

/**
 * Record a key failure: updates cooldown or marks down.
 */
export function markKeyFailure(
  keyId: string,
  statusCode?: number,
  errorMessage?: string,
  retryAfterMs?: number | null
): void {
  const db = getDb();
  const settings = getSettings();
  const now = Date.now();

  const key = db.prepare('SELECT consecutive_failures FROM provider_keys WHERE id = ?').get(keyId) as any;
  const failures = (key?.consecutive_failures || 0) + 1;

  let newStatus: HealthStatus = 'cooling_down';
  let cooldownDurationMs: number;

  if (statusCode === 401 || statusCode === 403) {
    // Permanent auth failure: mark down immediately
    newStatus = 'down';
    cooldownDurationMs = 24 * 60 * 60 * 1000;
  } else if (retryAfterMs && retryAfterMs > 0) {
    // Honor upstream Retry-After
    cooldownDurationMs = Math.min(retryAfterMs, settings.cooldownMaxMs * 2);
  } else {
    // Exponential backoff: base * 2^(failures - 1)
    const factor = Math.pow(2, Math.min(failures - 1, 4));
    cooldownDurationMs = Math.min(settings.cooldownBaseMs * factor, settings.cooldownMaxMs);
  }

  const cooldownUntil = now + cooldownDurationMs;

  db.prepare(`
    UPDATE provider_keys
    SET status = ?,
        cooldown_until = ?,
        consecutive_failures = ?,
        last_error = ?,
        last_error_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    newStatus,
    cooldownUntil,
    failures,
    errorMessage ? errorMessage.slice(0, 500) : null,
    now,
    now,
    keyId
  );
}
