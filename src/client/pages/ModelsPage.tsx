import React, { useState, useEffect } from 'react';
import { useModels, useProviders, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { ModelLogo, detectModelFamily } from '../components/ModelLogo.js';
import { Search, RefreshCw, Wrench, Eye, Zap, Sparkles, Check, CheckCheck, Play, Copy, Star, Terminal } from 'lucide-react';
import type { Model } from '../../shared/types.js';
import { isFreeModelId } from '../../shared/types.js';
import { useI18n } from '../i18n/index.js';

interface ModelsPageProps {
  onOpenPlayground?: (modelId: string) => void;
}

export const ModelsPage: React.FC<ModelsPageProps> = ({ onOpenPlayground }) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [filterFreeOnly, setFilterFreeOnly] = useState(false);
  const [filterToolsOnly, setFilterToolsOnly] = useState(false);
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string>('auto');
  const [syncingOpenCode, setSyncingOpenCode] = useState(false);

  useEffect(() => {
    fetchJson<any>('/api/models/default').then(res => {
      if (res.defaultModel) setDefaultModel(res.defaultModel);
    }).catch(() => {});
  }, []);

  // Ping latencies state map: { modelId: latencyMs }
  const [pings, setPings] = useState<Record<string, { loading: boolean; ms?: number; error?: string }>>({});

  const { data: providers = [] } = useProviders();
  const { data: models = [], isLoading } = useModels(selectedProvider || undefined, search || undefined);

  const filteredModels = models.filter((m: any) => {
    const isFree = m.isFree ?? isFreeModelId(m.modelId);
    if (filterFreeOnly && !isFree) return false;
    if (filterToolsOnly && !m.supportsTools) return false;
    return true;
  });

  const handleToggleModel = async (modelId: string) => {
    try {
      await fetchJson(`/api/models/${modelId}/toggle`, { method: 'PUT' });
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleEnableAllFree = async () => {
    try {
      await fetchJson('/api/chains/auto-build-free', { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRefreshModels = async (provId: string) => {
    setRefreshingProvider(provId);
    try {
      await fetchJson(`/api/providers/${provId}/refresh-models`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRefreshingProvider(null);
    }
  };

  const handlePingModel = async (modelId: string, providerId: string) => {
    setPings(prev => ({ ...prev, [modelId]: { loading: true } }));
    try {
      const res = await fetchJson<any>('/api/models/ping', {
        method: 'POST',
        body: JSON.stringify({ modelId, providerId }),
      });
      if (res.success) {
        setPings(prev => ({ ...prev, [modelId]: { loading: false, ms: res.latencyMs } }));
      } else {
        setPings(prev => ({ ...prev, [modelId]: { loading: false, error: res.error } }));
      }
    } catch (err: any) {
      setPings(prev => ({ ...prev, [modelId]: { loading: false, error: err.message } }));
    }
  };

  const handleSetDefaultModel = async (modelId: string, providerId?: string) => {
    try {
      await fetchJson('/api/models/set-default', {
        method: 'POST',
        body: JSON.stringify({ modelId, providerId }),
      });
      setDefaultModel(modelId);
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      alert(t('models.defaultModelSetAlert', { modelId }));
    } catch (err: any) {
      alert(`Error setting default model: ${err.message}`);
    }
  };

  const handleSyncToOpenCode = async () => {
    setSyncingOpenCode(true);
    try {
      await fetchJson<any>('/api/connect/opencode-sync-all', { method: 'POST' });
      alert(t('models.openCodeSyncSuccessAlert', { count: models.length }));
    } catch (err: any) {
      alert(`OpenCode sync error: ${err.message}`);
    } finally {
      setSyncingOpenCode(false);
    }
  };

  const formatContext = (ctx?: number | null) => {
    if (!ctx) return '-';
    if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(1)}M`;
    if (ctx >= 1000) return `${Math.round(ctx / 1000)}k`;
    return String(ctx);
  };

  const freeCount = models.filter((m: any) => m.isFree ?? (isFreeModelId(m.modelId) || m.providerProtocol === 'ollama')).length;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t('models.title')}</h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-bg-surface border border-border-default text-text-secondary">
              {t('models.badgeText', { total: models.length, free: freeCount })}
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            {t('models.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSyncToOpenCode}
            disabled={syncingOpenCode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors shadow-subtle disabled:opacity-50"
            title={t('models.syncOpenCodeTooltip')}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{syncingOpenCode ? t('models.syncing') : t('models.syncOpenCode')}</span>
          </button>

          <button
            onClick={handleEnableAllFree}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-status-healthy text-white hover:opacity-90 text-xs font-medium transition-opacity shadow-subtle"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('models.autoBuildFreeChain')}</span>
          </button>

          {providers.length > 0 && (
            <button
              onClick={() => handleRefreshModels(selectedProvider || providers[0].id)}
              disabled={!!refreshingProvider}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-primary text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingProvider ? 'animate-spin' : ''}`} />
              <span>{t('models.refreshModels')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Default Model Setting Banner */}
      <div className="p-4 rounded-md bg-bg-surface border border-border-default flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-primary">{t('models.defaultModelLabel')}</span>
            <span className="font-mono text-xs font-bold text-accent px-2 py-0.5 rounded bg-accent/10 border border-accent/20">
              {defaultModel || 'auto'}
            </span>
          </div>
          <p className="text-[11px] text-text-secondary mt-1">
            {t('models.defaultModelDesc')}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleSetDefaultModel('auto')}
            className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors border ${
              defaultModel === 'auto'
                ? 'bg-status-healthy text-white border-status-healthy shadow-subtle'
                : 'bg-bg-base text-text-secondary border-border-subtle hover:text-text-primary'
            }`}
          >
            {t('models.autoBestFree')}
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-3 rounded-md bg-bg-surface border border-border-default flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('models.searchPlaceholder')}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded bg-bg-base border border-border-subtle focus:border-accent focus:outline-none text-text-primary"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedProvider}
            onChange={e => setSelectedProvider(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded bg-bg-base border border-border-subtle focus:border-accent focus:outline-none text-text-primary"
          >
            <option value="">{t('models.allProviders', { count: providers.length })}</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Dedicated Free Only Filter Toggle */}
          <button
            type="button"
            onClick={() => setFilterFreeOnly(!filterFreeOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors border ${
              filterFreeOnly
                ? 'bg-status-healthy text-white border-status-healthy shadow-subtle'
                : 'bg-bg-base text-text-secondary border-border-subtle hover:text-text-primary'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('models.freeTierOnly', { count: freeCount })}</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterToolsOnly(!filterToolsOnly)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors border ${
              filterToolsOnly
                ? 'bg-accent-subtle text-accent border-accent-border'
                : 'bg-bg-base text-text-secondary border-border-subtle hover:text-text-primary'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>{t('models.toolsRequired')}</span>
          </button>
        </div>
      </div>

      {/* Models Table */}
      <div className="rounded-md bg-bg-surface border border-border-default overflow-hidden">
        {filteredModels.length === 0 ? (
          <div className="p-12 text-center text-xs text-text-muted">
            {isLoading ? t('models.loadingCatalog') : t('models.noModelsMatched')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-raised/50 text-[11px] text-text-muted font-medium">
                  <th className="py-2.5 px-4">{t('models.thModelProvider')}</th>
                  <th className="py-2.5 px-4">{t('models.thTier')}</th>
                  <th className="py-2.5 px-4">{t('models.thContextWindow')}</th>
                  <th className="py-2.5 px-4">{t('models.thLatency')}</th>
                  <th className="py-2.5 px-4">{t('models.thCapabilities')}</th>
                  <th className="py-2.5 px-4 text-right">{t('models.thActionsEnabled')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredModels.map((m: any) => {
                  const isFree = m.isFree ?? (isFreeModelId(m.modelId) || m.providerProtocol === 'ollama');
                  const ping = pings[m.modelId];

                  return (
                    <tr key={m.id} className="hover:bg-bg-raised/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <ModelLogo modelId={m.modelId} providerName={m.providerName} size={24} />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-medium text-text-primary">{m.modelId}</span>
                            </div>
                            <div className="text-[11px] text-text-muted">{m.providerName}</div>
                          </div>
                        </div>
                      </td>

                      {/* Tier Badge */}
                      <td className="py-3 px-4">
                        {isFree ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-status-healthy-bg text-status-healthy border border-[rgba(47,158,68,0.3)]">
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>{t('models.freeBadge')}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[rgba(245,159,0,0.12)] border border-[rgba(245,159,0,0.25)] text-[#f59f00] font-medium">
                            {t('models.paidBadge')}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono text-text-secondary">
                        {m.contextWindow ? (
                          <span className="px-1.5 py-0.5 rounded bg-bg-base border border-border-subtle">
                            {formatContext(m.contextWindow)} {t('models.tokensUnit')}
                          </span>
                        ) : (
                          <span className="text-text-muted">-</span>
                        )}
                      </td>

                      {/* Latency Ping */}
                      <td className="py-3 px-4 font-mono text-[11px]">
                        {ping?.loading ? (
                          <span className="text-text-muted animate-pulse">{t('models.pinging')}</span>
                        ) : ping?.ms ? (
                          <span className="text-status-healthy font-semibold">{ping.ms}ms</span>
                        ) : ping?.error ? (
                          <span className="text-status-error text-[10px]" title={ping.error}>{t('common.error')}</span>
                        ) : (
                          <button
                            onClick={() => handlePingModel(m.modelId, m.providerId)}
                            className="px-1.5 py-0.5 rounded bg-bg-base hover:bg-bg-raised border border-border-subtle text-text-muted hover:text-text-primary text-[10px]"
                            title={t('models.pingTooltip')}
                          >
                            {t('models.ping')}
                          </button>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {m.supportsTools && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-bg-base text-text-secondary border border-border-subtle">
                              <Wrench className="w-2.5 h-2.5 text-accent" />
                              <span>{t('models.toolsCap')}</span>
                            </span>
                          )}
                          {m.supportsVision && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-bg-base text-text-secondary border border-border-subtle">
                              <Eye className="w-2.5 h-2.5 text-[#4DABF7]" />
                              <span>{t('models.visionCap')}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleSetDefaultModel(m.modelId, m.providerId)}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors border ${
                              defaultModel === m.modelId
                                ? 'bg-status-healthy-bg text-status-healthy border-status-healthy/40 font-semibold'
                                : 'bg-bg-base hover:bg-bg-raised text-text-muted hover:text-text-primary border-border-subtle'
                            }`}
                            title={t('models.setDefaultTooltip')}
                          >
                            {defaultModel === m.modelId ? t('models.starDefault') : t('models.setDefault')}
                          </button>

                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`nonstop/${m.modelId}`);
                              alert(t('models.copiedSlugAlert', { slug: `nonstop/${m.modelId}` }));
                            }}
                            className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-text-primary transition-colors border border-border-subtle"
                            title={t('models.copySlugTooltip')}
                          >
                            <Copy className="w-3 h-3" />
                          </button>

                          {onOpenPlayground && (
                            <button
                              onClick={() => onOpenPlayground(m.modelId)}
                              className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-accent transition-colors"
                              title={t('models.testPromptPlayground')}
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            onClick={() => handleToggleModel(m.id)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              m.enabled ? 'bg-accent' : 'bg-bg-raised'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                m.enabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
