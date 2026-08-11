'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserKeys, loadBrowserValue } from '../../lib/browser-store';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { crmAccessContext, deriveSiteAccessReadiness, loadSiteAccessPlans, saveSiteAccessPlan, type BrowserSiteAccessPlan, type SensitiveCredentialState, type SiteAccessMethod } from '../../lib/browser-site-access';
import styles from './browser-site-access.module.css';

const methods: Array<{ value: SiteAccessMethod; label: string }> = [
  { value: 'customer_present', label: 'Customer / contact present' },
  { value: 'open_access', label: 'Open access' },
  { value: 'security_desk', label: 'Security / front desk' },
  { value: 'key_or_lockbox', label: 'Key / lockbox' },
  { value: 'gate_or_credential', label: 'Gate / access credential' },
  { value: 'other', label: 'Other controlled access' },
];

function defaultPlan(workOrderId: string): BrowserSiteAccessPlan {
  return { workOrderId, method: 'customer_present', status: 'not_checked', sensitiveCredentialState: 'not_required', updatedAt: new Date(0).toISOString(), updatedBy: 'Not checked' };
}

function needsCredential(method: SiteAccessMethod) {
  return method === 'key_or_lockbox' || method === 'gate_or_credential';
}

export function BrowserSiteAccess() {
  const [orders, setOrders] = useState<BrowserWorkOrderRecord[]>([]);
  const [plans, setPlans] = useState<BrowserSiteAccessPlan[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<BrowserSiteAccessPlan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    setOrders(storedOrders);
    setPlans(loadSiteAccessPlans());
    setSelectedId(storedOrders[storedOrders.length - 1]?.id ?? '');
  }, []);

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? orders[0];
  const selectedPlan = selectedOrder ? plans.find((plan) => plan.workOrderId === selectedOrder.id) : undefined;

  useEffect(() => {
    if (!selectedOrder) return;
    setDraft(selectedPlan ?? defaultPlan(selectedOrder.id));
    setNotice(null);
  }, [selectedOrder?.id, selectedPlan?.updatedAt]);

  const readiness = useMemo(() => selectedOrder ? deriveSiteAccessReadiness(selectedOrder, draft ? [...plans.filter((plan) => plan.workOrderId !== selectedOrder.id), draft] : plans) : null, [draft, plans, selectedOrder]);
  const crmContext = selectedOrder ? crmAccessContext(selectedOrder) : undefined;

  const update = (patch: Partial<BrowserSiteAccessPlan>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setNotice(null);
  };

  const changeMethod = (method: SiteAccessMethod) => {
    update({ method, sensitiveCredentialState: needsCredential(method) ? 'missing' : 'not_required', status: 'not_checked' });
  };

  const save = () => {
    if (!draft) return;
    const saved = saveSiteAccessPlan(draft);
    setPlans((current) => current.some((plan) => plan.workOrderId === saved.workOrderId) ? current.map((plan) => plan.workOrderId === saved.workOrderId ? saved : plan) : [...current, saved]);
    setDraft(saved);
    setNotice(`${saved.workOrderId} Site Access Plan saved. Job Readiness now recalculates access from this plan.`);
  };

  if (!selectedOrder || !draft || !readiness) return null;

  return (
    <section className={styles.workspace}>
      <header><div><span>SITE ACCESS CONTROL</span><h2>Work Order Access Plan</h2><p>Confirm how the crew enters the property before dispatch. Reusable CRM access notes are context only; the current Work Order still needs an explicit access decision.</p></div><label>Work Order<select value={selectedOrder.id} onChange={(event) => setSelectedId(event.target.value)}>{orders.slice().reverse().map((order) => <option value={order.id} key={order.id}>{order.id} · {order.customer}</option>)}</select></label></header>
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.summary}>
        <article><span>Property</span><strong>{selectedOrder.site}</strong><small>{selectedOrder.sector}</small></article>
        <article><span>Scheduled</span><strong>{selectedOrder.scheduledDate}</strong><small>{selectedOrder.scheduledStart}–{selectedOrder.scheduledEnd}</small></article>
        <article><span>Access Readiness</span><strong className={readiness.status === 'ready' ? styles.good : readiness.status === 'blocked' ? styles.danger : styles.warn}>{readiness.status.replace('_', ' ').toUpperCase()}</strong><small>{readiness.source}</small></article>
      </div>

      <div className={styles.layout}>
        <main>
          <div className={styles.sectionHead}><div><strong>Current Work Order Access</strong><span>No passwords, gate codes or lockbox codes should be stored here</span></div></div>
          <div className={styles.form}>
            <label>Access method<select value={draft.method} onChange={(event) => changeMethod(event.target.value as SiteAccessMethod)}>{methods.map((method) => <option value={method.value} key={method.value}>{method.label}</option>)}</select></label>
            <label>Access status<select value={draft.status} onChange={(event) => update({ status: event.target.value as BrowserSiteAccessPlan['status'] })}><option value="not_checked">Not checked</option><option value="confirmed">Confirmed</option><option value="blocked">Blocked</option></select></label>
            <label>On-site contact<input value={draft.contactName ?? ''} onChange={(event) => update({ contactName: event.target.value })} placeholder="Name only if relevant" /></label>
            <label>Contact phone<input value={draft.contactPhone ?? ''} onChange={(event) => update({ contactPhone: event.target.value })} placeholder="Operational contact number" /></label>
            {needsCredential(draft.method) ? <label className={styles.wide}>Sensitive credential availability<select value={draft.sensitiveCredentialState} onChange={(event) => update({ sensitiveCredentialState: event.target.value as SensitiveCredentialState })}><option value="missing">Missing / not confirmed</option><option value="confirmed_securely">Confirmed through approved secure method</option></select><small>Record only whether the credential is available. Do not enter the credential itself.</small></label> : null}
            <label className={styles.wide}>Operational instructions<textarea rows={3} value={draft.instructions ?? ''} onChange={(event) => update({ instructions: event.target.value })} placeholder="Example: check in with security desk; customer will meet crew at entrance. Do not write access codes." /></label>
          </div>
          <footer><button type="button" onClick={save}>Save Access Plan</button></footer>
        </main>

        <aside>
          <div className={styles.sectionHead}><div><strong>Readiness Evidence</strong><span>What consolidated Job Readiness will use</span></div></div>
          <div className={`${styles.readiness} ${readiness.status === 'ready' ? styles.readyBox : readiness.status === 'blocked' ? styles.blockedBox : styles.riskBox}`}><span>{readiness.status.replace('_', ' ').toUpperCase()}</span><strong>{readiness.reason}</strong><small>{readiness.source}</small></div>
          <div className={styles.crmContext}><span>CRM PROPERTY CONTEXT</span>{crmContext ? <><strong>Existing reusable access note</strong><p>{crmContext}</p><small>This does not automatically confirm access for today’s Work Order.</small></> : <><strong>No reusable CRM access note</strong><p>The current access plan remains the authoritative pre-dispatch evidence.</p></>}</div>
          <div className={styles.security}><span>SECURITY RULE</span><strong>Keep credentials out of free text.</strong><p>Keys, lockbox codes and gate credentials should later be handled by a dedicated secure secret/access mechanism with role-based access and audit—not browser notes.</p></div>
        </aside>
      </div>
    </section>
  );
}
