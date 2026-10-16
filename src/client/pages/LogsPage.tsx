import React, { useState } from 'react';
import { useLogs, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Trash2,
  ChevronDown,
  ChevronRight,
  Activity,
  Clock,
  Zap,
  DollarSign,
  Sparkles,
  FileText,
  X,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
import type { RequestLog } from '../../shared/types.js';
import { useI18n } from '../i18n/index.js';

export const LogsPage: React.FC = () => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [clientTool, setClientTool] = useState('');
  const [inspectLog, setInspectLog] = useState<any | null>(null);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'request' | 'response' | 'attempts'>('overview');

  const { data, isLoading } = useLogs(50, search, clientTool);
  const logs = data?.logs || [];

  const handleClearLogs = async () => {
    if (!confirm(t('logs.clearLogsConfirm'))) return;
    try {
      await fetchJson('/api/logs', { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['logs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setInspectLog(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t('logs.title')}</h1>
          <p className="text-xs text-text-secondary mt-1">
            {t('logs.subtitle')}
          </p>
        </div>

        {logs.length > 0 && (
          <button
            onClick={handleClearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-muted hover:text-status-error text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('logs.clearLogs')}</span>
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="p-3 rounded-md bg-bg-surface border border-border-default flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('logs.searchPlaceholder')}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded bg-bg-surface border border-border-default text-text-primary"
          />
        </div>

        <select
          value={clientTool}
          onChange={e => setClientTool(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded bg-bg-surface border border-border-default text-text-primary"
        >
          <option value="">{t('logs.allTools')}</option>
          <option value="opencode">OpenCode</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex CLI</option>
          <option value="generic-client">Generic Client</option>
        </select>
      </div>

      {/* Logs Table */}
      <div className="rounded-md bg-bg-surface border border-border-default overflow-hidden">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-xs text-text-muted space-y-2">
            <img src="/assets/icon.svg" alt="NonStop Router" className="w-8 h-8 mx-auto opacity-50" width={32} height={32} />
            <div>{isLoading ? t('logs.loadingLogs') : t('logs.noLogsRecorded')}</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-raised/50 text-[11px] text-text-muted font-medium">
                  <th className="py-2.5 px-3">{t('logs.thTime')}</th>
                  <th className="py-2.5 px-3">{t('logs.thClientTool')}</th>
                  <th className="py-2.5 px-3">{t('logs.thRouteModel')}</th>
                  <th className="py-2.5 px-3">{t('logs.thAnsweringTarget')}</th>
                  <th className="py-2.5 px-3">{t('logs.thLatencyTtft')}</th>
                  <th className="py-2.5 px-3">{t('logs.thTokens')}</th>
                  <th className="py-2.5 px-3">{t('logs.thSavings')}</th>
                  <th className="py-2.5 px-3 text-right">{t('logs.thStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {logs.map((log: any) => {
                  const isError = log.statusCode >= 400;
                  const failovers = Math.max(0, (log.targetsAttempted?.length || 1) - 1);
                  const isCached = Boolean(log.cached);
                  const moneySaved = log.moneySavedUsd || 0;

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setInspectLog(log)}
                      className="hover:bg-bg-raised/40 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono text-[11px] text-text-muted whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>

                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-bg-raised border border-border-subtle text-text-secondary">
                          {log.clientTool}
                        </span>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="font-mono text-[11px] text-text-primary">{log.requestedModel}</div>
                        <div className="text-[10px] text-text-muted">{log.endpoint}</div>
                      </td>

                      <td className="py-2.5 px-3">
                        {isCached ? (
                          <div className="flex items-center gap-1 text-status-healthy font-medium text-[11px]">
                            <Sparkles className="w-3 h-3" />
                            <span>{t('logs.cacheLocalSqlite')}</span>
                          </div>
                        ) : log.finalProviderName ? (
                          <div>
                            <div className="font-mono text-[11px] text-text-primary">{log.finalModelId}</div>
                            <div className="text-[10px] text-text-muted">{log.finalProviderName}</div>
                          </div>
                        ) : (
                          <span className="text-text-muted italic text-[11px]">{t('logs.noneExhausted')}</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[11px] text-text-secondary">
                        <div>{log.latencyMs}ms</div>
                        {log.ttftMs && <div className="text-[10px] text-text-muted">{t('logs.ttftPrefix', { ms: log.ttftMs })}</div>}
                      </td>

                      <td className="py-2.5 px-3 font-mono text-[11px] text-text-secondary">
                        {log.totalTokens ? (
                          <span>{log.totalTokens}</span>
                        ) : (
                          <span className="text-text-muted">-</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3">
                        {moneySaved > 0 ? (
                          <span className="font-mono text-[11px] font-semibold text-status-healthy">
                            +${moneySaved.toFixed(4)}
                          </span>
                        ) : isCached ? (
                          <span className="text-[10px] font-mono text-status-healthy bg-status-healthy/15 px-1.5 py-0.5 rounded">
                            {t('common.free')}
                          </span>
                        ) : (
                          <span className="text-text-muted text-[11px]">-</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isCached && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-status-healthy/15 text-status-healthy border border-status-healthy/30">
                              {t('logs.cachedBadge')}
                            </span>
                          )}
                          {failovers > 0 && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent-subtle text-accent border border-accent-border"
                              title={`${failovers} failover(s) occurred`}
                            >
                              {t('logs.fallbackOccurred', { count: failovers })}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                              isError
                                ? 'bg-status-error-bg text-status-error border border-[rgba(224,49,49,0.25)]'
                                : 'bg-status-healthy-bg text-status-healthy border border-[rgba(47,158,68,0.25)]'
                            }`}
                          >
                            {log.statusCode}
                          </span>
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

      {/* Slide-Over Request Inspector Drawer */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl bg-bg-surface border-l border-border-default h-full flex flex-col shadow-overlay animate-slide-left">
            {/* Drawer Header */}
            <div className="p-4 border-b border-border-subtle flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-semibold text-text-primary">{inspectLog.requestedModel}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted">
                    {inspectLog.endpoint}
                  </span>
                  <span className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded ${
                    inspectLog.statusCode >= 400 ? 'bg-status-error-bg text-status-error' : 'bg-status-healthy-bg text-status-healthy'
                  }`}>
                    {inspectLog.statusCode}
                  </span>
                </div>
                <div className="text-[11px] text-text-muted mt-1">
                  ID: <span className="font-mono">{inspectLog.id}</span> &bull; {new Date(inspectLog.timestamp).toLocaleString()}
                </div>
              </div>

              <button
                onClick={() => setInspectLog(null)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised"
                title={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Metrics Header Bar */}
            <div className="grid grid-cols-4 gap-2 p-3 bg-bg-raised/50 border-b border-border-subtle text-xs font-mono">
              <div>
                <span className="text-text-muted text-[10px] block">{t('logs.latencyMetric')}</span>
                <span className="text-text-primary font-semibold">{inspectLog.latencyMs}ms</span>
              </div>
              <div>
                <span className="text-text-muted text-[10px] block">{t('logs.ttftMetric')}</span>
                <span className="text-text-primary font-semibold">{inspectLog.ttftMs ? `${inspectLog.ttftMs}ms` : '-'}</span>
              </div>
              <div>
                <span className="text-text-muted text-[10px] block">{t('logs.totalTokensMetric')}</span>
                <span className="text-text-primary font-semibold">{inspectLog.totalTokens || '-'}</span>
              </div>
              <div>
                <span className="text-text-muted text-[10px] block">{t('logs.savingsMetric')}</span>
                <span className="text-status-healthy font-semibold">
                  {inspectLog.moneySavedUsd ? `+$${inspectLog.moneySavedUsd.toFixed(4)}` : inspectLog.cached ? t('logs.freeCached') : '$0.00'}
                </span>
              </div>
            </div>

            {/* Tabs Bar */}
            <div className="flex border-b border-border-subtle px-3 pt-2 gap-4 text-xs font-medium">
              {[
                { id: 'overview', label: t('logs.tabAttemptsRoute') },
                { id: 'request', label: t('logs.tabRequestPayload') },
                { id: 'response', label: t('logs.tabResponsePayload') },
              ].map(tTab => (
                <button
                  key={tTab.id}
                  onClick={() => setActiveTab(tTab.id as any)}
                  className={`pb-2 border-b-2 transition-colors ${
                    activeTab === tTab.id
                      ? 'border-accent text-accent font-semibold'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                >
                  {tTab.label}
                </button>
              ))}
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-text-primary mb-2">{t('logs.failoverAttemptTimeline')}</h3>
                    <div className="space-y-2">
                      {inspectLog.targetsAttempted?.map((att: any, idx: number) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                            att.success
                              ? 'bg-status-healthy-bg/30 border-[rgba(47,158,68,0.25)]'
                              : 'bg-status-error-bg/30 border-[rgba(224,49,49,0.25)]'
                          }`}
                        >
                          <div>
                            <div className="font-semibold text-text-primary font-mono">
                              #{idx + 1}: {att.providerName} / {att.modelId}
                            </div>
                            {att.error && <div className="text-status-error text-[11px] mt-1">{att.error}</div>}
                          </div>
                          <div className="text-right font-mono text-[11px] text-text-muted">
                            <div>{att.durationMs}ms</div>
                            <div>{att.statusCode || (att.success ? 200 : 500)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {inspectLog.errorMessage && (
                    <div className="p-3 rounded-lg bg-status-error-bg/30 border border-status-error/30 text-xs text-status-error">
                      <strong className="block mb-1">{t('logs.finalFailure')}</strong>
                      {inspectLog.errorMessage}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'request' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-text-secondary">{t('logs.rawIncomingRequest')}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(inspectLog.requestBody, null, 2));
                        setCopiedPayload(true);
                        setTimeout(() => setCopiedPayload(false), 2000);
                      }}
                      className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                    >
                      {copiedPayload ? <Check className="w-3 h-3 text-status-healthy" /> : <Copy className="w-3 h-3" />}
                      <span>{t('logs.copyJson')}</span>
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-bg-base border border-border-default text-[11px] font-mono text-text-primary overflow-x-auto whitespace-pre-wrap max-h-96">
                    {inspectLog.requestBody ? JSON.stringify(inspectLog.requestBody, null, 2) : t('logs.noPayloadRecorded')}
                  </pre>
                </div>
              )}

              {activeTab === 'response' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-text-secondary">{t('logs.capturedOutputPayload')}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(inspectLog.responseBody, null, 2));
                        setCopiedPayload(true);
                        setTimeout(() => setCopiedPayload(false), 2000);
                      }}
                      className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                    >
                      {copiedPayload ? <Check className="w-3 h-3 text-status-healthy" /> : <Copy className="w-3 h-3" />}
                      <span>{t('logs.copyJson')}</span>
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-bg-base border border-border-default text-[11px] font-mono text-text-primary overflow-x-auto whitespace-pre-wrap max-h-96">
                    {inspectLog.responseBody ? JSON.stringify(inspectLog.responseBody, null, 2) : t('logs.responsePayloadNotAvailable')}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
