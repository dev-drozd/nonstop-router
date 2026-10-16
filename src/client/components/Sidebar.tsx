import React from 'react';
import { Activity, Server, Cpu, GitFork, Terminal, FileText, Settings, Moon, Sun, Menu, X, Sparkles, Radio } from 'lucide-react';
import { useI18n } from '../i18n/index.js';

export type PageId = 'overview' | 'flow' | 'providers' | 'models' | 'chains' | 'connect' | 'logs' | 'settings';

interface SidebarProps {
  activePage: PageId;
  onSelectPage: (page: PageId) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onSelectPage,
  isDark,
  onToggleTheme,
  mobileOpen,
  onCloseMobile,
}) => {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    return localStorage.getItem('nonstop_sidebar_collapsed') === 'true';
  });

  const toggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('nonstop_sidebar_collapsed', String(next));
      return next;
    });
  };

  const navItems: Array<{ id: PageId; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: t('sidebar.overview'), icon: <Activity className="w-4 h-4" /> },
    { id: 'flow', label: t('sidebar.flow'), icon: <Radio className="w-4 h-4" /> },
    { id: 'providers', label: t('sidebar.providers'), icon: <Server className="w-4 h-4" /> },
    { id: 'models', label: t('sidebar.models'), icon: <Cpu className="w-4 h-4" /> },
    { id: 'chains', label: t('sidebar.chains'), icon: <GitFork className="w-4 h-4" /> },
    { id: 'connect', label: t('sidebar.connect'), icon: <Terminal className="w-4 h-4" /> },
    { id: 'logs', label: t('sidebar.logs'), icon: <FileText className="w-4 h-4" /> },
    { id: 'settings', label: t('sidebar.settings'), icon: <Settings className="w-4 h-4" /> },
  ];

  const handleNavClick = (id: PageId) => {
    onSelectPage(id);
    onCloseMobile();
  };

  const renderContent = (isMobileDrawer = false) => {
    const isMini = collapsed && !isMobileDrawer;

    return (
      <div className={`flex flex-col h-full bg-bg-surface border-r border-border-default select-none transition-all duration-200 ${isMini ? 'w-16' : 'w-64'}`}>
        {/* Brand Header */}
        <div className={`p-4 border-b border-border-default flex items-center ${isMini ? 'justify-center' : 'justify-between'}`}>
          {isMini ? (
            <button
              onClick={toggleCollapse}
              className="p-1 rounded-md hover:bg-bg-raised transition-colors focus:outline-none"
              title={t('sidebar.expandSidebar')}
            >
              <img src="/assets/icon.svg" alt="NonStop Router" className="w-7 h-7" width={28} height={28} />
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <img src="/assets/icon.svg" alt="NonStop Router" className="w-7 h-7 shrink-0" width={28} height={28} />
              <div>
                <div className="font-semibold text-sm tracking-tight text-text-primary">NonStop Router</div>
                <div className="text-[11px] font-mono text-text-muted">127.0.0.1:4000</div>
              </div>
            </div>
          )}

          {!isMobileDrawer && !isMini && (
            <button
              onClick={toggleCollapse}
              className="hidden md:flex p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-raised transition-colors"
              title={t('sidebar.collapseSidebar')}
              aria-label={t('sidebar.collapseSidebar')}
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          {isMobileDrawer && (
            <button
              onClick={onCloseMobile}
              className="p-1 text-text-secondary hover:text-text-primary"
              aria-label={t('sidebar.closeMenu')}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Nav List */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                title={isMini ? item.label : undefined}
                className={`w-full flex items-center ${isMini ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2'} rounded-md text-xs font-medium transition-colors text-left ${
                  isActive
                    ? 'bg-accent-subtle text-accent border border-accent-border'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-raised border border-transparent'
                }`}
              >
                <span className={isActive ? 'text-accent' : 'text-text-muted'}>{item.icon}</span>
                {!isMini && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Footer Info & Theme / Language Toggle */}
        <div className="p-3 border-t border-border-default space-y-2">
          <div className={`flex items-center ${isMini ? 'flex-col gap-2' : 'justify-between px-2'} py-1 text-xs text-text-muted`}>
            <div className="flex items-center gap-2" title={t('status.gatewayActive')}>
              <span className="w-2 h-2 rounded-full bg-status-healthy" />
              {!isMini && <span className="text-[11px]">{t('status.gatewayActive')}</span>}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onToggleTheme}
                className="p-1.5 rounded-md hover:bg-bg-raised text-text-secondary hover:text-text-primary transition-colors"
                title={isDark ? t('sidebar.switchToLight') : t('sidebar.switchToDark')}
              >
                {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:block h-screen shrink-0 sticky top-0">
        {renderContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={onCloseMobile} />
          <div className="relative z-10 w-64 max-w-[80vw] h-full shadow-overlay">
            {renderContent(true)}
          </div>
        </div>
      )}
    </>
  );
};
