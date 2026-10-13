import crypto from 'crypto';
import { getDb, getSettings } from './db.js';
import { getAvailableKeysForProvider, markKeySuccess, markKeyFailure, parseRetryAfterMs, type DecryptedKey } from './key-pool.js';
import { recordKeyRequest, shouldThrottleKey } from './rate-governor.js';
import { translateOpenAIToGemini, translateGeminiToOpenAI, chatCompletionToSSE, translateOpenAIToAnthropicRequest, translateAnthropicResponseToOpenAI } from './protocol-translator.js';
import type { ChainMode, TargetAttempt } from '../shared/types.js';

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

export interface DispatchResult {
  response: Response;
  finalTarget: RouteTarget;
  finalKey: DecryptedKey;
  attempts: TargetAttempt[];
  latencyMs: number;
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

// Universal Model Aliasing Map (maps industry requests like claude-3-5-sonnet, gpt-4o to best available targets)
const MODEL_ALIASES: Record<string, string[]> = {
  // Frontier Reasoning & Coding
  'claude-3-7-sonnet': ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'deepseek-chat', 'gemini-2.5-flash', 'llama-3.3-70b-versatile'],
  'claude-3-5-sonnet': ['claude-3-5-sonnet', 'deepseek-chat', 'gemini-2.5-flash', 'llama-3.3-70b-versatile'],
  'claude-sonnet': ['claude-3-5-sonnet', 'deepseek-chat', 'gemini-2.5-flash'],
  'claude-3-opus': ['claude-3-opus', 'deepseek-reasoner', 'deepseek-chat'],
  'gpt-4o': ['gpt-4o', 'deepseek-chat', 'gemini-2.5-flash', 'llama-3.3-70b-versatile'],
  'gpt-4': ['gpt-4o', 'deepseek-chat', 'gemini-2.5-flash'],
  'gpt-4o-mini': ['gpt-4o-mini', 'gemini-2.5-flash', 'llama-3.1-8b-instant'],
  'claude-3-5-haiku': ['claude-3-5-haiku', 'gemini-2.5-flash', 'llama-3.1-8b-instant'],
  'deepseek-reasoner': ['deepseek-reasoner', 'deepseek-r1', 'gemini-2.5-flash'],
  'deepseek-r1': ['deepseek-r1', 'deepseek-reasoner', 'gemini-2.5-flash'],
  'deepseek-chat': ['deepseek-chat', 'deepseek-v3', 'gemini-2.5-flash'],
  'deepseek-v3': ['deepseek-chat', 'gemini-2.5-flash', 'llama-3.3-70b-versatile'],
  'fast': ['gemini-2.5-flash', 'llama-3.1-8b-instant', 'deepseek-chat'],
  'reasoning': ['deepseek-reasoner', 'deepseek-r1', 'gemini-2.5-flash'],
  'code': ['deepseek-chat', 'qwen-2.5-coder-32b', 'llama-3.3-70b-versatile', 'gemini-2.5-flash'],
};

function isLocalTarget(target: RouteTarget): boolean {
  const url = target.providerBaseUrl.toLowerCase();
  return url.includes('127.0.0.1:11434') || url.includes('localhost:11434') ||
         url.includes('127.0.0.1:1234') || url.includes('localhost:1234');
}

// Round-robin cursor per provider, kept in-memory for the process lifetime.
const roundRobinCursor = new Map<string, number>();

/**
 * Resolves a requested model name to an ordered list of candidate targets.
 * @param requiresTools drop targets that cannot call tools
 * @param estimatedTokens drop targets whose context window is too small (0 = unknown)
 */
