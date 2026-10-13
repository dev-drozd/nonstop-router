import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from './db.js';
import { encryptKey, decryptKey, maskKey } from './crypto.js';
import { lookupModelMetadata } from './models-meta.js';
import { modelsUrlForBase } from './config.js';
import { isFreeModelId } from '../shared/types.js';
import type { Provider, ProviderKey, Model, ProviderProtocol, KeySelectionStrategy } from '../shared/types.js';

export async function testProviderConnection(
  protocol: ProviderProtocol,
  baseUrl: string,
  rawKey?: string
): Promise<{ success: boolean; latencyMs: number; error?: string; modelCount?: number }> {
  const start = Date.now();
  const cleanUrl = (baseUrl || '').replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout

    let url = '';
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (protocol === 'openai') {
      url = modelsUrlForBase(cleanUrl);
      if (rawKey) headers['Authorization'] = `Bearer ${rawKey.trim()}`;
    } else if (protocol === 'anthropic') {
      url = modelsUrlForBase(cleanUrl);
      headers['anthropic-version'] = '2023-06-01';
      if (rawKey) headers['x-api-key'] = rawKey.trim();
    } else if (protocol === 'gemini') {
      const keyParam = rawKey ? `?key=${encodeURIComponent(rawKey.trim())}` : '';
      url = `${modelsUrlForBase(cleanUrl)}${keyParam}`;
    }

    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      let errBody = '';
      try {
        errBody = await res.text();
      } catch {}
      return {
        success: false,
        latencyMs,
        error: `HTTP ${res.status} ${res.statusText}${errBody ? `: ${errBody.slice(0, 300)}` : ''}`,
      };
    }

    const data = await res.json() as any;
    let modelCount = 0;
    if (Array.isArray(data.data)) {
      modelCount = data.data.length;
    } else if (Array.isArray(data.models)) {
      modelCount = data.models.length;
    } else if (Array.isArray(data)) {
      modelCount = data.length;
    }

    return { success: true, latencyMs, modelCount };
  } catch (err: any) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: err.name === 'AbortError' ? 'Connection timed out (12s)' : (err.message || String(err)),
    };
  }
}

export async function fetchAndSyncModels(providerId: string): Promise<Model[]> {
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any;
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }

  // Get first healthy key
  const keys = db.prepare('SELECT * FROM provider_keys WHERE provider_id = ? ORDER BY consecutive_failures ASC').all(providerId) as any[];
  let rawKey: string | undefined;
  if (keys.length > 0) {
    rawKey = decryptKey(keys[0].key_encrypted);
  }

  const cleanUrl = provider.base_url.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  let url = '';

  if (provider.protocol === 'openai') {
    url = modelsUrlForBase(cleanUrl);
    if (rawKey) headers['Authorization'] = `Bearer ${rawKey.trim()}`;
  } else if (provider.protocol === 'anthropic') {
    url = modelsUrlForBase(cleanUrl);
    headers['anthropic-version'] = '2023-06-01';
    if (rawKey) headers['x-api-key'] = rawKey.trim();
  } else if (provider.protocol === 'gemini') {
    const keyParam = rawKey ? `?key=${encodeURIComponent(rawKey.trim())}` : '';
    url = `${modelsUrlForBase(cleanUrl)}${keyParam}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to fetch models from ${provider.name}: HTTP ${res.status} ${res.statusText} ${errText}`);
  }

  const data = await res.json() as any;
  let rawModels: Array<{ id: string; name?: string }> = [];

  if (Array.isArray(data.data)) {
    rawModels = data.data.map((m: any) => ({ id: m.id || m.name, name: m.name || m.id }));
  } else if (Array.isArray(data.models)) {
    rawModels = data.models.map((m: any) => ({
      id: m.name?.replace(/^models\//, '') || m.id,
      name: m.displayName || m.name || m.id,
    }));
  } else if (Array.isArray(data)) {
    rawModels = data.map((m: any) => ({ id: m.id || m.name, name: m.name || m.id }));
  }

  const now = Date.now();
  const upsertStmt = db.prepare(`
    INSERT INTO models (
      id, provider_id, model_id, name, enabled,
      context_window, max_output, supports_tools, supports_vision, supports_streaming,
      is_free, pricing_input, pricing_output, last_discovered_at
    ) VALUES (
      ?, ?, ?, ?, 1,
      ?, ?, ?, ?, 1,
      ?, ?, ?, ?
    ) ON CONFLICT(provider_id, model_id) DO UPDATE SET
      name = excluded.name,
      context_window = COALESCE(excluded.context_window, models.context_window),
      max_output = COALESCE(excluded.max_output, models.max_output),
      supports_tools = excluded.supports_tools,
      supports_vision = excluded.supports_vision,
      is_free = excluded.is_free,
      pricing_input = COALESCE(excluded.pricing_input, models.pricing_input),
      pricing_output = COALESCE(excluded.pricing_output, models.pricing_output),
      last_discovered_at = excluded.last_discovered_at
  `);

  for (const m of rawModels) {
    if (!m.id) continue;
    let meta: Awaited<ReturnType<typeof lookupModelMetadata>> = null;
    try {
      meta = await lookupModelMetadata(m.id);
    } catch (err: any) {
      // Metadata is optional enrichment; never fail discovery over it.
      console.warn(`Model metadata lookup failed for ${m.id}:`, err?.message);
    }
    const modelRecordId = `model_${crypto.randomUUID()}`;

    upsertStmt.run(
      modelRecordId,
      provider.id,
      m.id,
      m.name || m.id,
      meta?.context ?? null,
      meta?.output ?? null,
      meta?.tools !== false ? 1 : 0, // default true unless explicitly false in dataset
      meta?.vision === true ? 1 : 0,
      isFreeModelId(m.id) ? 1 : 0,
      meta?.pricingInput ?? null,
      meta?.pricingOutput ?? null,
      now
    );
  }

  // Return updated list
  const rows = db.prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY name ASC').all(provider.id) as any[];
  return rows.map(r => ({
    id: r.id,
    providerId: r.provider_id,
    modelId: r.model_id,
    name: r.name,
    enabled: Boolean(r.enabled),
    contextWindow: r.context_window,
    maxOutput: r.max_output,
    supportsTools: Boolean(r.supports_tools),
    supportsVision: Boolean(r.supports_vision),
    supportsStreaming: Boolean(r.supports_streaming),
    pricingInput: r.pricing_input,
    pricingOutput: r.pricing_output,
    lastDiscoveredAt: r.last_discovered_at,
  }));
}

