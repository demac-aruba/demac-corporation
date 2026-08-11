'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { loadWorkOrderScopes, scopeStatus, type BrowserWorkOrderScopeRecord } from '../../lib/browser-workorder-scope';
import styles from './browser-field-scope-status.module.css';

export function BrowserFieldScopeStatus() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [scopes, setScopes] = useState<BrowserWorkOrderScopeRecord[]>([]);

  useEffect(() => {
    setOrders(loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []));
    setScopes(loadWorkOrderScopes());
  }, []);

  const statusRows = useMemo(() => orders.slice().reverse().map((order) => {
    const scope = scopes.find((candidate) => candidate.workOrderId === order.id);
    return { order, scope, status: scopeStatus(order, scope) };
  }), [orders, scopes]);

  if (!orders.length) return null;
  const incomplete = statusRows.filter((row) => !row.status.complete).length;

  return (
    <section className={styles.status}>
      <header><div><span>FIELD PRE-FLIGHT · EQUIPMENT SCOPE</span><strong>{incomplete ? `${incomplete} Work Order${incomplete === 1 ? '' : 's'} need exact HVAC scope` : 'All browser Work Orders have exact equipment scope'}</strong><p>The technician should execute only the registered/planned units explicitly assigned to the Work Order.</p></div><a href="/work-orders/scope/">Manage Exact Scope →</a></header>
      <div className={styles.rows}>{statusRows.slice(0, 5).map(({ order, scope, status }) => <article key={order.id} className={status.complete ? styles.complete : styles.incomplete}><div><strong>{order.id}</strong><span>{order.customer} · {order.site}</span></div><div><span>Expected</span><strong>{order.totalQuantity} unit{order.totalQuantity === 1 ? '' : 's'}</strong></div><div><span>Scoped</span><strong>{scope?.items.length ?? 0}</strong></div><b>{status.complete ? 'READY FOR FIELD' : 'SCOPE REQUIRED'}</b></article>)}</div>
    </section>
  );
}
