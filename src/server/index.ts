import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import open from 'open';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { getDb, closeDb, getSettings, updateSettings, pruneStoredData, getAdminToken } from './db.js';
import { encryptKey, decryptKey, maskKey, generateGatewayKey, hashGatewayKey, safeEqual } from './crypto.js';
import { PROVIDER_PRESETS } from './presets.js';
import { testProviderConnection, fetchAndSyncModels, previewOpenCodeConfig, importProviderFromOpenCode, probeAndInspectProvider } from './provider-service.js';
import { resolveTargets, executeWithFailover, detectClientTool, logRequest, type RouteTarget } from './router-engine.js';
import { addKeyTokens } from './key-pool.js';
import { resolvePort, resolveHost, normalizeOpenAIBaseUrl } from './config.js';
import { translateAnthropicToOpenAI, translateOpenAIToAnthropicResponse, translateResponsesApiToChatCompletion, translateChatCompletionToResponsesApi } from './protocol-translator.js';
import { startHealthProber, stopHealthProber } from './health-prober.js';
import { generateToolConfigs, writeToOpenCodeConfig, writeToContinueConfig, writeToAiderConfig } from './connect-helper.js';
import { lookupCache, saveToCache, clearCache, getCacheStats } from './cache-manager.js';
import { calculateMoneySaved, getSavingsStats } from './cost-calculator.js';
import { optimizePromptPayload, estimatePromptTokens } from './prompt-optimizer.js';
import { detectLocalServices, autoRegisterLocalService } from './local-detector.js';
import { handleMcpRequest } from './mcp-server.js';
import { isFreeModelId } from '../shared/types.js';


const app = new Hono();

// Runtime facts populated at boot, surfaced to the dashboard and MCP clients.
const runtimeInfo = {
  port: 4000,
  host: '127.0.0.1',
  startedAt: Date.now(),
  version: '1.0.0',
};

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// Enable CORS for frontend development
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-nonstop-admin', 'anthropic-version', 'x-stainless-arch', 'x-stainless-lang', 'x-stainless-os', 'x-stainless-package-version', 'x-stainless-runtime', 'x-stainless-runtime-version', 'anthropic-beta', 'anthropic-dangerous-direct-browser-access'],
  exposeHeaders: ['x-nonstop-tokens-saved', 'x-nonstop-optimized', 'X-NonStop-Cached'],
}));

// The dashboard/admin API is local-only and protected against cross-site requests
// from other pages running on the same machine. Every /api request must present the
// admin token, which is injected into the served dashboard HTML (first-party) and
// cannot be read by other origins. Agents/scripts pass it via the x-nonstop-admin
// header or an ?admin_token= query parameter.
app.use('/api/*', async (c, next) => {
  const provided = c.req.header('x-nonstop-admin') || c.req.query('admin_token') || '';
  if (!safeEqual(provided, getAdminToken())) {
    return c.json({
      error: 'Admin API requires a NonStop admin token. Open the dashboard at http://127.0.0.1:4000 or send the x-nonstop-admin header.',
      type: 'admin_auth_required',
    }, 401);
  }
  await next();
});

// -------------------------------------------------------------
// MODEL CONTEXT PROTOCOL (MCP) ENDPOINTS (/mcp)
// -------------------------------------------------------------
app.post('/mcp', async (c) => {
  try {
    const mcpBody = await c.req.json();
    const mcpRes = await handleMcpRequest(mcpBody);
    return c.json(mcpRes);
  } catch (err: any) {
    return c.json({
      jsonrpc: '2.0',
      error: { code: -32700, message: `Parse error: ${err.message}` },
    }, 400);
  }
});

app.get('/mcp/sse', async (c) => {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'endpoint',
      data: '/mcp',
    });
  });
});

// SSE client subscribers
const sseClients = new Set<(event: string, data: any) => void>();
function broadcastEvent(event: string, data: any) {
  for (const send of sseClients) {
    try {
      send(event, data);
    } catch {}
  }
}