/**
 * Parses JSON or JSONC (JSON with comments)
 */
function parseJsonc(text: string): any {
  // Robustly remove comments while preserving string literals
  let insideString = false;
  let stringChar = '';
  let isEscaped = false;
  let result = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (insideString) {
      result += ch;
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === '\\') {
        isEscaped = true;
      } else if (ch === stringChar) {
        insideString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      insideString = true;
      stringChar = ch;
      result += ch;
      continue;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      result += text[i] || '';
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i++; // Skip closing '/'
      continue;
    }

    // Trailing comma cleanup before } or ]
    result += ch;
  }

  // Remove trailing commas in objects or arrays
  const sanitized = result.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(sanitized);
}

export interface OpenCodeImportCandidate {
  providerKey: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  modelCount: number;
  sampleModels: string[];
  resolvedKeyMasked: string | null;
  hasKey: boolean;
  rawKeyToSave?: string;
}

export function previewOpenCodeConfig(customPath?: string): {
  filePath: string;
  found: boolean;
  providers: OpenCodeImportCandidate[];
} {
  const candidatePaths = [
    customPath,
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
  ].filter(Boolean) as string[];

  let chosenPath = '';
  let content = '';

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      chosenPath = p;
      content = fs.readFileSync(p, 'utf8');
      break;
    }
  }

  if (!chosenPath || !content) {
    return { filePath: customPath || candidatePaths[0], found: false, providers: [] };
  }

  const parsed = parseJsonc(content);
  const providersObj = parsed.providers || {};
  const results: OpenCodeImportCandidate[] = [];

  for (const [key, p] of Object.entries<any>(providersObj)) {
    // Skip if it's nonstop-router itself
    if (key === 'nonstop' || p.name?.toLowerCase().includes('nonstop')) continue;

    const baseUrl = p.settings?.baseURL || p.baseURL || '';
    if (!baseUrl) continue;

    let rawKey: string | undefined = p.settings?.apiKey || p.apiKey;

    // Check if env var specified
    if (!rawKey && Array.isArray(p.env)) {
      for (const envVar of p.env) {
        if (process.env[envVar]) {
          rawKey = process.env[envVar];
          break;
        }
      }
    }

    // Check Token Harbor dedicated config if this is tokenharbor
    if (!rawKey && (key.toLowerCase().includes('tokenharbor') || baseUrl.includes('tokenharbor'))) {
      const thConfigPath = path.join(os.homedir(), '.tokenharbor', 'config.json');
      if (fs.existsSync(thConfigPath)) {
        try {
          const thCfg = JSON.parse(fs.readFileSync(thConfigPath, 'utf8'));
          if (thCfg.key) {
            rawKey = thCfg.key;
          }
        } catch {}
      }
    }

    const modelKeys = Object.keys(p.models || {});
    results.push({
      providerKey: key,
      name: p.name || key,
      baseUrl,
      protocol: 'openai',
      modelCount: modelKeys.length,
      sampleModels: modelKeys.slice(0, 5),
      resolvedKeyMasked: rawKey ? maskKey(rawKey) : null,
      hasKey: !!rawKey,
      rawKeyToSave: rawKey,
    });
  }

  return {
    filePath: chosenPath,
    found: true,
    providers: results,
  };
}

