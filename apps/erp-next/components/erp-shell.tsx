'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { TextSizeControl } from '@/components/accessibility/text-size-control';
import { principalRoleLabel, useAuth } from '@/components/auth/auth-provider';
import { navigationGroups } from '@/lib/navigation';

function ThemeControl() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(current);
  }, []);

  const apply = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('demac-theme', next);
  };

  return (
    <div className="theme-control" aria-label="Theme">
      <button className={theme === 'light' ? 'active' : ''} onClick={() => apply('light')} type="button">Light</button>
      <button className={theme === 'dark' ? 'active' : ''} onClick={() => apply('dark')} type="button">Dark</button>
    </div>
  );
}

const quickActions = [
  { label: 'Create customer', detail: 'CRM master data', href: '/crm', short: 'CU' },
  { label: 'Book appointment', detail: 'Scheduling & Dispatch', href: '/scheduling', short: 'AP' },
  { label: 'Open work orders', detail: 'Field operations', href: '/work-orders', short: 'WO' },
  { label: 'Capture expense', detail: 'Finance & evidence', href: '/expenses', short: 'EX' },
  { label: 'Reconcile payments', detail: 'Banking / allocation', href: '/payments', short: 'PA' },
  { label: 'Ask Executive AI', detail: 'Management intelligence', href: '/executive-ai', short: 'AI' },
];

const notifications = [
  { tone: 'critical', title: 'Expense budget ahead of pace', detail: '81% spent with 35% of month elapsed.', href: '/kpis' },
  { tone: 'warning', title: 'Customer balance remains', detail: 'Afl. 1,000 requires collection follow-up.', href: '/invoices' },
  { tone: 'warning', title: 'Van 2 stock at risk', detail: '220V switches projected below par.', href: '/vans' },
  { tone: 'opportunity', title: 'Sales ahead of pace', detail: 'Monthly sales are materially ahead of elapsed time.', href: '/kpis' },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'DU';
}

