import React from 'react';
import { useOverview, useChains } from '../api.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { ProviderLogo } from '../components/ProviderLogo.js';
import { Activity, ShieldCheck, Zap, ArrowRight, AlertTriangle, Cpu, Terminal, Key } from 'lucide-react';

interface OverviewPageProps {
  onNavigate: (page: any) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ onNavigate }) => {
  const { data: overview, isLoading } = useOverview();
  const { data: chains } = useChains();

  if (isLoading || !overview) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-8 w-48 bg-bg-raised animate-pulse rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-bg-surface border border-border-default rounded-md animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Healthy Providers & Keys',
      value: `${overview.healthyKeys} / ${overview.totalKeys}`,
      subtext: `${overview.totalProviders} provider${overview.totalProviders === 1 ? '' : 's'} configured`,
      icon: <ShieldCheck className="w-4 h-4 text-status-healthy" />,
    },
    {
      label: 'Failover Events Handled',
      value: overview.totalFailovers,
      subtext: 'Transparent upstream fallbacks',
      icon: <Zap className="w-4 h-4 text-accent" />,
    },
    {
      label: 'Discovered Models',
      value: overview.enabledModels,
      subtext: `Out of ${overview.totalModels} total available`,
      icon: <Cpu className="w-4 h-4 text-[#4DABF7]" />,
    },
    {
      label: 'Current Throughput',
      value: `${overview.requestsPerMinute} RPM`,
      subtext: 'Requests in the last 60s',
      icon: <Activity className="w-4 h-4 text-[#FCC419]" />,
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">System Overview</h1>
          <p className="text-xs text-text-secondary mt-1">Real-time local LLM router health, chains, and failover status.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('connect')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors shadow-subtle"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Connect Coding Tools</span>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, idx) => (
          <div key={idx} className="p-4 rounded-md bg-bg-surface border border-border-default flex flex-col justify-between">
            <div className="flex items-center justify-between text-text-muted text-xs">
              <span>{card.label}</span>
              {card.icon}
            </div>
            <div className="mt-3">
              <div className="text-2xl font-semibold text-text-primary tracking-tight font-mono">{card.value}</div>
              <div className="text-[11px] text-text-secondary mt-1">{card.subtext}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Active Chains & Health Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Routing Chains</h2>
            <button
              onClick={() => onNavigate('chains')}
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              <span>Manage Chains</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {overview.activeChains.map((ac) => (
              <div
                key={ac.chainId}
                className="p-4 rounded-md bg-bg-surface border border-border-default flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-text-primary">{ac.chainName}</span>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-bg-raised text-text-secondary border border-border-subtle">
                      {ac.mode} mode
                    </span>
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    Primary route for tools specifying model <code className="text-text-primary font-mono">{ac.chainName}</code>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {ac.activeTarget ? (
                    <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-md bg-bg-raised border border-border-subtle">
                      <ProviderLogo providerName={ac.activeTarget.providerName} size={18} />
                      <div className="text-xs">
                        <div className="font-mono font-medium text-text-primary">{ac.activeTarget.modelId}</div>
                        <div className="text-[10px] text-text-muted">{ac.activeTarget.providerName}</div>
                      </div>
                      <StatusBadge status={ac.activeTarget.status} showText={false} />
                    </div>
                  ) : (
                    <div className="text-xs text-text-muted italic">No active targets configured</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Errors & Probing Feed */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Recent Router Events</h2>
          <div className="p-4 rounded-md bg-bg-surface border border-border-default min-h-[220px] flex flex-col justify-between">
            {overview.recentErrors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center text-text-muted space-y-2">
                <ShieldCheck className="w-8 h-8 text-status-healthy opacity-80" />
                <div className="text-xs font-medium text-text-primary">All Routes Healthy</div>
                <div className="text-[11px]">No upstream rate limits or connection errors recorded.</div>
              </div>
            ) : (
              <div className="space-y-3">
                {overview.recentErrors.map((err, i) => (
                  <div key={i} className="text-xs p-2.5 rounded bg-bg-raised border border-border-subtle space-y-1">
                    <div className="flex items-center justify-between text-text-muted text-[10px]">
                      <span className="font-mono">{err.providerName} / {err.modelId}</span>
                      <span>{new Date(err.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-status-error line-clamp-2">{err.error}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-border-subtle flex items-center justify-between text-[11px] text-text-muted">
              <span>Prober frequency: 30s</span>
              <button onClick={() => onNavigate('logs')} className="text-accent hover:underline">
                View all logs
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