export async function importProviderFromOpenCode(candidateKey: string, customRawKey?: string): Promise<{
  provider: Provider;
  keysCount: number;
  modelsCount: number;
}> {
  const preview = previewOpenCodeConfig();
  const match = preview.providers.find(p => p.providerKey === candidateKey);
  if (!match) {
    throw new Error(`Provider ${candidateKey} not found in OpenCode config`);
  }

  const finalKey = customRawKey || match.rawKeyToSave;
  const db = getDb();

  const providerId = `prov_${crypto.randomUUID()}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO providers (id, name, protocol, base_url, selection_strategy, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'round-robin', ?, ?)
  `).run(providerId, match.name, match.protocol, match.baseUrl, now, now);

  let keysCount = 0;
  if (finalKey) {
    const keyId = `key_${crypto.randomUUID()}`;
    const encrypted = encryptKey(finalKey);
    const masked = maskKey(finalKey);

    db.prepare(`
      INSERT INTO provider_keys (
        id, provider_id, label, key_encrypted, key_masked,
        status, consecutive_failures, usage_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'healthy', 0, 0, ?, ?)
    `).run(keyId, providerId, 'Primary Key (OpenCode)', encrypted, masked, now, now);
    keysCount = 1;
  }

  // Auto-discover models
  let modelsCount = 0;
  try {
    const synced = await fetchAndSyncModels(providerId);
    modelsCount = synced.length;

    // Add discovered free models to default 'auto' chain if auto chain has no targets
    const autoChain = db.prepare('SELECT id FROM chains WHERE name = ?').get('auto') as any;
    if (autoChain) {
      const existingTargets = db.prepare('SELECT COUNT(*) as count FROM chain_targets WHERE chain_id = ?').get(autoChain.id) as { count: number };
      if (existingTargets.count === 0 && synced.length > 0) {
        // Only automatically populate verified 100% free models (:free)
        const freeModels = synced.filter(m => isFreeModelId(m.modelId));
        const topModels = freeModels.slice(0, 5);
        if (topModels.length > 0) {
          const insertTarget = db.prepare(`
            INSERT INTO chain_targets (id, chain_id, provider_id, model_id, order_index, requires_tools, min_context_window)
            VALUES (?, ?, ?, ?, ?, 0, NULL)
          `);
          topModels.forEach((m, idx) => {
            insertTarget.run(`target_${crypto.randomUUID()}`, autoChain.id, providerId, m.modelId, idx);
          });
        }
      }
    }
  } catch (err: any) {
    console.warn('Auto model sync during import warning:', err.message);
  }

  const provRow = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any;
  return {
    provider: {
      id: provRow.id,
      name: provRow.name,
      protocol: provRow.protocol,
      baseUrl: provRow.base_url,
      selectionStrategy: provRow.selection_strategy,
      createdAt: provRow.created_at,
      updatedAt: provRow.updated_at,
    },
    keysCount,
    modelsCount,
  };
}

export interface ProbeResult {
  success: boolean;
  statusCode: number;
  statusLabel: 'ACTIVE' | 'QUOTA_EXHAUSTED' | 'INVALID_KEY' | 'ERROR' | 'OFFLINE';
  latencyMs: number;
  testedModel: string | null;
  quotaDetails: string;
  workingBaseUrl: string;
  modelsCount: number;
  freeModelsCount: number;
  models: Array<{ id: string; name?: string; isFree: boolean; context?: number }>;
  modelsError?: string | null;
}