// -------------------------------------------------------------
// GATEWAY AUTHENTICATION MIDDLEWARE (/v1/*)
// -------------------------------------------------------------
app.use('/v1/*', async (c, next) => {
  const authHeader = c.req.header('authorization') || c.req.header('x-api-key') || '';
  let token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return c.json({
      error: {
        message: 'Missing gateway API key. Provide Authorization: Bearer <key> or x-api-key.',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    }, 401);
  }

  const tokenHash = hashGatewayKey(token);
  const db = getDb();
  const keyRecord = db.prepare('SELECT id FROM gateway_keys WHERE key_hash = ?').get(tokenHash) as any;

  if (!keyRecord) {
    return c.json({
      error: {
        message: 'Invalid gateway API key.',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    }, 401);
  }

  // Update last used
  db.prepare('UPDATE gateway_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), keyRecord.id);
  await next();
});

// -------------------------------------------------------------
// CLIENT-FACING GATEWAY ENDPOINTS
// -------------------------------------------------------------

// GET /v1/models: List chains first, then enabled models & universal aliases
app.get('/v1/models', async (c) => {
  const db = getDb();
  const chains = db.prepare('SELECT name, created_at FROM chains ORDER BY name ASC').all() as any[];
  const models = db.prepare(`
    SELECT m.model_id, p.name as provider_name, m.last_discovered_at
    FROM models m
    JOIN providers p ON m.provider_id = p.id
    WHERE m.enabled = 1
    ORDER BY m.model_id ASC
  `).all() as any[];

  const data: any[] = [];

  // Chains first
  for (const ch of chains) {
    data.push({
      id: ch.name,
      object: 'model',
      created: Math.floor(ch.created_at / 1000),
      owned_by: 'nonstop-router-chain',
      permission: [],
      root: ch.name,
    });
  }

  // Enabled models
  for (const m of models) {
    data.push({
      id: m.model_id,
      object: 'model',
      created: Math.floor(m.last_discovered_at / 1000),
      owned_by: m.provider_name,
      permission: [],
      root: m.model_id,
    });
  }

  // Universal Industry Aliases (maps automatically to active targets)
  const universalAliases = [
    { id: 'claude-3-7-sonnet', owned_by: 'anthropic-alias' },
    { id: 'claude-3-5-sonnet', owned_by: 'anthropic-alias' },
    { id: 'gpt-4o', owned_by: 'openai-alias' },
    { id: 'gpt-4o-mini', owned_by: 'openai-alias' },
    { id: 'deepseek-chat', owned_by: 'deepseek-alias' },
    { id: 'deepseek-reasoner', owned_by: 'deepseek-alias' },
    { id: 'gemini-2.5-flash', owned_by: 'google-alias' },
  ];

  for (const alias of universalAliases) {
    if (!data.some(d => d.id.toLowerCase() === alias.id.toLowerCase())) {
      data.push({
        id: alias.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: alias.owned_by,
        permission: [],
        root: alias.id,
      });
    }
  }

  return c.json({ object: 'list', data });
});

// POST /v1/chat/completions: OpenAI Chat Completions with failover & streaming
app.post('/v1/chat/completions', async (c) => {
  const start = Date.now();
  const rawBody = await c.req.json();
  const settings = getSettings();
  
  // 1. Context & Token Optimizer (trim excessive whitespace, repeated turn blocks, verbose git diffs)
  let body = rawBody;
  let tokensSaved = 0;
  if (settings.enablePromptOptimizer) {
    const optRes = optimizePromptPayload(rawBody);
    body = optRes.optimizedBody;
    tokensSaved = optRes.estimatedTokensSaved;
  }
  c.header('x-nonstop-tokens-saved', String(tokensSaved));
  c.header('x-nonstop-optimized', 'true');

  const requestedModel = body.model || 'auto';
  const stream = Boolean(body.stream);
  const requiresTools = Boolean(body.tools && body.tools.length > 0);
  const estimatedTokens = estimatePromptTokens(body);
  const clientTool = detectClientTool(c.req.raw.headers, '/v1/chat/completions');

  // 2. Local exact-match response cache (0ms latency, zero tokens consumed)
  if (settings.enableCache) {
    const cachedEntry = lookupCache('/v1/chat/completions', requestedModel, body);
    if (cachedEntry) {
      const cachedLatency = Date.now() - start;
      const respJson = cachedEntry.responseJson;
      const moneySaved = calculateMoneySaved(requestedModel, respJson?.usage?.prompt_tokens, respJson?.usage?.completion_tokens, true);

      logRequest({
        clientTool,
        endpoint: '/v1/chat/completions',
        chainName: 'cache',
        requestedModel,
        finalTarget: null,
        attempts: [],
        statusCode: 200,
        latencyMs: cachedLatency,
        ttftMs: cachedLatency,
        promptTokens: respJson?.usage?.prompt_tokens,
        completionTokens: respJson?.usage?.completion_tokens,
        totalTokens: respJson?.usage?.total_tokens,
        stream,
        requestBody: body,
        responseBody: respJson,
        moneySavedUsd: moneySaved,
        cached: true,
      });

      broadcastEvent('request_completed', {
        endpoint: '/v1/chat/completions',
        clientTool,
        model: requestedModel,
        target: 'cache/local-sqlite',
        latencyMs: cachedLatency,
        ttftMs: cachedLatency,
        failovers: 0,
        cached: true,
      });

      if (!stream) {
        c.header('X-NonStop-Cached', 'true');
        return c.json(respJson);
      } else {
        return streamSSE(c, async (sseStream) => {
          c.header('X-NonStop-Cached', 'true');
          const content = respJson?.choices?.[0]?.message?.content || '';
          const chunkObj = {
            id: `chatcmpl_cached_${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
          };
          try {
            await sseStream.write(`data: ${JSON.stringify(chunkObj)}\n\ndata: [DONE]\n\n`);
          } catch {}
        });
      }
    }
  }

  const { chainName, targets } = resolveTargets(requestedModel, requiresTools, estimatedTokens);

  if (targets.length === 0) {
    const errObj = { error: { message: `No healthy targets configured for model/chain '${requestedModel}'`, type: 'router_error' } };
    logRequest({
      clientTool,
      endpoint: '/v1/chat/completions',
      chainName,
      requestedModel,
      attempts: [],
      statusCode: 502,
      latencyMs: Date.now() - start,
      stream,
      errorMessage: errObj.error.message,
      requestBody: body,
    });
    return c.json(errObj, 502);
  }

  if (!stream) {
    // Non-streaming request
    try {
      const result = await executeWithFailover(targets, body, c.req.raw.signal);
      const json = await result.response.json();
      const latencyMs = Date.now() - start;

      const pTokens = json.usage?.prompt_tokens || Math.round(JSON.stringify(body).length / 4);
      const cTokens = json.usage?.completion_tokens || Math.round(JSON.stringify(json).length / 4);
      const totalTokens = json.usage?.total_tokens || (pTokens + cTokens);
      const moneySaved = calculateMoneySaved(result.finalTarget.modelId, pTokens, cTokens, false);

      if (result.finalKey?.id) {
        addKeyTokens(result.finalKey.id, totalTokens);
      }

      // Save to cache for future requests
      if (settings.enableCache && json) {
        saveToCache('/v1/chat/completions', requestedModel, body, json, pTokens, cTokens);
      }

      logRequest({
        clientTool,
        endpoint: '/v1/chat/completions',
        chainName,
        requestedModel,
        finalTarget: result.finalTarget,
        attempts: result.attempts,
        statusCode: 200,
        latencyMs,
        promptTokens: pTokens,
        completionTokens: cTokens,
        totalTokens,
        stream: false,
        requestBody: body,
        responseBody: json,
        moneySavedUsd: moneySaved,
        cached: false,
      });

      broadcastEvent('request_completed', {
        endpoint: '/v1/chat/completions',
        clientTool,
        model: requestedModel,
        target: `${result.finalTarget.providerName}/${result.finalTarget.modelId}`,
        latencyMs,
        failovers: Math.max(0, result.attempts.length - 1),
      });

      return c.json(json);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const statusCode = 502;
      const errResponse = {
        error: {
          message: err.message || 'All targets failed',
          type: 'router_failover_exhausted',
          attempts: err.attempts || [],
        },
      };

      logRequest({
        clientTool,
        endpoint: '/v1/chat/completions',
        chainName,
        requestedModel,
        attempts: err.attempts || [],
        statusCode,
        latencyMs,
        stream: false,
        errorMessage: err.message,
        requestBody: body,
      });

      return c.json(errResponse, statusCode);
    }
  }

// Streaming request (Server-Sent Events)
  return streamSSE(c, async (sseStream) => {
    let ttftRecorded = false;
    let ttftMs: number | null = null;
    let finalTarget: RouteTarget | null = null;
    let finalKeyId: string | null = null;
    let attemptsHistory: any[] = [];
    let accumulatedText = '';
    let streamCapturedTokens = 0;
    let clientGone = false;

    // Attempts the stream across the target list. If the upstream dies after tokens
    // have already been flushed to the client and restartOnMidstreamFailure is
    // enabled, it retries the request on the next target instead of surfacing a
    // truncated stream.
    for (let attempt = 0; attempt < targets.length; attempt++) {
      try {
        const result = await executeWithFailover(targets.slice(attempt), body, c.req.raw.signal);
        finalTarget = result.finalTarget;
        finalKeyId = result.finalKey?.id || null;
        attemptsHistory = [...attemptsHistory, ...result.attempts];

        const upstreamBody = result.response.body;
        if (!upstreamBody) {
          throw new Error('Upstream response body is empty');
        }

        const reader = upstreamBody.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (!ttftRecorded) {
            ttftRecorded = true;
            ttftMs = Date.now() - start;
          }

          const chunkText = decoder.decode(value, { stream: true });

          // Extract usage tokens if the upstream SSE stream reports them
          const matches = chunkText.match(/"total_tokens":\s*(\d+)/g);
          if (matches) {
            for (const m of matches) {
              const num = parseInt(m.split(':')[1].trim(), 10);
              if (num > streamCapturedTokens) streamCapturedTokens = num;
            }
          }

          // Accumulate text for cache
          const lines = chunkText.split('\n');
          for (const l of lines) {
            const trimmed = l.trim();
            if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
              try {
                const parsed = JSON.parse(trimmed.slice(5).trim());
                const d = parsed.choices?.[0]?.delta?.content;
                if (d) accumulatedText += d;
              } catch {}
            }
          }

          // Forward raw SSE chunk lines safely
          try {
            await sseStream.write(chunkText);
          } catch {
            // Client disconnected
            clientGone = true;
            break;
          }
        }

        if (clientGone) break;

        const totalLatency = Date.now() - start;
        const pTokens = estimatePromptTokens(body);
        const cTokens = Math.round(accumulatedText.length / 4);
        const totalStreamTokens = streamCapturedTokens > 0 ? streamCapturedTokens : (pTokens + cTokens);
        const moneySaved = calculateMoneySaved(finalTarget?.modelId || requestedModel, pTokens, cTokens, false);

        if (finalKeyId) {
          addKeyTokens(finalKeyId, totalStreamTokens);
        }

        // Cache streaming completion if text was accumulated
        if (settings.enableCache && accumulatedText && finalTarget) {
          saveToCache('/v1/chat/completions', requestedModel, body, {
            id: `chatcmpl_${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: finalTarget.modelId,
            choices: [{ index: 0, message: { role: 'assistant', content: accumulatedText }, finish_reason: 'stop' }],
            usage: { prompt_tokens: pTokens, completion_tokens: cTokens, total_tokens: pTokens + cTokens }
          }, pTokens, cTokens);
        }

        logRequest({
          clientTool,
          endpoint: '/v1/chat/completions',
          chainName,
          requestedModel,
          finalTarget,
          attempts: attemptsHistory,
          statusCode: 200,
          latencyMs: totalLatency,
          ttftMs,
          promptTokens: pTokens,
          completionTokens: cTokens,
          stream: true,
          moneySavedUsd: moneySaved,
          cached: false,
        });

        broadcastEvent('request_completed', {
          endpoint: '/v1/chat/completions',
          clientTool,
          model: requestedModel,
          target: finalTarget ? `${finalTarget.providerName}/${finalTarget.modelId}` : requestedModel,
          latencyMs: totalLatency,
          ttftMs,
          failovers: Math.max(0, attemptsHistory.length - 1),
        });

        return;
      } catch (err: any) {
        if (err?.clientAborted) {
          logRequest({
            clientTool, endpoint: '/v1/chat/completions', chainName, requestedModel,
            finalTarget, attempts: err.attempts || attemptsHistory, statusCode: 499,
            latencyMs: Date.now() - start, ttftMs, stream: true, errorMessage: 'Client disconnected',
          });
          return;
        }

        const canRetryMidStream =
          ttftRecorded && settings.restartOnMidstreamFailure && attempt < targets.length - 1;

        if (canRetryMidStream) {
          // Signal the retry to the client and reset accumulated state before
          // continuing on the next target.
          try {
            await sseStream.write(`data: ${JSON.stringify({
              id: `chatcmpl_retry_${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: requestedModel,
              choices: [{ index: 0, delta: {}, finish_reason: null }],
              'x-nonstop-midstream-failover': true,
            })}\n\n`);
          } catch {}
          accumulatedText = '';
          ttftRecorded = false;
          ttftMs = null;
          continue;
        }

        if (!ttftRecorded) {
          // Stream failed before first token: emit clean error event
          const errPayload = JSON.stringify({
            error: {
              message: err.message || 'Stream connection failed',
              type: 'stream_error',
              attempts: err.attempts || attemptsHistory,
            },
          });
          try {
            await sseStream.write(`data: ${errPayload}\n\ndata: [DONE]\n\n`);
          } catch {}
        } else {
          // Mid-stream failure: send standard termination
          try {
            await sseStream.write(`data: {"error": {"message": "Stream disconnected mid-response", "type": "stream_interrupted"}}\n\ndata: [DONE]\n\n`);
          } catch {}
        }

        logRequest({
          clientTool,
          endpoint: '/v1/chat/completions',
          chainName,
          requestedModel,
          finalTarget,
          attempts: err.attempts || attemptsHistory,
          statusCode: 502,
          latencyMs: Date.now() - start,
          ttftMs,
          stream: true,
          errorMessage: err.message,
        });
        return;
      }
    }
  });
});

// POST /v1/messages: Anthropic Messages API (for Claude Code)
app.post('/v1/messages', async (c) => {
  const start = Date.now();
  const body = await c.req.json();
  const requestedModel = body.model || 'auto';
  const stream = Boolean(body.stream);
  const clientTool = detectClientTool(c.req.raw.headers, '/v1/messages');

  const { chainName, targets } = resolveTargets(requestedModel, Boolean(body.tools?.length));

  if (targets.length === 0) {
    return c.json({
      type: 'error',
      error: { type: 'not_found_error', message: `No targets found for model ${requestedModel}` },
    }, 404);
  }

  // Translate Anthropic format to OpenAI format
  const openAiPayload = translateAnthropicToOpenAI(body);

  if (!stream) {
    try {
      const result = await executeWithFailover(targets, openAiPayload, c.req.raw.signal);
      const openAiJson = await result.response.json();
      const anthropicResp = translateOpenAIToAnthropicResponse(openAiJson, requestedModel);
      const latencyMs = Date.now() - start;

      if (result.finalKey?.id) {
        addKeyTokens(result.finalKey.id, openAiJson.usage?.total_tokens || 0);
      }

      logRequest({
        clientTool,
        endpoint: '/v1/messages',
        chainName,
        requestedModel,
        finalTarget: result.finalTarget,
        attempts: result.attempts,
        statusCode: 200,
        latencyMs,
        promptTokens: openAiJson.usage?.prompt_tokens,
        completionTokens: openAiJson.usage?.completion_tokens,
        totalTokens: openAiJson.usage?.total_tokens,
        stream: false,
        requestBody: body,
        responseBody: anthropicResp,
      });

      broadcastEvent('request_completed', {
        endpoint: '/v1/messages',
        clientTool,
        model: requestedModel,
        target: `${result.finalTarget.providerName}/${result.finalTarget.modelId}`,
        latencyMs,
        failovers: Math.max(0, result.attempts.length - 1),
      });

      return c.json(anthropicResp);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      logRequest({
        clientTool,
        endpoint: '/v1/messages',
        chainName,
        requestedModel,
        attempts: err.attempts || [],
        statusCode: 502,
        latencyMs,
        stream: false,
        errorMessage: err.message,
      });

      return c.json({
        type: 'error',
        error: { type: 'api_error', message: err.message || 'All targets failed' },
      }, 502);
    }
  }

  // Streaming Anthropic SSE
  return streamSSE(c, async (sseStream) => {
    let ttftRecorded = false;
    let ttftMs: number | null = null;
    let finalTarget: RouteTarget | null = null;
    let attemptsHistory: any[] = [];
    const msgId = `msg_${crypto.randomUUID()}`;

    try {
      const streamingPayload = { ...openAiPayload, stream: true };
      const result = await executeWithFailover(targets, streamingPayload, c.req.raw.signal);
      finalTarget = result.finalTarget;
      attemptsHistory = result.attempts;

      const upstreamBody = result.response.body;
      if (!upstreamBody) throw new Error('Empty upstream stream');

      // Send Anthropic message_start event
      await sseStream.write(`event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          model: requestedModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      })}\n\n`);

      // Start text block
      await sseStream.write(`event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" }
      })}\n\n`);

      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!ttftRecorded) {
          ttftRecorded = true;
          ttftMs = Date.now() - start;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const chunk = JSON.parse(dataStr);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              try {
                await sseStream.write(`event: content_block_delta\ndata: ${JSON.stringify({
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: delta.content }
                })}\n\n`);
              } catch {
                break;
              }
            }
          } catch {}
        }
      }

      // Close text block & message
      try {
        await sseStream.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
        await sseStream.write(`event: message_delta\ndata: ${JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 0 }
        })}\n\n`);
        await sseStream.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
      } catch {}

      const totalLatency = Date.now() - start;
      logRequest({
        clientTool,
        endpoint: '/v1/messages',
        chainName,
        requestedModel,
        finalTarget,
        attempts: attemptsHistory,
        statusCode: 200,
        latencyMs: totalLatency,
        ttftMs,
        stream: true,
      });

      broadcastEvent('request_completed', {
        endpoint: '/v1/messages',
        clientTool,
        model: requestedModel,
        target: finalTarget ? `${finalTarget.providerName}/${finalTarget.modelId}` : requestedModel,
        latencyMs: totalLatency,
        ttftMs,
        failovers: Math.max(0, attemptsHistory.length - 1),
      });
    } catch (err: any) {
      try {
        await sseStream.write(`event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "api_error", message: err.message || "Failed upstream stream" }
        })}\n\n`);
      } catch {}

      logRequest({
        clientTool,
        endpoint: '/v1/messages',
        chainName,
        requestedModel,
        finalTarget,
        attempts: err.attempts || attemptsHistory,
        statusCode: 502,
        latencyMs: Date.now() - start,
        ttftMs,
        stream: true,
        errorMessage: err.message,
      });
    }
  });
});

// POST /v1/responses: OpenAI Responses API (for Codex CLI)
app.post('/v1/responses', async (c) => {
  const start = Date.now();
  const body = await c.req.json();
  const requestedModel = body.model || 'auto';
  const stream = Boolean(body.stream);
  const clientTool = detectClientTool(c.req.raw.headers, '/v1/responses');

  const { chainName, targets } = resolveTargets(requestedModel, Boolean(body.tools?.length), estimatePromptTokens(body.input || body));
  if (targets.length === 0) {
    return c.json({ error: { message: `No targets for ${requestedModel}` } }, 404);
  }

  const openAiPayload = { ...translateResponsesApiToChatCompletion(body), stream };

  if (!stream) {
    try {
      const result = await executeWithFailover(targets, openAiPayload, c.req.raw.signal);
      const openAiJson = await result.response.json();
      const responsesApiJson = translateChatCompletionToResponsesApi(openAiJson);
      const latencyMs = Date.now() - start;

      if (result.finalKey?.id) {
        addKeyTokens(result.finalKey.id, openAiJson.usage?.total_tokens || 0);
      }

      logRequest({
        clientTool,
        endpoint: '/v1/responses',
        chainName,
        requestedModel,
        finalTarget: result.finalTarget,
        attempts: result.attempts,
        statusCode: 200,
        latencyMs,
        promptTokens: openAiJson.usage?.prompt_tokens,
        completionTokens: openAiJson.usage?.completion_tokens,
        totalTokens: openAiJson.usage?.total_tokens,
        stream: false,
        requestBody: body,
        responseBody: responsesApiJson,
      });

      broadcastEvent('request_completed', {
        endpoint: '/v1/responses',
        clientTool,
        model: requestedModel,
        target: `${result.finalTarget.providerName}/${result.finalTarget.modelId}`,
        latencyMs,
        failovers: Math.max(0, result.attempts.length - 1),
      });

      return c.json(responsesApiJson);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      logRequest({
        clientTool,
        endpoint: '/v1/responses',
        chainName,
        requestedModel,
        attempts: err.attempts || [],
        statusCode: 502,
        latencyMs,
        stream: false,
        errorMessage: err.message,
      });
      return c.json({ error: { message: err.message } }, 502);
    }
  }

  // Streaming Responses API SSE (Codex CLI)
  return streamSSE(c, async (sseStream) => {
    const responseId = `resp_${crypto.randomUUID().replace(/-/g, '')}`;
    let ttftMs: number | null = null;
    let finalTarget: RouteTarget | null = null;
    let attemptsHistory: any[] = [];

    try {
      const result = await executeWithFailover(targets, openAiPayload, c.req.raw.signal);
      finalTarget = result.finalTarget;
      attemptsHistory = result.attempts;

      await sseStream.write(`event: response.created\ndata: ${JSON.stringify({
        type: 'response.created',
        response: { id: responseId, object: 'response', status: 'in_progress', model: requestedModel, output: [] },
      })}\n\n`);

      const upstreamBody = result.response.body;
      if (!upstreamBody) throw new Error('Empty upstream stream');
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ttftMs === null) ttftMs = Date.now() - start;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(dataStr);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              await sseStream.write(`event: response.output_text.delta\ndata: ${JSON.stringify({
                type: 'response.output_text.delta',
                item_id: `${responseId}_msg`,
                output_index: 0,
                content_index: 0,
                delta,
              })}\n\n`);
            }
          } catch {}
        }
      }

      const latencyMs = Date.now() - start;
      const pTokens = estimatePromptTokens(body.input || body);
      const cTokens = Math.round(accumulated.length / 4);

      await sseStream.write(`event: response.completed\ndata: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: responseId,
          object: 'response',
          status: 'completed',
          model: requestedModel,
          output: [{
            type: 'message',
            id: `${responseId}_msg`,
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: accumulated, annotations: [] }],
          }],
          usage: { input_tokens: pTokens, output_tokens: cTokens, total_tokens: pTokens + cTokens },
        },
      })}\n\n`);

      if (result.finalKey?.id) addKeyTokens(result.finalKey.id, pTokens + cTokens);

      logRequest({
        clientTool, endpoint: '/v1/responses', chainName, requestedModel,
        finalTarget, attempts: attemptsHistory, statusCode: 200, latencyMs, ttftMs,
        promptTokens: pTokens, completionTokens: cTokens, stream: true,
      });

      broadcastEvent('request_completed', {
        endpoint: '/v1/responses', clientTool, model: requestedModel,
        target: finalTarget ? `${finalTarget.providerName}/${finalTarget.modelId}` : requestedModel,
        latencyMs, ttftMs, failovers: Math.max(0, attemptsHistory.length - 1),
      });
    } catch (err: any) {
      try {
        await sseStream.write(`event: response.failed\ndata: ${JSON.stringify({
          type: 'response.failed',
          response: { id: responseId, status: 'failed', error: { message: err.message || 'Upstream failure' } },
        })}\n\n`);
      } catch {}

      logRequest({
        clientTool, endpoint: '/v1/responses', chainName, requestedModel,
        finalTarget, attempts: err.attempts || attemptsHistory, statusCode: 502,
        latencyMs: Date.now() - start, ttftMs, stream: true, errorMessage: err.message,
      });
    }
  });
});

// -------------------------------------------------------------
// ADMIN API (/api/*)
// -------------------------------------------------------------

// Real-time SSE stream for dashboard
app.get('/api/events', async (c) => {
  return streamSSE(c, async (stream) => {
    const sender = (event: string, data: any) => {
      stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sseClients.add(sender);
    // Send initial connected event
    await stream.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

    const interval = setInterval(async () => {
      try {
        await stream.write(`: ping\n\n`);
      } catch {}
    }, 20000);

    c.req.raw.signal.addEventListener('abort', () => {
      clearInterval(interval);
      sseClients.delete(sender);
    });

    // Keep stream alive until client disconnect
    await new Promise(() => {});
  });
});

// GET /api/overview: Health overview stats
app.get('/api/overview', async (c) => {
  const db = getDb();
  const totalProviders = (db.prepare('SELECT COUNT(*) as count FROM providers').get() as any).count;
  const totalKeys = (db.prepare('SELECT COUNT(*) as count FROM provider_keys').get() as any).count;
  const healthyKeys = (db.prepare("SELECT COUNT(*) as count FROM provider_keys WHERE status = 'healthy'").get() as any).count;
  const totalChains = (db.prepare('SELECT COUNT(*) as count FROM chains').get() as any).count;
  const totalModels = (db.prepare('SELECT COUNT(*) as count FROM models').get() as any).count;
  const enabledModels = (db.prepare('SELECT COUNT(*) as count FROM models WHERE enabled = 1').get() as any).count;

  // Requests in last 60 seconds
  const oneMinAgo = Date.now() - 60000;
  const rpm = (db.prepare('SELECT COUNT(*) as count FROM request_logs WHERE timestamp >= ?').get(oneMinAgo) as any).count;

  // Total failover events: logs whose attempts list shows more than one target
  const totalLogs = db.prepare('SELECT targets_attempted FROM request_logs ORDER BY timestamp DESC LIMIT 500').all() as any[];
  let totalFailovers = 0;
  for (const log of totalLogs) {
    try {
      const attempts = JSON.parse(log.targets_attempted);
      if (Array.isArray(attempts) && attempts.length > 1) {
        totalFailovers++;
      }
    } catch {}
  }

  // Active chains with their highest-priority target and its most healthy key
  const chains = db.prepare('SELECT * FROM chains').all() as any[];
  const activeChains = chains.map(ch => {
    const target = db.prepare(`
      SELECT ct.model_id, p.name as provider_name,
        (SELECT status FROM provider_keys k
          WHERE k.provider_id = p.id
          ORDER BY CASE status
            WHEN 'healthy' THEN 0 WHEN 'probing' THEN 1
            WHEN 'cooling_down' THEN 2 ELSE 3 END
          LIMIT 1) as key_status
      FROM chain_targets ct
      JOIN providers p ON ct.provider_id = p.id
      WHERE ct.chain_id = ?
      ORDER BY ct.order_index ASC LIMIT 1
    `).get(ch.id) as any;

    return {
      chainId: ch.id,
      chainName: ch.name,
      mode: ch.mode,
      activeTarget: target ? {
        providerName: target.provider_name,
        modelId: target.model_id,
        status: target.key_status || 'healthy',
      } : null,
    };
  });

  // Recent errors
  const recentLogs = db.prepare('SELECT * FROM request_logs WHERE status_code >= 400 ORDER BY timestamp DESC LIMIT 5').all() as any[];
  const recentErrors = recentLogs.map(r => ({
    timestamp: r.timestamp,
    providerName: r.final_provider_name || 'Router',
    modelId: r.final_model_id || r.requested_model,
    error: r.error_message || `HTTP ${r.status_code}`,
  }));

  const savings = getSavingsStats();
  const cacheStats = getCacheStats();

  return c.json({
    totalProviders,
    totalKeys,
    healthyKeys,
    totalChains,
    totalModels,
    enabledModels,
    requestsPerMinute: rpm,
    totalFailovers,
    totalMoneySavedUsd: savings.totalSavedUsd,
    totalTokensSaved: savings.totalTokensSaved + cacheStats.totalTokensSaved,
    cacheHitCount: cacheStats.totalHits,
    activeChains,
    recentErrors,
    runtime: {
      port: runtimeInfo.port,
      host: runtimeInfo.host,
      baseUrl: `http://${runtimeInfo.host === '0.0.0.0' ? '127.0.0.1' : runtimeInfo.host}:${runtimeInfo.port}`,
      allowLan: getSettings().allowLan,
      startedAt: runtimeInfo.startedAt,
      version: runtimeInfo.version,
    },
  });
});


