import React, { useState } from 'react';
import { useProviders, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderLogo } from '../components/ProviderLogo.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { Server, Plus, Download, Key, Trash2, CheckCircle2, AlertCircle, RefreshCw, Eye, EyeOff, Copy, ShieldAlert, X, Pencil, Sparkles, Zap, Power } from 'lucide-react';
import type { Provider, ProviderProtocol, KeySelectionStrategy } from '../../shared/types.js';
import { useI18n } from '../i18n/index.js';

export const ProvidersPage: React.FC = () => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: providers = [], isLoading } = useProviders();

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddKeyModal, setShowAddKeyModal] = useState<string | null>(null);

  // Edit Provider modal state
  const [editingProvider, setEditingProvider] = useState<any>(null);
  const [editName, setEditName] = useState('');
  const [editProtocol, setEditProtocol] = useState<ProviderProtocol>('openai');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editStrategy, setEditStrategy] = useState<KeySelectionStrategy>('round-robin');

  // Edit Key modal state
  const [editingKey, setEditingKey] = useState<any>(null);
  const [editKeyLabel, setEditKeyLabel] = useState('');
  const [editKeyRaw, setEditKeyRaw] = useState('');

  // Key & Limits Inspector state
  const [showInspectorModal, setShowInspectorModal] = useState(false);
  const [inspectBaseUrl, setInspectBaseUrl] = useState('');
  const [inspectApiKey, setInspectApiKey] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<any>(null);

  // Revealed keys map: { [keyId]: rawKey }
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});

  // Individual key test state: { [keyId]: { loading: boolean; latencyMs?: number; statusLabel?: string; error?: string } }
  const [keyTestStates, setKeyTestStates] = useState<Record<string, { loading: boolean; latencyMs?: number; statusLabel?: string; error?: string }>>({});

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'provider' | 'key'; id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Add Provider form state
  const [providerName, setProviderName] = useState('');
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [selectionStrategy, setSelectionStrategy] = useState<KeySelectionStrategy>('round-robin');
  const [initialKey, setInitialKey] = useState('');
  const [keyLabel, setKeyLabel] = useState('Primary Key');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs?: number; error?: string; modelCount?: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Import preview state
  const [importPreview, setImportPreview] = useState<any>(null);
  const [loadingImport, setLoadingImport] = useState(false);
  const [importingKey, setImportingKey] = useState<string | null>(null);

  // New key form state
  const [newKeyRaw, setNewKeyRaw] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('Secondary Key');

  // Load presets
  const handleSelectPreset = (preset: any) => {
    setProviderName(preset.name);
    setProtocol(preset.protocol);
    setBaseUrl(preset.defaultBaseUrl);
  };

  const handleTestConnection = async () => {
    if (!baseUrl) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await fetchJson<any>('/api/providers/test', {
        method: 'POST',
        body: JSON.stringify({ protocol, baseUrl, rawKey: initialKey }),
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    try {
      await fetchJson('/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          name: providerName,
          protocol,
          baseUrl,
          selectionStrategy,
          initialKey: initialKey.trim() || undefined,
          keyLabel,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
      setShowAddModal(false);
      resetAddForm();
    } catch (err: any) {
      setActionError(err.message);
    }
  };

  const resetAddForm = () => {
    setProviderName('');
    setProtocol('openai');
    setBaseUrl('');
    setSelectionStrategy('round-robin');
    setInitialKey('');
    setKeyLabel('Primary Key');
    setTestResult(null);
    setActionError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.type === 'provider') {
        await fetchJson(`/api/providers/${deleteTarget.id}`, { method: 'DELETE' });
      } else {
        await fetchJson(`/api/keys/${deleteTarget.id}`, { method: 'DELETE' });
      }
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
      setDeleteTarget(null);
    } catch (err: any) {
      alert(`Delete error: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteProvider = (id: string, name: string) => {
    setDeleteTarget({ type: 'provider', id, name });
  };

  const handleOpenImport = async () => {
    setShowImportModal(true);
    setLoadingImport(true);
    try {
      const preview = await fetchJson<any>('/api/providers/import-preview', { method: 'POST' });
      setImportPreview(preview);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoadingImport(false);
    }
  };

  const handleConfirmImport = async (candidateKey: string) => {
    setImportingKey(candidateKey);
    try {
      await fetchJson('/api/providers/import-confirm', {
        method: 'POST',
        body: JSON.stringify({ providerKey: candidateKey }),
      });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      setShowImportModal(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setImportingKey(null);
    }
  };

  const handleAddKey = async (providerId: string) => {
    if (!newKeyRaw.trim()) return;
    try {
      await fetchJson(`/api/providers/${providerId}/keys`, {
        method: 'POST',
        body: JSON.stringify({ rawKey: newKeyRaw, label: newKeyLabel }),
      });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setShowAddKeyModal(null);
      setNewKeyRaw('');
      setNewKeyLabel('Secondary Key');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDeleteKey = (keyId: string, label: string) => {
    setDeleteTarget({ type: 'key', id: keyId, name: label });
  };

  const handleResetKey = async (keyId: string) => {
    try {
      await fetchJson(`/api/keys/${keyId}/reset`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleOpenEditProvider = (p: any) => {
    setEditingProvider(p);
    setEditName(p.name);
    setEditProtocol(p.protocol);
    setEditBaseUrl(p.baseUrl);
    setEditStrategy(p.selectionStrategy || 'round-robin');
  };

  const handleSaveEditProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProvider) return;
    try {
      await fetchJson(`/api/providers/${editingProvider.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName,
          protocol: editProtocol,
          baseUrl: editBaseUrl,
          selectionStrategy: editStrategy,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setEditingProvider(null);
    } catch (err: any) {
      alert(`Save error: ${err.message}`);
    }
  };

  const handleOpenEditKey = (k: any) => {
    setEditingKey(k);
    setEditKeyLabel(k.label);
    setEditKeyRaw('');
  };

  const handleSaveEditKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKey) return;
    try {
      await fetchJson(`/api/keys/${editingKey.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          label: editKeyLabel,
          rawKey: editKeyRaw.trim() || undefined,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      setEditingKey(null);
    } catch (err: any) {
      alert(`Key update error: ${err.message}`);
    }
  };

  const handleRunInspector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectBaseUrl || !inspectApiKey) return;
    setInspecting(true);
    setInspectResult(null);
    try {
      const res = await fetchJson<any>('/api/providers/inspect-key', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: inspectBaseUrl, rawKey: inspectApiKey }),
      });
      setInspectResult(res);
    } catch (err: any) {
      setInspectResult({ success: false, statusLabel: 'ERROR', quotaDetails: err.message, models: [] });
    } finally {
      setInspecting(false);
    }
  };

  const handleAddInspectedToProvider = async () => {
    if (!inspectResult) return;
    try {
      let autoName = 'Custom Provider';
      try {
        const u = new URL(inspectResult.workingBaseUrl || inspectBaseUrl);
        autoName = u.hostname.replace(/^api\./, '').split('.')[0];
        autoName = autoName.charAt(0).toUpperCase() + autoName.slice(1);
      } catch {}

      await fetchJson('/api/providers', {
        method: 'POST',
        body: JSON.stringify({
          name: autoName,
          protocol: 'openai',
          baseUrl: inspectResult.workingBaseUrl || inspectBaseUrl,
          selectionStrategy: 'round-robin',
          initialKey: inspectApiKey.trim(),
          keyLabel: 'Primary Key',
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
      setShowInspectorModal(false);
      setInspectResult(null);
      setInspectApiKey('');
    } catch (err: any) {
      alert(`Add error: ${err.message}`);
    }
  };

  const formatTokens = (t?: number) => {
    if (!t) return '0';
    if (t >= 1000000) return `${(t / 1000000).toFixed(1)}M`;
    if (t >= 1000) return `${Math.round(t / 1000)}k`;
    return String(t);
  };

  const handleToggleRevealKey = async (keyId: string) => {
    if (revealedKeys[keyId]) {
      const next = { ...revealedKeys };
      delete next[keyId];
      setRevealedKeys(next);
      return;
    }
    try {
      const res = await fetchJson<any>(`/api/keys/${keyId}/reveal`);
      if (res.rawKey) {
        setRevealedKeys(prev => ({ ...prev, [keyId]: res.rawKey }));
      }
    } catch (err: any) {
      alert(`Failed to reveal key: ${err.message}`);
    }
  };

  const handleTestKey = async (keyId: string) => {
    setKeyTestStates(prev => ({ ...prev, [keyId]: { loading: true } }));
    try {
      const res = await fetchJson<any>(`/api/keys/${keyId}/test`, { method: 'POST' });
      setKeyTestStates(prev => ({
        ...prev,
        [keyId]: {
          loading: false,
          latencyMs: res.latencyMs,
          statusLabel: res.statusLabel,
          error: res.success ? undefined : (res.quotaDetails || 'Test failed'),
        },
      }));
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    } catch (err: any) {
      setKeyTestStates(prev => ({ ...prev, [keyId]: { loading: false, error: err.message } }));
    }
  };

  const handleToggleKeyDisabled = async (keyId: string, currentlyDisabled: boolean) => {
    try {
      await fetchJson(`/api/keys/${keyId}/${currentlyDisabled ? 'enable' : 'disable'}`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(`Failed to ${currentlyDisabled ? 'enable' : 'disable'} key: ${err.message}`);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t('providers.title')}</h1>
          <p className="text-xs text-text-secondary mt-1">
            {t('providers.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors shadow-subtle"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('providers.addProvider')}</span>
          </button>
        </div>
      </div>

      {/* Terms of Service notice */}
      <div className="p-3 rounded-md bg-bg-surface border border-border-subtle flex items-start gap-2.5 text-xs text-text-muted">
        <ShieldAlert className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
        <span>
          {t('providers.tosNotice')}
        </span>
      </div>

      {/* Provider List */}
      <div className="space-y-4">
        {providers.length === 0 ? (
          <div className="p-12 text-center rounded-md bg-bg-surface border border-border-default space-y-3">
            <img src="/assets/icon.svg" alt="NonStop Router" className="w-8 h-8 mx-auto opacity-70" width={32} height={32} />
            <div className="text-sm font-medium text-text-primary">{t('providers.noProvidersTitle')}</div>
            <p className="text-xs text-text-secondary max-w-md mx-auto">
              {t('providers.noProvidersDesc')}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setShowAddModal(true)}
                className="px-3.5 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover"
              >
                {t('providers.addProvider')}
              </button>
            </div>
          </div>
        ) : (
          providers.map((p: any) => (
            <div key={p.id} className="rounded-md bg-bg-surface border border-border-default overflow-hidden">
              {/* Provider Header */}
              <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-subtle">
                <div className="flex items-center gap-3">
                  <ProviderLogo providerName={p.name} size={28} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-text-primary">{p.name}</span>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-bg-raised text-text-secondary border border-border-subtle">
                        {p.protocol}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-raised text-text-muted border border-border-subtle">
                        {t('providers.strategy', { strategy: p.selectionStrategy })}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-text-muted mt-0.5 truncate max-w-md">{p.baseUrl}</div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 self-end md:self-auto">
                  <button
                    onClick={() => setShowAddKeyModal(p.id)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-bg-raised hover:bg-bg-overlay text-text-primary text-xs font-medium transition-colors border border-border-subtle"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{t('providers.addKey')}</span>
                  </button>
                  <button
                    onClick={() => handleOpenEditProvider(p)}
                    className="p-1.5 rounded hover:bg-bg-raised text-text-muted hover:text-text-primary transition-colors border border-transparent hover:border-border-subtle"
                    title={t('providers.editProviderTooltip')}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteProvider(p.id, p.name)}
                    className="p-1.5 rounded hover:bg-bg-raised text-text-muted hover:text-status-error transition-colors"
                    title={t('providers.deleteProviderTooltip')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Keys Pool List */}
              <div className="p-4 bg-bg-base/40 space-y-2">
                <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                  {t('providers.keyPoolTitle', { count: p.keys?.length || 0 })}
                </div>

                {p.keys?.length === 0 ? (
                  <div className="text-xs text-text-muted italic py-2">
                    {t('providers.noKeysAdded')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {p.keys.map((k: any) => {
                      const isRevealed = Boolean(revealedKeys[k.id]);
                      const displayKey = isRevealed ? revealedKeys[k.id] : k.keyMasked;
                      const testState = keyTestStates[k.id];
                      const isDisabled = Boolean(k.disabled);

                      return (
                        <div
                          key={k.id}
                          className={`p-3 rounded-lg bg-bg-surface border border-border-subtle flex flex-col justify-between gap-2.5 transition-all hover:border-border-default ${isDisabled ? 'opacity-60' : ''}`}
                        >
                          <div className="space-y-1 overflow-hidden">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-text-primary truncate">{k.label}</span>
                              <StatusBadge status={isDisabled ? 'disabled' : k.status} />
                            </div>

                            <div className="flex items-center gap-1.5 text-[11px] font-mono text-text-muted">
                              <span className={isRevealed ? 'text-accent select-all font-semibold' : 'text-text-secondary select-all'}>
                                {displayKey}
                              </span>
                              <button
                                onClick={() => handleToggleRevealKey(k.id)}
                                className="p-0.5 rounded text-text-muted hover:text-text-primary transition-colors"
                                title={isRevealed ? t('providers.hideSecretKey') : t('providers.showSecretKey')}
                              >
                                {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={async () => {
                                  let textToCopy = isRevealed ? revealedKeys[k.id] : '';
                                  if (!textToCopy) {
                                    try {
                                      const res = await fetchJson<any>(`/api/keys/${k.id}/reveal`);
                                      textToCopy = res.rawKey;
                                    } catch {}
                                  }
                                  if (textToCopy) {
                                    navigator.clipboard.writeText(textToCopy);
                                    alert(t('providers.copiedKeyAlert', { label: k.label }));
                                  }
                                }}
                                className="p-0.5 rounded text-text-muted hover:text-text-primary transition-colors"
                                title={t('providers.copyRawApiKey')}
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="text-[11px] font-mono text-text-muted flex items-center gap-1.5 flex-wrap">
                              <span className="text-text-primary font-medium">{formatTokens(k.tokensUsed || 0)} {t('common.tokens')}</span>
                              <span>&bull;</span>
                              <span>{k.usageCount} {t('common.requests')}</span>
                            </div>

                            {/* Live Test Feedback if tested */}
                            {testState && (
                              <div className="text-[10px] font-mono p-1.5 rounded bg-bg-raised border border-border-subtle flex items-center justify-between">
                                <span className={testState.error ? 'text-status-error' : 'text-status-healthy'}>
                                  {testState.loading ? t('providers.testingKey') : (testState.error || testState.statusLabel || t('providers.keyActiveState'))}
                                </span>
                                {testState.latencyMs !== undefined && (
                                  <span className="text-text-muted">{testState.latencyMs}ms</span>
                                )}
                              </div>
                            )}

                            {k.lastError && !testState && (
                              <div className="text-[10px] text-status-error truncate" title={k.lastError}>
                                Err: {k.lastError}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-1 pt-2 border-t border-border-subtle/50">
                            <button
                              onClick={() => handleTestKey(k.id)}
                              disabled={testState?.loading}
                              className="px-2 py-1 rounded bg-bg-raised hover:bg-bg-overlay text-text-primary text-[10px] font-medium transition-colors border border-border-subtle flex items-center gap-1"
                              title={t('providers.testKeyTooltip')}
                            >
                              <Zap className="w-3 h-3 text-accent" />
                              <span>{testState?.loading ? t('common.testing') : t('providers.testKey')}</span>
                            </button>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleToggleKeyDisabled(k.id, isDisabled)}
                                className={`p-1 rounded hover:bg-bg-raised transition-colors ${isDisabled ? 'text-status-healthy hover:text-status-healthy' : 'text-text-muted hover:text-status-warning'}`}
                                title={isDisabled ? t('providers.enableKeyTooltip') : t('providers.disableKeyTooltip')}
                              >
                                <Power className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleOpenEditKey(k)}
                                className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-text-primary transition-colors"
                                title={t('providers.editKeyTooltip')}
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              {k.status !== 'healthy' && (
                                <button
                                  onClick={() => handleResetKey(k.id)}
                                  className="p-1 rounded hover:bg-bg-raised text-accent hover:text-accent-hover transition-colors"
                                  title={t('providers.resetKeyTooltip')}
                                >
                                  <RefreshCw className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteKey(k.id, k.label)}
                                className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-status-error transition-colors"
                                title={t('providers.deleteKeyTooltip')}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Provider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="relative z-10 w-full max-w-lg rounded-xl bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4 animate-modal">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">{t('providers.addUpstreamModalTitle')}</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
                title={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>


            {/* Presets Bar */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{t('providers.quickPresets')}</label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: 'Token Harbor', protocol: 'openai', defaultBaseUrl: 'https://tokenharbor.ai/v1' },
                  { name: 'OpenAI', protocol: 'openai', defaultBaseUrl: 'https://api.openai.com/v1' },
                  { name: 'Anthropic', protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1' },
                  { name: 'DeepSeek', protocol: 'openai', defaultBaseUrl: 'https://api.deepseek.com' },
                  { name: 'Google Gemini', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
                  { name: 'Groq', protocol: 'openai', defaultBaseUrl: 'https://api.groq.com/openai/v1' },
                  { name: 'Ollama', protocol: 'openai', defaultBaseUrl: 'http://127.0.0.1:11434/v1' },
                ].map(pre => (
                  <button
                    key={pre.name}
                    type="button"
                    onClick={() => handleSelectPreset(pre)}
                    className="px-2 py-1 rounded bg-bg-raised hover:bg-bg-overlay border border-border-subtle text-[11px] text-text-primary transition-colors"
                  >
                    {pre.name}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleCreateProvider} className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.providerName')}</label>
                <input
                  type="text"
                  required
                  value={providerName}
                  onChange={e => setProviderName(e.target.value)}
                  placeholder={t('providers.providerNamePlaceholder')}
                  className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.protocolType')}</label>
                  <select
                    value={protocol}
                    onChange={e => setProtocol(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  >
                    <option value="openai">{t('providers.protocolOpenAI')}</option>
                    <option value="anthropic">{t('providers.protocolAnthropic')}</option>
                    <option value="gemini">{t('providers.protocolGemini')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.keyStrategy')}</label>
                  <select
                    value={selectionStrategy}
                    onChange={e => setSelectionStrategy(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  >
                    <option value="round-robin">{t('providers.strategyRoundRobin')}</option>
                    <option value="fill-first">{t('providers.strategyFillFirst')}</option>
                    <option value="least-used">{t('providers.strategyLeastUsed')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.baseUrl')}</label>
                <input
                  type="text"
                  required
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder={t('providers.baseUrlPlaceholder')}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.initialKeyLabel')}</label>
                  <input
                    type="password"
                    value={initialKey}
                    onChange={e => setInitialKey(e.target.value)}
                    placeholder="sk-... or thk_..."
                    className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.keyLabel')}</label>
                  <input
                    type="text"
                    value={keyLabel}
                    onChange={e => setKeyLabel(e.target.value)}
                    placeholder="Account 1"
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  />
                </div>
              </div>

              {/* Real Connection Test feedback */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testingConnection || !baseUrl}
                  className="px-2.5 py-1 rounded bg-bg-raised border border-border-default text-xs font-medium hover:bg-bg-overlay text-text-primary disabled:opacity-50"
                >
                  {testingConnection ? t('common.testing') : t('providers.testConnection')}
                </button>

                {testResult && (
                  <div className={`text-xs flex items-center gap-1.5 ${testResult.success ? 'text-status-healthy' : 'text-status-error'}`}>
                    {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    <span>
                      {testResult.success
                        ? t('providers.connectedFeedback', { latency: testResult.latencyMs, models: testResult.modelCount })
                        : (testResult.error || t('providers.connectionFailedFeedback'))}
                    </span>
                  </div>
                )}
              </div>

              {actionError && (
                <div className="p-2 rounded bg-status-error-bg text-status-error text-xs">{actionError}</div>
              )}

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
                >
                  {t('providers.saveProvider')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import OpenCode Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-modal">
          <div className="relative z-10 w-full max-w-xl rounded-xl bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">{t('providers.importModalTitle')}</h2>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
                title={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>


            {loadingImport ? (
              <div className="py-8 text-center text-xs text-text-muted">{t('providers.scanningConfig')}</div>
            ) : importPreview?.found ? (
              <div className="space-y-3">
                <div className="text-xs text-text-secondary">
                  {t('providers.detectedConfigAt', { path: importPreview.filePath })}
                </div>

                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {importPreview.providers.map((cand: any) => (
                    <div
                      key={cand.providerKey}
                      className="p-3 rounded border border-border-default bg-bg-raised flex items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-text-primary">{cand.name}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-bg-surface text-text-muted">
                            {t('providers.modelsCount', { count: cand.modelCount })}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-text-muted">{cand.baseUrl}</div>
                        <div className="text-[11px] text-text-secondary">
                          Key: {cand.resolvedKeyMasked ? <span className="font-mono text-text-primary">{cand.resolvedKeyMasked}</span> : <span className="text-status-warning">{t('providers.missingKey')}</span>}
                        </div>
                      </div>

                      <button
                        onClick={() => handleConfirmImport(cand.providerKey)}
                        disabled={importingKey === cand.providerKey}
                        className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors shrink-0 disabled:opacity-50"
                      >
                        {importingKey === cand.providerKey ? t('common.loading') : t('common.import')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-text-muted">
                {t('providers.noCustomProvidersFound')}
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Key Modal */}
      {showAddKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-modal">
          <div className="relative z-10 w-full max-w-md rounded-xl bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">{t('providers.addKeyModalTitle')}</h2>
              <button
                type="button"
                onClick={() => setShowAddKeyModal(null)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
                title={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.keyLabel')}</label>
                <input
                  type="text"
                  value={newKeyLabel}
                  onChange={e => setNewKeyLabel(e.target.value)}
                  placeholder={t('providers.keyLabelPlaceholder')}
                  className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.apiKeyInput')}</label>
                <input
                  type="password"
                  value={newKeyRaw}
                  onChange={e => setNewKeyRaw(e.target.value)}
                  placeholder="sk-... or thk_..."
                  className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-border-subtle">
              <button
                onClick={() => setShowAddKeyModal(null)}
                className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleAddKey(showAddKeyModal)}
                className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
              >
                {t('providers.saveKey')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Provider Modal */}
      {editingProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-modal">
          <div className="relative z-10 w-full max-w-lg rounded-xl bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">{t('providers.editProviderModalTitle')}</h2>
              <button
                type="button"
                onClick={() => setEditingProvider(null)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
                title={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditProvider} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.providerName')}</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  required
                  placeholder={t('providers.editProviderPlaceholder')}
                  className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.protocol')}</label>
                  <select
                    value={editProtocol}
                    onChange={e => setEditProtocol(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  >
                    <option value="openai">{t('providers.protocolOpenAI')}</option>
                    <option value="anthropic">{t('providers.protocolAnthropic')}</option>
                    <option value="gemini">{t('providers.protocolGemini')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.keyStrategy')}</label>
                  <select
                    value={editStrategy}
                    onChange={e => setEditStrategy(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  >
                    <option value="round-robin">{t('providers.strategyRoundRobin')}</option>
                    <option value="fill-first">{t('providers.strategyFillFirst')}</option>
                    <option value="least-used">{t('providers.strategyLeastUsed')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.baseUrl')}</label>
                <input
                  type="text"
                  value={editBaseUrl}
                  onChange={e => setEditBaseUrl(e.target.value)}
                  required
                  placeholder={t('providers.baseUrlPlaceholder')}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setEditingProvider(null)}
                  className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
                >
                  {t('providers.saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Key Modal */}
      {editingKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-modal">
          <div className="relative z-10 w-full max-w-md rounded-xl bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">{t('providers.editKeyModalTitle')}</h2>
              <button
                type="button"
                onClick={() => setEditingKey(null)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
                title={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditKey} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.keyLabel')}</label>
                <input
                  type="text"
                  value={editKeyLabel}
                  onChange={e => setEditKeyLabel(e.target.value)}
                  required
                  placeholder={t('providers.editKeyLabelPlaceholder')}
                  className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {t('providers.replaceApiKey')} <span className="text-text-muted font-normal">{t('providers.replaceApiKeyHint')}</span>
                </label>
                <input
                  type="password"
                  value={editKeyRaw}
                  onChange={e => setEditKeyRaw(e.target.value)}
                  placeholder={t('providers.pasteNewKeyPlaceholder')}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setEditingKey(null)}
                  className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
                >
                  {t('providers.updateKey')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Key & Limits Inspector Tool Modal */}
      {showInspectorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-modal">
          <div className="relative z-10 w-full max-w-2xl rounded-xl bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-accent" />
                <h2 className="text-base font-semibold text-text-primary">{t('providers.inspectorModalTitle')}</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowInspectorModal(false)}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
                title={t('common.close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-secondary">
              {t('providers.inspectorDesc')}
            </p>

            <form onSubmit={handleRunInspector} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.apiBaseUrl')}</label>
                  <input
                    type="text"
                    value={inspectBaseUrl}
                    onChange={e => setInspectBaseUrl(e.target.value)}
                    required
                    placeholder={t('providers.baseUrlPlaceholder')}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">{t('providers.apiKeyInput')}</label>
                  <input
                    type="password"
                    value={inspectApiKey}
                    onChange={e => setInspectApiKey(e.target.value)}
                    required
                    placeholder={t('providers.pasteSecretKeyPlaceholder')}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={inspecting}
                  className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
                >
                  {inspecting ? t('providers.probingLimits') : t('providers.inspectKeyBtn')}
                </button>
              </div>
            </form>

            {/* Inspection Results Box */}
            {inspectResult && (
              <div className="p-4 rounded-lg bg-bg-raised/70 border border-border-default space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                      inspectResult.statusLabel === 'ACTIVE'
                        ? 'bg-status-healthy-bg text-status-healthy border border-status-healthy/30'
                        : inspectResult.statusLabel === 'QUOTA_EXHAUSTED'
                        ? 'bg-[rgba(245,159,0,0.15)] text-[#f59f00] border border-[rgba(245,159,0,0.3)]'
                        : 'bg-status-error/15 text-status-error border border-status-error/30'
                    }`}>
                      {inspectResult.statusLabel || 'PROBE COMPLETE'}
                    </span>
                    <span className="text-xs font-mono text-text-primary font-semibold">
                      {inspectResult.latencyMs || 0}ms latency
                    </span>
                  </div>

                  <button
                    onClick={handleAddInspectedToProvider}
                    className="px-3 py-1 rounded bg-status-healthy text-white text-xs font-medium hover:opacity-90 transition-opacity shadow-subtle"
                  >
                    {t('providers.addAsProviderImport')}
                  </button>
                </div>

                <div className="p-3 rounded bg-bg-base border border-border-subtle text-xs space-y-1">
                  <span className="font-semibold text-text-primary block">{t('providers.quotaDiagnosis')}</span>
                  <div className="font-mono text-text-secondary text-[11px] break-words">
                    {inspectResult.quotaDetails || t('providers.noDiagnosisReturned')}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs font-medium text-text-primary mb-1.5">
                    <span>{t('providers.discoveredModelsCount', { total: inspectResult.modelsCount || 0, free: inspectResult.freeModelsCount || 0 })}</span>
                    {inspectResult.workingBaseUrl && (
                      <span className="text-[10px] font-mono text-text-muted">{t('providers.detectedUrl', { url: inspectResult.workingBaseUrl })}</span>
                    )}
                  </div>

                  <div className="max-h-40 overflow-y-auto rounded bg-bg-base border border-border-subtle text-xs">
                    {inspectResult.models && inspectResult.models.length > 0 ? (
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-border-subtle bg-bg-surface text-[10px] text-text-muted font-medium">
                            <th className="py-1.5 px-3">{t('providers.modelId')}</th>
                            <th className="py-1.5 px-3">{t('providers.tier')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle font-mono text-[11px]">
                          {inspectResult.models.map((m: any, idx: number) => (
                            <tr key={idx} className="hover:bg-bg-raised/40">
                              <td className="py-1 px-3 text-text-primary">{m.id}</td>
                              <td className="py-1 px-3">
                                {m.isFree ? (
                                  <span className="text-status-healthy font-semibold">{t('common.free')}</span>
                                ) : (
                                  <span className="text-text-muted">{t('common.standard')}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-3 text-center text-text-muted text-[11px]">{t('providers.noModelsReturned')}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setShowInspectorModal(false)}
                className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-bg-surface border border-border-default rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-status-error/10 text-status-error shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  {deleteTarget.type === 'provider' ? t('providers.deleteModalTitleProvider') : t('providers.deleteModalTitleKey')}
                </h3>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                  {t('providers.deleteConfirmDesc', { name: deleteTarget.name })}
                  {deleteTarget.type === 'provider' && t('providers.deleteProviderWarning')}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-md bg-bg-raised hover:bg-bg-overlay text-text-secondary text-xs font-medium transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-md bg-status-error text-white hover:bg-status-error/90 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {isDeleting ? t('providers.deleting') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
