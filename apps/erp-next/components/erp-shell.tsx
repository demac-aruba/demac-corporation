'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { foundationRole, navigationGroups } from '@/lib/navigation';

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

export function ErpShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const groups = useMemo(
    () => navigationGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(foundationRole)) }))
      .filter((group) => group.items.length > 0),
    [],
  );

  useEffect(() => setSidebarOpen(false), [pathname]);

  return (
    <div className="erp-frame">
      <aside className={`erp-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-block">
          <div className="brand-mark">D</div>
          <div>
            <strong>DEMAC</strong>
            <span>ERP NEXT</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link className={`nav-item ${active ? 'active' : ''}`} href={item.href} key={item.href}>
                    <span className="nav-glyph">{item.short}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="environment-pill"><span /> Foundation Preview</div>
          <small>Legacy remains isolated</small>
        </div>
      </aside>

      {sidebarOpen ? <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="erp-main">
        <header className="erp-topbar">
          <button className="menu-trigger" type="button" onClick={() => setSidebarOpen((value) => !value)} aria-label="Open navigation">☰</button>
          <div className="global-search">
            <span>⌕</span>
            <input aria-label="Global search" placeholder="Search customers, work orders, invoices, assets..." />
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <ThemeControl />
            <button className="icon-action" type="button" aria-label="Notifications">◌<b>4</b></button>
            <div className="owner-chip">
              <div className="avatar">CM</div>
              <div><strong>Christian</strong><span>Super Admin</span></div>
            </div>
          </div>
        </header>

        <main className="erp-content">{children}</main>
      </div>
    </div>
  );
}
