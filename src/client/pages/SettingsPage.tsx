import React, { useState } from 'react';
import { useSettings, useGatewayKeys, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { Sliders, Key, Plus, Trash2, Copy, Check, ShieldAlert, Download, Upload, CheckCircle2, Globe } from 'lucide-react';
import { useI18n } from '../i18n/index.js';

export const SettingsPage: React.FC = () => {
  const { t, language, setLanguage } = useI18n();
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
      alert(t('settings.cacheClearedAlert'));
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(t('settings.cacheClearErrorAlert', { err: err.message }));
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
    if (!confirm(t('settings.revokeKeyConfirm'))) return;
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
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t('settings.title')}</h1>
        <p className="text-xs text-text-secondary mt-1">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* Interface Language Card */}
      <div className="p-5 rounded-md bg-bg-surface border border-border-default space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">{t('settings.languageSectionTitle')}</h2>
          </div>
          <p className="text-xs text-text-muted mt-1">
            {t('settings.languageSectionDesc')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
              language === 'en'
                ? 'bg-accent text-white border-accent shadow-subtle'
                : 'bg-bg-raised text-text-secondary border-border-subtle hover:text-text-primary'
            }`}
          >
            {t('settings.languageOptionEn')}
          </button>
          <button
            type="button"
            onClick={() => setLanguage('ru')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
              language === 'ru'
                ? 'bg-accent text-white border-accent shadow-subtle'
                : 'bg-bg-raised text-text-secondary border-border-subtle hover:text-text-primary'
            }`}
          >
            {t('settings.languageOptionRu')}
          </button>
        </div>
      </div>

      {/* Gateway Keys Card */}
      <div className="p-5 rounded-md bg-bg-surface border border-border-default space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary">{t('settings.gatewayKeysTitle')}</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {t('settings.gatewayKeysDesc')}
            </p>
          </div>
          <button
            onClick={() => {
              setShowKeyModal(true);
              setCreatedRawKey(null);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors shadow-subtle shrink-0 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('settings.generateKey')}</span>
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
                  {k.key_masked} &bull; {t('settings.createdDate', { date: new Date(k.created_at).toLocaleDateString() })}
                  {k.last_used_at && <span> &bull; {t('settings.lastUsedDate', { date: new Date(k.last_used_at).toLocaleTimeString() })}</span>}
                </div>
              </div>

              <button
                onClick={() => handleDeleteGatewayKey(k.id)}
                className="p-1 rounded hover:bg-bg-overlay text-text-muted hover:text-status-error transition-colors"
                title={t('settings.revokeKeyTooltip')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Router Engine Settings Form */}
      <form onSubmit={handleSaveSettings} className="p-5 rounded-md bg-bg-surface border border-border-default space-y-6">
        <h2 className="text-sm font-semibold text-text-primary">{t('settings.routingEngineTitle')}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('settings.defaultRequestTimeout')}
            </label>
            <input
              type="number"
              value={defaultTimeout}
              onChange={e => setDefaultTimeout(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">{t('settings.defaultRequestTimeoutDesc')}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('settings.probeInterval')}
            </label>
            <input
              type="number"
              value={probeInterval}
              onChange={e => setProbeInterval(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">{t('settings.probeIntervalDesc')}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('settings.cooldownBase')}
            </label>
            <input
              type="number"
              value={cooldownBase}
              onChange={e => setCooldownBase(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">{t('settings.cooldownBaseDesc')}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('settings.cooldownMax')}
            </label>
            <input
              type="number"
              value={cooldownMax}
              onChange={e => setCooldownMax(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">{t('settings.cooldownMaxDesc')}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {t('settings.autoChainPolicy')}
            </label>
            <select
              value={chainAutoPolicy}
              onChange={e => setChainAutoPolicy(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary cursor-pointer"
            >
              <option value="free_only">{t('settings.policyFreeOnly')}</option>
              <option value="free_first">{t('settings.policyFreeFirst')}</option>
              <option value="all">{t('settings.policyAll')}</option>
            </select>
            <span className="text-[11px] text-text-muted">
              {t('settings.autoChainPolicyDesc')}
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
              <div className="text-xs font-medium text-text-primary">{t('settings.enableLocalCache')}</div>
              <div className="text-[11px] text-text-muted">
                {t('settings.enableLocalCacheDesc')}
              </div>
            </div>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-7">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">{t('settings.cacheTtl')}</label>
              <input
                type="number"
                value={cacheTtlMs}
                onChange={e => setCacheTtlMs(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
              />
              <span className="text-[11px] text-text-muted">{t('settings.cacheTtlDesc')}</span>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">{t('settings.maxCacheEntries')}</label>
              <input
                type="number"
                value={cacheMaxEntries}
                onChange={e => setCacheMaxEntries(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
              />
              <span className="text-[11px] text-text-muted">{t('settings.maxCacheEntriesDesc')}</span>
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
              <div className="text-xs font-medium text-text-primary">{t('settings.enablePromptOptimizer')}</div>
              <div className="text-[11px] text-text-muted">
                {t('settings.enablePromptOptimizerDesc')}
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
              <div className="text-xs font-medium text-text-primary">{t('settings.enableRateGovernor')}</div>
              <div className="text-[11px] text-text-muted">
                {t('settings.enableRateGovernorDesc')}
              </div>
            </div>
          </label>

          <div className="pl-7">
            <label className="block text-xs font-medium text-text-secondary mb-1">{t('settings.rateGovernorCeiling')}</label>
            <input
              type="number"
              value={rateGovernorRpm}
              onChange={e => setRateGovernorRpm(Number(e.target.value))}
              className="w-full md:w-64 px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
            />
            <span className="text-[11px] text-text-muted">{t('settings.rateGovernorCeilingDesc')}</span>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={restartMidstream}
              onChange={e => setRestartMidstream(e.target.checked)}
              className="mt-0.5 rounded border-border-default text-accent focus:ring-accent"
            />
            <div>
              <div className="text-xs font-medium text-text-primary">{t('settings.restartOnMidstream')}</div>
              <div className="text-[11px] text-text-muted">
                {t('settings.restartOnMidstreamDesc')}
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
              <div className="text-xs font-medium text-text-primary">{t('settings.storePayloads')}</div>
              <div className="text-[11px] text-text-muted">
                {t('settings.storePayloadsDesc')}
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
                <span>{t('settings.allowLan')}</span>
                <span className="px-1.5 py-0.2 rounded bg-status-warning-bg text-status-warning text-[10px]">
                  {t('settings.securityWarning')}
                </span>
              </div>
              <div className="text-[11px] text-text-muted mt-0.5">
                {t('settings.allowLanDesc')}
              </div>
            </div>
          </label>
        </div>

        {/* Cache Maintenance Box */}
        <div className="pt-4 border-t border-border-subtle flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-text-primary">{t('settings.cacheMaintenance')}</div>
            <div className="text-[11px] text-text-muted">{t('settings.cacheMaintenanceDesc')}</div>
          </div>
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearingCache}
            className="px-3 py-1.5 text-xs font-medium rounded bg-bg-base hover:bg-bg-raised border border-border-default text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            {clearingCache ? t('settings.clearingCache') : t('settings.clearCache')}
          </button>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
          {saveSuccess ? (
            <div className="flex items-center gap-1.5 text-xs text-status-healthy">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t('settings.settingsSavedSuccessfully')}</span>
            </div>
          ) : <div />}

          <button
            type="submit"
            disabled={savingSettings}
            className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
          >
            {savingSettings ? t('settings.savingSettings') : t('settings.saveSettings')}
          </button>
        </div>
      </form>

      {/* Generate Gateway Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowKeyModal(false)} />
          <div className="relative z-10 w-full max-w-md rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <h2 className="text-base font-semibold text-text-primary">{t('settings.createGatewayKeyModalTitle')}</h2>

            {!createdRawKey ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('settings.keyNameLabel')}</label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={e => setNewKeyName(e.target.value)}
                    placeholder={t('settings.keyNamePlaceholder')}
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setShowKeyModal(false)}
                    className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleCreateGatewayKey}
                    className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors"
                  >
                    {t('settings.generate')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 rounded bg-status-healthy-bg border border-[rgba(47,158,68,0.25)] text-xs text-text-primary">
                  <div className="font-semibold text-status-healthy mb-1">{t('settings.keyGeneratedSuccess')}</div>
                  {t('settings.keyGeneratedDesc')}
                </div>

                <div className="relative rounded bg-bg-base border border-border-subtle p-3">
                  <div className="font-mono text-xs text-text-primary select-all break-all pr-8">
                    {createdRawKey}
                  </div>
                  <button
                    onClick={handleCopyRawKey}
                    className="absolute right-2 top-2 p-1.5 rounded bg-bg-raised hover:bg-bg-overlay text-text-muted hover:text-text-primary border border-border-subtle"
                    title={t('settings.copyKeyTooltip')}
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-status-healthy" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShowKeyModal(false)}
                    className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover"
                  >
                    {t('common.done')}
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
