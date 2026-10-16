import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProviders } from '../api.js';
import { Radio, CheckCircle2, XCircle, Clock, Sparkles, ArrowLeft, Zap } from 'lucide-react';
import type { LiveFlowEvent } from '../App.js';
import { useI18n } from '../i18n/index.js';

interface FlowPageProps {
  liveEvents: LiveFlowEvent[];
}

type NodeStatus = 'healthy' | 'cooling_down' | 'down' | 'probing' | 'disabled';

const STATUS_COLORS: Record<NodeStatus, string> = {
  healthy: '#2F9E44',
  cooling_down: '#F59F00',
  probing: '#4DABF7',
  down: '#E03131',
  disabled: '#807B73',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function formatTokens(t?: number) {
  if (!t) return '0';
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}k`;
  return String(t);
}

function providerStatus(keys: any[]): NodeStatus {
  const active = keys.filter(k => !k.disabled);
  if (active.length === 0) return keys.length ? 'disabled' : 'down';
  if (active.some(k => k.status === 'healthy')) return 'healthy';
  if (active.some(k => k.status === 'probing')) return 'probing';
  if (active.some(k => k.status === 'cooling_down')) return 'cooling_down';
  return 'down';
}

interface Pulse {
  id: number;
  providerId: string;
  keyId: string;
  ok: boolean;
  ts: number;
}

/** Measures a container so all geometry can be derived from actual available space. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 720, h: 620 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setSize({ w: Math.round(rect.width), h: Math.round(rect.height || rect.width) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

export const FlowPage: React.FC<FlowPageProps> = ({ liveEvents }) => {
  const { t } = useI18n();
  const { data: providers = [] } = useProviders();
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const seenTs = useRef<number>(-1);
  const mounted = useRef(false);

  const { ref: canvasRef, size } = useElementSize<HTMLDivElement>();

  // New events -> short-lived animated sparks.
  useEffect(() => {
    if (!mounted.current) {
      seenTs.current = liveEvents[0]?.timestamp ?? Date.now();
      mounted.current = true;
      return;
    }
    const fresh = liveEvents.filter(e => e.timestamp > seenTs.current);
    if (fresh.length === 0) return;
    seenTs.current = Math.max(...fresh.map(e => e.timestamp));
    const next: Pulse[] = [];
    for (const e of fresh) {
      for (const a of e.attempts || []) {
        next.push({ id: Math.random(), providerId: a.providerId, keyId: a.keyId, ok: a.success, ts: Date.now() });
      }
    }
    if (next.length) setPulses(prev => [...prev, ...next].slice(-60));
  }, [liveEvents]);

  useEffect(() => {
    if (pulses.length === 0) return;
    const timer = setTimeout(() => setPulses(prev => prev.filter(p => Date.now() - p.ts < 900)), 950);
    return () => clearTimeout(timer);
  }, [pulses]);

  const providerNodes = useMemo(() => {
    const hits = new Map<string, { ok: number; fail: number }>();
    for (const ev of liveEvents) {
      for (const a of ev.attempts || []) {
        const cur = hits.get(a.providerId) || { ok: 0, fail: 0 };
        a.success ? cur.ok++ : cur.fail++;
        hits.set(a.providerId, cur);
      }
    }
    return (providers as any[])
      .map(p => {
        const keys = p.keys || [];
        const h = hits.get(p.id) || { ok: 0, fail: 0 };
        return {
          id: p.id,
          name: p.name,
          protocol: p.protocol,
          strategy: p.selectionStrategy,
          keys,
          activeKeys: keys.filter((k: any) => !k.disabled),
          keysTotal: keys.length,
          keysActive: keys.filter((k: any) => !k.disabled).length,
          status: providerStatus(keys),
          ok: h.ok,
          fail: h.fail,
          tokens: keys.filter((k: any) => !k.disabled).reduce((s: number, k: any) => s + (k.tokensUsed || 0), 0),
          requests: keys.filter((k: any) => !k.disabled).reduce((s: number, k: any) => s + (k.usageCount || 0), 0),
        };
      })
      .sort((a, b) => (b.ok + b.fail) - (a.ok + a.fail) || a.name.localeCompare(b.name));
  }, [providers, liveEvents]);

  const selectedProvider = useMemo(
    () => (providers as any[]).find(p => p.id === selectedProviderId) || null,
    [providers, selectedProviderId]
  );

  const keyActivity = useMemo(() => {
    const m = new Map<string, { ok: number; fail: number }>();
    if (!selectedProvider) return m;
    for (const ev of liveEvents) {
      for (const a of ev.attempts || []) {
        if (a.providerId !== selectedProvider.id) continue;
        const cur = m.get(a.keyId) || { ok: 0, fail: 0 };
        a.success ? cur.ok++ : cur.fail++;
        m.set(a.keyId, cur);
      }
    }
    return m;
  }, [liveEvents, selectedProvider]);

  const latest = liveEvents[0];
  const latestForProvider = selectedProvider
    ? liveEvents.find(ev => (ev.attempts || []).some(a => a.providerId === selectedProvider.id)) || null
    : latest;

  const totalProviderSends = providerNodes.reduce((s, n) => s + n.ok + n.fail, 0);

  // -------------------------------------------------------------------------
  // Responsive geometry
  // -------------------------------------------------------------------------
  const W = size.w;
  const H = size.h;
  const cx = W / 2;
  const cy = H / 2;

  /**
   * Computes ring/node radii from the measured canvas so the diagram always
   * fits: nodes never overlap and the whole ring stays inside the box.
   */
  const layout = (count: number, kind: 'provider' | 'key') => {
    const n = Math.max(1, count);
    const pad = 20; // breathing room from the canvas edge
    const usable = Math.max(80, Math.min(W, H) / 2 - pad);
    const minNode = kind === 'key' ? 26 : 24;
    const maxNode = kind === 'key' ? 80 : 76;
    // No overlap around the ring: required arc per node > its diameter.
    const spacing = 1.18;
    const fit = usable / ((n * spacing) / Math.PI + 1);
    const nodeR = clamp(fit, minNode, maxNode);
    // Ring radius: shrink the usable area by the node radius so nodes stay inside.
    const ringR = clamp(usable - nodeR, nodeR + 40, usable);
    const hubR = clamp(Math.min(nodeR * 0.98, ringR - nodeR - 26), 44, 122);
    const scale = clamp(nodeR / 62, 0.7, 1.15);
    return { ringR, hubR, nodeR, scale };
  };

  const ringPosition = (i: number, count: number, radius: number) => {
    const a = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  };

  const renderSpark = (from: { x: number; y: number }, to: { x: number; y: number }, p: Pulse, r: number) => (
    <circle key={p.id} r={Math.max(4, r * 0.09)} fill={p.ok ? '#2F9E44' : '#E03131'}>
      <animateMotion dur="0.7s" repeatCount="1" fill="freeze" path={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} />
      <animate attributeName="opacity" values="0;1;1;0" dur="0.7s" repeatCount="1" fill="freeze" />
    </circle>
  );

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 w-full max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg sm:text-xl font-semibold text-text-primary tracking-tight">{t('flow.liveRoutingFlow')}</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-accent-subtle text-accent border border-accent-border">
              <Radio className="w-3 h-3" />
              <span>{t('flow.realTime')}</span>
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            {selectedProvider
              ? <>{t('flow.watchingProvider', { name: selectedProvider.name })}</>
              : t('flow.pickProvider')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedProvider && (
            <button
              onClick={() => setSelectedProviderId(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-primary text-xs font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t('flow.allProvidersBtn')}</span>
            </button>
          )}
          <select
            value={selectedProviderId || ''}
            onChange={e => setSelectedProviderId(e.target.value || null)}
            className="px-3 py-1.5 text-xs font-mono rounded bg-bg-surface border border-border-default focus:border-accent text-text-primary"
          >
            <option value="">{t('flow.allProvidersOption', { count: providerNodes.length })}</option>
            {providerNodes.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.keysActive}/{p.keysTotal} {t('flow.keys')})</option>
            ))}
          </select>
        </div>
      </div>

      {providerNodes.length === 0 ? (
        <div className="p-10 rounded-md bg-bg-surface border border-border-default text-center text-sm text-text-muted">
          {t('flow.noProvidersMessage')}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Canvas — measures itself and scales */}
          <div
            ref={canvasRef}
            className="xl:col-span-3 rounded-md bg-bg-surface border border-border-default overflow-hidden w-full"
            style={{ height: 'clamp(420px, 68vh, 900px)' }}
          >
            <svg width={W} height={H} className="block" role="img" aria-label="Live routing flow">
              <defs>
                <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
                  <stop offset="70%" stopColor="var(--color-accent)" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
                </radialGradient>
              </defs>

              {selectedProvider
                ? (() => {
                    const keys: any[] = (selectedProvider.keys || []).filter((k: any) => !k.disabled);
                    const { ringR, hubR, nodeR, scale } = layout(keys.length, 'key');
                    const activity = (keyId: string) => keyActivity.get(keyId) || { ok: 0, fail: 0 };
                    const totalTok = keys.reduce((s: number, k: any) => s + (k.tokensUsed || 0), 0);
                    const totalReq = keys.reduce((s: number, k: any) => s + (k.usageCount || 0), 0);

                    return (
                      <>
                        <circle cx={cx} cy={cy} r={ringR} fill="none" stroke="var(--color-border-subtle)" strokeWidth="1" strokeDasharray="3 7" />

                        {/* Edges */}
                        {keys.map((k, i) => {
                          const { x, y } = ringPosition(i, keys.length, ringR);
                          const dx = x - cx, dy = y - cy;
                          const len = Math.hypot(dx, dy) || 1;
                          const sx = cx + (dx / len) * hubR;
                          const sy = cy + (dy / len) * hubR;
                          const ex = cx + (dx / len) * (ringR - nodeR);
                          const ey = cy + (dy / len) * (ringR - nodeR);
                          const keyEvents = liveEvents
                            .flatMap(ev => (ev.attempts || []).filter(a => a.keyId === k.id).map(a => a.success))
                            .slice(0, 4);
                          return (
                            <g key={k.id}>
                              {keyEvents.length === 0 ? (
                                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--color-border-strong)" strokeWidth="1.5" strokeDasharray="4 7" opacity="0.45" />
                              ) : keyEvents.map((ok, idx) => {
                                const jitter = (idx - (keyEvents.length - 1) / 2) * (nodeR * 0.06);
                                const nx = -(dy / len), ny = (dx / len);
                                return (
                                  <line key={idx}
                                    x1={sx + nx * jitter} y1={sy + ny * jitter}
                                    x2={ex + nx * jitter} y2={ey + ny * jitter}
                                    stroke={ok ? '#2F9E44' : '#E03131'}
                                    strokeWidth={idx === 0 ? 3.4 : Math.max(1.3, 2.6 - idx * 0.4)}
                                    strokeLinecap="round"
                                    opacity={0.85 - idx * 0.15}
                                  />
                                );
                              })}
                            </g>
                          );
                        })}

                        {/* Centre hub = requester */}
                        <circle cx={cx} cy={cy} r={hubR + 40} fill="url(#hubGlow)" />
                        <circle cx={cx} cy={cy} r={hubR} fill="var(--color-bg-raised)" stroke="var(--color-accent)" strokeWidth="2.5" />
                        <text x={cx} y={cy - hubR * 0.52} textAnchor="middle" fontSize={11} className="font-mono" letterSpacing="2" fill="var(--color-text-muted)">REQUESTER</text>
                        <text x={cx} y={cy - hubR * 0.24} textAnchor="middle" fontSize={16} fontWeight="700" fill="var(--color-text-primary)">
                          {(latestForProvider?.clientTool || 'idle').replace('-', ' ')}
                        </text>
                        <text x={cx} y={cy - hubR * 0.04} textAnchor="middle" fontSize={11} className="font-mono" fill="var(--color-text-secondary)">
                          {(() => { const m = latestForProvider?.model || selectedProvider.name; return m.length > 24 ? m.slice(0, 23) + '…' : m; })()}
                        </text>
                        <text x={cx} y={cy + hubR * 0.36} textAnchor="middle" fontSize={24} fontWeight="700" className="font-mono" fill="var(--color-accent)">
                          {formatTokens(totalTok)}
                        </text>
                        <text x={cx} y={cy + hubR * 0.55} textAnchor="middle" fontSize={10.5} className="font-mono" fill="var(--color-text-muted)">{t('flow.tokensUsed')}</text>
                        <text x={cx} y={cy + hubR * 0.78} textAnchor="middle" fontSize={11.5} fontWeight="600" className="font-mono" fill="var(--color-text-secondary)">
                          {totalReq} {t('flow.requests')}
                        </text>

                        {/* Key nodes (disabled keys excluded) */}
                        {keys.map((k, i) => {
                          const { x, y } = ringPosition(i, keys.length, ringR);
                          const st = k.status as NodeStatus;
                          const color = STATUS_COLORS[st];
                          const act = activity(k.id);
                          const lit = act.ok + act.fail > 0;
                          return (
                            <g key={k.id}>
                              {lit && <circle cx={x} cy={y} r={nodeR + 8} fill="none" stroke={act.fail > 0 && act.ok === 0 ? '#E03131' : '#2F9E44'} strokeWidth="2" opacity="0.5" />}
                              <circle cx={x} cy={y} r={nodeR} fill="var(--color-bg-surface)" stroke={color} strokeWidth="2.5" />
                              <text x={x} y={y - nodeR * 0.46} textAnchor="middle" fontSize={12 * scale} fontWeight="600" fill="var(--color-text-primary)">
                                {(() => { const l = k.label || t('flow.key'); const max = Math.max(6, Math.floor(nodeR / 5)); return l.length > max ? l.slice(0, max - 1) + '…' : l; })()}
                              </text>
                              <text x={x} y={y - nodeR * 0.22} textAnchor="middle" fontSize={9.5 * scale} className="font-mono" fill="var(--color-text-muted)">
                                …{String(k.keyMasked || '').slice(-4)}
                              </text>
                              <text x={x} y={y + nodeR * 0.12} textAnchor="middle" fontSize={15 * scale} fontWeight="700" className="font-mono" fill="var(--color-text-primary)">
                                {formatTokens(k.tokensUsed || 0)}
                              </text>
                              <text x={x} y={y + nodeR * 0.32} textAnchor="middle" fontSize={9 * scale} className="font-mono" fill="var(--color-text-muted)">{t('flow.tokens')}</text>
                              <text x={x} y={y + nodeR * 0.56} textAnchor="middle" fontSize={10 * scale} className="font-mono" fill="var(--color-text-secondary)">
                                {k.usageCount || 0} {t('flow.requests')}
                              </text>
                              <text x={x} y={y + nodeR * 0.78} textAnchor="middle" fontSize={9 * scale} className="font-mono" fontWeight="600" fill={color}>
                                {st === 'cooling_down' ? t('flow.cooling') : t(`status.${st}`)}
                              </text>
                            </g>
                          );
                        })}

                        {/* Sparks */}
                        {pulses.filter(p => p.providerId === selectedProvider.id).map(p => {
                          const idx = keys.findIndex((k: any) => k.id === p.keyId);
                          if (idx < 0) return null;
                          const { x, y } = ringPosition(idx, keys.length, ringR);
                          const dx = x - cx, dy = y - cy;
                          const len = Math.hypot(dx, dy) || 1;
                          return renderSpark(
                            { x: cx + (dx / len) * hubR, y: cy + (dy / len) * hubR },
                            { x: cx + (dx / len) * (ringR - nodeR), y: cy + (dy / len) * (ringR - nodeR) },
                            p, nodeR
                          );
                        })}
                      </>
                    );
                  })()
                : (() => {
                    const nodes = providerNodes;
                    const { ringR, hubR, nodeR, scale } = layout(nodes.length, 'provider');
                    return (
                      <>
                        <circle cx={cx} cy={cy} r={ringR} fill="none" stroke="var(--color-border-subtle)" strokeWidth="1" strokeDasharray="3 7" />

                        {nodes.map((p, i) => {
                          const { x, y } = ringPosition(i, nodes.length, ringR);
                          const dx = x - cx, dy = y - cy;
                          const len = Math.hypot(dx, dy) || 1;
                          const sx = cx + (dx / len) * hubR;
                          const sy = cy + (dy / len) * hubR;
                          const ex = cx + (dx / len) * (ringR - nodeR);
                          const ey = cy + (dy / len) * (ringR - nodeR);
                          const last = liveEvents
                            .flatMap(ev => (ev.attempts || []).filter(a => a.providerId === p.id).map(a => a.success))
                            .slice(0, 4);
                          return (
                            <g key={p.id} onClick={() => setSelectedProviderId(p.id)} style={{ cursor: 'pointer' }}>
                              {last.length === 0 ? (
                                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--color-border-strong)" strokeWidth="1.5" strokeDasharray="4 7" opacity="0.5" />
                              ) : last.map((ok, idx) => {
                                const jitter = (idx - (last.length - 1) / 2) * (nodeR * 0.08);
                                const nx = -(dy / len), ny = (dx / len);
                                return (
                                  <line key={idx}
                                    x1={sx + nx * jitter} y1={sy + ny * jitter}
                                    x2={ex + nx * jitter} y2={ey + ny * jitter}
                                    stroke={ok ? '#2F9E44' : '#E03131'}
                                    strokeWidth={idx === 0 ? 3.6 : Math.max(1.3, 2.6 - idx * 0.4)}
                                    strokeLinecap="round"
                                    opacity={0.85 - idx * 0.15}
                                  />
                                );
                              })}
                              <circle cx={x} cy={y} r={nodeR} fill="var(--color-bg-raised)" stroke={STATUS_COLORS[p.status]} strokeWidth="2.5" />
                              <text x={x} y={y - nodeR * 0.42} textAnchor="middle" fontSize={12.5 * scale} fontWeight="600" fill="var(--color-text-primary)">
                                {(() => { const max = Math.max(8, Math.floor(nodeR / 4.5)); return p.name.length > max ? p.name.slice(0, max - 1) + '…' : p.name; })()}
                              </text>
                              <text x={x} y={y - nodeR * 0.16} textAnchor="middle" fontSize={9.5 * scale} className="font-mono" fill="var(--color-text-muted)">
                                {p.keysActive}/{p.keysTotal} {t('flow.keys')} · {p.strategy.replace('-', ' ')}
                              </text>
                              <text x={x} y={y + nodeR * 0.22} textAnchor="middle" fontSize={16 * scale} fontWeight="700" className="font-mono" fill={p.ok + p.fail > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)'}>
                                {p.ok + p.fail}
                              </text>
                              <text x={x} y={y + nodeR * 0.42} textAnchor="middle" fontSize={9 * scale} className="font-mono" fill="var(--color-text-muted)">{t('flow.sends')}</text>
                              <text x={x} y={y + nodeR * 0.68} textAnchor="middle" fontSize={10 * scale} className="font-mono" fill="var(--color-text-secondary)">
                                {formatTokens(p.tokens)} tok
                              </text>
                            </g>
                          );
                        })}

                        <circle cx={cx} cy={cy} r={hubR + 30} fill="url(#hubGlow)" />
                        <circle cx={cx} cy={cy} r={hubR} fill="var(--color-bg-raised)" stroke="var(--color-accent)" strokeWidth="2" />
                        <text x={cx} y={cy - hubR * 0.12} textAnchor="middle" fontSize={11} className="font-mono" letterSpacing="2" fill="var(--color-text-secondary)">{t('flow.router')}</text>
                        <text x={cx} y={cy + hubR * 0.34} textAnchor="middle" fontSize={22} fontWeight="700" className="font-mono" fill="var(--color-text-primary)">{totalProviderSends}</text>
                        <text x={cx} y={cy + hubR * 0.60} textAnchor="middle" fontSize={9} className="font-mono" fill="var(--color-text-muted)">{t('flow.sendsThisSession')}</text>

                        {pulses.map(p => {
                          const idx = nodes.findIndex(n => n.id === p.providerId);
                          if (idx < 0) return null;
                          const { x, y } = ringPosition(idx, nodes.length, ringR);
                          const dx = x - cx, dy = y - cy;
                          const len = Math.hypot(dx, dy) || 1;
                          return renderSpark(
                            { x: cx + (dx / len) * hubR, y: cy + (dy / len) * hubR },
                            { x: cx + (dx / len) * (ringR - nodeR), y: cy + (dy / len) * (ringR - nodeR) },
                            p, nodeR
                          );
                        })}
                      </>
                    );
                  })()}
            </svg>
          </div>

          {/* Side panel */}
          <div className="space-y-4 xl:col-span-1">
            <div className="p-4 rounded-md bg-bg-surface border border-border-default space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <Zap className="w-3.5 h-3.5 text-accent" />
                <span>{selectedProvider ? t('flow.lastRequestProvider') : t('flow.lastRequest')}</span>
              </div>
              {latestForProvider ? (
                <>
                  <div className="text-[11px] font-mono text-text-secondary space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-text-muted">{t('flow.model')}</span>
                      <span className="text-text-primary break-all">{latestForProvider.model}</span>
                      {latestForProvider.cached && <span className="px-1.5 rounded bg-accent-subtle text-accent text-[9px]">{t('flow.cacheBadge')}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-text-muted">{t('flow.client')}</span>
                      <span className="text-text-primary">{latestForProvider.clientTool}</span>
                      <Clock className="w-3 h-3" />
                      <span className="text-text-primary">{latestForProvider.latencyMs}ms</span>
                      {latestForProvider.ttftMs != null && <span className="text-text-muted">ttft {latestForProvider.ttftMs}ms</span>}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    {(latestForProvider.attempts || [])
                      .filter(a => !selectedProvider || a.providerId === selectedProvider.id)
                      .map((a, i) => (
                        <div key={i} className={`flex items-start gap-2 text-[11px] p-2 rounded border ${a.success ? 'bg-status-healthy-bg border-[rgba(47,158,68,0.25)]' : 'bg-[var(--color-error-bg)] border-[rgba(224,49,49,0.25)]'}`}>
                          {a.success ? <CheckCircle2 className="w-3.5 h-3.5 text-status-healthy shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-status-error shrink-0 mt-0.5" />}
                          <div className="min-w-0">
                            <div className="font-mono text-text-primary truncate">{a.providerName} · {a.modelId}</div>
                            {a.success ? (
                              <div className="text-text-muted">{t('flow.sentIn', { ms: a.durationMs ?? '?', key: String(a.keyId).slice(-4) })}</div>
                            ) : (
                              <div className="text-status-error break-words">{a.statusCode ? `HTTP ${a.statusCode}` : 'error'}{a.error ? ` — ${a.error}` : ''}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    {(latestForProvider.attempts || []).length === 0 && (
                      <div className="text-[11px] text-text-muted italic">
                        {latestForProvider.cached ? t('flow.servedFromCache') : t('flow.noAttemptsRecorded')}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-text-muted">
                  {t('flow.waitingTraffic')}
                </div>
              )}
            </div>

            {selectedProvider && (
              <div className="p-4 rounded-md bg-bg-surface border border-border-default space-y-2">
                <div className="text-xs font-semibold text-text-primary">{t('flow.activeKeyPool', { name: selectedProvider.name })}</div>
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {(selectedProvider.keys || []).filter((k: any) => !k.disabled).map((k: any) => {
                    const act = keyActivity.get(k.id) || { ok: 0, fail: 0 };
                    const st = k.status as NodeStatus;
                    return (
                      <div key={k.id} className="flex items-center justify-between gap-2 p-2 rounded bg-bg-raised border border-border-subtle text-[11px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLORS[st] }} />
                          <span className="font-mono text-text-primary truncate">{k.label}</span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-text-muted shrink-0">
                          <span>{formatTokens(k.tokensUsed || 0)} tok</span>
                          <span>{k.usageCount || 0} req</span>
                          {act.ok + act.fail > 0 && <span className="text-accent">{act.ok + act.fail} live</span>}
                        </div>
                      </div>
                    );
                  })}
                  {(selectedProvider.keys || []).filter((k: any) => !k.disabled).length === 0 && (
                    <div className="text-[11px] text-text-muted italic">{t('flow.noActiveKeys')}</div>
                  )}
                </div>
              </div>
            )}

            <div className="p-4 rounded-md bg-bg-surface border border-border-default space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span>{t('flow.readingAnimation')}</span>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {selectedProvider
                  ? t('flow.readingAnimationProvider')
                  : t('flow.readingAnimationRouter')}
              </p>
              <div className="text-[10px] text-text-muted pt-1 border-t border-border-subtle">
                {liveEvents.length === 1
                  ? t('flow.showingLastRequests', { count: liveEvents.length })
                  : t('flow.showingLastRequestsPlural', { count: liveEvents.length })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};