// GET /api/presets
app.get('/api/presets', (c) => {
  return c.json(PROVIDER_PRESETS);
});

// PROVIDERS CRUD
app.get('/api/providers', (c) => {
  const db = getDb();
  const providers = db.prepare('SELECT * FROM providers ORDER BY created_at DESC').all() as any[];
  const result = providers.map(p => {
    const keys = db.prepare('SELECT * FROM provider_keys WHERE provider_id = ? ORDER BY created_at ASC').all(p.id) as any[];
    const modelCount = (db.prepare('SELECT COUNT(*) as count FROM models WHERE provider_id = ?').get(p.id) as any).count;
    const enabledModelCount = (db.prepare('SELECT COUNT(*) as count FROM models WHERE provider_id = ? AND enabled = 1').get(p.id) as any).count;

    return {
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.base_url,
      selectionStrategy: p.selection_strategy,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      keys: keys.map(k => ({
        id: k.id,
        providerId: k.provider_id,
        label: k.label,
        keyMasked: k.key_masked,
        status: k.status,
        cooldownUntil: k.cooldown_until,
        consecutiveFailures: k.consecutive_failures,
        lastError: k.last_error,
        lastErrorAt: k.last_error_at,
        usageCount: k.usage_count,
        tokensUsed: k.tokens_used || 0,
        disabled: Boolean(k.disabled),
        createdAt: k.created_at,
        updatedAt: k.updated_at,
      })),
      modelCount,
      enabledModelCount,
    };
  });
  return c.json(result);
});

