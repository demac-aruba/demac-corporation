'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import { loadCustomerEventSnapshot, type BrowserCustomerEvent } from '../../lib/browser-customer-events';
import styles from './browser-customer-timeline.module.css';

type CustomerIdentity = { id: string; name: string; type?: string; location?: string };

function formatWhen(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function eventTone(event: BrowserCustomerEvent) {
  return styles[event.tone] ?? styles.neutral;
}

export function BrowserCustomerTimeline() {
  const [customers, setCustomers] = useState<CustomerIdentity[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const stored = loadBrowserValue<CustomerIdentity[]>(browserKeys.customers, []);
    setCustomers(stored);
    setSelectedId(stored[0]?.id ?? '');
  }, []);

  const selected = customers.find((customer) => customer.id === selectedId);
  const snapshot = useMemo(() => selectedId ? loadCustomerEventSnapshot(selectedId) : { events: [], openWork: 0, approvedReports: 0, sentReports: 0, detectedPayments: 0 }, [selectedId, refreshKey]);

  if (!customers.length) return null;

  return (
    <section className={styles.timeline}>
      <header><div><span>CUSTOMER 360 · LIVE RELATIONSHIP MEMORY</span><h2>Unified Customer Timeline</h2><p>Scheduling, field work, office review, customer delivery, billing and payments resolve back to the same customer identity.</p></div><div className={styles.controls}><label>Customer<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} · {customer.location || customer.type || customer.id}</option>)}</select></label><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh activity</button></div></header>

      <div className={styles.metrics}><article><span>Open Work</span><strong>{snapshot.openWork}</strong><small>Work Orders not yet field-submitted</small></article><article><span>Approved Reports</span><strong>{snapshot.approvedReports}</strong><small>Office quality gate passed</small></article><article><span>Reports Sent</span><strong>{snapshot.sentReports}</strong><small>Human delivery recorded</small></article><article><span>Detected Payments</span><strong>{snapshot.detectedPayments}</strong><small>Customer-linked bank staging</small></article></div>

      <div className={styles.content}>
        <div className={styles.identity}><div className={styles.avatar}>{selected?.name.split(/\s+/).map((part) => part[0]).slice(0,2).join('').toUpperCase()}</div><div><span>{selected?.id}</span><strong>{selected?.name}</strong><small>{selected?.type ?? 'Customer'} · {selected?.location ?? 'Aruba'}</small></div></div>
        <div className={styles.events}>{snapshot.events.length ? snapshot.events.slice(0,18).map((event) => <article key={event.id}><div className={`${styles.dot} ${eventTone(event)}`} /><time>{formatWhen(event.occurredAt)}</time><div><div><strong>{event.title}</strong><b>{event.module}</b></div><p>{event.detail}</p>{event.entityId ? <small>{event.entityId}</small> : null}</div></article>) : <div className={styles.empty}><strong>No persistent operational activity for this customer yet</strong><p>Create/confirm an appointment using this CRM customer, execute the Work Order, or stage a customer-linked payment to see the timeline populate automatically.</p></div>}</div>
      </div>

      <footer><span>Browser-persistent relationship memory</span><strong>The production Customer 360 timeline will use immutable/audited ERP events behind the Firebase repository layer; this preview proves the cross-module identity chain first.</strong></footer>
    </section>
  );
}
