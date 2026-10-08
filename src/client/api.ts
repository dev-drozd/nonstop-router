import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Provider, Model, Chain, GatewayKey, RequestLog, Settings, SystemHealthOverview } from '../shared/types.js';

const API_BASE = '';

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    let errMessage = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      errMessage = json.error?.message || json.error || errMessage;
    } catch {}
    throw new Error(errMessage);
  }
  return res.json();
}

// Queries
export function useOverview() {
  return useQuery<SystemHealthOverview>({
    queryKey: ['overview'],
    queryFn: () => fetchJson('/api/overview'),
    refetchInterval: 5000,
  });
}

export function useProviders() {
  return useQuery<Provider[]>({
    queryKey: ['providers'],
    queryFn: () => fetchJson('/api/providers'),
  });
}

export function useModels(providerId?: string, search?: string) {
  return useQuery<Model[]>({
    queryKey: ['models', providerId, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (providerId) params.set('providerId', providerId);
      if (search) params.set('search', search);
      return fetchJson(`/api/models?${params.toString()}`);
    },
  });
}

export function useChains() {
  return useQuery<Chain[]>({
    queryKey: ['chains'],
    queryFn: () => fetchJson('/api/chains'),
  });
}

export function useGatewayKeys() {
  return useQuery<GatewayKey[]>({
    queryKey: ['gateway-keys'],
    queryFn: () => fetchJson('/api/gateway-keys'),
  });
}

export function useLogs(limit = 50, search = '', clientTool = '') {
  return useQuery<{ total: number; logs: RequestLog[] }>({
    queryKey: ['logs', limit, search, clientTool],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (search) params.set('search', search);
      if (clientTool) params.set('clientTool', clientTool);
      return fetchJson(`/api/logs?${params.toString()}`);
    },
    refetchInterval: 6000,
  });
}

export function useSettings() {
  return useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => fetchJson('/api/settings'),
  });
}

export function useConnectConfigs(chainName = 'auto') {
  return useQuery<{ baseUrl: string; gatewayKey: string; chainName: string; configs: any[] }>({
    queryKey: ['connect', chainName],
    queryFn: () => fetchJson(`/api/connect/configs?chain=${encodeURIComponent(chainName)}`),
  });
}
