import { getDb, getSettings } from './db.js';
import { decryptKey } from './crypto.js';
import { testProviderConnection } from './provider-service.js';
import type Database from 'better-sqlite3';

let proberTimer: NodeJS.Timeout | null = null;
let isProbing = false;

// Persistent prepared statements cache to avoid GC finalizer collisions on Node 24
let stmts: {
  getExpiredCooldown?: Database.Statement;
  recoverKey?: Database.Statement;
  getCandidates?: Database.Statement;
  markHealthy?: Database.Statement;
  markProbing?: Database.Statement;
  restoreStatus?: Database.Statement;
} = {};

function getStatements(db: Database.Database) {
  if (!stmts.getExpiredCooldown) {
    stmts.getExpiredCooldown = db.prepare(`
      SELECT id, provider_id, label
      FROM provider_keys
      WHERE status = 'cooling_down' AND cooldown_until IS NOT NULL AND cooldown_until <= ?
        AND COALESCE(disabled, 0) = 0
    `);
    stmts.recoverKey = db.prepare("UPDATE provider_keys SET status = 'healthy', cooldown_until = NULL WHERE id = ?");
    stmts.getCandidates = db.prepare(`
      SELECT pk.id as key_id, pk.provider_id, pk.label, pk.key_encrypted, pk.status,
             p.name as provider_name, p.protocol, p.base_url
      FROM provider_keys pk
      JOIN providers p ON pk.provider_id = p.id
      WHERE pk.status IN ('down', 'cooling_down') AND COALESCE(pk.disabled, 0) = 0
    `);
    stmts.markHealthy = db.prepare(`
      UPDATE provider_keys
      SET status = 'healthy',
          cooldown_until = NULL,
          consecutive_failures = 0,
          last_error = NULL,
          updated_at = ?
      WHERE id = ?
    `);
    stmts.markProbing = db.prepare("UPDATE provider_keys SET status = 'probing', updated_at = ? WHERE id = ?");
    stmts.restoreStatus = db.prepare("UPDATE provider_keys SET status = ?, updated_at = ? WHERE id = ?");
  }
  return stmts;
}

export function startHealthProber(broadcastFn?: (event: string, data: any) => void): void {
  if (proberTimer) clearInterval(proberTimer);

  const runProbeCycle = async () => {
    if (isProbing) return;
    isProbing = true;

    try {
      const db = getDb();
      const s = getStatements(db);
      const now = Date.now();

      // 1. Recover keys whose cooldown has expired
      const expiredCooldownKeys = s.getExpiredCooldown!.all(now) as any[];

      for (const k of expiredCooldownKeys) {
        s.recoverKey!.run(k.id);
        if (broadcastFn) {
          broadcastFn('key_recovered', { keyId: k.id, providerId: k.provider_id, label: k.label, reason: 'cooldown_expired' });
        }
      }

      // 2. Actively probe keys marked 'down' or 'cooling_down'
      const candidates = s.getCandidates!.all() as any[];

      for (const item of candidates) {
        let rawKey: string;
        try {
          rawKey = decryptKey(item.key_encrypted);
        } catch {
          continue;
        }

        // Mark as probing so concurrent dispatch avoids racing a key mid-probe.
        s.markProbing!.run(Date.now(), item.key_id);

        const testRes = await testProviderConnection(item.protocol, item.base_url, rawKey);

        if (testRes.success) {
          // Probe succeeded! Mark healthy
          s.markHealthy!.run(Date.now(), item.key_id);

          if (broadcastFn) {
            broadcastFn('target_recovered', {
              keyId: item.key_id,
              providerId: item.provider_id,
              providerName: item.provider_name,
              label: item.label,
              latencyMs: testRes.latencyMs,
            });
          }
        } else {
          // Probe failed: restore the previous status so cooldowns keep elapsing.
          s.restoreStatus!.run(item.status, Date.now(), item.key_id);
        }
      }
    } catch (err: any) {
      console.warn('Health prober cycle warning:', err.message);
    } finally {
      isProbing = false;
    }
  };

  const settings = getSettings();
  const interval = Math.max(15000, settings.healthProbeIntervalMs || 30000);
  proberTimer = setInterval(runProbeCycle, interval);
  if (proberTimer && typeof proberTimer.unref === 'function') {
    proberTimer.unref();
  }
}

export function stopHealthProber(): void {
  if (proberTimer) {
    clearInterval(proberTimer);
    proberTimer = null;
  }
}
