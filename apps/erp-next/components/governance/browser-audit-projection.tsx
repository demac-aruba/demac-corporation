'use client';

import { useMemo, useState } from 'react';
import { loadBrowserAuditProjection, type BrowserAuditProjectionEvent } from '../../lib/browser-audit-projection';
import styles from './browser-audit-projection.module.css';

const importanceOptions: Array<'all' | BrowserAuditProjectionEvent['importance']> = ['all', 'normal', 'sensitive', 'financial'];

function formatWhen(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function BrowserAuditProjection() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [moduleFilter, setModuleFilter] = useState('all');
  const [importanceFilter, setImportanceFilter] = useState<(typeof importanceOptions)[number]>('all');
  const [query, setQuery] = useState('');

  const events = useMemo(() => loadBrowserAuditProjection(), [refreshKey]);
  const modules = useMemo(() => ['all', ...Array.from(new Set(events.map((event) => event.module))).sort()], [events]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (moduleFilter !== 'all' && event.module !== moduleFilter) return false;
      if (importanceFilter !== 'all' && event.importance !== importanceFilter) return false;
      if (!needle) return true;
      return `${event.action} ${event.entityType} ${event.entityId} ${event.actor} ${event.detail} ${event.module}`.toLowerCase().includes(needle);
    });
  }, [events, importanceFilter, moduleFilter, query]);

  const metrics = useMemo(() => ({
    total: events.length,
    financial: events.filter((event) => event.importance === 'financial').length,
    sensitive: events.filter((event) => event.importance === 'sensitive').length,
    modules: new Set(events.map((event) => event.module)).size,
  }), [events]);

  return (
    <section className={styles.audit}>
      <header>
        <div><span>GOVERNANCE · TEST TRANSACTION TRACE</span><h2>Live Audit Projection</h2><p>Chronological trace derived from the browser-persistent ERP workflow. It helps validate traceability now, but it is not immutable production audit evidence.</p></div>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh Events</button>
      </header>

      <div className={styles.metrics}>
        <article><span>Projected Events</span><strong>{metrics.total}</strong><small>Across current browser workflow</small></article>
        <article><span>Financial Events</span><strong>{metrics.financial}</strong><small>Billing, payments, inventory value signals</small></article>
        <article><span>Sensitive Events</span><strong>{metrics.sensitive}</strong><small>Confirmation, report review, delivery</small></article>
        <article><span>Source Modules</span><strong>{metrics.modules}</strong><small>Cross-module traceability</small></article>
      </div>

      <div className={styles.filters}>
        <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Entity, action, actor, detail..." /></label>
        <label>Module<select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>{modules.map((module) => <option value={module} key={module}>{module === 'all' ? 'All modules' : module}</option>)}</select></label>
        <label>Importance<select value={importanceFilter} onChange={(event) => setImportanceFilter(event.target.value as (typeof importanceOptions)[number])}>{importanceOptions.map((importance) => <option value={importance} key={importance}>{importance === 'all' ? 'All importance' : importance}</option>)}</select></label>
        <b>{filtered.length} shown</b>
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.table}>
          <div className={`${styles.row} ${styles.head}`}><span>Time</span><span>Module / Action</span><span>Entity</span><span>Actor</span><span>Detail</span><span>Importance</span></div>
          {filtered.length ? filtered.map((event) => <div className={styles.row} key={event.id}>
            <time>{formatWhen(event.occurredAt)}</time>
            <div><strong>{event.action}</strong><small>{event.module}</small></div>
            <div><strong>{event.entityType}</strong><small>{event.entityId}</small></div>
            <span>{event.actor}</span>
            <p>{event.detail}</p>
            <b className={styles[event.importance]}>{event.importance}</b>
          </div>) : <div className={styles.empty}><strong>No matching projected events</strong><p>Create workflow records or loosen the current filters.</p></div>}
        </div>
      </div>

      <footer><div><span>PREVIEW AUDIT LIMITATION</span><strong>Actor labels in this view are inferred from browser workflow context. Production AuditEvent records must use authenticated identity, append-only event writes and durable server/database timestamps.</strong></div><a href="/security/">Open Security Foundation →</a></footer>
    </section>
  );
}
