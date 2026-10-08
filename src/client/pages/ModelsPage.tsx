import React, { useState } from 'react';
import { useModels, useProviders, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderLogo } from '../components/ProviderLogo.js';
import { Search, RefreshCw, Wrench, Eye, Check, X, Filter } from 'lucide-react';
import type { Model } from '../../shared/types.js';

export const ModelsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [filterToolsOnly, setFilterToolsOnly] = useState(false);
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);

  const { data: providers = [] } = useProviders();
  const { data: models = [], isLoading } = useModels(selectedProvider || undefined, search || undefined);

  const filteredModels = models.filter(m => {
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

  const formatContext = (ctx?: number | null) => {
    if (!ctx) return '-';
    if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(1)}M`;
    if (ctx >= 1000) return `${Math.round(ctx / 1000)}k`;
    return String(ctx);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">Discovered Models</h1>
          <p className="text-xs text-text-secondary mt-1">
            Browse discovered models from connected providers, view enriched metadata, and toggle routing availability.
          </p>
        </div>

        {providers.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRefreshModels(selectedProvider || providers[0].id)}
              disabled={!!refreshingProvider}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-primary text-xs font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingProvider ? 'animate-spin' : ''}`} />
              <span>Refresh Provider Models</span>
            </button>
          </div>
        )}
      </div>

      {/* Filters Bar */}
      <div className="p-3 rounded-md bg-bg-surface border border-border-default flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by model name or ID (e.g. claude-sonnet, deepseek)..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded bg-bg-base border border-border-subtle focus:border-accent focus:outline-none text-text-primary"
          />
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedProvider}
            onChange={e => setSelectedProvider(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded bg-bg-base border border-border-subtle focus:border-accent focus:outline-none text-text-primary"
          >
            <option value="">All Providers ({providers.length})</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

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
            <span>Tools Required</span>
          </button>
        </div>
      </div>

      {/* Models Table / Cards */}
      <div className="rounded-md bg-bg-surface border border-border-default overflow-hidden">
        {filteredModels.length === 0 ? (
          <div className="p-12 text-center text-xs text-text-muted">
            {isLoading ? 'Loading model catalog...' : 'No models matched the search query.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-raised/50 text-[11px] text-text-muted font-medium">
                  <th className="py-2.5 px-4">Model & Provider</th>
                  <th className="py-2.5 px-4">Context Window</th>
                  <th className="py-2.5 px-4">Capabilities</th>
                  <th className="py-2.5 px-4">Pricing (1M tokens)</th>
                  <th className="py-2.5 px-4 text-right">Enabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredModels.map((m: any) => (
                  <tr key={m.id} className="hover:bg-bg-raised/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <ProviderLogo providerName={m.providerName || ''} size={22} />
                        <div>
                          <div className="font-mono font-medium text-text-primary">{m.modelId}</div>
                          <div className="text-[11px] text-text-muted">{m.providerName}</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono text-text-secondary">
                      {m.contextWindow ? (
                        <span className="px-1.5 py-0.5 rounded bg-bg-base border border-border-subtle">
                          {formatContext(m.contextWindow)} tokens
                        </span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {m.supportsTools && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-bg-base text-text-secondary border border-border-subtle">
                            <Wrench className="w-2.5 h-2.5 text-accent" />
                            <span>Tools</span>
                          </span>
                        )}
                        {m.supportsVision && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-bg-base text-text-secondary border border-border-subtle">
                            <Eye className="w-2.5 h-2.5 text-[#4DABF7]" />
                            <span>Vision</span>
                          </span>
                        )}
                        {!m.supportsTools && !m.supportsVision && (
                          <span className="text-[11px] text-text-muted">Chat only</span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono text-text-secondary text-[11px]">
                      {m.pricingInput != null ? (
                        <span>${m.pricingInput} in / ${m.pricingOutput || m.pricingInput} out</span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