export function ErpShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, principal, firebaseConfigured, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [query, setQuery] = useState('');

  const groups = useMemo(
    () => navigationGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(principal.role)) }))
      .filter((group) => group.items.length > 0),
    [principal.role],
  );

  const searchableModules = useMemo(() => groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))), [groups]);
  const accessibleHrefs = useMemo(() => new Set(searchableModules.map((item) => item.href)), [searchableModules]);
  const visibleQuickActions = useMemo(() => quickActions.filter((item) => accessibleHrefs.has(item.href)), [accessibleHrefs]);
  const visibleNotifications = useMemo(() => notifications.filter((item) => accessibleHrefs.has(item.href)), [accessibleHrefs]);
  const normalizedQuery = query.trim().toLowerCase();
  const moduleResults = useMemo(() => {
    if (!normalizedQuery) return searchableModules.slice(0, 10);
    return searchableModules.filter((item) => `${item.label} ${item.group} ${item.short}`.toLowerCase().includes(normalizedQuery)).slice(0, 12);
  }, [normalizedQuery, searchableModules]);
  const actionResults = useMemo(() => {
    if (!normalizedQuery) return visibleQuickActions;
    return visibleQuickActions.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, visibleQuickActions]);

  useEffect(() => setSidebarOpen(false), [pathname]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
        setNotificationsOpen(false);
        setSessionOpen(false);
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
        setNotificationsOpen(false);
        setSessionOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navigate = (href: string) => {
    setCommandOpen(false);
    setNotificationsOpen(false);
    setSessionOpen(false);
    setQuery('');
    router.push(href);
  };

  const logout = () => {
    signOut();
    setSessionOpen(false);
    router.replace('/login');
  };

  return (
    <div className="erp-frame">
      <aside className={`erp-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-block">
          <div className="brand-mark">D</div>
          <div><strong>DEMAC</strong><span>ERP NEXT</span></div>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active = pathname === item.href;
                return <Link className={`nav-item ${active ? 'active' : ''}`} href={item.href} key={item.href}><span className="nav-glyph">{item.short}</span><span>{item.label}</span></Link>;
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="environment-pill"><span /> Secure Firebase Session</div>
          <small>{principalRoleLabel(principal)} · authenticated</small>
        </div>
      </aside>

      {sidebarOpen ? <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="erp-main">
        <header className="erp-topbar">
          <button className="menu-trigger" type="button" onClick={() => setSidebarOpen((value) => !value)} aria-label="Open navigation">☰</button>
          <label className="global-search" onClick={() => { setCommandOpen(true); setNotificationsOpen(false); setSessionOpen(false); }}>
            <span>⌕</span>
            <input aria-label="Global search" value={query} onFocus={() => { setCommandOpen(true); setNotificationsOpen(false); setSessionOpen(false); }} onChange={(event) => setQuery(event.target.value)} placeholder="Search modules, customers, work orders, invoices..." />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar-actions">
            <ThemeControl />
            <div className="notification-anchor">
              <button className="icon-action" type="button" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => { setNotificationsOpen((current) => !current); setCommandOpen(false); setSessionOpen(false); }}>◌<b>{visibleNotifications.length}</b></button>
              {notificationsOpen ? <div className="notification-popover"><header><div><strong>Management Alerts</strong><span>Exception-first attention queue</span></div><button type="button" onClick={() => setNotificationsOpen(false)}>×</button></header>{visibleNotifications.map((item) => <button type="button" className={`notification-row notification-${item.tone}`} key={item.title} onClick={() => navigate(item.href)}><i /><div><strong>{item.title}</strong><span>{item.detail}</span></div></button>)}<button className="notification-footer" type="button" onClick={() => navigate('/kpis')}>Open full attention queue →</button></div> : null}
            </div>
            <div className="notification-anchor">
              <button className="owner-chip" type="button" aria-label="Account and session" aria-expanded={sessionOpen} onClick={() => { setSessionOpen((current) => !current); setNotificationsOpen(false); setCommandOpen(false); }} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
                <div className="avatar">{initials(principal.displayName)}</div>
                <div><strong>{principal.displayName}</strong><span>{status === 'loading' ? 'Checking session…' : principalRoleLabel(principal)}</span></div>
              </button>
              {sessionOpen ? <div className="session-popover"><header><strong>{principal.displayName}</strong><span>{principalRoleLabel(principal)}</span></header><div><span>Security mode</span><strong>Firebase authenticated</strong></div><div><span>Firebase client</span><strong>{firebaseConfigured ? 'Configuration detected' : 'Configuration unavailable'}</strong></div><TextSizeControl compact /><button className="danger" type="button" onClick={logout}>Sign out securely</button></div> : null}
            </div>
          </div>
        </header>

        <main className="erp-content">{children}</main>
      </div>

      {commandOpen ? <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}>
        <section className="command-palette" role="dialog" aria-modal="true" aria-label="DEMAC command palette">
          <header className="command-input-row"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ERP Next or type an action..." /><kbd>ESC</kbd></header>
          <div className="command-results">
            {actionResults.length > 0 ? <section><div className="command-section-label">Quick Actions</div>{actionResults.map((item) => <button type="button" className="command-result" key={`action-${item.label}`} onClick={() => navigate(item.href)}><span className="command-glyph">{item.short}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div><em>Open</em></button>)}</section> : null}
            {moduleResults.length > 0 ? <section><div className="command-section-label">Modules</div>{moduleResults.map((item) => <button type="button" className="command-result" key={item.href} onClick={() => navigate(item.href)}><span className="command-glyph">{item.short}</span><div><strong>{item.label}</strong><small>{item.group}</small></div><em>Go</em></button>)}</section> : null}
            {actionResults.length === 0 && moduleResults.length === 0 ? <div className="command-empty"><strong>No matching ERP destination</strong><span>Customer/work-order/entity search will use the live repository after Firebase data mode is enabled.</span></div> : null}
          </div>
          <footer className="command-footer"><span>↑↓ Navigate</span><span>Enter Open</span><span>⌘K Toggle</span></footer>
        </section>
      </div> : null}
    </div>
  );
}
