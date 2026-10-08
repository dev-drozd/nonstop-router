import React, { useState } from 'react';
import { fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ArrowRight, Download, Server, Terminal, Copy, Check } from 'lucide-react';

interface OnboardingWizardProps {
  onComplete: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Provider selection
  const [providerType, setProviderType] = useState<'import' | 'manual'>('import');
  const [importCandidates, setImportCandidates] = useState<any[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string>('');
  const [manualName, setManualName] = useState('Token Harbor');
  const [manualUrl, setManualUrl] = useState('https://tokenharbor.ai/v1');
  const [manualKey, setManualKey] = useState('');

  // Step 2: Auto-discovered models
  const [discoveredModels, setDiscoveredModels] = useState<any[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [chainName, setChainName] = useState('auto');

  // Step 3: Gateway configuration
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gatewayKey, setGatewayKey] = useState('nsk_live_YOUR_KEY');

  React.useEffect(() => {
    // Check for OpenCode import candidates on mount
    fetchJson<any>('/api/providers/import-preview', { method: 'POST' })
      .then(res => {
        if (res.found && res.providers?.length > 0) {
          setImportCandidates(res.providers);
          setSelectedCandidate(res.providers[0].providerKey);
        } else {
          setProviderType('manual');
        }
      })
      .catch(() => setProviderType('manual'));

    // Fetch gateway key
    fetchJson<any>('/api/connect/configs?chain=auto')
      .then(res => {
        if (res.gatewayKey) setGatewayKey(res.gatewayKey);
      })
      .catch(() => {});
  }, []);

  const handleStep1Submit = async () => {
    setIsSubmitting(true);
    try {
      if (providerType === 'import') {
        const res = await fetchJson<any>('/api/providers/import-confirm', {
          method: 'POST',
          body: JSON.stringify({ providerKey: selectedCandidate }),
        });
        // Fetch discovered models
        const models = await fetchJson<any[]>(`/api/models?providerId=${res.provider.id}`);
        setDiscoveredModels(models);
        setSelectedModels(models.slice(0, 3).map(m => m.modelId));
      } else {
        const res = await fetchJson<any>('/api/providers', {
          method: 'POST',
          body: JSON.stringify({
            name: manualName,
            protocol: 'openai',
            baseUrl: manualUrl,
            initialKey: manualKey,
            keyLabel: 'Primary Key',
          }),
        });
        const models = await fetchJson<any[]>(`/api/models?providerId=${res.providerId}`);
        setDiscoveredModels(models);
        setSelectedModels(models.slice(0, 3).map(m => m.modelId));
      }
      setStep(2);
    } catch (err: any) {
      alert(`Setup error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep2Submit = async () => {
    setIsSubmitting(true);
    try {
      // Find chain
      const chains = await fetchJson<any[]>('/api/chains');
      const autoChain = chains.find(c => c.name === chainName) || chains[0];
      if (autoChain && selectedModels.length > 0) {
        // Map selected models to provider
        const provs = await fetchJson<any[]>('/api/providers');
        const primaryProv = provs[0];
        const targets = selectedModels.map(mId => ({
          providerId: primaryProv.id,
          modelId: mId,
          requiresTools: false,
        }));
        await fetchJson(`/api/chains/${autoChain.id}/targets`, {
          method: 'PUT',
          body: JSON.stringify({ targets }),
        });
      }
      queryClient.invalidateQueries();
      setStep(3);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    queryClient.invalidateQueries();
    onComplete();
  };

  const sampleSnippet = `export ANTHROPIC_BASE_URL="http://127.0.0.1:4000"\nexport ANTHROPIC_AUTH_TOKEN="${gatewayKey}"\nexport ANTHROPIC_MODEL="${chainName}"`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
      <div className="w-full max-w-xl rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-6">
        {/* Progress indicator */}
        <div className="flex items-center justify-between border-b border-border-subtle pb-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">Welcome to NonStop Router</div>
            <div className="text-xs text-text-secondary">First-run setup in under 2 minutes</div>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-accent text-white' : 'bg-bg-raised text-text-muted'}`}>1</span>
            <span className="text-text-muted">&bull;</span>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-accent text-white' : 'bg-bg-raised text-text-muted'}`}>2</span>
            <span className="text-text-muted">&bull;</span>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= 3 ? 'bg-accent text-white' : 'bg-bg-raised text-text-muted'}`}>3</span>
          </div>
        </div>

        {/* STEP 1: Add or Import Provider */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary">
              Step 1: Choose how to connect your first LLM provider.
            </div>

            {importCandidates.length > 0 && (
              <div className="p-3 rounded bg-bg-raised border border-border-subtle space-y-2">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-xs text-text-primary">
                  <input
                    type="radio"
                    name="providerSource"
                    checked={providerType === 'import'}
                    onChange={() => setProviderType('import')}
                    className="text-accent focus:ring-accent"
                  />
                  <span>Import from OpenCode Configuration (Recommended)</span>
                </label>
                {providerType === 'import' && (
                  <div className="pl-6 text-xs text-text-secondary">
                    Detected existing provider: <strong className="text-text-primary">{importCandidates[0]?.name}</strong> ({importCandidates[0]?.modelCount} models, key found).
                  </div>
                )}
              </div>
            )}

            <div className="p-3 rounded bg-bg-raised border border-border-subtle space-y-2">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-xs text-text-primary">
                <input
                  type="radio"
                  name="providerSource"
                  checked={providerType === 'manual'}
                  onChange={() => setProviderType('manual')}
                  className="text-accent focus:ring-accent"
                />
                <span>Configure Provider Manually</span>
              </label>

              {providerType === 'manual' && (
                <div className="space-y-3 pt-2 pl-6">
                  <div>
                    <label className="block text-[11px] text-text-muted mb-0.5">Provider Name</label>
                    <input
                      type="text"
                      value={manualName}
                      onChange={e => setManualName(e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded bg-bg-base border border-border-default focus:border-accent text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-text-muted mb-0.5">Base URL</label>
                    <input
                      type="text"
                      value={manualUrl}
                      onChange={e => setManualUrl(e.target.value)}
                      className="w-full px-2.5 py-1 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-text-muted mb-0.5">API Key</label>
                    <input
                      type="password"
                      value={manualKey}
                      onChange={e => setManualKey(e.target.value)}
                      placeholder="sk-... or thk_..."
                      className="w-full px-2.5 py-1 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent text-text-primary"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleStep1Submit}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Connecting...' : 'Connect & Fetch Models'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Pick Models & Set Chain */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary">
              Step 2: Models automatically discovered ({discoveredModels.length} models). Choose your primary targets for the default <code className="font-mono text-text-primary">auto</code> chain:
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {discoveredModels.slice(0, 15).map(m => {
                const isSelected = selectedModels.includes(m.modelId);
                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedModels(selectedModels.filter(id => id !== m.modelId));
                      } else {
                        setSelectedModels([...selectedModels, m.modelId]);
                      }
                    }}
                    className={`p-2.5 rounded border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-accent-subtle border-accent-border text-text-primary'
                        : 'bg-bg-raised border-border-subtle text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <span className="font-mono">{m.modelId}</span>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-accent" />}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-text-muted">{selectedModels.length} targets selected</span>
              <button
                onClick={handleStep2Submit}
                disabled={isSubmitting || selectedModels.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
              >
                <span>Save Chain & Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Connect Tools */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary">
              Step 3: Setup complete! Copy your tool configuration snippet or start routing now.
            </div>

            <div className="relative rounded bg-bg-base border border-border-subtle p-3">
              <pre className="text-[11px] font-mono text-text-primary whitespace-pre pr-8 overflow-x-auto">
                {sampleSnippet}
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(sampleSnippet);
                  setCopiedSnippet(true);
                  setTimeout(() => setCopiedSnippet(false), 2000);
                }}
                className="absolute right-2 top-2 p-1.5 rounded bg-bg-raised text-text-muted hover:text-text-primary border border-border-subtle"
                title="Copy snippet"
              >
                {copiedSnippet ? <Check className="w-3.5 h-3.5 text-status-healthy" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleFinish}
                className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
