import crypto from 'crypto';
import { getDb, getSettings } from './db.js';
import { getAvailableKeysForProvider, markKeySuccess, markKeyFailure, parseRetryAfterMs, type DecryptedKey } from './key-pool.js';
import type { ChainMode, TargetAttempt, RequestLog } from '../shared/types.js';

export interface RouteTarget {
  targetId: string;
  chainId?: string;
  providerId: string;
  providerName: string;
  providerProtocol: 'openai' | 'anthropic' | 'gemini';
  providerBaseUrl: string;
  selectionStrategy: 'fill-first' | 'round-robin' | 'least-used';
  modelId: string;
  supportsTools: boolean;
  contextWindow: number | null;
}

export function detectClientTool(headers: Headers, path: string): string {
  const ua = (headers.get('user-agent') || '').toLowerCase();
  if (ua.includes('opencode')) return 'opencode';
  if (ua.includes('claude-code') || ua.includes('claudecode')) return 'claude-code';
  if (ua.includes('codex') || path.includes('/responses')) return 'codex';
  if (ua.includes('cline')) return 'cline';
  if (ua.includes('roo-code') || ua.includes('roocode')) return 'roo-code';
  if (ua.includes('continue')) return 'continue';
  if (ua.includes('aider')) return 'aider';
  if (ua.includes('zed')) return 'zed';
  if (ua.includes('curl')) return 'curl';
  return 'generic-client';
}

/**
 * Resolves requested model name to an ordered list of candidate targets.
 */
export function resolveTargets(requestedModel: string, requiresTools = false, estimatedTokens = 0): {
  chainName: string;
  mode: ChainMode;
  targets: RouteTarget[];
} {
  const db = getDb();
  let chain = db.prepare('SELECT * FROM chains WHERE name = ?').get(requestedModel) as any;
  let chainName = requestedModel;

  if (!chain) {
    // Check if requestedModel matches a specific model
    const specificModel = db.prepare(`
      SELECT m.*, p.name as provider_name, p.protocol, p.base_url, p.selection_strategy
      FROM models m
      JOIN providers p ON m.provider_id = p.id
      WHERE m.model_id = ? AND m.enabled = 1
    `).get(requestedModel) as any;

    if (specificModel) {
      return {
        chainName: 'direct',
        mode: 'priority',
        targets: [{
          targetId: `direct_${specificModel.id}`,
          providerId: specificModel.provider_id,
          providerName: specificModel.provider_name,
          providerProtocol: specificModel.protocol,
          providerBaseUrl: specificModel.base_url,
          selectionStrategy: specificModel.selection_strategy,
          modelId: specificModel.model_id,
          supportsTools: Boolean(specificModel.supports_tools),
          contextWindow: specificModel.context_window,
        }],
      };
    }

    // Fall back to default 'auto' chain
    chain = db.prepare("SELECT * FROM chains WHERE name = 'auto'").get() as any;
    chainName = 'auto';
  }

  if (!chain) {
    return { chainName: 'none', mode: 'priority', targets: [] };
  }

  // Get targets for chain
  const rows = db.prepare(`
    SELECT ct.*, p.name as provider_name, p.protocol, p.base_url, p.selection_strategy,
           m.supports_tools, m.context_window
    FROM chain_targets ct
    JOIN providers p ON ct.provider_id = p.id
    LEFT JOIN models m ON (ct.provider_id = m.provider_id AND ct.model_id = m.model_id)
    WHERE ct.chain_id = ?
    ORDER BY ct.order_index ASC
  `).all(chain.id) as any[];

  let targets: RouteTarget[] = rows.map(r => ({
    targetId: r.id,
    chainId: chain.id,
    providerId: r.provider_id,
    providerName: r.provider_name,
    providerProtocol: r.protocol,
    providerBaseUrl: r.base_url,
    selectionStrategy: r.selection_strategy,
    modelId: r.model_id,
    supportsTools: r.supports_tools === null ? true : Boolean(r.supports_tools),
    contextWindow: r.context_window,
  }));

  // Capability filters:
  if (requiresTools) {
    targets = targets.filter(t => t.supportsTools);
  }
  if (estimatedTokens > 0) {
    targets = targets.filter(t => !t.contextWindow || t.contextWindow >= estimatedTokens);
  }

  // Sticky mode: prioritize currently active target if set
  if (chain.mode === 'sticky' && chain.active_target_id) {
    const activeIdx = targets.findIndex(t => t.targetId === chain.active_target_id);
    if (activeIdx > 0) {
      const active = targets.splice(activeIdx, 1)[0];
      targets.unshift(active);
    }
  }

  return {
    chainName,
    mode: chain.mode,
    targets,
  };
}

export interface DispatchResult {
  response: Response;
  finalTarget: RouteTarget;
  finalKey: DecryptedKey;
  attempts: TargetAttempt[];
  latencyMs: number;
}

/**
 * Dispatches an upstream non-streaming or streaming request with automatic failover.
 */
