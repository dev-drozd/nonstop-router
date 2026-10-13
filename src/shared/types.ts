export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini';
export type KeySelectionStrategy = 'fill-first' | 'round-robin' | 'least-used';
export type HealthStatus = 'healthy' | 'cooling_down' | 'down' | 'probing';
export type ChainMode = 'priority' | 'sticky';

export interface Provider {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  selectionStrategy: KeySelectionStrategy;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderKey {
  id: string;
  providerId: string;
  label: string;
  keyMasked: string;
  status: HealthStatus;
  cooldownUntil: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: number | null;
  usageCount: number;
  tokensUsed?: number;
  disabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Model {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  enabled: boolean;
  contextWindow: number | null;
  maxOutput: number | null;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  pricingInput: number | null;
  pricingOutput: number | null;
  lastDiscoveredAt: number;
  isFree?: boolean;
}

export type ChainAutoPolicy = 'free_only' | 'free_first' | 'all';

export interface ChainTarget {
  id: string;
  chainId: string;
  providerId: string;
  modelId: string;
  orderIndex: number;
  requiresTools: boolean;
  minContextWindow: number | null;
  // Joined fields for UI convenience
  providerName?: string;
  providerProtocol?: ProviderProtocol;
  modelName?: string;
  status?: HealthStatus;
  isFree?: boolean;
}

export interface Chain {
  id: string;
  name: string;
  mode: ChainMode;
  activeTargetId: string | null;
  description: string | null;
  createdAt: number;
  updatedAt: number;
  targets?: ChainTarget[];
}

export interface GatewayKey {
  id: string;
  name: string;
  keyMasked: string;
  rateLimitRpm: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface TargetAttempt {
  providerId: string;
  providerName: string;
  modelId: string;
  keyId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  durationMs: number;
}

export interface RequestLog {
  id: string;
  timestamp: number;
  clientTool: string;
  endpoint: string;
  chainName: string;
  requestedModel: string;
  finalProviderId: string | null;
  finalProviderName: string | null;
  finalModelId: string | null;
  targetsAttempted: TargetAttempt[];
  statusCode: number;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  stream: boolean;
  errorMessage: string | null;
  requestBody?: string | null;
  responseBody?: string | null;
  moneySavedUsd?: number;
  cached?: boolean;
}

export interface Settings {
  defaultRequestTimeoutMs: number;
  cooldownBaseMs: number;
  cooldownMaxMs: number;
  healthProbeIntervalMs: number;
  restartOnMidstreamFailure: boolean;
  logRetentionDays: number;
  storePayloads: boolean;
  allowLan: boolean;
  theme: 'dark' | 'light';
  enableCache?: boolean;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  enablePromptOptimizer?: boolean;
  enableRateGovernor?: boolean;
  rateGovernorRpm?: number;
  autoDetectLocal?: boolean;
  chainAutoPolicy?: ChainAutoPolicy;
  /** The chain used when a client requests model "auto". */
  defaultModel?: string;
}

export interface LocalDetectedService {
  type: 'ollama' | 'lmstudio';
  name: string;
  baseUrl: string;
  models: string[];
  running: boolean;
}

/**
 * Single source of truth for detecting zero-cost models from an id suffix convention.
 * Matches `:free` and `-free` only, never arbitrary substrings such as "freeform".
 */
export function isFreeModelId(modelId: string): boolean {
  const id = (modelId || '').toLowerCase().trim();
  return id.endsWith(':free') || id.endsWith('-free') || id.endsWith('/free');
}

export interface SystemHealthOverview {
  totalProviders: number;
  totalKeys: number;
  healthyKeys: number;
  totalChains: number;
  totalModels: number;
  enabledModels: number;
  requestsPerMinute: number;
  totalFailovers: number;
  totalMoneySavedUsd: number;
  totalTokensSaved: number;
  cacheHitCount: number;
  activeChains: Array<{
    chainId: string;
    chainName: string;
    mode: ChainMode;
    activeTarget: {
      providerName: string;
      modelId: string;
      status: HealthStatus;
    } | null;
  }>;
  recentErrors: Array<{
    timestamp: number;
    providerName: string;
    modelId: string;
    error: string;
  }>;
  runtime?: {
    port: number;
    host: string;
    baseUrl: string;
    allowLan: boolean;
    startedAt: number;
    version: string;
  };
}