app.post('/api/providers', async (c) => {
  const body = await c.req.json();
  const { name, protocol, baseUrl, selectionStrategy = 'round-robin', initialKey, keyLabel = 'Account 1' } = body;

  if (!name || !protocol || !baseUrl) {
    return c.json({ error: 'Name, protocol, and baseUrl are required' }, 400);
  }

  const db = getDb();
  const providerId = `prov_${crypto.randomUUID()}`;
  const now = Date.now();
  const normalizedBaseUrl = protocol === 'openai' ? normalizeOpenAIBaseUrl(baseUrl) : String(baseUrl).replace(/\/+$/, '');

  db.prepare(`
    INSERT INTO providers (id, name, protocol, base_url, selection_strategy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(providerId, name, protocol, normalizedBaseUrl, selectionStrategy, now, now);

  if (initialKey && initialKey.trim()) {
    const keyId = `key_${crypto.randomUUID()}`;
    const encrypted = encryptKey(initialKey.trim());
    const masked = maskKey(initialKey.trim());

    db.prepare(`
      INSERT INTO provider_keys (
        id, provider_id, label, key_encrypted, key_masked,
        status, consecutive_failures, usage_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'healthy', 0, 0, ?, ?)
    `).run(keyId, providerId, keyLabel, encrypted, masked, now, now);
  }

  // Attempt auto model discovery
  try {
    await fetchAndSyncModels(providerId);
  } catch (err: any) {
    console.warn('Initial model sync error (can be refreshed later):', err.message);
  }

  return c.json({ success: true, providerId });
});

app.put('/api/providers/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, protocol, baseUrl, selectionStrategy } = body;

  const db = getDb();
  const now = Date.now();
  const normalizedBaseUrl = baseUrl
    ? (protocol === 'openai' || !protocol ? normalizeOpenAIBaseUrl(baseUrl) : String(baseUrl).replace(/\/+$/, ''))
    : null;
  db.prepare(`
    UPDATE providers
    SET name = COALESCE(?, name),
        protocol = COALESCE(?, protocol),
        base_url = COALESCE(?, base_url),
        selection_strategy = COALESCE(?, selection_strategy),
        updated_at = ?
    WHERE id = ?
  `).run(name, protocol, normalizedBaseUrl, selectionStrategy, now, id);

  return c.json({ success: true });
});

app.delete('/api/providers/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  try {
    db.prepare('DELETE FROM chain_targets WHERE provider_id = ?').run(id);
    db.prepare('DELETE FROM models WHERE provider_id = ?').run(id);
    db.prepare('DELETE FROM provider_keys WHERE provider_id = ?').run(id);
    db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    return c.json({ success: true, id });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Test connection endpoint
app.post('/api/providers/test', async (c) => {
  const body = await c.req.json();
  const { protocol, baseUrl, rawKey } = body;
  if (!protocol || !baseUrl) {
    return c.json({ error: 'Protocol and baseUrl are required' }, 400);
  }
  const result = await testProviderConnection(protocol, baseUrl, rawKey);
  return c.json(result);
});

app.post('/api/providers/:id/test', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as any;
  if (!provider) return c.json({ error: 'Provider not found' }, 404);

  const key = db.prepare('SELECT key_encrypted FROM provider_keys WHERE provider_id = ? ORDER BY consecutive_failures ASC LIMIT 1').get(id) as any;
  let rawKey: string | undefined;
  if (key) {
    try { rawKey = decryptKey(key.key_encrypted); } catch {}
  }

  const result = await testProviderConnection(provider.protocol, provider.base_url, rawKey);
  return c.json(result);
});

// Provider Key Management
app.post('/api/providers/:id/keys', async (c) => {
  const providerId = c.req.param('id');
  const body = await c.req.json();
  const { rawKey, label = 'Secondary Key' } = body;

  if (!rawKey || !rawKey.trim()) {
    return c.json({ error: 'API key is required' }, 400);
  }

  const db = getDb();
  const keyId = `key_${crypto.randomUUID()}`;
  const encrypted = encryptKey(rawKey.trim());
  const masked = maskKey(rawKey.trim());
  const now = Date.now();

  db.prepare(`
    INSERT INTO provider_keys (
      id, provider_id, label, key_encrypted, key_masked,
      status, consecutive_failures, usage_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'healthy', 0, 0, ?, ?)
  `).run(keyId, providerId, label, encrypted, masked, now, now);

  return c.json({ success: true, keyId, keyMasked: masked });
});

app.delete('/api/keys/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  try {
    db.prepare('DELETE FROM provider_keys WHERE id = ?').run(id);
    return c.json({ success: true, id });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/keys/:id/reset', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  db.prepare(`
    UPDATE provider_keys
    SET status = 'healthy', cooldown_until = NULL, consecutive_failures = 0, last_error = NULL
    WHERE id = ?
  `).run(id);
  return c.json({ success: true });
});

// Disable Key (excluded from routing until re-enabled; the secret is kept)
app.post('/api/keys/:id/disable', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  db.prepare('UPDATE provider_keys SET disabled = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  return c.json({ success: true, disabled: true });
});

// Enable Key (restored to the pool as healthy)
app.post('/api/keys/:id/enable', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  db.prepare(`
    UPDATE provider_keys
    SET disabled = 0, status = 'healthy', cooldown_until = NULL,
        consecutive_failures = 0, last_error = NULL, updated_at = ?
    WHERE id = ?
  `).run(Date.now(), id);
  return c.json({ success: true, disabled: false });
});

// Edit Key (Rename or update key string)
app.put('/api/keys/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { label, rawKey } = body;
  const db = getDb();
  const now = Date.now();

  if (rawKey && rawKey.trim()) {
    const encrypted = encryptKey(rawKey.trim());
    const masked = maskKey(rawKey.trim());
    db.prepare(`
      UPDATE provider_keys
      SET label = COALESCE(?, label),
          key_encrypted = ?,
          key_masked = ?,
          status = 'healthy',
          consecutive_failures = 0,
          last_error = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(label || null, encrypted, masked, now, id);
  } else if (label) {
    db.prepare(`
      UPDATE provider_keys
      SET label = ?, updated_at = ?
      WHERE id = ?
    `).run(label, now, id);
  }

  return c.json({ success: true });
});