export async function executeWithFailover(
  targets: RouteTarget[],
  payload: any,
  clientSignal?: AbortSignal
): Promise<DispatchResult> {
  const settings = getSettings();
  const attempts: TargetAttempt[] = [];

  if (targets.length === 0) {
    throw new Error('No healthy targets available for this request');
  }

  for (const target of targets) {
    const keys = getAvailableKeysForProvider(target.providerId, target.selectionStrategy);

    if (keys.length === 0) {
      attempts.push({
        providerId: target.providerId,
        providerName: target.providerName,
        modelId: target.modelId,
        keyId: 'none',
        success: false,
        error: 'No available healthy keys (all down or cooling down)',
        durationMs: 0,
      });
      continue;
    }

    for (const key of keys) {
      const attemptStart = Date.now();
      const targetPayload = { ...payload, model: target.modelId };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), settings.defaultRequestTimeoutMs);

        // Abort upstream if client disconnects
        const onClientAbort = () => controller.abort();
        if (clientSignal) {
          clientSignal.addEventListener('abort', onClientAbort, { once: true });
        }

        const cleanBase = target.providerBaseUrl.replace(/\/+$/, '');
        let targetUrl = '';
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': targetPayload.stream ? 'text/event-stream' : 'application/json',
        };

        if (target.providerProtocol === 'openai') {
          targetUrl = `${cleanBase}/chat/completions`;
          if (key.rawKey) headers['Authorization'] = `Bearer ${key.rawKey.trim()}`;
        } else if (target.providerProtocol === 'anthropic') {
          targetUrl = `${cleanBase}/messages`;
          headers['anthropic-version'] = '2023-06-01';
          if (key.rawKey) headers['x-api-key'] = key.rawKey.trim();
        } else if (target.providerProtocol === 'gemini') {
          const keyParam = key.rawKey ? `?key=${encodeURIComponent(key.rawKey.trim())}` : '';
          const action = targetPayload.stream ? 'streamGenerateContent' : 'generateContent';
          targetUrl = `${cleanBase}/models/${target.modelId}:${action}${keyParam}`;
        }

        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(targetPayload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);

        const attemptDuration = Date.now() - attemptStart;

        // Check for retryable failure triggers: HTTP 429, 5xx, 401/403
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          const retryAfterMs = parseRetryAfterMs(res.headers);
          markKeyFailure(key.id, res.status, errBody, retryAfterMs);

          attempts.push({
            providerId: target.providerId,
            providerName: target.providerName,
            modelId: target.modelId,
            keyId: key.id,
            success: false,
            statusCode: res.status,
            error: `HTTP ${res.status}: ${errBody.slice(0, 200)}`,
            durationMs: attemptDuration,
          });

          // Move to next key / target immediately! Do NOT retry same failing target repeatedly.
          continue;
        }

        // HTTP 200 OK
        markKeySuccess(key.id);

        // In sticky mode, update active target
        if (target.chainId) {
          getDb().prepare('UPDATE chains SET active_target_id = ? WHERE id = ?').run(target.targetId, target.chainId);
        }

        attempts.push({
          providerId: target.providerId,
          providerName: target.providerName,
          modelId: target.modelId,
          keyId: key.id,
          success: true,
          statusCode: res.status,
          durationMs: attemptDuration,
        });

        return {
          response: res,
          finalTarget: target,
          finalKey: key,
          attempts,
          latencyMs: attemptDuration,
        };
      } catch (err: any) {
        const attemptDuration = Date.now() - attemptStart;
        const isTimeout = err.name === 'AbortError' && !clientSignal?.aborted;
        const errMsg = isTimeout ? `Request timed out after ${settings.defaultRequestTimeoutMs}ms` : err.message;

        markKeyFailure(key.id, 504, errMsg);

        attempts.push({
          providerId: target.providerId,
          providerName: target.providerName,
          modelId: target.modelId,
          keyId: key.id,
          success: false,
          statusCode: isTimeout ? 504 : 500,
          error: errMsg,
          durationMs: attemptDuration,
        });

        // Continue to next key or target
        continue;
      }
    }
  }

  // All targets failed
  const summary = attempts.map(a => `${a.providerName}/${a.modelId}: ${a.error || a.statusCode}`).join('; ');
  const failureErr: any = new Error(`All targets failed. Attempts: [${summary}]`);
  failureErr.attempts = attempts;
  throw failureErr;
}

/**
 * Persists an audit log entry into request_logs.
 */
export function logRequest(entry: {
  clientTool: string;
  endpoint: string;
  chainName: string;
  requestedModel: string;
  finalTarget?: RouteTarget | null;
  attempts: TargetAttempt[];
  statusCode: number;
  latencyMs: number;
  ttftMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  stream: boolean;
  errorMessage?: string | null;
  requestBody?: any;
  responseBody?: any;
}): void {
  const db = getDb();
  const settings = getSettings();
  const now = Date.now();

  const reqBodyStr = settings.storePayloads && entry.requestBody ? JSON.stringify(entry.requestBody) : null;
  const resBodyStr = settings.storePayloads && entry.responseBody ? JSON.stringify(entry.responseBody) : null;

  db.prepare(`
    INSERT INTO request_logs (
      id, timestamp, client_tool, endpoint, chain_name, requested_model,
      final_provider_id, final_provider_name, final_model_id,
      targets_attempted, status_code, latency_ms, ttft_ms,
      prompt_tokens, completion_tokens, total_tokens,
      stream, error_message, request_body, response_body
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    )
  `).run(
    `log_${crypto.randomUUID()}`,
    now,
    entry.clientTool,
    entry.endpoint,
    entry.chainName,
    entry.requestedModel,
    entry.finalTarget?.providerId || null,
    entry.finalTarget?.providerName || null,
    entry.finalTarget?.modelId || null,
    JSON.stringify(entry.attempts),
    entry.statusCode,
    entry.latencyMs,
    entry.ttftMs ?? null,
    entry.promptTokens ?? null,
    entry.completionTokens ?? null,
    entry.totalTokens ?? null,
    entry.stream ? 1 : 0,
    entry.errorMessage || null,
    reqBodyStr,
    resBodyStr
  );
}
