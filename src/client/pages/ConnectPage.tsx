import React, { useState } from 'react';
import { useConnectConfigs, useChains, useGatewayKeys, fetchJson } from '../api.js';
import { Terminal, Copy, Check, ExternalLink, FileEdit, CheckCircle2 } from 'lucide-react';

export const ConnectPage: React.FC = () => {
  const { data: chains = [] } = useChains();
  const [selectedChain, setSelectedChain] = useState('auto');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: connectData, isLoading } = useConnectConfigs(selectedChain);

  // One-click writer modal state
  const [activeWriterTool, setActiveWriterTool] = useState<{ id: string; name: string; endpoint: string } | null>(null);
  const [writerPreview, setWriterPreview] = useState<any>(null);
  const [writingStatus, setWritingStatus] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handlePreviewWrite = async (toolId: string, toolName: string) => {
    const endpoint = toolId === 'continue' ? '/api/connect/continue-write'
      : toolId === 'aider' ? '/api/connect/aider-write'
      : '/api/connect/opencode-write';
    
    setActiveWriterTool({ id: toolId, name: toolName, endpoint });
    setWritingStatus(null);
    setWriterPreview(null);
    try {
      const res = await fetchJson<any>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ chainName: selectedChain, execute: false }),
      });
      setWriterPreview(res);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleExecuteWrite = async () => {
    if (!activeWriterTool) return;
    setWritingStatus('writing');
    try {
      const res = await fetchJson<any>(activeWriterTool.endpoint, {
        method: 'POST',
        body: JSON.stringify({ chainName: selectedChain, execute: true }),
      });
      setWriterPreview(res);
      setWritingStatus('done');
    } catch (err: any) {
      alert(err.message);
      setWritingStatus(null);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">Connect AI Tools</h1>
          <p className="text-xs text-text-secondary mt-1">
            Pre-filled configuration snippets for your local AI coding tools and agents.
          </p>
        </div>

        {/* Chain selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Target Chain:</span>
          <select
            value={selectedChain}
            onChange={e => setSelectedChain(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono rounded bg-bg-surface border border-border-default focus:border-accent focus:outline-none text-text-primary"
          >
            {chains.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tools Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {connectData?.configs?.map((tool: any) => (
          <div
            key={tool.id}
            className="rounded-md bg-bg-surface border border-border-default overflow-hidden flex flex-col justify-between"
          >
            <div className="p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-text-primary">{tool.name}</span>
                  {tool.filename && (
                    <span className="text-[10px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-bg-base border border-border-subtle truncate max-w-[200px]">
                      {tool.filename}
                    </span>
                  )}
                </div>

                <a
                  href={tool.docUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-muted hover:text-text-primary p-1"
                  title="View tool documentation"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <p className="text-xs text-text-secondary">{tool.description}</p>

              {/* Code Snippet Box */}
              <div className="relative rounded bg-bg-base border border-border-subtle p-3 mt-2">
                <pre className="text-[11px] font-mono text-text-primary overflow-x-auto whitespace-pre leading-relaxed pr-8">
                  {tool.snippet}
                </pre>

                <button
                  onClick={() => handleCopy(tool.id, tool.snippet)}
                  className="absolute right-2 top-2 p-1.5 rounded bg-bg-raised hover:bg-bg-overlay text-text-muted hover:text-text-primary border border-border-subtle transition-colors"
                  title="Copy snippet"
                >
                  {copiedId === tool.id ? (
                    <Check className="w-3.5 h-3.5 text-status-healthy" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              <div className="text-[11px] text-text-muted pt-1">
                {tool.instructions}
              </div>
            </div>

            {/* Automated One-Click Action for OpenCode, Continue, and Aider */}
            {(tool.id === 'opencode' || tool.id === 'continue' || tool.id === 'aider') && (
              <div className="p-3 bg-bg-raised/40 border-t border-border-subtle flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">Automated Integration</span>
                <button
                  onClick={() => handlePreviewWrite(tool.id, tool.name)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors shadow-subtle"
                >
                  <FileEdit className="w-3.5 h-3.5" />
                  <span>Configure {tool.name}</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Configuration Writer Diff & Confirmation Modal */}
      {activeWriterTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setActiveWriterTool(null)} />
          <div className="relative z-10 w-full max-w-2xl rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Configure {activeWriterTool.name}</h2>

            {writerPreview ? (
              <div className="space-y-3">
                <div className="text-xs text-text-secondary">
                  Target file: <code className="font-mono text-text-primary">{writerPreview.filePath}</code>
                  {writerPreview.backupPath && (
                    <div className="text-status-healthy mt-1">
                      Backup created at: <code className="font-mono">{writerPreview.backupPath}</code>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                    Configuration Diff Preview
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded bg-bg-base border border-border-subtle p-3 text-[11px] font-mono whitespace-pre text-text-primary">
                    {writerPreview.updatedText}
                  </div>
                </div>

                {writingStatus === 'done' && (
                  <div className="p-2.5 rounded bg-status-healthy-bg border border-[rgba(47,158,68,0.25)] flex items-center gap-2 text-xs text-status-healthy">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Configuration successfully updated and backed up. {activeWriterTool.name} is now pointed at NonStop Router.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-text-muted">Loading preview...</div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setActiveWriterTool(null)}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
              >
                Close
              </button>
              {writingStatus !== 'done' && (
                <button
                  type="button"
                  onClick={handleExecuteWrite}
                  disabled={writingStatus === 'writing'}
                  className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
                >
                  {writingStatus === 'writing' ? 'Writing...' : 'Confirm & Write File'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