export function resolveTargets(requestedModel: string, requiresTools = false, estimatedTokens = 0): {
  chainName: string;
  mode: ChainMode;
  targets: RouteTarget[];
} {
  const db = getDb();
  const normalizedRequested = (requestedModel || 'auto').toLowerCase().trim();

  let chain = db.prepare('SELECT * FROM chains WHERE LOWER(name) = ?').get(normalizedRequested) as any;
  let chainName = requestedModel;

  if (!chain) {
    // 1. Direct model check
    let specificModel = db.prepare(`
      SELECT m.*, p.name as provider_name, p.protocol, p.base_url, p.selection_strategy
      FROM models m
      JOIN providers p ON m.provider_id = p.id
      WHERE LOWER(m.model_id) = ? AND m.enabled = 1
    `).get(normalizedRequested) as any;

    // 2. Universal Model Aliasing check if direct model not found
    if (!specificModel && MODEL_ALIASES[normalizedRequested]) {
      const candidates = MODEL_ALIASES[normalizedRequested];
      for (const cand of candidates) {
        specificModel = db.prepare(`
          SELECT m.*, p.name as provider_name, p.protocol, p.base_url, p.selection_strategy
          FROM models m
          JOIN providers p ON m.provider_id = p.id
          WHERE LOWER(m.model_id) = ? AND m.enabled = 1
        `).get(cand.toLowerCase()) as any;
        if (specificModel) {
          chainName = `alias:${cand}`;
          break;
        }
      }
    }

    if (specificModel) {
      const target: RouteTarget = {
        targetId: `direct_${specificModel.id}`,
        providerId: specificModel.provider_id,
        providerName: specificModel.provider_name,
        providerProtocol: specificModel.protocol,
        providerBaseUrl: specificModel.base_url,
        selectionStrategy: specificModel.selection_strategy,
        modelId: specificModel.model_id,
        supportsTools: Boolean(specificModel.supports_tools),
        contextWindow: specificModel.context_window,
      };
      const withinContext = estimatedTokens <= 0 || !target.contextWindow || target.contextWindow >= estimatedTokens;
      if (!withinContext || (requiresTools && !target.supportsTools)) {
        // Explicit model request cannot satisfy the required capability; do not silently
        // route elsewhere, but still surface the miss to the caller via empty targets.
        return { chainName: chainName || 'direct', mode: 'priority', targets: [] };
      }
      return { chainName: chainName || 'direct', mode: 'priority', targets: [target] };
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
    contextWindow: r.min_context_window && !r.context_window ? r.min_context_window : r.context_window,
  }));

  // Capability filters: a tool-calling request must only hit tool-capable targets,
  // and an oversized prompt must not be sent to a smaller-context model.
  if (requiresTools) {
    targets = targets.filter(t => t.supportsTools);
  }
  if (estimatedTokens > 0) {
    targets = targets.filter(t => !t.contextWindow || t.contextWindow >= estimatedTokens);
  }

  // Demote local LLMs to the end of chain as a safety net (cloud first, local last)
  const cloudTargets = targets.filter(t => !isLocalTarget(t));
  const localTargets = targets.filter(t => isLocalTarget(t));
  targets = [...cloudTargets, ...localTargets];

  // Sticky mode: prioritize the pinned target if it is still present and the chain latched.
  if (chain.mode === 'sticky' && chain.active_target_id) {
    const activeIdx = targets.findIndex(t => t.targetId === chain.active_target_id);
    if (activeIdx > 0) {
      const active = targets.splice(activeIdx, 1)[0];
      targets.unshift(active);
    }
  }

  return { chainName, mode: chain.mode, targets };
}

function rotateKeys(providerId: string, keys: DecryptedKey[], strategy: RouteTarget['selectionStrategy']): DecryptedKey[] {
  if (keys.length <= 1) return keys;
  if (strategy === 'least-used') {
    return [...keys].sort((a, b) => a.usageCount - b.usageCount);
  }
  if (strategy === 'fill-first') {
    return keys;
  }
  // round-robin: deterministic rotation through the pool so load spreads evenly
  const cursor = roundRobinCursor.get(providerId) || 0;
  const rotated = [...keys.slice(cursor % keys.length), ...keys.slice(0, cursor % keys.length)];
  roundRobinCursor.set(providerId, (cursor + 1) % keys.length);
  return rotated;
}