// Reveal API Key (Decrypted for viewing / copying)
app.get('/api/keys/:id/reveal', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const keyRow = db.prepare('SELECT id, label, key_encrypted, key_masked FROM provider_keys WHERE id = ?').get(id) as any;
  if (!keyRow) return c.json({ error: 'Key not found' }, 404);

  const rawKey = decryptKey(keyRow.key_encrypted);
  return c.json({ success: true, id: keyRow.id, label: keyRow.label, rawKey, keyMasked: keyRow.key_masked });
});

// Test Specific Key Endpoint
app.post('/api/keys/:id/test', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const keyRow = db.prepare(`
    SELECT pk.*, p.base_url, p.protocol, p.name as provider_name
    FROM provider_keys pk
    JOIN providers p ON pk.provider_id = p.id
    WHERE pk.id = ?
  `).get(id) as any;

  if (!keyRow) return c.json({ error: 'Key not found' }, 404);

  const rawKey = decryptKey(keyRow.key_encrypted);
  if (!rawKey) return c.json({ error: 'Failed to decrypt API key' }, 500);

  const probe = await probeAndInspectProvider(keyRow.base_url, rawKey);
  const now = Date.now();

  if (probe.statusLabel === 'QUOTA_EXHAUSTED' || probe.statusCode === 429) {
    db.prepare("UPDATE provider_keys SET status = 'cooling_down', last_error = ?, last_error_at = ?, updated_at = ? WHERE id = ?")
      .run(probe.quotaDetails.slice(0, 150), now, now, id);
  } else if (probe.statusLabel === 'ACTIVE') {
    db.prepare("UPDATE provider_keys SET status = 'healthy', consecutive_failures = 0, last_error = NULL, updated_at = ? WHERE id = ?")
      .run(now, id);
  } else {
    db.prepare("UPDATE provider_keys SET last_error = ?, last_error_at = ?, updated_at = ? WHERE id = ?")
      .run((probe.quotaDetails || 'Error').slice(0, 150), now, now, id);
  }

  return c.json(probe);
});



// Interactive Key Inspector & Quota Limits Tester
app.post('/api/providers/inspect-key', async (c) => {
  const body = await c.req.json();
  const { baseUrl, rawKey } = body;
  if (!baseUrl || !rawKey) {
    return c.json({ error: 'baseUrl and rawKey are required' }, 400);
  }
  const result = await probeAndInspectProvider(baseUrl, rawKey);
  return c.json(result);
});

