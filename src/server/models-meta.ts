import { getDb } from './db.js';

interface CachedMeta {
  context?: number;
  output?: number;
  tools?: boolean;
  vision?: boolean;
  pricingInput?: number;
  pricingOutput?: number;
}

let inMemoryMetaCache: Map<string, CachedMeta> | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function loadModelsDevDataset(force = false): Promise<Map<string, CachedMeta>> {
  if (inMemoryMetaCache && !force && Date.now() - lastFetchTime < CACHE_TTL_MS) {
    return inMemoryMetaCache;
  }

  const db = getDb();
  inMemoryMetaCache = new Map<string, CachedMeta>();

  // Check SQLite cache first
  const cachedRows = db.prepare('SELECT model_key, data_json, updated_at FROM model_metadata_cache').all() as Array<{
    model_key: string;
    data_json: string;
    updated_at: number;
  }>;

  if (cachedRows.length > 0) {
    for (const row of cachedRows) {
      try {
        inMemoryMetaCache.set(row.model_key, JSON.parse(row.data_json));
      } catch {}
    }
  }

  // If cache is empty or stale or forced, attempt fetch
  const isStale = cachedRows.length === 0 || Date.now() - (cachedRows[0]?.updated_at || 0) > CACHE_TTL_MS;
  if (isStale || force) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const res = await fetch('https://models.dev/api.json', { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as Record<string, any>;
        const now = Date.now();
        const insertStmt = db.prepare(`
          INSERT OR REPLACE INTO model_metadata_cache (model_key, data_json, updated_at)
          VALUES (?, ?, ?)
        `);

        const tx = db.transaction(() => {
          for (const providerKey of Object.keys(data)) {
            const providerObj = data[providerKey];
            if (!providerObj || typeof providerObj !== 'object') continue;
            const modelsObj = providerObj.models;
            if (!modelsObj || typeof modelsObj !== 'object') continue;

            for (const modelId of Object.keys(modelsObj)) {
              const m = modelsObj[modelId];
              if (!m || typeof m !== 'object') continue;

              const meta: CachedMeta = {};
              if (typeof m.limit?.context === 'number' && m.limit.context > 0) {
                meta.context = m.limit.context;
              }
              if (typeof m.limit?.output === 'number' && m.limit.output > 0) {
                meta.output = m.limit.output;
              }
              if (typeof m.tool_call === 'boolean') {
                meta.tools = m.tool_call;
              }
              if (typeof m.attachment === 'boolean') {
                meta.vision = m.attachment;
              }
              if (typeof m.cost?.input === 'number') {
                meta.pricingInput = m.cost.input;
              }
              if (typeof m.cost?.output === 'number') {
                meta.pricingOutput = m.cost.output;
              }

              // Store both exact ID and lowercased normalized ID
              const cleanId = modelId.toLowerCase().trim();
              inMemoryMetaCache!.set(cleanId, meta);
              inMemoryMetaCache!.set(modelId, meta);

              insertStmt.run(cleanId, JSON.stringify(meta), now);
            }
          }
        });

        tx();
        lastFetchTime = now;
      }
    } catch (err: any) {
      // Graceful offline fallback: if models.dev cannot be reached, keep whatever was in SQLite cache
      console.warn('models.dev fetch failed or offline; using local cached metadata:', err.message);
    }
  }

  return inMemoryMetaCache;
}

export async function lookupModelMetadata(modelId: string): Promise<CachedMeta | null> {
  const cache = await loadModelsDevDataset();
  const clean = modelId.toLowerCase().trim();

  // Try direct match
  if (cache.has(clean)) return cache.get(clean)!;
  if (cache.has(modelId)) return cache.get(modelId)!;

  // Try matching without provider prefix (e.g. "openai/gpt-4o" -> "gpt-4o")
  if (clean.includes('/')) {
    const afterSlash = clean.split('/').slice(1).join('/');
    if (cache.has(afterSlash)) return cache.get(afterSlash)!;
  }

  // Try fuzzy prefix match
  for (const [key, val] of cache.entries()) {
    if (clean.startsWith(key) || key.startsWith(clean)) {
      return val;
    }
  }

  return null;
}
