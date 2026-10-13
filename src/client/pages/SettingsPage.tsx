import React, { useState } from 'react';
import { useSettings, useGatewayKeys, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { Sliders, Key, Plus, Trash2, Copy, Check, ShieldAlert, Download, Upload, CheckCircle2 } from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useSettings();
  const { data: gatewayKeys = [] } = useGatewayKeys();

  // Settings form state
  const [defaultTimeout, setDefaultTimeout] = useState(settings?.defaultRequestTimeoutMs || 60000);
  const [cooldownBase, setCooldownBase] = useState(settings?.cooldownBaseMs || 30000);
  const [cooldownMax, setCooldownMax] = useState(settings?.cooldownMaxMs || 300000);
  const [probeInterval, setProbeInterval] = useState(settings?.healthProbeIntervalMs || 30000);
  const [restartMidstream, setRestartMidstream] = useState(settings?.restartOnMidstreamFailure || false);
  const [logRetention, setLogRetention] = useState(settings?.logRetentionDays || 7);
  const [storePayloads, setStorePayloads] = useState<boolean>(settings?.storePayloads ?? false);
  const [allowLan, setAllowLan] = useState(settings?.allowLan || false);
  const [enableCache, setEnableCache] = useState(settings?.enableCache ?? true);
  const [cacheTtlMs, setCacheTtlMs] = useState(settings?.cacheTtlMs ?? 86400000);
  const [cacheMaxEntries, setCacheMaxEntries] = useState(settings?.cacheMaxEntries ?? 2000);
  const [enablePromptOptimizer, setEnablePromptOptimizer] = useState(settings?.enablePromptOptimizer ?? false);
  const [enableRateGovernor, setEnableRateGovernor] = useState(settings?.enableRateGovernor ?? true);
  const [rateGovernorRpm, setRateGovernorRpm] = useState(settings?.rateGovernorRpm ?? 25);
  const [chainAutoPolicy, setChainAutoPolicy] = useState<'free_only' | 'free_first' | 'all'>(settings?.chainAutoPolicy || 'free_only');

  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  // New gateway key modal
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('Coding Key');
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  React.useEffect(() => {
    if (settings) {
      setDefaultTimeout(settings.defaultRequestTimeoutMs);
      setCooldownBase(settings.cooldownBaseMs);
      setCooldownMax(settings.cooldownMaxMs);
      setProbeInterval(settings.healthProbeIntervalMs);
      setRestartMidstream(settings.restartOnMidstreamFailure);
      setLogRetention(settings.logRetentionDays);
      setStorePayloads(settings.storePayloads);
      setAllowLan(settings.allowLan);
      setEnableCache(settings.enableCache ?? true);
      setCacheTtlMs(settings.cacheTtlMs ?? 86400000);
      setCacheMaxEntries(settings.cacheMaxEntries ?? 2000);
      setEnablePromptOptimizer(settings.enablePromptOptimizer ?? false);
      setEnableRateGovernor(settings.enableRateGovernor ?? true);
      setRateGovernorRpm(settings.rateGovernorRpm ?? 25);
      setChainAutoPolicy(settings.chainAutoPolicy || 'free_only');
    }
  }, [settings]);

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await fetchJson('/api/cache', { method: 'DELETE' });
      alert('Local response cache cleared successfully.');
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(`Error clearing cache: ${err.message}`);
    } finally {
      setClearingCache(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSaveSuccess(false);
    try {
      await fetchJson('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          defaultRequestTimeoutMs: Number(defaultTimeout),
          cooldownBaseMs: Number(cooldownBase),
          cooldownMaxMs: Number(cooldownMax),
          healthProbeIntervalMs: Number(probeInterval),
          restartOnMidstreamFailure: Boolean(restartMidstream),
          logRetentionDays: Number(logRetention),
          storePayloads: Boolean(storePayloads),
          allowLan: Boolean(allowLan),
          enableCache: Boolean(enableCache),
          cacheTtlMs: Number(cacheTtlMs),
          cacheMaxEntries: Number(cacheMaxEntries),
          enablePromptOptimizer: Boolean(enablePromptOptimizer),
          enableRateGovernor: Boolean(enableRateGovernor),
          rateGovernorRpm: Number(rateGovernorRpm),
          chainAutoPolicy,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['settings'] });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreateGatewayKey = async () => {
    try {
      const res = await fetchJson<any>('/api/gateway-keys', {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName }),
      });
      queryClient.invalidateQueries({ queryKey: ['gateway-keys'] });
      setCreatedRawKey(res.rawKey);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteGatewayKey = async (id: string) => {
    if (!confirm('Revoke this gateway API key? Tools using this key will immediately receive 401 Unauthorized.')) return;
    try {
      await fetchJson(`/api/gateway-keys/${id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['gateway-keys'] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCopyRawKey = () => {
    if (!createdRawKey) return;
    navigator.clipboard.writeText(createdRawKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">Gateway Settings</h1>
        <p className="text-xs text-text-secondary mt-1">
          Tune routing timeouts, health probe cadences, security settings, and local gateway keys.
        </p>
      </div>

      {/* Gateway Keys Card */}
      <div className="p-5 rounded-md bg-bg-surface border border-border-default space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Local Gateway API Keys</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Client tools (Claude Code, OpenCode, Codex) must provide one of these keys to access the gateway.
            </p>
          </div>
          <button
            onClick={() => {
              setShowKeyModal(true);
              setCreatedRawKey(null);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors shadow-subtle"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate Key</span>
          </button>
        </div>

        <div className="space-y-2">
          {gatewayKeys.map((k: any) => (
            <div
              key={k.id}
              className="p-3 rounded bg-bg-raised border border-border-subtle flex items-center justify-between gap-3"
            >
              <div>
                <div className="text-xs font-medium text-text-primary">{k.name}</div>
                <div className="text-[11px] font-mono text-text-muted mt-0.5">
                  {k.key_masked} &bull; Created: {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && <span> &bull; Last used: {new Date(k.last_used_at).toLocaleTimeString()}</span>}
                </div>
              </div>

              <button
                onClick={() => handleDeleteGatewayKey(k.id)}
                className="p-1 rounded hover:bg-bg-overlay text-text-muted hover:text-status-error transition-colors"
                title="Revoke key"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Router Engine Settings Form */}
      <form onSubmit={handleSaveSettings} className="p-5 rounded-md bg-bg-surface border border-border-default space-y-6">
        <h2 className="text-sm font-semibold text-text-primary">Routing & Probing Engine</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Default Request Timeout (ms)
            </label>
            <input
              type="number"
              value={defaultTimeout}
              onChange={e => setDefaultTimeout(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">Timeout before switching to next fallback target.</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Background Health Probe Interval (ms)
            </label>
            <input
              type="number"
              value={probeInterval}
              onChange={e => setProbeInterval(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">Cadence for probing down targets.</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Cooldown Base (ms)
            </label>
            <input
              type="number"
              value={cooldownBase}
              onChange={e => setCooldownBase(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">Initial backoff duration after HTTP 429/5xx.</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Cooldown Maximum Cap (ms)
            </label>
            <input
              type="number"
              value={cooldownMax}
              onChange={e => setCooldownMax(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">Maximum exponential backoff limit.</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Auto-Chain Model Policy (Default Failover Behavior)
            </label>
            <select
              value={chainAutoPolicy}
              onChange={e => setChainAutoPolicy(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary cursor-pointer"
            >
              <option value="free_only">100% Free Tier Only (Guaranteed $0 - Default)</option>
              <option value="free_first">Free First + Paid Fallback (Emergency Safety Net)</option>
              <option value="all">All Models (Include Paid)</option>
            </select>
            <span className="text-[11px] text-text-muted">
              Guarantees failover chains prioritize free endpoints, preventing unexpected credit consumption and 402 errors.
            </span>
          </div>
        </div>

        {/* Checkbox Toggles */}
        <div className="space-y-4 pt-2 border-t border-border-subtle">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enableCache}
              onChange={e => setEnableCache(e.target.checked)}
              className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
            />
            <div>
              <div className="text-xs font-medium text-text-primary">Enable Local Response Cache (identical prompts only)</div>
              <div className="text-[11px] text-text-muted">
                Exact-match cache keyed on messages, model, and all sampling parameters (temperature, top_p, max_tokens, seed, tools).
                Repeat requests return in &lt;5ms at $0 cost with no upstream rate-limit usage.
              </div>
            </div>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-7">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Cache TTL (ms)</label>
              <input
                type="number"
                value={cacheTtlMs}
                onChange={e => setCacheTtlMs(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
              />
              <span className="text-[11px] text-text-muted">Entries older than this are evicted.</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Max Cache Entries</label>
              <input
                type="number"
                value={cacheMaxEntries}
                onChange={e => setCacheMaxEntries(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
              />
              <span className="text-[11px] text-text-muted">Least-recently-used entries are evicted first.</span>
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enablePromptOptimizer}
              onChange={e => setEnablePromptOptimizer(e.target.checked)}
              className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
            />
            <div>
              <div className="text-xs font-medium text-text-primary">Enable Prompt Token Optimizer (lossy)</div>
              <div className="text-[11px] text-text-muted">
                Off by default. Collapses redundant whitespace and build logs and de-duplicates large code blocks repeated
                across older turns. Never modifies the two most recent turns or system prompts.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enableRateGovernor}
              onChange={e => setEnableRateGovernor(e.target.checked)}
              className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
            />
            <div>
              <div className="text-xs font-medium text-text-primary">Enable Smart Rate-Limit Governor</div>
              <div className="text-[11px] text-text-muted">
                Tracks a rolling requests-per-minute window per key and rotates to a sibling key before the upstream
                provider returns HTTP 429.
              </div>
            </div>
          </label>

          <div className="pl-7">
            <label className="block text-xs font-medium text-text-secondary mb-1">Rate Governor Ceiling (requests / minute / key)</label>
            <input
              type="number"
              value={rateGovernorRpm}
              onChange={e => setRateGovernorRpm(Number(e.target.value))}
              className="w-full md:w-64 px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">Conservative default of 25 RPM suits most free tiers.</span>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={restartMidstream}
              onChange={e => setRestartMidstream(e.target.checked)}
              className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
            />
            <div>
              <div className="text-xs font-medium text-text-primary">Restart on Mid-Stream Failure</div>
              <div className="text-[11px] text-text-muted">
                Off by default. When enabled, if an upstream stream dies after tokens were already emitted, the router restarts the full request on the fallback target instead of sending a stream error event.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={storePayloads}
              onChange={e => setStorePayloads(e.target.checked)}
              className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
            />
            <div>
              <div className="text-xs font-medium text-text-primary">Store Request & Response Payloads in Logs</div>
              <div className="text-[11px] text-text-muted">
                Off by default for privacy. Only store prompt and completion bodies when debugging prompts locally.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer p-3 rounded bg-bg-raised border border-border-subtle">
            <input
              type="checkbox"
              checked={allowLan}
              onChange={e => setAllowLan(e.target.checked)}
              className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
            />
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                <span>Allow Local Network Access (LAN)</span>
                <span className="px-1.5 py-0.2 rounded bg-status-warning-bg text-status-warning text-[10px]">
                  Security Warning
                </span>
              </div>
              <div className="text-[11px] text-text-muted mt-0.5">
                Binds to 0.0.0.0 instead of 127.0.0.1. Other devices on your local network will be able to access the gateway port.
              </div>
            </div>
          </label>
        </div>

        {/* Cache Maintenance Box */}
        <div className="pt-4 border-t border-border-subtle flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-text-primary">Response Cache Maintenance</div>
            <div className="text-[11px] text-text-muted">Flush all cached completions if upstream model behavior changed.</div>
          </div>
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearingCache}
            className="px-3 py-1.5 text-xs font-medium rounded bg-bg-base hover:bg-bg-raised border border-border-default text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            {clearingCache ? 'Clearing...' : 'Clear Cache'}
          </button>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
          {saveSuccess ? (
            <div className="flex items-center gap-1.5 text-xs text-status-healthy">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Settings saved successfully</span>
            </div>
          ) : <div />}

          <button
            type="submit"
            disabled={savingSettings}
            className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
          >
            {savingSettings ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      {/* Generate Gateway Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowKeyModal(false)} />
          <div className="relative z-10 w-full max-w-md rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Create Local Gateway Key</h2>

            {!createdRawKey ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Key Name / Label</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={e => setNewKeyName(e.target.value)}
                    placeholder="e.g. Claude Code Key"
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowKeyModal(false)}
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateGatewayKey}
                    className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors"
                  >
                    Generate
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 rounded bg-status-healthy-bg border border-[rgba(47,158,68,0.25)] text-xs text-text-primary">
                  <div className="font-semibold text-status-healthy mb-1">Key Generated Successfully!</div>
                  Copy this key now. For your security, the gateway stores only a cryptographic hash and will not display the key again.
                </div>

                <div className="relative rounded bg-bg-base border border-border-subtle p-3">
                  <div className="font-mono text-xs text-text-primary select-all break-all pr-8">
                    {createdRawKey}
                  </div>
                  <button
                    onClick={handleCopyRawKey}
                    className="absolute right-2 top-2 p-1.5 rounded bg-bg-raised hover:bg-bg-overlay text-text-muted hover:text-text-primary border border-border-subtle"
                    title="Copy key"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-status-healthy" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShowKeyModal(false)}
                    className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
