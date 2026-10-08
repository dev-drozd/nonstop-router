import React, { useState } from 'react';
import { useLogs, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Trash2, ChevronDown, ChevronRight, Activity, Clock, Zap } from 'lucide-react';
import type { RequestLog } from '../../shared/types.js';

export const LogsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [clientTool, setClientTool] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const { data, isLoading } = useLogs(50, search, clientTool);
  const logs = data?.logs || [];

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear all request logs?')) return;
    try {
      await fetchJson('/api/logs', { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['logs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">Request Audit Logs</h1>
          <p className="text-xs text-text-secondary mt-1">
            Complete trace of client requests, attempted failover paths, latency, and token metrics.
          </p>
        </div>

        {logs.length > 0 && (
          <button
            onClick={handleClearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-muted hover:text-status-error text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Logs</span>
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
            placeholder="Search by model, chain, or error message..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded bg-bg-base border border-border-subtle focus:border-accent focus:outline-none text-text-primary"
          />
        </div>

        <select
          value={clientTool}
          onChange={e => setClientTool(e.target.value)}
          className="px-2.5 py-1.5 text-xs rounded bg-bg-base border border-border-subtle focus:border-accent focus:outline-none text-text-primary"
        >
          <option value="">All Tools</option>
          <option value="opencode">OpenCode</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex CLI</option>
          <option value="generic-client">Generic Client</option>
        </select>
      </div>

      {/* Logs Table */}
      <div className="rounded-md bg-bg-surface border border-border-default overflow-hidden">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-xs text-text-muted">
            {isLoading ? 'Loading logs...' : 'No request logs recorded yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-raised/50 text-[11px] text-text-muted font-medium">
                  <th className="py-2.5 px-3 w-8"></th>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Client Tool</th>
                  <th className="py-2.5 px-3">Route / Model</th>
                  <th className="py-2.5 px-3">Answering Target</th>
                  <th className="py-2.5 px-3">Latency / TTFT</th>
                  <th className="py-2.5 px-3">Tokens</th>
                  <th className="py-2.5 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {logs.map((log: any) => {
                  const isExpanded = expandedLogId === log.id;
                  const isError = log.statusCode >= 400;
                  const failovers = Math.max(0, (log.targetsAttempted?.length || 1) - 1);

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => toggleExpand(log.id)}
                        className="hover:bg-bg-raised/30 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 px-3 text-text-muted">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </td>

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
                          {log.finalProviderName ? (
                            <div>
                              <div className="font-mono text-[11px] text-text-primary">{log.finalModelId}</div>
                              <div className="text-[10px] text-text-muted">{log.finalProviderName}</div>
                            </div>
                          ) : (
                            <span className="text-text-muted italic text-[11px]">None (Exhausted)</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3 font-mono text-[11px] text-text-secondary">
                          <div>{log.latencyMs}ms</div>
                          {log.ttftMs && <div className="text-[10px] text-text-muted">TTFT: {log.ttftMs}ms</div>}
                        </td>

                        <td className="py-2.5 px-3 font-mono text-[11px] text-text-secondary">
                          {log.totalTokens ? (
                            <span>{log.totalTokens}</span>
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {failovers > 0 && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent-subtle text-accent border border-accent-border"
                                title={`${failovers} failover(s) occurred`}
                              >
                                {failovers} fallback
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

                      {/* Expandable Details Row */}
                      {isExpanded && (
                        <tr className="bg-bg-raised/20 border-b border-border-subtle">
                          <td colSpan={8} className="p-4 space-y-3">
                            <div className="text-xs font-semibold text-text-primary">Target Attempt History</div>
                            <div className="space-y-1.5">
                              {log.targetsAttempted?.map((att: any, aIdx: number) => (
                                <div
                                  key={aIdx}
                                  className={`p-2.5 rounded text-xs border flex items-center justify-between gap-3 ${
                                    att.success
                                      ? 'bg-status-healthy-bg border-[rgba(47,158,68,0.25)]'
                                      : 'bg-status-error-bg border-[rgba(224,49,49,0.25)]'
                                  }`}
                                >
                                  <div>
                                    <div className="font-mono font-medium text-text-primary">
                                      Attempt #{aIdx + 1}: {att.providerName} / {att.modelId}
                                    </div>
                                    {att.error && <div className="text-status-error text-[11px] mt-0.5">{att.error}</div>}
                                  </div>
                                  <div className="font-mono text-[11px] text-text-muted shrink-0">
                                    {att.durationMs}ms &bull; {att.statusCode || (att.success ? 200 : 500)}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {log.errorMessage && (
                              <div className="p-2.5 rounded bg-bg-base border border-border-subtle text-xs text-status-error">
                                <span className="font-semibold">Error Message:</span> {log.errorMessage}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
