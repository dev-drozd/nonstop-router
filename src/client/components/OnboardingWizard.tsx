import React, { useState } from 'react';
import { fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { ModelLogo, detectModelFamily } from './ModelLogo.js';
import {
  X,
  Server,
  Globe,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  ArrowRight,
  Download,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';
import { useI18n } from '../i18n/index.js';

interface OnboardingWizardProps {
  onComplete: () => void;
  onClose?: () => void;
}

const PRESETS = [
  { name: 'Token Harbor', url: 'https://tokenharbor.ai/v1', placeholder: 'thk_...' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1', placeholder: 'sk-...' },
  { name: 'Anthropic', url: 'https://api.anthropic.com/v1', placeholder: 'sk-ant-...' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1', placeholder: 'gsk_...' },
  { name: 'Ollama (Local)', url: 'http://127.0.0.1:11434/v1', placeholder: 'ollama' },
];

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete, onClose }) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Provider selection
  const [providerType, setProviderType] = useState<'import' | 'manual'>('import');
  const [importCandidates, setImportCandidates] = useState<any[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string>('');
  const [manualName, setManualName] = useState('Token Harbor');
  const [manualUrl, setManualUrl] = useState('https://tokenharbor.ai/v1');
  const [manualKey, setManualKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  // Step 2: Auto-discovered models
  const [discoveredModels, setDiscoveredModels] = useState<any[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [chainName, setChainName] = useState('auto');

  // Step 3: Gateway configuration
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gatewayKey, setGatewayKey] = useState('nsk_live_YOUR_KEY');

  const handleDismiss = () => {
    if (onClose) {
      onClose();
    } else {
      onComplete();
    }
  };

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

    // Fetch the local gateway key for the sample snippet (admin-protected, local-only)
    fetchJson<any>('/api/gateway-key')
      .then(res => {
        if (res.rawKey) setGatewayKey(res.rawKey);
      })
      .catch(() => {});
  }, []);

  const selectPreset = (p: typeof PRESETS[0]) => {
    setManualName(p.name);
    setManualUrl(p.url);
    if (p.name === 'Ollama (Local)' && !manualKey) {
      setManualKey('ollama');
    }
  };

  const handleStep1Submit = async () => {
    setIsSubmitting(true);
    try {
      if (providerType === 'import') {
        const res = await fetchJson<any>('/api/providers/import-confirm', {
          method: 'POST',
          body: JSON.stringify({ providerKey: selectedCandidate }),
        });
        const models = await fetchJson<any[]>(`/api/models?providerId=${res.provider.id}`);
        setDiscoveredModels(models);

        // Prioritize free models first
        const freeModels = models.filter(m => detectModelFamily(m.modelId).isFree).map(m => m.modelId);
        if (freeModels.length > 0) {
          setSelectedModels(freeModels.slice(0, 4));
        } else {
          setSelectedModels(models.slice(0, 3).map(m => m.modelId));
        }
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

        // Prioritize free models first
        const freeModels = models.filter(m => detectModelFamily(m.modelId).isFree).map(m => m.modelId);
        if (freeModels.length > 0) {
          setSelectedModels(freeModels.slice(0, 4));
        } else {
          setSelectedModels(models.slice(0, 3).map(m => m.modelId));
        }
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
      const chains = await fetchJson<any[]>('/api/chains');
      const autoChain = chains.find(c => c.name === chainName) || chains[0];
      if (autoChain && selectedModels.length > 0) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-modal">
      <div className="w-full max-w-xl rounded-xl bg-bg-surface border border-border-default p-6 shadow-overlay space-y-5">
        {/* Modal Brand Header */}
        <div className="flex flex-col items-center justify-center pt-1 pb-3 border-b border-border-subtle relative">
          <button
            onClick={handleDismiss}
            className="absolute right-0 top-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
            title={t('wizard.closeSkip')}
            aria-label={t('wizard.closeSetupModal')}
          >
            <X className="w-4 h-4" />
          </button>

          {/* Theme-adaptive Stacked Brand Logo */}
          <div className="mb-2">
            <img
              src="/assets/logo-stacked.svg"
              alt="NonStop Router"
              className="h-14 hidden dark:block mx-auto"
            />
            <img
              src="/assets/logo-stacked-on-light.svg"
              alt="NonStop Router"
              className="h-14 block dark:hidden mx-auto"
            />
          </div>

          <p className="text-xs text-text-secondary text-center max-w-sm">
            {t('wizard.subtitle')}
          </p>

          {/* Step indicators */}
          <div className="flex items-center gap-1.5 font-mono text-xs mt-3">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-medium ${step >= 1 ? 'bg-accent text-white' : 'bg-bg-raised text-text-muted'}`}>1</span>
            <span className="text-border-strong">&bull;</span>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-medium ${step >= 2 ? 'bg-accent text-white' : 'bg-bg-raised text-text-muted'}`}>2</span>
            <span className="text-border-strong">&bull;</span>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-medium ${step >= 3 ? 'bg-accent text-white' : 'bg-bg-raised text-text-muted'}`}>3</span>
          </div>
        </div>

        {/* STEP 1: Add or Import Provider */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary">
              {t('wizard.step1Title')}
            </div>

            {/* OpenCode Import Option */}
            {importCandidates.length > 0 && (
              <div
                onClick={() => setProviderType('import')}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  providerType === 'import'
                    ? 'bg-accent-subtle/40 border-accent-border ring-1 ring-accent/30'
                    : 'bg-bg-raised border-border-default hover:border-border-strong'
                }`}
              >
                <label className="flex items-start gap-2.5 cursor-pointer font-medium text-xs text-text-primary">
                  <input
                    type="radio"
                    name="providerSource"
                    checked={providerType === 'import'}
                    onChange={() => setProviderType('import')}
                    className="mt-0.5 text-accent focus:ring-accent"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t('wizard.importOpenCodeTitle')}</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-status-healthy/15 text-status-healthy font-normal">{t('wizard.detected')}</span>
                    </div>
                    <div className="text-[11px] text-text-secondary mt-1">
                      {t('wizard.foundProvider', { name: importCandidates[0]?.name, count: importCandidates[0]?.modelCount })}
                    </div>
                  </div>
                </label>
              </div>
            )}

            {/* Manual Provider Option */}
            <div
              className={`p-3.5 rounded-lg border transition-all ${
                providerType === 'manual'
                  ? 'bg-bg-surface border-border-strong'
                  : 'bg-bg-raised border-border-default'
              }`}
            >
              <label
                onClick={() => setProviderType('manual')}
                className="flex items-center gap-2.5 cursor-pointer font-medium text-xs text-text-primary mb-3"
              >
                <input
                  type="radio"
                  name="providerSource"
                  checked={providerType === 'manual'}
                  onChange={() => setProviderType('manual')}
                  className="text-accent focus:ring-accent"
                />
                <span className="font-semibold">{t('wizard.manualTitle')}</span>
              </label>

              {providerType === 'manual' && (
                <div className="space-y-3.5 pt-1 pl-6">
                  {/* Quick Presets */}
                  <div>
                    <div className="text-[11px] text-text-muted mb-1.5">{t('wizard.quickPresets')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESETS.map(p => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => selectPreset(p)}
                          className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${
                            manualName === p.name
                              ? 'bg-accent text-white border-accent'
                              : 'bg-bg-raised text-text-secondary border-border-default hover:text-text-primary hover:border-border-strong'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Provider Name */}
                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary mb-1">
                      <Server className="w-3.5 h-3.5 text-text-muted" />
                      <span>{t('wizard.providerName')}</span>
                    </label>
                    <input
                      type="text"
                      value={manualName}
                      onChange={e => setManualName(e.target.value)}
                      placeholder={t('wizard.providerNamePlaceholder')}
                      className="w-full"
                    />
                  </div>

                  {/* Base URL */}
                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary mb-1">
                      <Globe className="w-3.5 h-3.5 text-text-muted" />
                      <span>{t('wizard.baseUrl')}</span>
                    </label>
                    <input
                      type="text"
                      value={manualUrl}
                      onChange={e => setManualUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      className="w-full font-mono text-xs"
                    />
                  </div>

                  {/* API Key with Show/Hide Toggle */}
                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary mb-1">
                      <Key className="w-3.5 h-3.5 text-text-muted" />
                      <span>{t('wizard.apiKey')}</span>
                      <span className="text-text-muted text-[10px] font-normal">{t('wizard.encryptedNote')}</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={manualKey}
                        onChange={e => setManualKey(e.target.value)}
                        placeholder="sk-... or thk_..."
                        className="w-full font-mono text-xs pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-1"
                        title={showKey ? t('wizard.hideKey') : t('wizard.showKey')}
                      >
                        {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Step 1 Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={handleDismiss}
                className="text-xs text-text-muted hover:text-text-primary transition-colors underline-offset-4 hover:underline"
              >
                {t('wizard.skipExplore')}
              </button>

              <button
                type="button"
                onClick={handleStep1Submit}
                disabled={isSubmitting || (providerType === 'manual' && !manualUrl.trim())}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
              >
                <span>{isSubmitting ? t('wizard.connecting') : t('wizard.connectFetch')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Pick Models & Set Chain */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>
                {t('wizard.step2Title', { count: discoveredModels.length })}
              </span>
              <button
                type="button"
                onClick={() => {
                  const free = discoveredModels.filter(m => detectModelFamily(m.modelId).isFree).map(m => m.modelId);
                  if (free.length > 0) setSelectedModels(free);
                }}
                className="flex items-center gap-1 text-[11px] text-status-healthy hover:underline"
              >
                <Sparkles className="w-3 h-3" />
                <span>{t('wizard.selectFreeOnly')}</span>
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {discoveredModels.map(m => {
                const isSelected = selectedModels.includes(m.modelId);
                const { isFree } = detectModelFamily(m.modelId);
                return (
                  <div
                    key={m.id || m.modelId}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedModels(selectedModels.filter(id => id !== m.modelId));
                      } else {
                        setSelectedModels([...selectedModels, m.modelId]);
                      }
                    }}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${
                      isSelected
                        ? 'bg-accent-subtle/50 border-accent-border text-text-primary shadow-sm'
                        : 'bg-bg-raised border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <ModelLogo modelId={m.modelId} size={18} />
                      <span className="font-mono text-xs">{m.modelId}</span>
                      {isFree && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-status-healthy/15 text-status-healthy border border-status-healthy/30 uppercase tracking-wider">
                          {t('common.free')}
                        </span>
                      )}
                    </div>
                    {isSelected ? (
                      <CheckCircle2 className="w-4 h-4 text-accent" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-border-default" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Step 2 Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
              <button
                type="button"
                onClick={handleDismiss}
                className="text-xs text-text-muted hover:text-text-primary transition-colors underline-offset-4 hover:underline"
              >
                {t('wizard.skip')}
              </button>

              <div className="flex items-center gap-3">
                <span className="text-xs text-text-muted">{t('wizard.targetsSelected', { count: selectedModels.length })}</span>
                <button
                  type="button"
                  onClick={handleStep2Submit}
                  disabled={isSubmitting || selectedModels.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle disabled:opacity-50"
                >
                  <span>{t('wizard.saveChainContinue')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Connect Tools */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="text-xs text-text-secondary">
              {t('wizard.step3Title')}
            </div>

            <div className="relative rounded-lg bg-bg-base border border-border-default p-3.5">
              <pre className="text-[11px] font-mono text-text-primary whitespace-pre pr-8 overflow-x-auto">
                {sampleSnippet}
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(sampleSnippet);
                  setCopiedSnippet(true);
                  setTimeout(() => setCopiedSnippet(false), 2000);
                }}
                className="absolute right-2.5 top-2.5 p-1.5 rounded bg-bg-raised text-text-muted hover:text-text-primary border border-border-default transition-colors"
                title={t('wizard.copySnippet')}
              >
                {copiedSnippet ? <Check className="w-3.5 h-3.5 text-status-healthy" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
              <div className="text-xs text-status-healthy flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t('wizard.routerOperational')}</span>
              </div>
              <button
                type="button"
                onClick={handleFinish}
                className="px-5 py-2 text-xs font-semibold rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
              >
                {t('wizard.openDashboard')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
