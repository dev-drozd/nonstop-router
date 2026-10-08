import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import open from 'open';
import { fileURLToPath } from 'url';

import { getDb, getSettings, updateSettings, defaultSettings } from './db.js';
import { encryptKey, decryptKey, maskKey, generateGatewayKey, hashGatewayKey } from './crypto.js';
import { PROVIDER_PRESETS } from './presets.js';
import { testProviderConnection, fetchAndSyncModels, previewOpenCodeConfig, importProviderFromOpenCode } from './provider-service.js';
import { resolveTargets, executeWithFailover, detectClientTool, logRequest, type RouteTarget } from './router-engine.js';
import { translateAnthropicToOpenAI, translateOpenAIToAnthropicResponse, translateResponsesApiToChatCompletion, translateChatCompletionToResponsesApi } from './protocol-translator.js';
import { startHealthProber, stopHealthProber } from './health-prober.js';
import { generateToolConfigs, writeToOpenCodeConfig } from './connect-helper.js';

const app = new Hono();

// Enable CORS for frontend development
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version'],
}));

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

// GET /v1/models: List chains first, then enabled models
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

  return c.json({ object: 'list', data });
});

// POST /v1/chat/completions: OpenAI Chat Completions with failover & streaming
app.post('/v1/chat/completions', async (c) => {
  const start = Date.now();
  const body = await c.req.json();
  const requestedModel = body.model || 'auto';
  const stream = Boolean(body.stream);
  const requiresTools = Boolean(body.tools && body.tools.length > 0);
  const clientTool = detectClientTool(c.req.raw.headers, '/v1/chat/completions');

  const { chainName, targets } = resolveTargets(requestedModel, requiresTools);

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

      logRequest({
        clientTool,
        endpoint: '/v1/chat/completions',
        chainName,
        requestedModel,
        finalTarget: result.finalTarget,
        attempts: result.attempts,
        statusCode: 200,
        latencyMs,
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
        totalTokens: json.usage?.total_tokens,
        stream: false,
        requestBody: body,
        responseBody: json,
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
    let attemptsHistory: any[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const result = await executeWithFailover(targets, body, c.req.raw.signal);
      finalTarget = result.finalTarget;
      attemptsHistory = result.attempts;

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
        // Forward raw SSE chunk lines
        await sseStream.write(chunkText);
      }

      const totalLatency = Date.now() - start;
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
        promptTokens,
        completionTokens,
        stream: true,
      });

      broadcastEvent('request_completed', {
        endpoint: '/v1/chat/completions',
        clientTool,
        model: requestedModel,
        target: `${finalTarget.providerName}/${finalTarget.modelId}`,
        latencyMs: totalLatency,
        ttftMs,
        failovers: Math.max(0, attemptsHistory.length - 1),
      });
    } catch (err: any) {
      if (!ttftRecorded) {
        // Stream failed before first token: emit clean error event
        const errPayload = JSON.stringify({
          error: {
            message: err.message || 'Stream connection failed',
            type: 'stream_error',
            attempts: err.attempts || attemptsHistory,
          },
        });
        await sseStream.write(`data: ${errPayload}\n\ndata: [DONE]\n\n`);
      } else {
        // Midstream failure: send standard termination
        await sseStream.write(`data: {"error": {"message": "Stream disconnected mid-response", "type": "stream_interrupted"}}\n\ndata: [DONE]\n\n`);
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
              await sseStream.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: delta.content }
              })}\n\n`);
            }
          } catch {}
        }
      }

      // Close text block & message
      await sseStream.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
      await sseStream.write(`event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 }
      })}\n\n`);
      await sseStream.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);

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
        target: `${finalTarget.providerName}/${finalTarget.modelId}`,
        latencyMs: totalLatency,
        ttftMs,
        failovers: Math.max(0, attemptsHistory.length - 1),
      });
    } catch (err: any) {
      await sseStream.write(`event: error\ndata: ${JSON.stringify({
        type: "error",
        error: { type: "api_error", message: err.message || "Failed upstream stream" }
      })}\n\n`);

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
  const clientTool = detectClientTool(c.req.raw.headers, '/v1/responses');

  const { chainName, targets } = resolveTargets(requestedModel, Boolean(body.tools?.length));
  if (targets.length === 0) {
    return c.json({ error: { message: `No targets for ${requestedModel}` } }, 404);
  }

  const openAiPayload = translateResponsesApiToChatCompletion(body);

  try {
    const result = await executeWithFailover(targets, openAiPayload, c.req.raw.signal);
    const openAiJson = await result.response.json();
    const responsesApiJson = translateChatCompletionToResponsesApi(openAiJson);
    const latencyMs = Date.now() - start;

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

  // Total failover events: logs with more than 1 attempt
  const totalLogs = db.prepare('SELECT targets_attempted FROM request_logs ORDER BY timestamp DESC LIMIT 100').all() as any[];
  let totalFailovers = 0;
  for (const log of totalLogs) {
    try {
      const attempts = JSON.parse(log.targets_attempted);
      if (Array.isArray(attempts) && attempts.length > 1) {
        totalFailovers++;
      }
    } catch {}
  }

  // Active chains with target
  const chains = db.prepare('SELECT * FROM chains').all() as any[];
  const activeChains = chains.map(ch => {
    const target = db.prepare(`
      SELECT ct.*, p.name as provider_name, pk.status as key_status
      FROM chain_targets ct
      JOIN providers p ON ct.provider_id = p.id
      LEFT JOIN provider_keys pk ON p.id = pk.provider_id
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

  return c.json({
    totalProviders,
    totalKeys,
    healthyKeys,
    totalChains,
    totalModels,
    enabledModels,
    requestsPerMinute: rpm,
    totalFailovers,
    activeChains,
    recentErrors,
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

  db.prepare(`
    INSERT INTO providers (id, name, protocol, base_url, selection_strategy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(providerId, name, protocol, baseUrl, selectionStrategy, now, now);

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
  db.prepare(`
    UPDATE providers
    SET name = COALESCE(?, name),
        protocol = COALESCE(?, protocol),
        base_url = COALESCE(?, base_url),
        selection_strategy = COALESCE(?, selection_strategy),
        updated_at = ?
    WHERE id = ?
  `).run(name, protocol, baseUrl, selectionStrategy, now, id);

  return c.json({ success: true });
});

app.delete('/api/providers/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  return c.json({ success: true });
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
  db.prepare('DELETE FROM provider_keys WHERE id = ?').run(id);
  return c.json({ success: true });
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
      targetsAttempted: JSON.parse(r.targets_attempted || '[]'),
      statusCode: r.status_code,
      latencyMs: r.latency_ms,
      ttftMs: r.ttft_ms,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      stream: Boolean(r.stream),
      errorMessage: r.error_message,
      requestBody: r.request_body ? JSON.parse(r.request_body) : null,
      responseBody: r.response_body ? JSON.parse(r.response_body) : null,
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
  const host = c.req.header('host') || '127.0.0.1:4000';
  const protocol = c.req.header('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;

  // Get first gateway key or initial stashed key
  const keyRow = db.prepare('SELECT id, key_masked FROM gateway_keys LIMIT 1').get() as any;
  const initialKey = db.prepare("SELECT value FROM settings WHERE key = 'initial_raw_gateway_key'").get() as any;
  const rawKey = initialKey ? initialKey.value : (keyRow ? 'nsk_live_YOUR_KEY' : 'nsk_live_YOUR_KEY');

  const configs = generateToolConfigs(baseUrl, rawKey, chainName);
  return c.json({ baseUrl, gatewayKey: rawKey, chainName, configs });
});

app.post('/api/connect/opencode-write', async (c) => {
  const body = await c.req.json();
  const { execute = false, chainName = 'auto' } = body;
  const host = c.req.header('host') || '127.0.0.1:4000';
  const v1Url = `http://${host}/v1`;

  const db = getDb();
  const initialKey = db.prepare("SELECT value FROM settings WHERE key = 'initial_raw_gateway_key'").get() as any;
  const rawKey = initialKey ? initialKey.value : 'nsk_live_YOUR_KEY';

  const result = writeToOpenCodeConfig(v1Url, rawKey, chainName, execute);
  return c.json(result);
});

// -------------------------------------------------------------
// FRONTEND STATIC ASSETS SERVING
// -------------------------------------------------------------
const clientDistPath = path.resolve(process.cwd(), 'dist/client');
if (fs.existsSync(clientDistPath)) {
  app.get('*', async (c) => {
    const reqPath = c.req.path;
    const filePath = path.join(clientDistPath, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json; charset=utf-8',
        '.ico': 'image/x-icon',
        '.png': 'image/png',
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      return c.body(fs.readFileSync(filePath), 200, { 'Content-Type': contentType });
    }

    // Single-Page Application HTML fallback
    const indexHtml = path.join(clientDistPath, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return c.html(fs.readFileSync(indexHtml, 'utf8'));
    }

    return c.text('NonStop Router Dashboard Build Not Found', 404);
  });
} else {
  // Dev fallback when client is served by Vite on port 5173
  app.get('/', (c) => {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>NonStop Router</title></head>
        <body style="background:#0E0D0C;color:#EDEDEC;font-family:sans-serif;padding:2rem;">
          <h2>NonStop Router Gateway is running on port 4000</h2>
          <p>Frontend dev server runs at <a href="http://localhost:5173" style="color:#E8590C;">http://localhost:5173</a></p>
        </body>
      </html>
    `);
  });
}

// -------------------------------------------------------------
// SERVER INITIALIZATION & LIFECYCLE
// -------------------------------------------------------------
export function startServer(port = 4000, host = '127.0.0.1') {
  // Initialize Database
  getDb();

  // Start background health prober
  startHealthProber(broadcastEvent);

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  }, (info) => {
    console.log(`NonStop Router active at http://${host}:${info.port}`);
  });

  return server;
}

// Auto-start if run directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('index.ts') ||
  process.argv[1].endsWith('index.js') ||
  process.argv[1].endsWith('nonstop-router.js')
);

if (isDirectRun) {
  const settings = getSettings();
  const host = settings.allowLan ? '0.0.0.0' : '127.0.0.1';
  startServer(4000, host);

  // Open browser on start if first run or flag passed
  if (!process.env.NO_OPEN) {
    setTimeout(() => {
      open('http://127.0.0.1:4000').catch(() => {});
    }, 800);
  }
}
