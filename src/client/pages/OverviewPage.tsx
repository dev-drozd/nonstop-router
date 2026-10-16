import React, { useState } from 'react';
import { useOverview, useChains, useModels, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '../components/StatusBadge.js';
import { ModelLogo } from '../components/ModelLogo.js';
import { isFreeModelId } from '../../shared/types.js';
import { Activity, ShieldCheck, Zap, ArrowRight, Cpu, Terminal, Play, Sparkles, DollarSign } from 'lucide-react';
import { useI18n } from '../i18n/index.js';

interface OverviewPageProps {
  onNavigate: (page: any) => void;
  onOpenPlayground: (modelId: string) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ onNavigate, onOpenPlayground }) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: overview, isLoading } = useOverview();
  const { data: chains = [] } = useChains();
  const { data: models = [] } = useModels();

  const [detectingLocal, setDetectingLocal] = useState(false);
  const [buildingFree, setBuildingFree] = useState(false);

  const handleDetectLocal = async () => {
    setDetectingLocal(true);
    try {
      const res = await fetchJson<any>('/api/providers/detect-local', { method: 'POST' });
      queryClient.invalidateQueries();
      if (res.services?.length > 0) {
        alert(t('overview.discoveredLocalAlert', {
          services: res.services.map((s: any) => `${s.name} (${s.models.length} models)`).join(', ')
        }));
      } else {
        alert(t('overview.noLocalDetected'));
      }
    } catch (err: any) {
      alert(t('overview.detectionError', { error: err.message }));
    } finally {
      setDetectingLocal(false);
    }
  };

  const handleAutoBuildFree = async () => {
    setBuildingFree(true);
    try {
      await fetchJson('/api/chains/auto-build-free', { method: 'POST' });
      queryClient.invalidateQueries();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBuildingFree(false);
    }
  };

  if (isLoading || !overview) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-8 w-48 bg-bg-raised animate-pulse rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-24 bg-bg-surface border border-border-default rounded-md animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const freeModelsCount = models.filter((m: any) => m.isFree ?? isFreeModelId(m.modelId)).length;

  const statCards = [
    {
      label: t('overview.statMoneySaved'),
      value: `$${(overview.totalMoneySavedUsd || 0).toFixed(2)}`,
      subtext: t('overview.statMoneySavedSubtext', { tokens: (overview.totalTokensSaved || 0).toLocaleString() }),
      icon: <DollarSign className="w-4 h-4 text-status-healthy" />,
      accentBorder: 'border-status-healthy/40',
      valueColor: 'text-status-healthy',
    },
    {
      label: t('overview.statCacheHits'),
      value: t('overview.statCacheHitsValue', { count: overview.cacheHitCount || 0 }),
      subtext: t('overview.statCacheHitsSubtext'),
      icon: <Sparkles className="w-4 h-4 text-accent" />,
      accentBorder: 'border-border-default',
      valueColor: 'text-text-primary',
    },
    {
      label: t('overview.statFreeTargets'),
      value: t('overview.statFreeTargetsValue', { count: overview.healthyKeys }),
      subtext: t('overview.statFreeTargetsSubtext', { count: freeModelsCount }),
      icon: <Cpu className="w-4 h-4 text-[#4DABF7]" />,
      accentBorder: 'border-border-default',
      valueColor: 'text-text-primary',
    },
    {
      label: t('overview.statFailovers'),
      value: overview.totalFailovers,
      subtext: t('overview.statFailoversSubtext'),
      icon: <Zap className="w-4 h-4 text-accent" />,
      accentBorder: 'border-border-default',
      valueColor: 'text-text-primary',
    },
    {
      label: t('overview.statThroughput'),
      value: t('overview.statThroughputValue', { rpm: overview.requestsPerMinute }),
      subtext: t('overview.statThroughputSubtext'),
      icon: <Activity className="w-4 h-4 text-[#FCC419]" />,
      accentBorder: 'border-border-default',
      valueColor: 'text-text-primary',
    },
  ];

  const gatewayBase = overview.runtime?.baseUrl || 'http://127.0.0.1:4000';
  const gatewayV1 = `${gatewayBase}/v1`;

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t('overview.title')}</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-status-healthy-bg text-status-healthy border border-[rgba(47,158,68,0.25)]">
              <Sparkles className="w-3 h-3" />
              <span>{t('overview.freeTierActive')}</span>
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            {t('overview.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleDetectLocal}
            disabled={detectingLocal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-primary text-xs font-medium transition-colors"
            title={t('overview.detectLocalTitle')}
          >
            <Cpu className="w-3.5 h-3.5 text-[#4DABF7]" />
            <span>{detectingLocal ? t('overview.detecting') : t('overview.detectLocal')}</span>
          </button>

          <button
            onClick={() => onOpenPlayground('auto')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-primary text-xs font-medium transition-colors"
          >
            <Play className="w-3.5 h-3.5 text-accent" />
            <span>{t('overview.interactivePlayground')}</span>
          </button>

          <button
            onClick={() => onNavigate('connect')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors shadow-subtle"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{t('overview.connectTools')}</span>
          </button>
        </div>
      </div>

      {/* Local AI Gateway Endpoint Banner */}
      <div className="p-4 rounded-md bg-bg-surface border border-border-default flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-text-primary">{t('overview.gatewayEndpointTitle')}</div>
          <div className="text-[11px] text-text-secondary mt-0.5">
            {t('overview.gatewayEndpointDesc', { url: gatewayV1 })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded bg-bg-base border border-border-subtle font-mono text-xs text-text-primary select-all">
            {gatewayV1}
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(gatewayV1);
              alert(t('overview.copiedUrlAlert', { url: gatewayV1 }));
            }}
            className="px-3 py-1.5 rounded-md bg-bg-raised hover:bg-bg-overlay border border-border-default text-xs font-medium text-text-primary transition-colors"
          >
            {t('overview.copyUrl')}
          </button>
        </div>
      </div>

      {/* Quick Action Banner for Free Tier Optimization */}
      <div className="p-4 rounded-md bg-gradient-to-r from-bg-surface to-bg-raised border border-border-default flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-md bg-status-healthy-bg border border-[rgba(47,158,68,0.3)] flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-status-healthy" />
          </div>
          <div>
            <div className="text-xs font-semibold text-text-primary">
              {t('overview.freeBannerTitle')}
            </div>
            <div className="text-[11px] text-text-secondary mt-0.5">
              {t('overview.freeBannerDesc', { count: freeModelsCount })}
            </div>
          </div>
        </div>

        <button
          onClick={handleAutoBuildFree}
          disabled={buildingFree}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-status-healthy text-white text-xs font-medium hover:opacity-90 transition-opacity shrink-0 shadow-subtle disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{buildingFree ? t('overview.configuring') : t('overview.setFreePriority')}</span>
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((card, idx) => (
          <div key={idx} className={`p-4 rounded-md bg-bg-surface border ${card.accentBorder} flex flex-col justify-between transition-all`}>
            <div className="flex items-center justify-between text-text-muted text-xs">
              <span className="font-medium">{card.label}</span>
              {card.icon}
            </div>
            <div className="mt-3">
              <div className={`text-2xl font-bold tracking-tight font-mono ${card.valueColor}`}>{card.value}</div>
              <div className="text-[11px] text-text-secondary mt-1">{card.subtext}</div>
            </div>
          </div>
        ))}
      </div>


      {/* Active Chains & Health Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">{t('overview.activeChains')}</h2>
            <button
              onClick={() => onNavigate('chains')}
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              <span>{t('overview.manageChains')}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {overview.activeChains.map((ac) => {
              const isFree = ac.activeTarget ? isFreeModelId(ac.activeTarget.modelId) : false;

              return (
                <div
                  key={ac.chainId}
                  className="p-4 rounded-md bg-bg-surface border border-border-default flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-text-primary">{ac.chainName}</span>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-bg-raised text-text-secondary border border-border-subtle">
                        {t('overview.modeLabel', { mode: ac.mode })}
                      </span>
                      {isFree && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[9px] font-mono font-semibold bg-status-healthy-bg text-status-healthy border border-[rgba(47,158,68,0.3)]">
                          {t('overview.primaryRouteBadge')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {t('overview.primaryTargetDesc', { name: ac.chainName })}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {ac.activeTarget ? (
                      <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-md bg-bg-raised border border-border-subtle">
                        <ModelLogo modelId={ac.activeTarget.modelId} providerName={ac.activeTarget.providerName} size={22} />
                        <div className="text-xs">
                          <div className="font-mono font-medium text-text-primary">{ac.activeTarget.modelId}</div>
                          <div className="text-[10px] text-text-muted">{ac.activeTarget.providerName}</div>
                        </div>
                        <StatusBadge status={ac.activeTarget.status} showText={false} />
                      </div>
                    ) : (
                      <div className="text-xs text-text-muted italic">{t('overview.noActiveTargets')}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Errors & Probing Feed */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">{t('overview.liveRouterFeed')}</h2>
          <div className="p-4 rounded-md bg-bg-surface border border-border-default min-h-[220px] flex flex-col justify-between">
            {overview.recentErrors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center text-text-muted space-y-2">
                <ShieldCheck className="w-8 h-8 text-status-healthy opacity-80" />
                <div className="text-xs font-medium text-text-primary">{t('overview.allRoutesHealthy')}</div>
                <div className="text-[11px]">{t('overview.freeModelsStreaming')}</div>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                {overview.recentErrors.map((err, i) => {
                  let badge = 'ERROR';
                  let badgeColor = 'bg-status-error/15 text-status-error border-status-error/30';
                  if (err.error.includes('429')) {
                    badge = '429 RATE LIMIT';
                    badgeColor = 'bg-status-standby/15 text-status-standby border-status-standby/30';
                  } else if (err.error.includes('402')) {
                    badge = '402 QUOTA DEPLETED';
                    badgeColor = 'bg-[rgba(245,159,0,0.15)] text-[#f59f00] border-[rgba(245,159,0,0.3)]';
                  } else if (err.error.includes('401') || err.error.includes('403')) {
                    badge = 'AUTH / KEY';
                  }

                  let cleanMsg = err.error;
                  try {
                    const jsonMatch = err.error.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                      const p = JSON.parse(jsonMatch[0]);
                      if (p.error?.message) cleanMsg = p.error.message;
                      else if (p.message) cleanMsg = p.message;
                    }
                  } catch {}

                  return (
                    <div key={i} className="text-xs p-2.5 rounded bg-bg-raised border border-border-subtle space-y-1.5">
                      <div className="flex items-center justify-between text-text-muted text-[10px]">
                        <div className="flex items-center gap-1.5 font-mono truncate max-w-[190px]">
                          <span className="font-semibold text-text-primary">{err.providerName}</span>
                          <span>/</span>
                          <span className="truncate">{err.modelId}</span>
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-medium border ${badgeColor}`}>
                          {badge}
                        </span>
                      </div>
                      <div className="text-text-secondary text-[11px] line-clamp-2 leading-relaxed font-mono">
                        {cleanMsg}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-[11px] text-text-muted">
              <span>{t('overview.proberFrequency')}</span>
              <button onClick={() => onNavigate('logs')} className="text-accent hover:underline">
                {t('overview.viewAuditLogs')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
