import type { KeySelectionStrategy, ProviderProtocol } from '../shared/types.js';

const VALID_PROTOCOLS: ProviderProtocol[] = ['openai', 'anthropic', 'gemini'];

/**
 * Normalizes a protocol read from the database. Older UI versions could store
 * "ollama" (which speaks the OpenAI-compatible API); it maps to "openai".
 * Anything else unknown also falls back to "openai" rather than crashing dispatch.
 */
export function normalizeProtocol(protocol: unknown): ProviderProtocol {
  if (protocol === 'ollama' || protocol === 'lmstudio') return 'openai';
  if (typeof protocol === 'string' && (VALID_PROTOCOLS as string[]).includes(protocol)) {
    return protocol as ProviderProtocol;
  }
  return 'openai';
}

/**
 * Resolve the port the gateway should bind to.
 * Precedence: explicit argument -> --port style env -> PORT env -> 4000.
 */
export function resolvePort(explicit?: number, env: NodeJS.ProcessEnv = process.env): number {
  if (explicit && Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const envPort = Number(env.PORT);
  if (Number.isFinite(envPort) && envPort > 0) return Math.floor(envPort);
  return 4000;
}

export function resolveHost(allowLan: boolean, env: NodeJS.ProcessEnv = process.env): string {
  if (env.HOST) return env.HOST;
  return allowLan ? '0.0.0.0' : '127.0.0.1';
}

/**
 * Accept a user-entered base URL, normalize it, and return the canonical
 * OpenAI-compatible base that always ends in a single `/v1` segment.
 *
 * Users routinely paste any of these:
 *   https://api.groq.com/openai          -> https://api.groq.com/openai/v1
 *   https://api.groq.com/openai/v1/      -> https://api.groq.com/openai/v1
 *   https://generativelanguage.../v1beta -> https://generativelanguage.../v1beta   (preserved)
 *   http://127.0.0.1:11434               -> http://127.0.0.1:11434/v1
 */
export function normalizeOpenAIBaseUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim();
  if (!url) return url;

  // Drop trailing slashes and a trailing /chat/completions if the user pasted an endpoint.
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/i, '');
  url = url.replace(/\/+$/, '');

  // Preserve version segments that are not the OpenAI `/v1` convention.
  if (/\/v\d+(alpha|beta)$/i.test(url)) return url;
  if (/\/v\d+$/i.test(url)) return url;

  // Append /v1 for everything else (bare hosts, custom gateways, `.../openai`).
  return `${url}/v1`;
}

/**
 * Base URL used to reach the `/models` discovery endpoint for a given provider.
 * The gateway stores OpenAI-compatible bases ending in `/v1`.
 */
export function modelsUrlForBase(baseUrl: string): string {
  const clean = (baseUrl || '').replace(/\/+$/, '');
  if (/\/models$/i.test(clean)) return clean;
  return `${clean}/models`;
}