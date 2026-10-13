/**
 * NonStop Router — Model Context Protocol (MCP) Server
 * Allows AI Agents (Claude Code, Cursor, OpenCode, Cline) to inspect router health,
 * view healthy model pools, switch routing chains, and manage prompt cache programmatically.
 */

import { getDb, getSettings, updateSettings } from './db.js';
import { getCacheStats, clearCache } from './cache-manager.js';
import { testProviderConnection } from './provider-service.js';
import { decryptKey } from './crypto.js';
import { isFreeModelId } from '../shared/types.js';

export interface McpRequest {
  jsonrpc: string;
  id?: string | number;
  method: string;
  params?: any;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

const MCP_TOOLS = [
  {
    name: 'nonstop_status',
    description: 'Get real-time NonStop Router operational status, healthy keys, failover counts, and active chains.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'nonstop_list_models',
    description: 'List all currently active and enabled models across all upstream providers with their context windows and tool support.',
    inputSchema: {
      type: 'object',
      properties: {
        filterFreeOnly: {
          type: 'boolean',
          description: 'If true, returns only models on zero-cost free tiers or local runners.',
        },
      },
    },
  },
  {
    name: 'nonstop_switch_chain',
    description: 'Set the active routing chain used when a client requests model "auto".',
    inputSchema: {
      type: 'object',
      properties: {
        chainName: {
          type: 'string',
          description: 'The name of the chain to set as active default (e.g., "auto", "fast", "reasoning").',
        },
      },
      required: ['chainName'],
    },
  },
  {
    name: 'nonstop_get_cache_stats',
    description: 'Get metrics on the local SQLite exact-match response cache: hits, tokens saved, and entry count.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'nonstop_clear_cache',
    description: 'Invalidate and clear all cached prompt entries in the local SQLite response cache.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleMcpRequest(req: McpRequest): Promise<McpResponse> {
  const { id, method, params } = req;

  switch (method) {
    case 'initialize': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: 'nonstop-router',
            version: '1.0.0',
          },
        },
      };
    }

    case 'notifications/initialized': {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    case 'tools/list': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        const textOutput = await executeMcpTool(toolName, args);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: textOutput,
              },
            ],
            isError: false,
          },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Error executing ${toolName}: ${err.message}`,
              },
            ],
            isError: true,
          },
        };
      }
    }

    default: {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
    }
  }
}

async function executeMcpTool(name: string, args: any): Promise<string> {
  const db = getDb();

  switch (name) {
    case 'nonstop_status': {
      const providersCount = (db.prepare('SELECT COUNT(*) as c FROM providers').get() as any).c;
      const totalKeys = (db.prepare('SELECT COUNT(*) as c FROM provider_keys').get() as any).c;
      const healthyKeys = (db.prepare("SELECT COUNT(*) as c FROM provider_keys WHERE status = 'healthy'").get() as any).c;
      const cooldownKeys = (db.prepare("SELECT COUNT(*) as c FROM provider_keys WHERE status = 'cooldown' OR status = 'cooling_down'").get() as any).c;
      const totalRequests = (db.prepare('SELECT COUNT(*) as c FROM request_logs').get() as any).c;
      const cacheStats = getCacheStats();
      const settings = getSettings();

      const chains = db.prepare('SELECT name, mode FROM chains').all() as any[];

      return JSON.stringify({
        status: 'online',
        activeChain: settings.defaultModel || 'auto',
        providers: providersCount,
        keys: { total: totalKeys, healthy: healthyKeys, coolingDown: cooldownKeys },
        chains: chains.map(c => `${c.name} (${c.mode})`),
        totalRequestsHandled: totalRequests,
        responseCache: {
          entries: cacheStats.totalEntries,
          hits: cacheStats.totalHits,
          tokensSaved: cacheStats.totalTokensSaved,
        },
      }, null, 2);
    }

    case 'nonstop_list_models': {
      const models = db.prepare(`
        SELECT m.model_id, m.name, p.name as provider_name, p.protocol, p.base_url,
               m.context_window, m.supports_tools, m.is_free
        FROM models m
        JOIN providers p ON m.provider_id = p.id
        WHERE m.enabled = 1
        ORDER BY p.name ASC, m.name ASC
      `).all() as any[];

      const filtered = args.filterFreeOnly
        ? models.filter(m => m.is_free === 1 || isFreeModelId(m.model_id) ||
            (m.base_url || '').includes('127.0.0.1') || (m.base_url || '').includes('localhost'))
        : models;

      return JSON.stringify(filtered.map(m => ({
        model: m.model_id,
        provider: m.provider_name,
        contextWindow: m.context_window,
        tools: Boolean(m.supports_tools),
        free: Boolean(m.is_free) || isFreeModelId(m.model_id),
      })), null, 2);
    }

    case 'nonstop_switch_chain': {
      const chainName = args.chainName;
      const chain = db.prepare('SELECT * FROM chains WHERE name = ?').get(chainName) as any;
      if (!chain) {
        throw new Error(`Chain '${chainName}' does not exist in NonStop Router.`);
      }
      updateSettings({ defaultModel: chainName } as any);
      return `Active default routing chain set to '${chainName}' (mode: ${chain.mode}). Requests for model "auto" now use it.`;
    }

    case 'nonstop_get_cache_stats': {
      const stats = getCacheStats();
      return JSON.stringify(stats, null, 2);
    }

    case 'nonstop_clear_cache': {
      clearCache();
      return 'Local SQLite response cache cleared.';
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
