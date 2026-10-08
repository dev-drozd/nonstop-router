import React, { useState } from 'react';
import { useProviders, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderLogo } from '../components/ProviderLogo.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { Server, Plus, Download, Key, Trash2, CheckCircle2, AlertCircle, RefreshCw, Eye, ShieldAlert } from 'lucide-react';
import type { Provider, ProviderProtocol, KeySelectionStrategy } from '../../shared/types.js';

export const ProvidersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: providers = [], isLoading } = useProviders();

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddKeyModal, setShowAddKeyModal] = useState<string | null>(null);

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

  const handleDeleteProvider = async (id: string) => {
    if (!confirm('Are you sure you want to remove this provider and all its associated keys?')) return;
    try {
      await fetchJson(`/api/providers/${id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
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

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm('Delete this API key?')) return;
    try {
      await fetchJson(`/api/keys/${keyId}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
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

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">Providers & Key Pools</h1>
          <p className="text-xs text-text-secondary mt-1">
            Configure upstream LLMs, manage encrypted key pools, and failover behavior.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenImport}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-bg-surface border border-border-default hover:bg-bg-raised text-text-primary text-xs font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Import OpenCode Config</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors shadow-subtle"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Provider</span>
          </button>
        </div>
      </div>

      {/* Terms of Service notice */}
      <div className="p-3 rounded-md bg-bg-surface border border-border-subtle flex items-start gap-2.5 text-xs text-text-muted">
        <ShieldAlert className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
        <span>
          Note: You are responsible for ensuring that multi-key pooling and request routing adhere to each provider's terms of service and acceptable use policies.
        </span>
      </div>

      {/* Provider List */}
      <div className="space-y-4">
        {providers.length === 0 ? (
          <div className="p-12 text-center rounded-md bg-bg-surface border border-border-default space-y-3">
            <Server className="w-10 h-10 text-text-muted mx-auto opacity-60" />
            <div className="text-sm font-medium text-text-primary">No Providers Configured</div>
            <p className="text-xs text-text-secondary max-w-md mx-auto">
              Add your first AI provider or import existing configurations from your OpenCode setup.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={handleOpenImport}
                className="px-3 py-1.5 rounded-md bg-bg-raised border border-border-default text-xs font-medium hover:bg-bg-overlay"
              >
                Import from OpenCode
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-hover"
              >
                Add Manually
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
                        Strategy: {p.selectionStrategy}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-text-muted mt-0.5 truncate max-w-md">{p.baseUrl}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto">
                  <button
                    onClick={() => setShowAddKeyModal(p.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-bg-raised hover:bg-bg-overlay text-text-primary text-xs font-medium transition-colors border border-border-subtle"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Key</span>
                  </button>
                  <button
                    onClick={() => handleDeleteProvider(p.id)}
                    className="p-1.5 rounded hover:bg-bg-raised text-text-muted hover:text-status-error transition-colors"
                    title="Delete provider"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Keys Pool List */}
              <div className="p-4 bg-bg-base/40 space-y-2">
                <div className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
                  Key Pool ({p.keys?.length || 0})
                </div>

                {p.keys?.length === 0 ? (
                  <div className="text-xs text-text-muted italic py-2">
                    No keys added yet. Add a key to start routing requests.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {p.keys.map((k: any) => (
                      <div
                        key={k.id}
                        className="p-2.5 rounded bg-bg-surface border border-border-subtle flex items-center justify-between gap-2"
                      >
                        <div className="space-y-0.5 overflow-hidden">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-text-primary truncate">{k.label}</span>
                            <StatusBadge status={k.status} />
                          </div>
                          <div className="text-[11px] font-mono text-text-muted truncate">
                            {k.keyMasked} &bull; Used: {k.usageCount}
                          </div>
                          {k.lastError && (
                            <div className="text-[10px] text-status-error truncate" title={k.lastError}>
                              Err: {k.lastError}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {k.status !== 'healthy' && (
                            <button
                              onClick={() => handleResetKey(k.id)}
                              className="p-1 rounded hover:bg-bg-raised text-accent hover:text-accent-hover transition-colors"
                              title="Reset key to healthy"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteKey(k.id)}
                            className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-status-error transition-colors"
                            title="Delete key"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
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
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowAddModal(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Add Upstream Provider</h2>

            {/* Presets Bar */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Quick Presets</label>
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
                <label className="block text-xs font-medium text-text-secondary mb-1">Provider Name</label>
                <input
                  type="text"
                  required
                  value={providerName}
                  onChange={e => setProviderName(e.target.value)}
                  placeholder="e.g. Token Harbor, Groq, Ollama"
                  className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Protocol Type</label>
                  <select
                    value={protocol}
                    onChange={e => setProtocol(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  >
                    <option value="openai">OpenAI Compatible</option>
                    <option value="anthropic">Anthropic Messages</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Key Strategy</label>
                  <select
                    value={selectionStrategy}
                    onChange={e => setSelectionStrategy(e.target.value as any)}
                    className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  >
                    <option value="round-robin">Round Robin</option>
                    <option value="fill-first">Fill First</option>
                    <option value="least-used">Least Used</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Base URL</label>
                <input
                  type="text"
                  required
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-text-secondary mb-1">Initial API Key (Encrypted at Rest)</label>
                  <input
                    type="password"
                    value={initialKey}
                    onChange={e => setInitialKey(e.target.value)}
                    placeholder="sk-... or thk_..."
                    className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Key Label</label>
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
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </button>

                {testResult && (
                  <div className={`text-xs flex items-center gap-1.5 ${testResult.success ? 'text-status-healthy' : 'text-status-error'}`}>
                    {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    <span>
                      {testResult.success
                        ? `Connected (${testResult.latencyMs}ms, ${testResult.modelCount} models)`
                        : (testResult.error || 'Connection failed')}
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
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
                >
                  Save Provider
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import OpenCode Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowImportModal(false)} />
          <div className="relative z-10 w-full max-w-xl rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Import from OpenCode Configuration</h2>

            {loadingImport ? (
              <div className="py-8 text-center text-xs text-text-muted">Scanning ~/.config/opencode...</div>
            ) : importPreview?.found ? (
              <div className="space-y-3">
                <div className="text-xs text-text-secondary">
                  Detected config at: <code className="font-mono text-text-primary">{importPreview.filePath}</code>
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
                            {cand.modelCount} models
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-text-muted">{cand.baseUrl}</div>
                        <div className="text-[11px] text-text-secondary">
                          Key: {cand.resolvedKeyMasked ? <span className="font-mono text-text-primary">{cand.resolvedKeyMasked}</span> : <span className="text-status-warning">Missing key</span>}
                        </div>
                      </div>

                      <button
                        onClick={() => handleConfirmImport(cand.providerKey)}
                        disabled={importingKey === cand.providerKey}
                        className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors shrink-0 disabled:opacity-50"
                      >
                        {importingKey === cand.providerKey ? 'Importing...' : 'Import'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-text-muted">
                No custom providers found in OpenCode config file.
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-border-subtle">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Key Modal */}
      {showAddKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowAddKeyModal(null)} />
          <div className="relative z-10 w-full max-w-md rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Add Key to Provider Pool</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Key Label</label>
                <input
                  type="text"
                  value={newKeyLabel}
                  onChange={e => setNewKeyLabel(e.target.value)}
                  placeholder="e.g. Account 2, Team Key"
                  className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">API Key</label>
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
                Cancel
              </button>
              <button
                onClick={() => handleAddKey(showAddKeyModal)}
                className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
