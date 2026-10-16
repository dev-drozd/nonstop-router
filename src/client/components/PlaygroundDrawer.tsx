import React, { useState } from 'react';
import { useChains, useModels, fetchJson } from '../api.js';
import { ModelLogo } from './ModelLogo.js';
import { Play, X, Terminal, Clock, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n/index.js';

interface PlaygroundDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialModel?: string;
}

export const PlaygroundDrawer: React.FC<PlaygroundDrawerProps> = ({
  isOpen,
  onClose,
  initialModel = 'auto',
}) => {
  const { t } = useI18n();
  const { data: chains = [] } = useChains();
  const { data: models = [] } = useModels();

  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [prompt, setPrompt] = useState(() => t('playground.defaultPrompt'));
  const [output, setOutput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [metrics, setMetrics] = useState<{ ttftMs?: number; totalLatencyMs?: number; target?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialModel) setSelectedModel(initialModel);
  }, [initialModel]);

  if (!isOpen) return null;

  const handleRun = async () => {
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    setOutput('');
    setError(null);
    setMetrics(null);

    const start = Date.now();
    let ttft: number | undefined;

    try {
      // Use the local gateway key stashed at first run (never exposed via the admin API).
      const gatewayData = await fetchJson<any>('/api/gateway-key');
      const gatewayKey = gatewayData.rawKey;

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gatewayKey}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        if (!ttft) {
          ttft = Date.now() - start;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const chunk = JSON.parse(dataStr);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              setOutput(accumulated);
            }
          } catch {}
        }
      }

      setMetrics({
        ttftMs: ttft,
        totalLatencyMs: Date.now() - start,
        target: selectedModel,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl h-full bg-bg-surface border-l border-border-default shadow-overlay flex flex-col justify-between overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-border-default flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-accent" />
            <span className="font-semibold text-sm text-text-primary">{t('playground.title')}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-text-primary" title={t('common.close')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls & Model Select */}
        <div className="p-4 border-b border-border-subtle bg-bg-raised/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <ModelLogo modelId={selectedModel} size={20} />
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="px-2.5 py-1 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent text-text-primary flex-1"
            >
              <optgroup label={t('playground.routingChains')}>
                {chains.map(c => (
                  <option key={c.id} value={c.name}>{c.name} (Chain)</option>
                ))}
              </optgroup>
              <optgroup label={t('playground.directModels')}>
                {models.filter(m => m.enabled).map((m: any) => (
                  <option key={m.id} value={m.modelId}>
                    {m.modelId} {m.modelId.includes('free') ? '(FREE)' : ''}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <button
            onClick={handleRun}
            disabled={isLoading || !prompt.trim()}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
          >
            <Play className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? t('playground.streaming') : t('playground.runPrompt')}</span>
          </button>
        </div>

        {/* Prompt Input & Output */}
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t('playground.userPrompt')}</label>
            <textarea
              rows={3}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={t('playground.placeholder')}
              className="w-full p-2.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary resize-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-muted">{t('playground.streamedResponse')}</label>
              {metrics && (
                <div className="flex items-center gap-3 text-[11px] font-mono text-text-muted">
                  {metrics.ttftMs && <span>{t('playground.ttft', { ms: metrics.ttftMs })}</span>}
                  <span>{t('playground.total', { ms: metrics.totalLatencyMs || 0 })}</span>
                </div>
              )}
            </div>

            <div className="rounded bg-bg-base border border-border-subtle p-3 min-h-[200px] text-xs font-mono text-text-primary whitespace-pre-wrap leading-relaxed">
              {output || (
                <span className="text-text-muted italic">
                  {isLoading ? t('playground.waitingFirstToken') : t('playground.clickRunPrompt')}
                </span>
              )}
            </div>

            {error && (
              <div className="p-2.5 rounded bg-status-error-bg text-status-error text-xs flex items-center gap-2 mt-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border-default bg-bg-raised/30 flex items-center justify-between text-[11px] text-text-muted">
          <span>{t('playground.routingVia')}</span>
          <span className="text-status-healthy font-mono">200 OK</span>
        </div>
      </div>
    </div>
  );
};
