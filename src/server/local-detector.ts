import { getDb } from './db.js';
import type { LocalDetectedService } from '../shared/types.js';

export async function detectLocalServices(): Promise<LocalDetectedService[]> {
  const results: LocalDetectedService[] = [];

  // 1. Probe Ollama (port 11434)
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = (data.models || []).map((m: any) => m.name || m.model);
      results.push({
        type: 'ollama',
        name: 'Ollama (Local)',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models,
        running: true,
      });
    }
  } catch {}

  // 2. Probe LM Studio (port 1234)
  try {
    const res = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = (data.data || []).map((m: any) => m.id);
      results.push({
        type: 'lmstudio',
        name: 'LM Studio (Local)',
        baseUrl: 'http://127.0.0.1:1234/v1',
        models,
        running: true,
      });
    }
  } catch {}

  return results;
}

export async function autoRegisterLocalService(service: LocalDetectedService): Promise<{ providerId: string; modelsAdded: number }> {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM providers WHERE base_url LIKE ?').get(`%${service.type === 'ollama' ? '11434' : '1234'}%`) as any;

  const now = Date.now();
  let providerId = existing?.id;

  if (!providerId) {
    providerId = `prov_${service.type}_${Date.now()}`;
    db.prepare(`
      INSERT INTO providers (id, name, protocol, base_url, selection_strategy, created_at, updated_at)
      VALUES (?, ?, 'openai', ?, 'round-robin', ?, ?)
    `).run(providerId, service.name, service.baseUrl, now, now);

    // Add dummy key for local gateway compliance
    const { encryptKey, maskKey } = await import('./crypto.js');
    const encKey = encryptKey(service.type);
    const masked = maskKey(service.type);
    db.prepare(`
      INSERT INTO provider_keys (id, provider_id, label, key_encrypted, key_masked, status, consecutive_failures, usage_count, created_at, updated_at)
      VALUES (?, ?, 'Local Key', ?, ?, 'healthy', 0, 0, ?, ?)
    `).run(`key_${providerId}_1`, providerId, encKey, masked, now, now);
  }

  // Register models
  let count = 0;
  const insertModel = db.prepare(`
    INSERT OR REPLACE INTO models (id, provider_id, model_id, name, enabled, context_window, max_output, supports_tools, supports_vision, supports_streaming, last_discovered_at)
    VALUES (?, ?, ?, ?, 1, 131072, 8192, 1, 0, 1, ?)
  `);

  for (const modelId of service.models) {
    const id = `m_${providerId}_${modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    insertModel.run(id, providerId, modelId, modelId, now);
    count++;
  }

  return { providerId, modelsAdded: count };
}
