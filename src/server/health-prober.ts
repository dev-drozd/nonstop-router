import { getDb, getSettings } from './db.js';
import { decryptKey } from './crypto.js';
import { testProviderConnection } from './provider-service.js';

let proberTimer: NodeJS.Timeout | null = null;
let isProbing = false;

export function startHealthProber(broadcastFn?: (event: string, data: any) => void): void {
  if (proberTimer) clearInterval(proberTimer);

  const runProbeCycle = async () => {
    if (isProbing) return;
    isProbing = true;

    try {
      const db = getDb();
      const settings = getSettings();
      const now = Date.now();

      // 1. Recover keys whose cooldown has expired
      const expiredCooldownKeys = db.prepare(`
        SELECT id, provider_id, label
        FROM provider_keys
        WHERE status = 'cooling_down' AND cooldown_until IS NOT NULL AND cooldown_until <= ?
      `).all(now) as any[];

      for (const k of expiredCooldownKeys) {
        db.prepare("UPDATE provider_keys SET status = 'healthy', cooldown_until = NULL WHERE id = ?").run(k.id);
        if (broadcastFn) {
          broadcastFn('key_recovered', { keyId: k.id, providerId: k.provider_id, label: k.label, reason: 'cooldown_expired' });
        }
      }

      // 2. Actively probe keys marked 'down' or 'cooling_down'
      const candidates = db.prepare(`
        SELECT pk.id as key_id, pk.provider_id, pk.label, pk.key_encrypted, pk.status,
               p.name as provider_name, p.protocol, p.base_url
        FROM provider_keys pk
        JOIN providers p ON pk.provider_id = p.id
        WHERE pk.status IN ('down', 'cooling_down')
      `).all() as any[];

      for (const item of candidates) {
        let rawKey: string;
        try {
          rawKey = decryptKey(item.key_encrypted);
        } catch {
          continue;
        }

        // Test with real minimal endpoint
        const testRes = await testProviderConnection(item.protocol, item.base_url, rawKey);

        if (testRes.success) {
          // Probe succeeded! Mark healthy
          db.prepare(`
            UPDATE provider_keys
            SET status = 'healthy',
                cooldown_until = NULL,
                consecutive_failures = 0,
                last_error = NULL,
                updated_at = ?
            WHERE id = ?
          `).run(Date.now(), item.key_id);

          if (broadcastFn) {
            broadcastFn('target_recovered', {
              keyId: item.key_id,
              providerId: item.provider_id,
              providerName: item.provider_name,
              label: item.label,
              latencyMs: testRes.latencyMs,
            });
          }
        }
      }
    } catch (err: any) {
      console.warn('Health prober cycle warning:', err.message);
    } finally {
      isProbing = false;
    }
  };

  const settings = getSettings();
  const interval = Math.max(10000, settings.healthProbeIntervalMs || 30000);
  proberTimer = setInterval(runProbeCycle, interval);
}

export function stopHealthProber(): void {
  if (proberTimer) {
    clearInterval(proberTimer);
    proberTimer = null;
  }
}
