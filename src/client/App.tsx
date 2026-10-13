import React, { useState, useEffect } from 'react';
import { useProviders, useOverview, fetchJson } from './api.js';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar, type PageId } from './components/Sidebar.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { ProvidersPage } from './pages/ProvidersPage.js';
import { ModelsPage } from './pages/ModelsPage.js';
import { ChainsPage } from './pages/ChainsPage.js';
import { ConnectPage } from './pages/ConnectPage.js';
import { LogsPage } from './pages/LogsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { PlaygroundDrawer } from './components/PlaygroundDrawer.js';
import { Menu, Play } from 'lucide-react';

export const App: React.FC = () => {
  const queryClient = useQueryClient();
  const [activePage, setActivePage] = useState<PageId>('overview');
  const [isDark, setIsDark] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(() => {
    return localStorage.getItem('nonstop_wizard_dismissed') === 'true';
  });

  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [playgroundModel, setPlaygroundModel] = useState('auto');

  const openPlayground = (modelId: string = 'auto') => {
    setPlaygroundModel(modelId);
    setPlaygroundOpen(true);
  };

  const handleDismissWizard = () => {
    setWizardDismissed(true);
    localStorage.setItem('nonstop_wizard_dismissed', 'true');
  };


  const { data: providers = [], isLoading: loadingProviders } = useProviders();

  // Initialize theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('nonstop_theme') || 'dark';
    const isDarkTheme = savedTheme === 'dark';
    setIsDark(isDarkTheme);
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const handleToggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    localStorage.setItem('nonstop_theme', newDark ? 'dark' : 'light');
    if (newDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  };

  // Connect to SSE live updates
  useEffect(() => {
    const sse = new EventSource('/api/events');

    sse.addEventListener('request_completed', () => {
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['logs'] });
    });

    sse.addEventListener('target_recovered', () => {
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      queryClient.invalidateQueries({ queryKey: ['chains'] });
    });

    sse.addEventListener('key_recovered', () => {
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
    });

    return () => {
      sse.close();
    };
  }, [queryClient]);

  // Show onboarding wizard if no providers exist and user hasn't dismissed it
  const showWizard = !loadingProviders && providers.length === 0 && !wizardDismissed;

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        activePage={activePage}
        onSelectPage={setActivePage}
        isDark={isDark}
        onToggleTheme={handleToggleTheme}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Mobile Topbar */}
        <header className="md:hidden flex items-center justify-between p-3 border-b border-border-default bg-bg-surface">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md hover:bg-bg-raised text-text-primary"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center justify-center">
            <img src="/assets/icon.svg" alt="NonStop Router" className="w-7 h-7" width={28} height={28} />
          </div>
          <div className="w-8" />
        </header>

        {/* Scrollable Page Body */}
        <main className="flex-1 overflow-y-auto">
          {activePage === 'overview' && <OverviewPage onNavigate={setActivePage} onOpenPlayground={openPlayground} />}
          {activePage === 'providers' && <ProvidersPage />}
          {activePage === 'models' && <ModelsPage onOpenPlayground={openPlayground} />}
          {activePage === 'chains' && <ChainsPage />}
          {activePage === 'connect' && <ConnectPage />}
          {activePage === 'logs' && <LogsPage />}
          {activePage === 'settings' && <SettingsPage />}
        </main>
      </div>

      {/* Interactive Playground Drawer */}
      <PlaygroundDrawer
        isOpen={playgroundOpen}
        onClose={() => setPlaygroundOpen(false)}
        initialModel={playgroundModel}
      />

      {/* First-Run Onboarding Wizard */}
      {showWizard && (
        <OnboardingWizard
          onComplete={handleDismissWizard}
          onClose={handleDismissWizard}
        />
      )}
    </div>
  );
};