/**
 * Dispatches an upstream request with automatic key and model failover.
 * Non-streaming responses and streaming responses that fail before any token
 * reaches the client are both transparently retried on the next target.
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
    const available = getAvailableKeysForProvider(target.providerId, target.selectionStrategy);
    let candidateKeys = rotateKeys(target.providerId, available, target.selectionStrategy);

    // Rate governor: when enabled, deprioritize keys that have hit their rolling
    // RPM ceiling so we rotate before the upstream returns a 429. If every key is
    // saturated we still try them rather than failing the request outright.
    if (settings.enableRateGovernor) {
      const ceiling = settings.rateGovernorRpm && settings.rateGovernorRpm > 0 ? settings.rateGovernorRpm : undefined;
      const unthrottled = candidateKeys.filter(k => !shouldThrottleKey(k.id, ceiling));
      if (unthrottled.length > 0) {
        candidateKeys = unthrottled;
      }
    }

    const keys = candidateKeys;

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
        const headerResponseMode = Boolean(targetPayload.stream);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': headerResponseMode ? 'text/event-stream' : 'application/json',
        };

        if (target.providerProtocol === 'openai') {
          targetUrl = `${cleanBase}/chat/completions`;
          if (key.rawKey) headers['Authorization'] = `Bearer ${key.rawKey.trim()}`;
        } else if (target.providerProtocol === 'anthropic') {
          targetUrl = `${cleanBase}/messages`;
          headers['anthropic-version'] = '2023-06-01';
          if (key.rawKey) headers['x-api-key'] = key.rawKey.trim();
          // Anthropic has no OpenAI-compatible stream; always request JSON so the
          // engine can translate it into an OpenAI-shaped response/stream.
          targetPayload.stream = false;
        } else if (target.providerProtocol === 'gemini') {
          // Gemini streaming uses a different SSE shape; always fetch non-streaming
          // and synthesize an OpenAI-compatible stream for the client when needed.
          const keyParam = key.rawKey ? `?key=${encodeURIComponent(key.rawKey.trim())}` : '';
          targetUrl = `${cleanBase}/models/${encodeURIComponent(target.modelId)}:generateContent${keyParam}`;
          headers['x-goog-api-key'] = key.rawKey?.trim() || '';
          delete headers['Authorization'];
          targetPayload.stream = false;
        } else {
          throw new Error(`Unsupported provider protocol: ${target.providerProtocol}`);
        }

        // Anthropic-native upstream: translate the OpenAI payload to the Messages API.
        const requestBody =
          target.providerProtocol === 'gemini'
            ? JSON.stringify(translateOpenAIToGemini(targetPayload))
            : target.providerProtocol === 'anthropic'
              ? JSON.stringify(translateOpenAIToAnthropicRequest(targetPayload))
              : JSON.stringify(targetPayload);

        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: requestBody,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        if (clientSignal) clientSignal.removeEventListener('abort', onClientAbort);

        const attemptDuration = Date.now() - attemptStart;

        // Retryable failure triggers: HTTP 429, 5xx, 401/403
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

          // Move to next key / target immediately.
          continue;
        }

        // HTTP 200 OK
        markKeySuccess(key.id);
        recordKeyRequest(key.id);

        // Normalize non-OpenAI upstream responses into OpenAI-shaped Responses so every
        // downstream endpoint handler can treat all targets identically.
        let finalResponse = res;
        if (target.providerProtocol !== 'openai') {
          const upstreamJson = await res.json().catch(() => null);
          if (!upstreamJson) {
            const msg = `${target.providerProtocol} returned a non-JSON body`;
            markKeyFailure(key.id, 502, msg);
            attempts.push({
              providerId: target.providerId,
              providerName: target.providerName,
              modelId: target.modelId,
              keyId: key.id,
              success: false,
              statusCode: 502,
              error: msg,
              durationMs: attemptDuration,
            });
            continue;
          }
          const openAiJson = target.providerProtocol === 'gemini'
            ? translateGeminiToOpenAI(upstreamJson, target.modelId)
            : translateAnthropicResponseToOpenAI(upstreamJson, target.modelId);
          finalResponse = new Response(
            headerResponseMode ? chatCompletionToSSE(openAiJson) : JSON.stringify(openAiJson),
            {
              status: 200,
              headers: { 'Content-Type': headerResponseMode ? 'text/event-stream' : 'application/json' },
            }
          );
        }

        // Sticky mode latches onto the working target; priority mode leaves the
        // chain head untouched so it returns to #1 as soon as it recovers.
        if (target.chainId) {
          const chainRow = getDb().prepare('SELECT mode FROM chains WHERE id = ?').get(target.chainId) as any;
          if (chainRow?.mode === 'sticky') {
            getDb().prepare('UPDATE chains SET active_target_id = ? WHERE id = ?').run(target.targetId, target.chainId);
          }
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

        return { response: finalResponse, finalTarget: target, finalKey: key, attempts, latencyMs: attemptDuration };
      } catch (err: any) {
        const attemptDuration = Date.now() - attemptStart;
        const isClientAbort = clientSignal?.aborted;
        const isTimeout = err.name === 'AbortError' && !isClientAbort;
        const errMsg = isTimeout ? `Request timed out after ${settings.defaultRequestTimeoutMs}ms` : err.message;

        if (isClientAbort) {
          // The caller went away; do not blame the key.
          attempts.push({
            providerId: target.providerId,
            providerName: target.providerName,
            modelId: target.modelId,
            keyId: key.id,
            success: false,
            statusCode: 499,
            error: 'Client disconnected',
            durationMs: attemptDuration,
          });
          throw Object.assign(new Error('Client disconnected'), { attempts, clientAborted: true });
        }

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

        continue;
      }
    }
  }

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
  moneySavedUsd?: number;
  cached?: boolean;
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
      stream, error_message, request_body, response_body,
      money_saved_usd, cached
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
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
    resBodyStr,
    entry.moneySavedUsd ?? 0,
    entry.cached ? 1 : 0
  );
}