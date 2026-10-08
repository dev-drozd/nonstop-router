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
}

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
}
