import React from 'react';
import { Activity, Server, Cpu, GitFork, Terminal, FileText, Settings, Moon, Sun, Menu, X } from 'lucide-react';

export type PageId = 'overview' | 'providers' | 'models' | 'chains' | 'connect' | 'logs' | 'settings';

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
  const navItems: Array<{ id: PageId; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Activity className="w-4 h-4" /> },
    { id: 'providers', label: 'Providers & Keys', icon: <Server className="w-4 h-4" /> },
    { id: 'models', label: 'Models', icon: <Cpu className="w-4 h-4" /> },
    { id: 'chains', label: 'Chains', icon: <GitFork className="w-4 h-4" /> },
    { id: 'connect', label: 'Connect Tools', icon: <Terminal className="w-4 h-4" /> },
    { id: 'logs', label: 'Request Logs', icon: <FileText className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  const handleNavClick = (id: PageId) => {
    onSelectPage(id);
    onCloseMobile();
  };

  const content = (
    <div className="flex flex-col h-full bg-bg-surface border-r border-border-default select-none w-64">
      {/* Brand Header */}
      <div className="p-4 border-b border-border-default flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-[#1F1C19] border border-border-strong flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
              <path d="M7 11h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H7" stroke="#E8590C" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M25 21H14a5 5 0 0 1-5-5v0a5 5 0 0 1 5-5h11" stroke="#E8590C" strokeWidth="2.5" strokeLinecap="round"/>
              <circle cx="7" cy="11" r="2" fill="#E8590C"/>
              <circle cx="25" cy="21" r="2" fill="#E8590C"/>
            </svg>
          </div>
          <div>
            <div className="font-semibold text-sm tracking-tight text-text-primary">NonStop Router</div>
            <div className="text-[11px] font-mono text-text-muted">127.0.0.1:4000</div>
          </div>
        </div>
        <button
          onClick={onCloseMobile}
          className="md:hidden p-1 text-text-secondary hover:text-text-primary"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Nav List */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors text-left ${
                isActive
                  ? 'bg-accent-subtle text-accent border border-accent-border'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-raised border border-transparent'
              }`}
            >
              <span className={isActive ? 'text-accent' : 'text-text-muted'}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer Info & Theme Toggle */}
      <div className="p-3 border-t border-border-default space-y-2">
        <div className="flex items-center justify-between px-2 py-1 text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-healthy" />
            <span className="text-[11px]">Gateway Active</span>
          </div>
          <button
            onClick={onToggleTheme}
            className="p-1.5 rounded-md hover:bg-bg-raised text-text-secondary hover:text-text-primary transition-colors"
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:block h-screen shrink-0 sticky top-0">
        {content}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={onCloseMobile} />
          <div className="relative z-10 w-64 max-w-[80vw] h-full shadow-overlay">
            {content}
          </div>
        </div>
      )}
    </>
  );
};
