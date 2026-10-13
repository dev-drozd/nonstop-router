import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProviders } from '../api.js';
import { Radio, CheckCircle2, XCircle, Clock, Sparkles, ArrowLeft, Zap } from 'lucide-react';
import type { LiveFlowEvent } from '../App.js';

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

const SIZE = 620;
const C = SIZE / 2;
const RING_R = 205;

function formatTokens(t?: number) {
  if (!t) return '0';
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}k`;
  return String(t);
}

function ringPosition(i: number, count: number, radius = RING_R) {
  // Start at the top and go clockwise.
  const a = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
  return { x: C + radius * Math.cos(a), y: C + radius * Math.sin(a) };
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
  targetKeyId?: string | null;
  ok: boolean;
  ts: number;
}

export const FlowPage: React.FC<FlowPageProps> = ({ liveEvents }) => {
  const { data: providers = [] } = useProviders();
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const seenTs = useRef<number>(-1);
  const mounted = useRef(false);

  // Turn newly-arrived events into short-lived animated sparks.
  useEffect(() => {
    if (!mounted.current) {
      // On first mount, adopt the current head so we don't replay old history.
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

  // Expire pulses once their animation has played.
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
          keysTotal: keys.length,
          keysHealthy: keys.filter((k: any) => !k.disabled && k.status === 'healthy').length,
          status: providerStatus(keys),
          ok: h.ok,
          fail: h.fail,
          tokens: keys.reduce((s: number, k: any) => s + (k.tokensUsed || 0), 0),
          requests: keys.reduce((s: number, k: any) => s + (k.usageCount || 0), 0),
        };
      })
      .sort((a, b) => (b.ok + b.fail) - (a.ok + a.fail) || a.name.localeCompare(b.name));
  }, [providers, liveEvents]);

  const selectedProvider = useMemo(
    () => (providers as any[]).find(p => p.id === selectedProviderId) || null,
    [providers, selectedProviderId]
  );

  // Per-key session activity for the drilled-in provider.
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
  // Render helpers
  // -------------------------------------------------------------------------

  const renderSpark = (from: { x: number; y: number }, to: { x: number; y: number }, p: Pulse) => (
    <circle key={p.id} r="5" fill={p.ok ? '#2F9E44' : '#E03131'}>
      <animateMotion
        dur="0.7s"
        repeatCount="1"
        fill="freeze"
        path={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
      />
      <animate attributeName="opacity" values="0;1;1;0" dur="0.7s" repeatCount="1" fill="freeze" />
    </circle>
  );

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold text-text-primary tracking-tight">Live Routing Flow</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-accent-subtle text-accent border border-accent-border">
              <Radio className="w-3 h-3" />
              <span>REAL-TIME</span>
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            {selectedProvider
              ? <>Watching <strong className="text-text-primary">{selectedProvider.name}</strong> — each key sits in the ring; the requester is in the centre.</>
              : 'Pick a provider to open its key pool, or watch all providers at once.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedProvider && (
            <button
              onClick={() => setSelectedProviderId(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-primary text-xs font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All providers</span>
            </button>
          )}
          <select
            value={selectedProviderId || ''}
            onChange={e => setSelectedProviderId(e.target.value || null)}
            className="px-3 py-1.5 text-xs font-mono rounded bg-bg-surface border border-border-default focus:border-accent text-text-primary"
          >
            <option value="">All providers ({providerNodes.length})</option>
            {providerNodes.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.keysTotal} keys)</option>
            ))}
          </select>
        </div>
      </div>

      {providerNodes.length === 0 ? (
        <div className="p-10 rounded-md bg-bg-surface border border-border-default text-center text-sm text-text-muted">
          No providers yet. Add one on the <strong className="text-text-primary">Providers &amp; Keys</strong> page to see the live flow.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Canvas */}
          <div className="lg:col-span-2 p-4 rounded-md bg-bg-surface border border-border-default overflow-hidden">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-auto max-h-[660px]" role="img" aria-label="Live routing flow">
              <defs>
                <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
                  <stop offset="70%" stopColor="var(--color-accent)" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
                </radialGradient>
              </defs>

              <circle cx={C} cy={C} r={RING_R} fill="none" stroke="var(--color-border-subtle)" strokeWidth="1" strokeDasharray="3 7" />
              <circle cx={C} cy={C} r={RING_R + 34} fill="none" stroke="var(--color-border-subtle)" strokeWidth="1" opacity="0.4" />

              {selectedProvider
                ? /* ---------- Per-provider key ring ---------- */
                  (() => {
                    const keys = (selectedProvider.keys || []) as any[];
                    const hubR = 74;
                    const nodeR = 40;
                    const activity = (keyId: string) => keyActivity.get(keyId) || { ok: 0, fail: 0 };

                    return (
                      <>
                        {/* Edges + sparks */}
                        {keys.map((k, i) => {
                          const { x, y } = ringPosition(i, keys.length);
                          const dx = x - C, dy = y - C;
                          const len = Math.hypot(dx, dy) || 1;
                          const sx = C + (dx / len) * hubR;
                          const sy = C + (dy / len) * hubR;
                          const ex = C + (dx / len) * (RING_R - nodeR);
                          const ey = C + (dy / len) * (RING_R - nodeR);
                          const act = activity(k.id);
                          const strokes: React.ReactNode[] = [];
                          // Draw up to the last few sends for this key, tinted by outcome.
                          const keyEvents = liveEvents
                            .flatMap(ev => (ev.attempts || []).filter(a => a.keyId === k.id).map(a => a.success))
                            .slice(0, 4);
                          if (keyEvents.length === 0) {
                            strokes.push(<line key="idle" x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--color-border-strong)" strokeWidth="1.5" strokeDasharray="4 7" opacity="0.45" />);
                          } else {
                            keyEvents.forEach((ok, idx) => {
                              const jitter = (idx - (keyEvents.length - 1) / 2) * 4.5;
                              const nx = -(dy / len), ny = (dx / len);
                              strokes.push(
                                <line key={idx}
                                  x1={sx + nx * jitter} y1={sy + ny * jitter}
                                  x2={ex + nx * jitter} y2={ey + ny * jitter}
                                  stroke={ok ? '#2F9E44' : '#E03131'}
                                  strokeWidth={idx === 0 ? 3.4 : Math.max(1.3, 2.6 - idx * 0.4)}
                                  strokeLinecap="round"
                                  opacity={0.85 - idx * 0.15}
                                />
                              );
                            });
                          }
                          return <g key={k.id}>{strokes}</g>;
                        })}

                        {/* Center hub = requester */}
                        <circle cx={C} cy={C} r={hubR + 34} fill="url(#hubGlow)" />
                        <circle cx={C} cy={C} r={hubR} fill="var(--color-bg-raised)" stroke="var(--color-accent)" strokeWidth="2" />
                        <text x={C} y={C - 34} textAnchor="middle" fontSize="9" className="font-mono" fill="var(--color-text-muted)">REQUESTER</text>
                        <text x={C} y={C - 16} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-text-primary)">
                          {(latestForProvider?.clientTool || 'idle').replace('-', ' ')}
                        </text>
                        <text x={C} y={C + 2} textAnchor="middle" fontSize="9" className="font-mono" fill="var(--color-text-secondary)">
                          {(latestForProvider?.model || selectedProvider.name).slice(0, 20)}
                        </text>
                        <text x={C} y={C + 24} textAnchor="middle" fontSize="15" fontWeight="700" className="font-mono" fill="var(--color-accent)">
                          {formatTokens(keys.reduce((s: number, k: any) => s + (k.tokensUsed || 0), 0))}
                        </text>
                        <text x={C} y={C + 38} textAnchor="middle" fontSize="8" className="font-mono" fill="var(--color-text-muted)">tokens used</text>
                        <text x={C} y={C + 56} textAnchor="middle" fontSize="9" className="font-mono" fill="var(--color-text-muted)">
                          {keys.reduce((s: number, k: any) => s + (k.usageCount || 0), 0)} requests
                        </text>

                        {/* Key nodes */}
                        {keys.map((k, i) => {
                          const { x, y } = ringPosition(i, keys.length);
                          const isDisabled = Boolean(k.disabled);
                          const st: NodeStatus = isDisabled ? 'disabled' : (k.status as NodeStatus);
                          const color = STATUS_COLORS[st];
                          const act = activity(k.id);
                          const lit = act.ok + act.fail > 0;
                          return (
                            <g key={k.id}>
                              {lit && <circle cx={x} cy={y} r={nodeR + 7} fill="none" stroke={act.fail > 0 && act.ok === 0 ? '#E03131' : '#2F9E44'} strokeWidth="1.5" opacity="0.55" />}
                              <circle cx={x} cy={y} r={nodeR} fill="var(--color-bg-raised)" stroke={color} strokeWidth="2.5" />
                              <text x={x} y={y - 12} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--color-text-primary)">
                                {(k.label || 'key').length > 12 ? (k.label || 'key').slice(0, 11) + '…' : (k.label || 'key')}
                              </text>
                              <text x={x} y={y + 2} textAnchor="middle" fontSize="8" className="font-mono" fill="var(--color-text-muted)">
                                …{String(k.keyMasked || '').slice(-4)}
                              </text>
                              <text x={x} y={y + 16} textAnchor="middle" fontSize="10" fontWeight="700" className="font-mono" fill="var(--color-text-primary)">
                                {formatTokens(k.tokensUsed || 0)}
                              </text>
                              <text x={x} y={y + 27} textAnchor="middle" fontSize="8" className="font-mono" fill="var(--color-text-muted)">
                                {k.usageCount || 0} req
                              </text>
                              <text x={x} y={y + 38} textAnchor="middle" fontSize="7.5" className="font-mono" fill={color}>
                                {st === 'cooling_down' ? 'cooling' : st}
                              </text>
                            </g>
                          );
                        })}

                        {/* Sparks: center -> key */}
                        {pulses
                          .filter(p => p.providerId === selectedProvider.id)
                          .map(p => {
                            const idx = keys.findIndex((k: any) => k.id === p.keyId);
                            if (idx < 0) return null;
                            const { x, y } = ringPosition(idx, keys.length);
                            const dx = x - C, dy = y - C;
                            const len = Math.hypot(dx, dy) || 1;
                            return renderSpark(
                              { x: C + (dx / len) * hubR, y: C + (dy / len) * hubR },
                              { x: C + (dx / len) * (RING_R - nodeR), y: C + (dy / len) * (RING_R - nodeR) },
                              p
                            );
                          })}
                      </>
                    );
                  })()
                : /* ---------- All-providers ring ---------- */
                  (() => {
                    const hubR = 66;
                    const nodeR = 46;
                    return (
                      <>
                        {providerNodes.map((p, i) => {
                          const { x, y } = ringPosition(i, providerNodes.length);
                          const dx = x - C, dy = y - C;
                          const len = Math.hypot(dx, dy) || 1;
                          const sx = C + (dx / len) * hubR;
                          const sy = C + (dy / len) * hubR;
                          const ex = C + (dx / len) * (RING_R - nodeR);
                          const ey = C + (dy / len) * (RING_R - nodeR);
                          const last = liveEvents
                            .flatMap(ev => (ev.attempts || []).filter(a => a.providerId === p.id).map(a => a.success))
                            .slice(0, 4);
                          return (
                            <g key={p.id} onClick={() => setSelectedProviderId(p.id)} style={{ cursor: 'pointer' }}>
                              {last.length === 0 ? (
                                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--color-border-strong)" strokeWidth="1.5" strokeDasharray="4 7" opacity="0.5" />
                              ) : (
                                last.map((ok, idx) => {
                                  const jitter = (idx - (last.length - 1) / 2) * 5;
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
                                })
                              )}
                              <circle cx={x} cy={y} r={nodeR} fill="var(--color-bg-raised)" stroke={STATUS_COLORS[p.status]} strokeWidth="2" />
                              <text x={x} y={y - 14} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-text-primary)">
                                {p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name}
                              </text>
                              <text x={x} y={y - 1} textAnchor="middle" fontSize="8.5" className="font-mono" fill="var(--color-text-muted)">
                                {p.keysTotal} keys · {p.strategy.replace('-', ' ')}
                              </text>
                              <text x={x} y={y + 15} textAnchor="middle" fontSize="11" fontWeight="700" className="font-mono" fill={p.ok + p.fail > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)'}>
                                {p.ok + p.fail} sends
                              </text>
                              <text x={x} y={y + 29} textAnchor="middle" fontSize="8" className="font-mono" fill="var(--color-text-muted)">
                                {formatTokens(p.tokens)} tok
                              </text>
                              <text x={x} y={y + 39} textAnchor="middle" fontSize="8" fill="var(--color-accent)" opacity="0.9">click to open →</text>
                            </g>
                          );
                        })}

                        <circle cx={C} cy={C} r={hubR + 30} fill="url(#hubGlow)" />
                        <circle cx={C} cy={C} r={hubR} fill="var(--color-bg-raised)" stroke="var(--color-accent)" strokeWidth="2" />
                        <text x={C} y={C - 8} textAnchor="middle" fontSize="10" className="font-mono" fill="var(--color-text-secondary)">ROUTER</text>
                        <text x={C} y={C + 12} textAnchor="middle" fontSize="18" fontWeight="700" className="font-mono" fill="var(--color-text-primary)">{totalProviderSends}</text>
                        <text x={C} y={C + 27} textAnchor="middle" fontSize="8" className="font-mono" fill="var(--color-text-muted)">sends this session</text>

                        {pulses.map(p => {
                          const idx = providerNodes.findIndex(n => n.id === p.providerId);
                          if (idx < 0) return null;
                          const { x, y } = ringPosition(idx, providerNodes.length);
                          const dx = x - C, dy = y - C;
                          const len = Math.hypot(dx, dy) || 1;
                          return renderSpark(
                            { x: C + (dx / len) * hubR, y: C + (dy / len) * hubR },
                            { x: C + (dx / len) * (RING_R - nodeR), y: C + (dy / len) * (RING_R - nodeR) },
                            p
                          );
                        })}
                      </>
                    );
                  })()}
            </svg>
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <div className="p-4 rounded-md bg-bg-surface border border-border-default space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <Zap className="w-3.5 h-3.5 text-accent" />
                <span>{selectedProvider ? 'Last request on this provider' : 'Last request'}</span>
              </div>
              {latestForProvider ? (
                <>
                  <div className="text-[11px] font-mono text-text-secondary space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-text-muted">model</span>
                      <span className="text-text-primary">{latestForProvider.model}</span>
                      {latestForProvider.cached && <span className="px-1.5 rounded bg-accent-subtle text-accent text-[9px]">CACHE</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-muted">client</span>
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
                              <div className="text-text-muted">sent in {a.durationMs ?? '?'}ms · key …{String(a.keyId).slice(-4)}</div>
                            ) : (
                              <div className="text-status-error break-words">{a.statusCode ? `HTTP ${a.statusCode}` : 'error'}{a.error ? ` — ${a.error}` : ''}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    {(latestForProvider.attempts || []).length === 0 && (
                      <div className="text-[11px] text-text-muted italic">
                        {latestForProvider.cached ? 'Served from local cache — no upstream call.' : 'No attempts recorded.'}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-text-muted">
                  Waiting for traffic. Send a request from a connected tool or the Playground and watch it travel to a key.
                </div>
              )}
            </div>

            {selectedProvider && (
              <div className="p-4 rounded-md bg-bg-surface border border-border-default space-y-2">
                <div className="text-xs font-semibold text-text-primary">Key pool — {selectedProvider.name}</div>
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {(selectedProvider.keys || []).map((k: any) => {
                    const act = keyActivity.get(k.id) || { ok: 0, fail: 0 };
                    const st: NodeStatus = k.disabled ? 'disabled' : (k.status as NodeStatus);
                    return (
                      <div key={k.id} className={`flex items-center justify-between gap-2 p-2 rounded bg-bg-raised border border-border-subtle text-[11px] ${k.disabled ? 'opacity-60' : ''}`}>
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
                </div>
              </div>
            )}

            <div className="p-4 rounded-md bg-bg-surface border border-border-default space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span>Reading the animation</span>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                {selectedProvider
                  ? <>Each spark leaves the requester and lands on the key that served it. Green = success, red = that key returned 429/5xx and the router moved on. The number under each key is that key's own token total.</>
                  : <>The centre is the router; every edge is a provider. Choose a provider to open its key pool and see traffic land on individual keys.</>}
              </p>
              <div className="text-[10px] text-text-muted pt-1 border-t border-border-subtle">
                Showing the last {liveEvents.length} request{liveEvents.length === 1 ? '' : 's'} in this session.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};