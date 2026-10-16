import React, { useState } from 'react';
import { useChains, useModels, fetchJson } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';
import { ModelLogo } from '../components/ModelLogo.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { GitFork, Plus, Trash2, ArrowUp, ArrowDown, Sparkles, Shield, Wrench } from 'lucide-react';
import type { Chain, ChainMode } from '../../shared/types.js';
import { isFreeModelId } from '../../shared/types.js';
import { useI18n } from '../i18n/index.js';

export const ChainsPage: React.FC = () => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: chains = [] } = useChains();
  const { data: models = [] } = useModels();

  const [selectedChainId, setSelectedChainId] = useState<string>('');
  const [showAddChainModal, setShowAddChainModal] = useState(false);
  const [showAddTargetModal, setShowAddTargetModal] = useState(false);
  const [buildingFreeChain, setBuildingFreeChain] = useState(false);
  const [autoPolicy, setAutoPolicy] = useState<'free_only' | 'free_first' | 'all'>('free_only');

  // New chain form
  const [newChainName, setNewChainName] = useState('');
  const [newChainMode, setNewChainMode] = useState<ChainMode>('priority');
  const [newChainDesc, setNewChainDesc] = useState('');

  // Selected chain
  const activeChain = chains.find(c => c.id === selectedChainId) || chains[0];

  const handleCreateChain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChainName.trim()) return;
    try {
      const res = await fetchJson<any>('/api/chains', {
        method: 'POST',
        body: JSON.stringify({
          name: newChainName.trim(),
          mode: newChainMode,
          description: newChainDesc,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setShowAddChainModal(false);
      setSelectedChainId(res.chainId);
      setNewChainName('');
      setNewChainDesc('');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAutoBuildChain = async (policy: 'free_only' | 'free_first' | 'all' = autoPolicy) => {
    setBuildingFreeChain(true);
    try {
      await fetchJson('/api/chains/auto-build', {
        method: 'POST',
        body: JSON.stringify({ policy, chainId: activeChain?.id || 'chain_auto' }),
      });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBuildingFreeChain(false);
    }
  };

  const handleUpdateMode = async (mode: ChainMode) => {
    if (!activeChain) return;
    try {
      await fetchJson(`/api/chains/${activeChain.id}`, {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleMoveTarget = async (currentIndex: number, direction: 'up' | 'down') => {
    if (!activeChain?.targets) return;
    const targetIdx = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIdx < 0 || targetIdx >= activeChain.targets.length) return;

    const reordered = [...activeChain.targets];
    const temp = reordered[currentIndex];
    reordered[currentIndex] = reordered[targetIdx];
    reordered[targetIdx] = temp;

    const payload = reordered.map(t => ({
      providerId: t.providerId,
      modelId: t.modelId,
      requiresTools: t.requiresTools,
      minContextWindow: t.minContextWindow,
    }));

    try {
      await fetchJson(`/api/chains/${activeChain.id}/targets`, {
        method: 'PUT',
        body: JSON.stringify({ targets: payload }),
      });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRemoveTarget = async (targetIndex: number) => {
    if (!activeChain?.targets) return;
    const updated = activeChain.targets.filter((_, idx) => idx !== targetIndex);
    const payload = updated.map(t => ({
      providerId: t.providerId,
      modelId: t.modelId,
      requiresTools: t.requiresTools,
      minContextWindow: t.minContextWindow,
    }));

    try {
      await fetchJson(`/api/chains/${activeChain.id}/targets`, {
        method: 'PUT',
        body: JSON.stringify({ targets: payload }),
      });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAddTarget = async (providerId: string, modelId: string) => {
    if (!activeChain) return;
    const currentTargets = activeChain.targets || [];
    const payload = [
      ...currentTargets.map(t => ({
        providerId: t.providerId,
        modelId: t.modelId,
        requiresTools: t.requiresTools,
        minContextWindow: t.minContextWindow,
      })),
      {
        providerId,
        modelId,
        requiresTools: false,
        minContextWindow: null,
      },
    ];

    try {
      await fetchJson(`/api/chains/${activeChain.id}/targets`, {
        method: 'PUT',
        body: JSON.stringify({ targets: payload }),
      });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setShowAddTargetModal(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">{t('chains.title')}</h1>
          <p className="text-xs text-text-secondary mt-1">
            {t('chains.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-bg-surface p-1 rounded-md border border-border-default shadow-subtle">
            <span className="text-[11px] text-text-muted pl-1.5 font-medium">{t('chains.policy')}</span>
            <select
              value={autoPolicy}
              onChange={(e) => setAutoPolicy(e.target.value as any)}
              className="bg-bg-raised border border-border-subtle rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent font-medium cursor-pointer"
              title={t('chains.policyTooltip')}
            >
              <option value="free_only">{t('chains.policyFreeOnly')}</option>
              <option value="free_first">{t('chains.policyFreeFirst')}</option>
              <option value="all">{t('chains.policyAll')}</option>
            </select>

            <button
              onClick={() => handleAutoBuildChain(autoPolicy)}
              disabled={buildingFreeChain}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-status-healthy text-white hover:opacity-90 text-xs font-medium transition-opacity shadow-subtle disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{buildingFreeChain ? t('chains.building') : t('chains.autoBuildChain')}</span>
            </button>
          </div>

          <button
            onClick={() => setShowAddChainModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover text-xs font-medium transition-colors shadow-subtle"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('chains.newChain')}</span>
          </button>
        </div>
      </div>

      {/* Chain Selector Tabs */}
      <div className="flex items-center gap-2 border-b border-border-default pb-2 overflow-x-auto">
        {chains.map(c => {
          const isSelected = activeChain?.id === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedChainId(c.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors border ${
                isSelected
                  ? 'bg-accent-subtle text-accent border-accent-border'
                  : 'bg-bg-surface text-text-secondary border-border-default hover:text-text-primary'
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </div>

      {activeChain && (() => {
        const freeCount = activeChain.targets?.filter(t => t.isFree ?? isFreeModelId(t.modelId)).length || 0;
        const totalCount = activeChain.targets?.length || 0;
        const paidCount = totalCount - freeCount;

        return (
        <div className="space-y-6">
          {/* Chain Settings Header Card */}
          <div className="p-4 rounded-md bg-bg-surface border border-border-default flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-base font-semibold text-text-primary">{activeChain.name}</span>
                <span className="text-xs text-text-muted">{t('chains.targetsCount', { count: totalCount })}</span>
                {totalCount > 0 && paidCount === 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-status-healthy-bg text-status-healthy border border-[rgba(47,158,68,0.3)]">
                    {t('chains.freeGuaranteedBadge')}
                  </span>
                )}
                {totalCount > 0 && paidCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[rgba(245,159,0,0.15)] text-[#f59f00] border border-[rgba(245,159,0,0.3)]">
                    {t('chains.freePlusPaidBadge', { free: freeCount, paid: paidCount })}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-secondary mt-1">
                {activeChain.description || t('chains.defaultTargetDesc', { name: activeChain.name })}
              </p>
            </div>

            {/* Mode Toggle: Priority vs Sticky */}
            <div className="flex items-center gap-2 bg-bg-base p-1 rounded border border-border-subtle">
              <button
                onClick={() => handleUpdateMode('priority')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  activeChain.mode === 'priority'
                    ? 'bg-accent text-white shadow-subtle'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t('chains.priorityMode')}
              </button>
              <button
                onClick={() => handleUpdateMode('sticky')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  activeChain.mode === 'sticky'
                    ? 'bg-accent text-white shadow-subtle'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t('chains.stickyMode')}
              </button>
            </div>
          </div>

          {/* Targets List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
                {t('chains.failoverOrder')}
              </h2>
              <button
                onClick={() => setShowAddTargetModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-bg-surface border border-border-default hover:bg-bg-raised text-text-primary text-xs font-medium transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>{t('chains.addTarget')}</span>
              </button>
            </div>

            {!activeChain.targets || activeChain.targets.length === 0 ? (
              <div className="p-8 text-center rounded-md bg-bg-surface border border-border-default text-xs text-text-muted space-y-2">
                <img src="/assets/icon.svg" alt="NonStop Router" className="w-8 h-8 mx-auto opacity-50" width={32} height={32} />
                <div>{t('chains.noTargets')}</div>
              </div>
            ) : (
              <div className="space-y-2">
                {activeChain.targets.map((tTarget, idx) => {
                  const isFree = tTarget.isFree ?? isFreeModelId(tTarget.modelId);

                  return (
                    <div
                      key={tTarget.id}
                      className="p-3.5 rounded-md bg-bg-surface border border-border-default flex items-center justify-between gap-3 hover:border-border-strong transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded bg-bg-raised border border-border-subtle flex items-center justify-center font-mono text-[11px] font-semibold text-text-muted">
                          {idx + 1}
                        </div>

                        <ModelLogo modelId={tTarget.modelId} providerName={tTarget.providerName} size={26} />

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-text-primary">{tTarget.modelId}</span>
                            {isFree ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-status-healthy-bg text-status-healthy border border-[rgba(47,158,68,0.3)]">
                                {t('common.free')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-[rgba(245,159,0,0.15)] text-[#f59f00] border border-[rgba(245,159,0,0.3)]">
                                {t('common.paid')}
                              </span>
                            )}
                            <span className="text-[11px] text-text-muted">({tTarget.providerName})</span>
                            <StatusBadge status={tTarget.status || 'healthy'} />
                          </div>
                          <div className="text-[10px] text-text-muted mt-0.5">
                            {idx === 0 ? t('chains.primaryActiveRoute') : t('chains.fallbackRoute', { idx })}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleMoveTarget(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                          title={t('chains.moveUp')}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleMoveTarget(idx, 'down')}
                          disabled={idx === activeChain.targets!.length - 1}
                          className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                          title={t('chains.moveDown')}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRemoveTarget(idx)}
                          className="p-1 rounded hover:bg-bg-raised text-text-muted hover:text-status-error transition-colors ml-2"
                          title={t('chains.removeTarget')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Add Target Modal */}
      {showAddTargetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowAddTargetModal(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <h2 className="text-base font-semibold text-text-primary">{t('chains.addTargetModalTitle')}</h2>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {models.filter(m => m.enabled).map((m: any) => {
                const isFree = isFreeModelId(m.modelId);
                return (
                  <div
                    key={m.id}
                    className="p-2.5 rounded bg-bg-raised border border-border-subtle flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <ModelLogo modelId={m.modelId} providerName={m.providerName} size={22} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium text-text-primary">{m.modelId}</span>
                          {isFree && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-status-healthy-bg text-status-healthy">
                              {t('common.free')}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-text-muted">{m.providerName}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddTarget(m.providerId, m.modelId)}
                      className="px-2.5 py-1 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
                    >
                      {t('chains.select')}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end pt-2 border-t border-border-subtle">
              <button
                onClick={() => setShowAddTargetModal(false)}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Chain Modal */}
      {showAddChainModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowAddChainModal(false)} />
          <div className="relative z-10 w-full max-w-md rounded-md bg-bg-surface border border-border-default p-6 shadow-overlay space-y-4">
            <h2 className="text-base font-semibold text-text-primary">{t('chains.createNewChainModalTitle')}</h2>
            <form onSubmit={handleCreateChain} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('chains.chainName')}</label>
                <input
                  type="text"
                  required
                  value={newChainName}
                  onChange={e => setNewChainName(e.target.value)}
                  placeholder={t('chains.chainNamePlaceholder')}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('chains.failoverMode')}</label>
                <select
                  value={newChainMode}
                  onChange={e => setNewChainMode(e.target.value as any)}
                  className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                >
                  <option value="priority">{t('chains.priorityModeOption')}</option>
                  <option value="sticky">{t('chains.stickyModeOption')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">{t('chains.descriptionOptional')}</label>
                <input
                  type="text"
                  value={newChainDesc}
                  onChange={e => setNewChainDesc(e.target.value)}
                  placeholder={t('chains.descriptionPlaceholder')}
                  className="w-full px-3 py-1.5 text-xs rounded bg-bg-base border border-border-default focus:border-accent focus:outline-none text-text-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setShowAddChainModal(false)}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium rounded bg-accent text-white hover:bg-accent-hover transition-colors shadow-subtle"
                >
                  {t('chains.createChainBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