export async function probeAndInspectProvider(inputBaseUrl: string, rawKey: string): Promise<ProbeResult> {
  const cleanInput = inputBaseUrl.replace(/\/+$/, '');
  const urlCandidates = [cleanInput];

  if (cleanInput.includes('://api.')) {
    urlCandidates.push(cleanInput.replace('://api.', '://'));
  } else if (!cleanInput.includes('://api.') && cleanInput.includes('://')) {
    urlCandidates.push(cleanInput.replace('://', '://api.'));
  }

  let workingBase = cleanInput;
  let modelsList: Array<{ id: string; name?: string; isFree: boolean; context?: number }> = [];
  let modelsFetchSuccess = false;
  let modelsError: string | null = null;
  let latencyMs = 0;

  for (const candidate of urlCandidates) {
    const endpointsToTry = [
      candidate.endsWith('/models') ? candidate : `${candidate}/models`,
      candidate.endsWith('/v1') ? `${candidate}/models` : `${candidate}/v1/models`,
    ];

    for (const ep of endpointsToTry) {
      const startPing = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);

        const res = await fetch(ep, {
          headers: {
            'Authorization': `Bearer ${rawKey.trim()}`,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        latencyMs = Date.now() - startPing;

        if (res.ok) {
          const data = await res.json() as any;
          const rawModels = data.data || data.models || (Array.isArray(data) ? data : []);
          modelsList = rawModels.map((m: any) => {
            const mid = m.id || m.name;
            const isFree = isFreeModelId(mid);
            return {
              id: mid,
              name: m.name || mid,
              isFree,
              context: m.context_length || m.limit?.context || 64000,
            };
          });

          workingBase = ep.replace(/\/models\/?$/, '');
          modelsFetchSuccess = true;
          break;
        } else {
          const txt = await res.text().catch(() => '');
          modelsError = `HTTP ${res.status}: ${txt.slice(0, 150)}`;
        }
      } catch (err: any) {
        modelsError = err.name === 'AbortError' ? 'Timeout (9s)' : err.message;
      }
    }

    if (modelsFetchSuccess) break;
  }

  const freeModels = modelsList.filter(m => m.isFree);
  const testModel = freeModels.length > 0 ? freeModels[0].id : (modelsList.length > 0 ? modelsList[0].id : 'auto');

  let chatSuccess = false;
  let chatStatus = 0;
  let quotaDetails: string | null = null;
  let chatError: string | null = null;

  let chatUrl = workingBase.replace(/\/+$/, '');
  chatUrl = chatUrl.replace(/\/chat\/completions\/?$/, '');
  chatUrl = `${chatUrl}/chat/completions`;

  const probeStart = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawKey.trim()}`,
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    chatStatus = res.status;
    latencyMs = Date.now() - probeStart;

    const txt = await res.text();
    let cleanMsg = txt;
    try {
      const j = JSON.parse(txt);
      if (j.error?.message) cleanMsg = j.error.message;
    } catch {}

    chatError = cleanMsg;

    if (res.ok) {
      chatSuccess = true;
      quotaDetails = 'Active quota verified & functioning';
    } else if (res.status === 429) {
      quotaDetails = cleanMsg || 'Quota exhausted / Rate limit reached for this period';
    } else if (res.status === 401 || res.status === 403) {
      quotaDetails = 'Invalid API key or unauthorized';
    } else if (res.status === 402) {
      quotaDetails = 'Account balance is zero / Quota depleted';
    }
  } catch (err: any) {
    chatError = err.name === 'AbortError' ? 'Connection timed out (12s)' : err.message;
  }

  let statusLabel: 'ACTIVE' | 'QUOTA_EXHAUSTED' | 'INVALID_KEY' | 'ERROR' | 'OFFLINE' = 'ACTIVE';
  if (chatStatus === 429) statusLabel = 'QUOTA_EXHAUSTED';
  else if (chatStatus === 402) statusLabel = 'QUOTA_EXHAUSTED';
  else if (chatStatus === 401 || chatStatus === 403) statusLabel = 'INVALID_KEY';
  else if (!chatSuccess && chatStatus !== 0) statusLabel = 'ERROR';
  else if (!chatSuccess) statusLabel = 'OFFLINE';

  return {
    success: chatSuccess,
    statusCode: chatStatus,
    statusLabel,
    latencyMs,
    testedModel: testModel,
    quotaDetails: quotaDetails || chatError || (chatSuccess ? 'Quota active' : 'Unknown status'),
    workingBaseUrl: workingBase,
    modelsCount: modelsList.length,
    freeModelsCount: modelsList.filter(m => m.isFree).length,
    models: modelsList,
    modelsError: modelsFetchSuccess ? null : modelsError,
  };
}

