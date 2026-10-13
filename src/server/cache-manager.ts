import crypto from 'crypto';
import { getDb } from './db.js';

export interface CacheEntry {
  hash: string;
  endpoint: string;
  modelId: string;
  responseJson: any;
  hitCount: number;
  savedTokens: number;
  createdAt: number;
  lastHitAt: number;
}

/**
 * Builds a cache key from everything that can change the model's output.
 * Generation parameters (temperature, top_p, max_tokens, seed, stop, tool
 * schemas) are all included, so a deterministic answer is never replayed for a
 * request that asked for different sampling behaviour.
 *
 * This is an exact-match cache, not a semantic/embedding cache.
 */
export function computePromptHash(endpoint: string, model: string, body: any): string {
  const messages = (body.messages || []).map((m: any) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content.trim() : m.content,
    tool_call_id: m.tool_call_id ?? undefined,
    name: m.name ?? undefined,
    tool_calls: m.tool_calls ?? undefined,
  }));

  const tools = (body.tools || []).map((t: any) => t.function || t);

  const normalized = JSON.stringify({
    endpoint,
    model: (model || '').toLowerCase(),
    messages,
    tools,
    temperature: body.temperature ?? null,
    top_p: body.top_p ?? null,
    max_tokens: body.max_tokens ?? null,
    seed: body.seed ?? null,
    stop: body.stop ?? null,
    response_format: body.response_format ?? null,
    tool_choice: body.tool_choice ?? null,
  });

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function lookupCache(endpoint: string, model: string, body: any): CacheEntry | null {
  try {
    const db = getDb();
    const hash = computePromptHash(endpoint, model, body);
    const row = db.prepare('SELECT * FROM prompt_cache WHERE hash = ?').get(hash) as any;

    if (!row) return null;

    const now = Date.now();
    db.prepare(`
      UPDATE prompt_cache
      SET hit_count = hit_count + 1, last_hit_at = ?
      WHERE hash = ?
    `).run(now, hash);

    return {
      hash: row.hash,
      endpoint: row.endpoint,
      modelId: row.model_id,
      responseJson: JSON.parse(row.response_json),
      hitCount: row.hit_count + 1,
      savedTokens: row.saved_tokens,
      createdAt: row.created_at,
      lastHitAt: now,
    };
  } catch (err: any) {
    console.error('[CACHE LOOKUP ERROR]', err?.message);
    return null;
  }
}

export function saveToCache(
  endpoint: string,
  model: string,
  body: any,
  responseJson: any,
  promptTokens: number = 0,
  completionTokens: number = 0
): void {
  try {
    const db = getDb();
    const hash = computePromptHash(endpoint, model, body);
    const now = Date.now();
    const savedTokens = Math.max(0, promptTokens + completionTokens);

    db.prepare(`
      INSERT INTO prompt_cache (hash, endpoint, model_id, messages_normalized, response_json, hit_count, saved_tokens, created_at, last_hit_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(hash) DO UPDATE SET
        response_json = excluded.response_json,
        last_hit_at = excluded.last_hit_at,
        saved_tokens = excluded.saved_tokens
    `).run(
      hash,
      endpoint,
      model,
      JSON.stringify(body.messages || []),
      JSON.stringify(responseJson),
      savedTokens,
      now,
      now
    );
  } catch (err: any) {
    console.error('[CACHE SAVE ERROR]', err?.message);
  }
}

export function clearCache(): void {
  try {
    getDb().prepare('DELETE FROM prompt_cache').run();
  } catch (err: any) {
    console.error('[CACHE CLEAR ERROR]', err?.message);
  }
}

export function getCacheStats(): { totalEntries: number; totalHits: number; totalTokensSaved: number } {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(*) as totalEntries,
        COALESCE(SUM(hit_count - 1), 0) as totalHits,
        COALESCE(SUM((hit_count - 1) * saved_tokens), 0) as totalTokensSaved
      FROM prompt_cache
    `).get() as any;

    return {
      totalEntries: Number(row?.totalEntries || 0),
      totalHits: Math.max(0, Number(row?.totalHits || 0)),
      totalTokensSaved: Number(row?.totalTokensSaved || 0),
    };
  } catch {
    return { totalEntries: 0, totalHits: 0, totalTokensSaved: 0 };
  }
}