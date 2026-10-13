interface KeyRateStats {
  timestamps: number[];
  tokensThisMinute: number;
}

const keyWindows = new Map<string, KeyRateStats>();

// Default conservative ceiling for free-tier endpoints to avoid 429 penalties.
export const DEFAULT_FREE_RPM_CEILING = 25;
const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 5_000;

function pruneWindow(stats: KeyRateStats, now: number): void {
  const windowStart = now - WINDOW_MS;
  // timestamps are appended in order, so a single filter preserves ordering.
  stats.timestamps = stats.timestamps.filter(t => t > windowStart);
}

function getStats(keyId: string, now: number): KeyRateStats {
  let stats = keyWindows.get(keyId);
  if (!stats) {
    // Bound memory: if we exceed the key budget, drop the oldest tracked windows.
    if (keyWindows.size >= MAX_TRACKED_KEYS) {
      const oldest = [...keyWindows.entries()]
        .sort((a, b) => (a[1].timestamps.at(-1) || 0) - (b[1].timestamps.at(-1) || 0))
        .slice(0, Math.floor(MAX_TRACKED_KEYS / 4));
      for (const [k] of oldest) keyWindows.delete(k);
    }
    stats = { timestamps: [], tokensThisMinute: 0 };
    keyWindows.set(keyId, stats);
  }
  pruneWindow(stats, now);
  return stats;
}

/**
 * Returns true when the key has already reached its rolling requests-per-minute ceiling.
 */
export function shouldThrottleKey(keyId: string, customRpmLimit?: number | null): boolean {
  const now = Date.now();
  const stats = getStats(keyId, now);
  const limit = customRpmLimit && customRpmLimit > 0 ? customRpmLimit : DEFAULT_FREE_RPM_CEILING;
  return stats.timestamps.length >= limit;
}

/**
 * Record that a request was dispatched through a key, for rolling RPM accounting.
 */
export function recordKeyRequest(keyId: string, tokens: number = 0): void {
  const now = Date.now();
  const stats = getStats(keyId, now);
  stats.timestamps.push(now);
  stats.tokensThisMinute += Math.max(0, tokens);
}

export function getKeyRateStats(): Array<{ keyId: string; rpm: number; tokensThisMinute: number }> {
  const now = Date.now();
  const out: Array<{ keyId: string; rpm: number; tokensThisMinute: number }> = [];
  for (const [keyId, stats] of keyWindows.entries()) {
    pruneWindow(stats, now);
    out.push({ keyId, rpm: stats.timestamps.length, tokensThisMinute: stats.tokensThisMinute });
  }
  return out;
}

export function resetRateWindows(): void {
  keyWindows.clear();
}