// Default Model Management
app.post('/api/models/set-default', async (c) => {
  const body = await c.req.json();
  const { modelId, providerId } = body;
  if (!modelId) {
    return c.json({ error: 'modelId is required' }, 400);
  }

  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('default_model', ?)").run(modelId);

  // Also elevate this model to #1 priority in 'auto' chain if auto chain exists
  const autoChain = db.prepare("SELECT id FROM chains WHERE name = 'auto'").get() as any;
  if (autoChain) {
    const currentTargets = db.prepare("SELECT * FROM chain_targets WHERE chain_id = ? ORDER BY order_index ASC").all(autoChain.id) as any[];
    db.prepare("DELETE FROM chain_targets WHERE chain_id = ?").run(autoChain.id);
    
    let chosenTarget = currentTargets.find(t => t.model_id === modelId);
    if (!chosenTarget && providerId) {
      chosenTarget = {
        id: `target_def_${crypto.randomUUID().slice(0, 8)}`,
        chain_id: autoChain.id,
        provider_id: providerId,
        model_id: modelId,
        requires_tools: 1,
        min_context_window: null,
      };
    }
    const otherTargets = currentTargets.filter(t => t.model_id !== modelId);
    const ordered = chosenTarget ? [chosenTarget, ...otherTargets] : otherTargets;
    
    const insertStmt = db.prepare(`
      INSERT INTO chain_targets (id, chain_id, provider_id, model_id, order_index, requires_tools, min_context_window)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    ordered.forEach((t, idx) => {
      insertStmt.run(t.id, autoChain.id, t.provider_id, t.model_id, idx, t.requires_tools || 0, t.min_context_window || null);
    });
  }

  return c.json({ success: true, defaultModel: modelId });
});

app.get('/api/models/default', (c) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as any;
  return c.json({ defaultModel: row ? row.value : 'auto' });
});

// Sync all discovered models directly to OpenCode config without hardcoding
app.post('/api/connect/opencode-sync-all', async (c) => {
  const host = c.req.header('host') || '127.0.0.1:4000';
  const v1Url = `http://${host}/v1`;

  const db = getDb();
  const initialKey = db.prepare("SELECT value FROM settings WHERE key = 'initial_raw_gateway_key'").get() as any;
  const rawKey = initialKey ? initialKey.value : 'nsk_live_YOUR_KEY';

  const defaultRow = db.prepare("SELECT value FROM settings WHERE key = 'default_model'").get() as any;
  const activeChain = defaultRow ? defaultRow.value : 'auto';

  const result = writeToOpenCodeConfig(v1Url, rawKey, activeChain, true);
  return c.json({ success: true, ...result });
});

// Model Discovery & Management
app.get('/api/models', (c) => {
  const db = getDb();
  const providerId = c.req.query('providerId');
  const search = (c.req.query('search') || '').toLowerCase();

  let query = `
    SELECT m.*, p.name as provider_name, p.protocol as provider_protocol
    FROM models m
    JOIN providers p ON m.provider_id = p.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (providerId) {
    query += ' AND m.provider_id = ?';
    params.push(providerId);
  }
  if (search) {
    query += ' AND (LOWER(m.name) LIKE ? OR LOWER(m.model_id) LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY p.name ASC, m.name ASC';
  const rows = db.prepare(query).all(...params) as any[];

  return c.json(rows.map(r => ({
    id: r.id,
    providerId: r.provider_id,
    providerName: r.provider_name,
    providerProtocol: r.provider_protocol,
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
    isFree: isFreeModelId(r.model_id) || r.provider_protocol === 'ollama',
  })));
});

app.put('/api/models/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  db.prepare('UPDATE models SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  const updated = db.prepare('SELECT enabled FROM models WHERE id = ?').get(id) as any;
  return c.json({ success: true, enabled: Boolean(updated?.enabled) });
});

app.post('/api/providers/:id/refresh-models', async (c) => {
  const id = c.req.param('id');
  try {
    const models = await fetchAndSyncModels(id);
    return c.json({ success: true, count: models.length, models });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Chains Management
app.get('/api/chains', (c) => {
  const db = getDb();
  const chains = db.prepare('SELECT * FROM chains ORDER BY name ASC').all() as any[];

  const result = chains.map(ch => {
    const targets = db.prepare(`
      SELECT ct.*, p.name as provider_name, p.protocol as provider_protocol,
             pk.status as target_status, pk.last_error as target_error
      FROM chain_targets ct
      JOIN providers p ON ct.provider_id = p.id
      LEFT JOIN provider_keys pk ON p.id = pk.provider_id
      WHERE ct.chain_id = ?
      ORDER BY ct.order_index ASC
    `).all(ch.id) as any[];

    return {
      id: ch.id,
      name: ch.name,
      mode: ch.mode,
      activeTargetId: ch.active_target_id,
      description: ch.description,
      createdAt: ch.created_at,
      updatedAt: ch.updated_at,
      targets: targets.map(t => ({
        id: t.id,
        chainId: t.chain_id,
        providerId: t.provider_id,
        providerName: t.provider_name,
        providerProtocol: t.provider_protocol,
        modelId: t.model_id,
        orderIndex: t.order_index,
        requiresTools: Boolean(t.requires_tools),
        minContextWindow: t.min_context_window,
        status: t.target_status || 'healthy',
        error: t.target_error,
        isFree: isFreeModelId(t.model_id) || t.provider_protocol === 'ollama',
      })),
    };
  });

  return c.json(result);
});

app.post('/api/chains', async (c) => {
  const body = await c.req.json();
  const { name, mode = 'priority', description } = body;
  if (!name || !name.trim()) return c.json({ error: 'Chain name is required' }, 400);

  const db = getDb();
  const id = `chain_${crypto.randomUUID()}`;
  const now = Date.now();

  try {
    db.prepare(`
      INSERT INTO chains (id, name, mode, active_target_id, description, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?)
    `).run(id, name.trim(), mode, description || null, now, now);
    return c.json({ success: true, chainId: id });
  } catch (err: any) {
    return c.json({ error: `Chain name already exists: ${err.message}` }, 400);
  }
});

app.put('/api/chains/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, mode, description } = body;

  const db = getDb();
  const now = Date.now();
  db.prepare(`
    UPDATE chains
    SET name = COALESCE(?, name),
        mode = COALESCE(?, mode),
        description = COALESCE(?, description),
        updated_at = ?
    WHERE id = ?
  `).run(name, mode, description, now, id);

  return c.json({ success: true });
});

app.delete('/api/chains/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const chain = db.prepare('SELECT name FROM chains WHERE id = ?').get(id) as any;
  if (chain?.name === 'auto') {
    return c.json({ error: "Cannot delete the default 'auto' chain" }, 400);
  }
  db.prepare('DELETE FROM chains WHERE id = ?').run(id);
  return c.json({ success: true });
});

app.put('/api/chains/:id/targets', async (c) => {
  const chainId = c.req.param('id');
  const body = await c.req.json();
  const { targets } = body as { targets: Array<{ providerId: string; modelId: string; requiresTools?: boolean; minContextWindow?: number }> };

  const db = getDb();
  const deleteStmt = db.prepare('DELETE FROM chain_targets WHERE chain_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO chain_targets (id, chain_id, provider_id, model_id, order_index, requires_tools, min_context_window)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    deleteStmt.run(chainId);
    if (Array.isArray(targets)) {
      targets.forEach((t, idx) => {
        insertStmt.run(
          `target_${crypto.randomUUID()}`,
          chainId,
          t.providerId,
          t.modelId,
          idx,
          t.requiresTools ? 1 : 0,
          t.minContextWindow || null
        );
      });
    }
  });

  tx();
  return c.json({ success: true });
});

// -----------------------------------------------------------------------------
// Auto-Build Optimal Failover Chain (single shared implementation)
// -----------------------------------------------------------------------------

type AutoPolicy = 'free_only' | 'free_first' | 'all';

/** Ranks models for coding/reasoning quality. Unknown models sort last. */
function modelPriorityRank(mId: string): number {
  const l = (mId || '').toLowerCase();
  if (/(deepseek[-_ ]?(v\d|r\d|chat|reasoner|coder))/.test(l)) return 1;
  if (/(claude|sonnet|opus|haiku)/.test(l)) return 2;
  if (/(gpt|codex|openai|\bo[13]\b)/.test(l)) return 3;
  if (/(gemini|google)/.test(l)) return 4;
  if (/(qwen)/.test(l)) return 5;
  if (/(glm|zhipu)/.test(l)) return 6;
  if (/(mimo|minimax)/.test(l)) return 7;
  if (/(kimi|moonshot)/.test(l)) return 8;
  if (/(mistral|codestral|devstral)/.test(l)) return 9;
  if (/(llama|meta)/.test(l)) return 10;
  return 20;
}

function isLocalProvider(protocol?: string | null, baseUrl?: string | null): boolean {
  const url = (baseUrl || '').toLowerCase();
  return protocol === 'ollama' || protocol === 'lmstudio' ||
    url.includes('localhost') || url.includes('127.0.0.1');
}

/** A model is treated as zero-cost only if it is tagged :free or served locally. */
function isTrulyFreeModel(m: any): boolean {
  if (isFreeModelId(m.model_id)) return true;
  return isLocalProvider(m.provider_protocol, m.provider_base_url);
}

function applyAutoChain(policy: AutoPolicy, targetChainId: string): { status: number; body: any } {
  const db = getDb();
  let targetChain = db.prepare('SELECT id, name FROM chains WHERE id = ? OR name = ?').get(targetChainId, targetChainId) as any;
  if (!targetChain) targetChain = db.prepare("SELECT id, name FROM chains WHERE name = 'auto'").get() as any;
  if (!targetChain) return { status: 404, body: { error: 'Chain not found' } };

  const allModels = db.prepare(`
    SELECT m.*, p.name as provider_name, p.protocol as provider_protocol, p.base_url as provider_base_url
    FROM models m
    JOIN providers p ON m.provider_id = p.id
    WHERE m.enabled = 1 OR m.is_free = 1
  `).all() as any[];

  const byRank = (a: any, b: any) => modelPriorityRank(a.model_id) - modelPriorityRank(b.model_id);
  const free = allModels.filter(isTrulyFreeModel).sort(byRank);
  const paid = allModels.filter(m => !isTrulyFreeModel(m)).sort(byRank);
  const cloudFree = free.filter(m => !isLocalProvider(m.provider_protocol, m.provider_base_url));
  const localFree = free.filter(m => isLocalProvider(m.provider_protocol, m.provider_base_url));

  let targetsToSet: any[] = [];
  if (policy === 'free_only') {
    if (free.length === 0) {
      return {
        status: 400,
        body: {
          error: "No verified free models found (models ending in :free or served by a local model runner). Connect a free-tier provider or choose 'Free First + Paid Fallback'.",
        },
      };
    }
    // Cloud free models first, local runners last as an always-available safety net.
    targetsToSet = [...cloudFree, ...localFree];
  } else if (policy === 'free_first') {
    // Free first, then a hard cap of the best paid models to prevent bill shocks.
    targetsToSet = [...cloudFree, ...paid.slice(0, 5), ...localFree];
  } else {
    targetsToSet = [...allModels].sort(byRank).slice(0, 20);
  }

  // Deduplicate by provider + model.
  const seen = new Set<string>();
  targetsToSet = targetsToSet.filter(m => {
    const key = `${m.provider_id}:${m.model_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const insertStmt = db.prepare(`
    INSERT INTO chain_targets (id, chain_id, provider_id, model_id, order_index, requires_tools)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM chain_targets WHERE chain_id = ?').run(targetChain.id);
    targetsToSet.forEach((m, idx) => {
      insertStmt.run(`target_auto_${idx}_${crypto.randomUUID().slice(0, 8)}`, targetChain.id, m.provider_id, m.model_id, idx);
    });
    // Priority mode: always return to the #1 target once it recovers.
    db.prepare("UPDATE chains SET mode = 'priority' WHERE id = ?").run(targetChain.id);
  });
  tx();

  return {
    status: 200,
    body: {
      success: true,
      policy,
      chainId: targetChain.id,
      chainName: targetChain.name,
      count: targetsToSet.length,
      targets: targetsToSet.map(m => ({
        providerName: m.provider_name,
        modelId: m.model_id,
        isFree: isTrulyFreeModel(m),
      })),
    },
  };
}

app.post('/api/chains/auto-build', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const settings = getSettings();
  const policy: AutoPolicy = (body.policy as AutoPolicy) || settings.chainAutoPolicy || 'free_only';
  const result = applyAutoChain(policy, body.chainId || 'chain_auto');
  return c.json(result.body, result.status as any);
});

// Backward-compatible alias for /api/chains/auto-build-free
app.post('/api/chains/auto-build-free', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = applyAutoChain('free_only', body.chainId || 'chain_auto');
  return c.json(result.body, result.status as any);
});

// Live Model Ping Benchmark Endpoint
app.post('/api/models/ping', async (c) => {
  const body = await c.req.json();
  const { modelId, providerId } = body;
  const db = getDb();

  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as any;
  if (!provider) return c.json({ error: 'Provider not found' }, 404);

  const keys = db.prepare('SELECT key_encrypted FROM provider_keys WHERE provider_id = ? ORDER BY consecutive_failures ASC LIMIT 1').all(providerId) as any[];
  if (keys.length === 0) return c.json({ error: 'No keys configured' }, 400);

  const rawKey = decryptKey(keys[0].key_encrypted);
  const start = Date.now();

  try {
    const cleanUrl = provider.base_url.replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rawKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return c.json({ success: false, latencyMs, error: `HTTP ${res.status}: ${err.slice(0, 150)}` });
    }

    return c.json({ success: true, latencyMs });
  } catch (err: any) {
    return c.json({ success: false, latencyMs: Date.now() - start, error: err.message });
  }
});

// Gateway Keys Management
app.get('/api/gateway-keys', (c) => {
  const db = getDb();
  const keys = db.prepare('SELECT id, name, key_masked, rate_limit_rpm, created_at, last_used_at FROM gateway_keys ORDER BY created_at DESC').all();
  return c.json(keys);
});

app.post('/api/gateway-keys', async (c) => {
  const body = await c.req.json();
  const { name = 'Coding Key', rateLimitRpm } = body;
  const { rawKey, keyHash, keyMasked } = generateGatewayKey();

  const db = getDb();
  const id = `gwk_${crypto.randomUUID()}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO gateway_keys (id, name, key_hash, key_masked, rate_limit_rpm, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(id, name, keyHash, keyMasked, rateLimitRpm || null, now);

  return c.json({ id, name, rawKey, keyMasked });
});

app.delete('/api/gateway-keys/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  db.prepare('DELETE FROM gateway_keys WHERE id = ?').run(id);
  return c.json({ success: true });
});

// Logs API
app.get('/api/logs', (c) => {
  const db = getDb();
  const limit = Math.min(100, parseInt(c.req.query('limit') || '50', 10));
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search') || '';
  const clientTool = c.req.query('clientTool') || '';

  let query = 'SELECT * FROM request_logs WHERE 1=1';
  const params: any[] = [];

  if (clientTool) {
    query += ' AND client_tool = ?';
    params.push(clientTool);
  }
  if (search) {
    query += ' AND (requested_model LIKE ? OR chain_name LIKE ? OR error_message LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as any[];
  const total = (db.prepare('SELECT COUNT(*) as count FROM request_logs').get() as any).count;

  return c.json({
    total,
    logs: rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      clientTool: r.client_tool,
      endpoint: r.endpoint,
      chainName: r.chain_name,
      requestedModel: r.requested_model,
      finalProviderId: r.final_provider_id,
      finalProviderName: r.final_provider_name,
      finalModelId: r.final_model_id,
      targetsAttempted: safeJsonParse(r.targets_attempted, []),
      statusCode: r.status_code,
      latencyMs: r.latency_ms,
      ttftMs: r.ttft_ms,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      stream: Boolean(r.stream),
      errorMessage: r.error_message,
      requestBody: r.request_body ? safeJsonParse(r.request_body, null) : null,
      responseBody: r.response_body ? safeJsonParse(r.response_body, null) : null,
      moneySavedUsd: r.money_saved_usd || 0,
      cached: Boolean(r.cached),
    })),
  });
});


app.delete('/api/logs', (c) => {
  const db = getDb();
  db.prepare('DELETE FROM request_logs').run();
  return c.json({ success: true });
});

// Settings API
app.get('/api/settings', (c) => {
  return c.json(getSettings());
});

app.put('/api/settings', async (c) => {
  const body = await c.req.json();
  const updated = updateSettings(body);
  return c.json(updated);
});

// OpenCode Config Import & Writer APIs
app.post('/api/providers/import-preview', (c) => {
  const preview = previewOpenCodeConfig();
  return c.json(preview);
});

app.post('/api/providers/import-confirm', async (c) => {
  const body = await c.req.json();
  const { providerKey, customRawKey } = body;
  try {
    const result = await importProviderFromOpenCode(providerKey, customRawKey);
    return c.json({ success: true, ...result });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Connect Tool Snippets & OpenCode One-Click Writer
app.get('/api/connect/configs', (c) => {
  const db = getDb();
  const chainName = c.req.query('chain') || 'auto';
  const host = c.req.header('host') || `127.0.0.1:${runtimeInfo.port}`;
  const protocol = c.req.header('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;

  // Return the masked key only. The raw gateway key is never exposed through this
  // endpoint; it is written directly by the one-click writers and revealed once
  // via /api/gateway-key for the local playground.
  const keyRow = db.prepare('SELECT id, key_masked FROM gateway_keys LIMIT 1').get() as any;

  const configs = generateToolConfigs(baseUrl, 'YOUR_GATEWAY_KEY', chainName);
  return c.json({ baseUrl, gatewayKeyMasked: keyRow?.key_masked || 'nsk_live_...', chainName, configs });
});

/**
 * Returns the active local gateway key so the first-party playground can call /v1.
 * Protected by the admin token on the /api surface; the key is local-only.
 */
app.get('/api/gateway-key', (c) => {
  const db = getDb();
  const keyRow = db.prepare('SELECT id, key_masked FROM gateway_keys ORDER BY created_at ASC LIMIT 1').get() as any;
  const initialKey = db.prepare("SELECT value FROM settings WHERE key = 'initial_raw_gateway_key'").get() as any;
  return c.json({ rawKey: initialKey ? initialKey.value : null, keyMasked: keyRow?.key_masked || null });
});

function resolveGatewayV1Url(host: string): string {
  const base = `http://${host}`.replace(/\/+$/, '');
  return `${base}/v1`;
}

app.post('/api/connect/opencode-write', async (c) => {
  const body = await c.req.json();
  const { execute = false, chainName = 'auto' } = body;
  const host = c.req.header('host') || `127.0.0.1:${runtimeInfo.port}`;

  const db = getDb();
  const initialKey = db.prepare("SELECT value FROM settings WHERE key = 'initial_raw_gateway_key'").get() as any;
  const rawKey = initialKey ? initialKey.value : 'nsk_live_YOUR_KEY';

  const result = writeToOpenCodeConfig(resolveGatewayV1Url(host), rawKey, chainName, execute);
  return c.json(result);
});

app.post('/api/connect/continue-write', async (c) => {
  const body = await c.req.json();
  const { execute = false, chainName = 'auto' } = body;
  const host = c.req.header('host') || `127.0.0.1:${runtimeInfo.port}`;

  const db = getDb();
  const initialKey = db.prepare("SELECT value FROM settings WHERE key = 'initial_raw_gateway_key'").get() as any;
  const rawKey = initialKey ? initialKey.value : 'nsk_live_YOUR_KEY';

  const result = writeToContinueConfig(resolveGatewayV1Url(host), rawKey, chainName, execute);
  return c.json(result);
});

app.post('/api/connect/aider-write', async (c) => {
  const body = await c.req.json();
  const { execute = false, chainName = 'auto' } = body;
  const host = c.req.header('host') || `127.0.0.1:${runtimeInfo.port}`;

  const db = getDb();
  const initialKey = db.prepare("SELECT value FROM settings WHERE key = 'initial_raw_gateway_key'").get() as any;
  const rawKey = initialKey ? initialKey.value : 'nsk_live_YOUR_KEY';

  const result = writeToAiderConfig(resolveGatewayV1Url(host), rawKey, chainName, execute);
  return c.json(result);
});

// Local LLM Auto-Detect (Ollama / LM Studio)
app.post('/api/providers/detect-local', async (c) => {
  const detected = await detectLocalServices();
  const registered: any[] = [];
  for (const s of detected) {
    const reg = await autoRegisterLocalService(s);
    registered.push({ ...s, ...reg });
  }
  return c.json({ services: detected, registered });
});

// Cache stats and clear
app.get('/api/cache/stats', (c) => c.json(getCacheStats()));
app.delete('/api/cache', (c) => {
  clearCache();
  return c.json({ success: true });
});

// Savings metrics
app.get('/api/metrics/savings', (c) => c.json(getSavingsStats()));


// -------------------------------------------------------------
// FRONTEND STATIC ASSETS SERVING
// -------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function resolveStaticDirs(): { clientDir: string | null; publicDir: string | null } {
  const clientCandidates = [
    path.resolve(__dirname, '../client'),
    path.resolve(__dirname, '../../dist/client'),
    path.resolve(process.cwd(), 'dist/client'),
  ];
  const publicCandidates = [
    path.resolve(__dirname, '../public'),
    path.resolve(__dirname, '../../public'),
    path.resolve(process.cwd(), 'public'),
  ];
  return {
    clientDir: clientCandidates.find(p => fs.existsSync(p)) || null,
    publicDir: publicCandidates.find(p => fs.existsSync(p)) || null,
  };
}

const staticDirs = resolveStaticDirs();

/**
 * Resolves a request path to a file strictly inside one of the allowed roots.
 * Returns null for traversal attempts or missing files.
 */
function safeResolveFile(reqPath: string, roots: Array<string | null>): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reqPath.split('?')[0]);
  } catch {
    return null;
  }
  // Reject NUL bytes and any path that escapes its root.
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^\/+/, '');
  if (!relative) return null;

  for (const root of roots) {
    if (!root) continue;
    const candidate = path.resolve(root, relative);
    const normalizedRoot = path.resolve(root);
    if (candidate === normalizedRoot) continue;
    if (!candidate.startsWith(normalizedRoot + path.sep)) continue;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

function serveFile(c: any, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (ext === '.html') {
    headers['Cache-Control'] = 'no-store';
  } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    // Vite emits content-hashed asset filenames; cache them aggressively.
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  return c.body(fs.readFileSync(filePath), 200, headers);
}

if (staticDirs.clientDir || staticDirs.publicDir) {
  app.get('*', async (c) => {
    const reqPath = c.req.path;

    if (!reqPath.startsWith('/api/') && !reqPath.startsWith('/v1/') && !reqPath.startsWith('/mcp')) {
      const file = safeResolveFile(reqPath, [staticDirs.clientDir, staticDirs.publicDir]);
      if (file) return serveFile(c, file);
    }

    // Single-Page Application HTML fallback, with the admin token injected so the
    // first-party dashboard can call the protected /api surface.
    const indexHtml = staticDirs.clientDir ? path.join(staticDirs.clientDir, 'index.html') : null;
    if (indexHtml && fs.existsSync(indexHtml)) {
      let html = fs.readFileSync(indexHtml, 'utf8');
      const token = getAdminToken();
      const bootstrap = `<script>window.__NONSTOP__=${JSON.stringify({ adminToken: token })};</script>`;
      html = html.includes('</head>') ? html.replace('</head>', `${bootstrap}</head>`) : bootstrap + html;
      return c.html(html);
    }

    return c.text('NonStop Router Dashboard build not found. Run `npm run build` first.', 404);
  });
} else {
  // Dev fallback when the client is served by Vite on port 5173
  app.get('/', (c) => {
    return c.html(`<!DOCTYPE html>
      <html>
        <head><title>NonStop Router</title></head>
        <body style="background:#0E0D0C;color:#EDEDEC;font-family:sans-serif;padding:2rem;">
          <h2>NonStop Router gateway is running on port ${runtimeInfo.port}</h2>
          <p>Frontend dev server runs at <a href="http://localhost:5173" style="color:#E8590C;">http://localhost:5173</a></p>
        </body>
      </html>`);
  });
}

// -------------------------------------------------------------
// SERVER INITIALIZATION & LIFECYCLE
// -------------------------------------------------------------
let pruneTimer: NodeJS.Timeout | null = null;

export function startServer(port?: number, host?: string) {
  const resolvedPort = resolvePort(port);
  const resolvedHost = host || '127.0.0.1';

  runtimeInfo.port = resolvedPort;
  runtimeInfo.host = resolvedHost;

  // Initialize Database
  getDb();

  // Start background health prober
  startHealthProber(broadcastEvent);

  // Periodic retention/cache maintenance
  if (!pruneTimer) {
    pruneTimer = setInterval(() => pruneStoredData(), 60 * 60 * 1000);
    pruneTimer.unref?.();
    // Run once shortly after boot as well.
    setTimeout(() => pruneStoredData(), 5000).unref?.();
  }

  const server = serve({
    fetch: app.fetch,
    port: resolvedPort,
    hostname: resolvedHost,
  }, (info) => {
    const displayHost = resolvedHost === '0.0.0.0' ? '127.0.0.1' : resolvedHost;
    console.log(`NonStop Router active at http://${displayHost}:${info.port}`);
  });

  return server;
}

// Auto-start if run directly
const isDirectRun = Boolean(process.argv[1]) && (
  process.argv[1].endsWith('index.ts') ||
  process.argv[1].endsWith('index.js') ||
  process.argv[1].endsWith('nonstop-router.js')
);

if (isDirectRun) {
  process.on('uncaughtException', (err) => {
    console.error('[NONSTOP ROUTER] Uncaught exception:', err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[NONSTOP ROUTER] Unhandled rejection:', reason);
  });

  const handleExit = () => {
    try { if (pruneTimer) clearInterval(pruneTimer); } catch {}
    try { stopHealthProber(); } catch {}
    try { closeDb(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);

  const settings = getSettings();
  const port = resolvePort();
  const host = resolveHost(settings.allowLan);
  startServer(port, host);

  // Open the dashboard on start unless disabled.
  if (!process.env.NO_OPEN) {
    const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    setTimeout(() => {
      open(`http://${displayHost}:${port}`).catch(() => {});
    }, 800);
  }
}

