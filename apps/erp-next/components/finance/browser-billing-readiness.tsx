'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import type { BrowserFieldExecutionRecord, BrowserOfficeReviewRecord } from '../../lib/browser-field';
import type { BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { BROWSER_BILLING_DRAFTS_KEY, deriveApprovedBillingDrafts, mergeBillingDrafts, type BrowserBillingDraft } from '../../lib/browser-billing';
import styles from './browser-billing-readiness.module.css';

function formatAfl(value: number) {
  return `Afl. ${value.toLocaleString('en-US', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function BrowserBillingReadiness() {
  const [drafts, setDrafts] = useState<BrowserBillingDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const orders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    const reviews = loadBrowserValue<BrowserOfficeReviewRecord[]>(browserKeys.officeReviews, []);
    const executions = loadBrowserValue<BrowserFieldExecutionRecord[]>(browserKeys.fieldExecutions, []);
    const existing = loadBrowserValue<BrowserBillingDraft[]>(BROWSER_BILLING_DRAFTS_KEY, []);
    const derived = deriveApprovedBillingDrafts(orders, reviews, executions);
    const merged = mergeBillingDrafts(existing, derived);
    saveBrowserValue(BROWSER_BILLING_DRAFTS_KEY, merged);
    setDrafts(merged);
    setSelectedId(merged[0]?.id ?? null);
  }, []);

  const selected = drafts.find((draft) => draft.id === selectedId) ?? drafts[0];
  const metrics = useMemo(() => ({
    total: drafts.length,
    complete: drafts.filter((draft) => draft.pricingComplete).length,
    review: drafts.filter((draft) => !draft.pricingComplete).length,
    known: drafts.reduce((sum, draft) => sum + draft.knownSubtotal, 0),
  }), [drafts]);

  const markReady = () => {
    if (!selected || !selected.pricingComplete) return;
    const now = new Date().toISOString();
    const next = drafts.map((draft) => draft.id === selected.id ? { ...draft, status: 'ready_for_qbo' as const, updatedAt: now } : draft);
    setDrafts(next);
    saveBrowserValue(BROWSER_BILLING_DRAFTS_KEY, next);
    setNotice(`${selected.workOrderId} marked Ready for QBO Sync. No QuickBooks invoice was created automatically.`);
  };

  if (!drafts.length) return null;

  return (
    <section className={styles.workspace}>
      <header><div><span>WORK ORDER → BILLING READINESS</span><h2>Invoice Draft Candidates</h2><p>Office-approved jobs become billing candidates. ERP Next prices only governed rules and flags everything else for human review.</p></div><b>{drafts.length} draft{drafts.length === 1 ? '' : 's'}</b></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}
      <div className={styles.metrics}><article><span>Billing Candidates</span><strong>{metrics.total}</strong><small>From approved field work</small></article><article><span>Pricing Complete</span><strong>{metrics.complete}</strong><small>All lines governed</small></article><article><span>Needs Review</span><strong className={metrics.review ? styles.warn : ''}>{metrics.review}</strong><small>Nothing is guessed</small></article><article><span>Known Subtotal</span><strong>{formatAfl(metrics.known)}</strong><small>Before QBO tax/accounting treatment</small></article></div>
      <div className={styles.layout}>
        <aside className={styles.list}>{drafts.map((draft) => <button type="button" className={selected?.id === draft.id ? styles.active : ''} key={draft.id} onClick={() => { setSelectedId(draft.id); setNotice(null); }}><div><strong>{draft.workOrderId}</strong><span>{draft.customer}</span><small>{draft.site}</small></div><b className={draft.status === 'ready_for_qbo' ? styles.qbo : draft.pricingComplete ? styles.complete : styles.review}>{draft.status === 'ready_for_qbo' ? 'QBO READY' : draft.pricingComplete ? 'PRICED' : 'REVIEW'}</b></button>)}</aside>
        {selected ? <main className={styles.detail}>
          <div className={styles.detailHead}><div><span>{selected.id}</span><h3>{selected.customer}</h3><p>{selected.workOrderId} · {selected.site} · {selected.lines.length} billing line{selected.lines.length === 1 ? '' : 's'}</p></div><b className={selected.pricingComplete ? styles.complete : styles.review}>{selected.pricingComplete ? 'PRICING COMPLETE' : 'PRICING REVIEW REQUIRED'}</b></div>
          <div className={styles.lineTable}><div className={`${styles.row} ${styles.head}`}><span>Description</span><span>Qty</span><span>Unit Price</span><span>Amount</span><span>Status</span></div>{selected.lines.map((line) => <div className={styles.row} key={line.id}><div><strong>{line.description}</strong>{line.note ? <small>{line.note}</small> : null}</div><span>{line.quantity} {line.unit}</span><span>{line.unitPrice !== undefined ? formatAfl(line.unitPrice) : '—'}</span><strong>{line.amount !== undefined ? formatAfl(line.amount) : 'Review'}</strong><b className={line.status === 'priced' ? styles.pricedLine : styles.reviewLine}>{line.status === 'priced' ? 'Governed' : 'Review'}</b></div>)}</div>
          <section className={styles.totalBox}><div><span>Known priced subtotal</span><strong>{formatAfl(selected.knownSubtotal)}</strong></div><p>Tax, accounting classification, credits, discounts and any unpriced lines are not invented here. QuickBooks remains the accounting system of record.</p></section>
          <section className={styles.rules}><article><span>KNOWN RULE</span><strong>Standard Service by BTU</strong><p>9k = Afl. 100 · 12k = Afl. 125 · 18k = Afl. 135 · 24k = Afl. 145 · 36k = Afl. 175.</p></article><article><span>KNOWN RULE</span><strong>220V Switch</strong><p>Afl. 75 each when captured as a technician add-on.</p></article><article><span>REVIEW RULE</span><strong>Everything else</strong><p>Deep cleaning, installation, brackets, armaflex, 60k service and exact refrigerant pricing remain review-required until governed pricebook rules exist.</p></article></section>
          <footer><div><span>Accounting handoff</span><strong>{selected.status === 'ready_for_qbo' ? 'Ready for explicit QBO sync' : selected.pricingComplete ? 'Eligible for accounting approval' : 'Pricing review must be completed first'}</strong></div><button type="button" disabled={!selected.pricingComplete || selected.status === 'ready_for_qbo'} onClick={markReady}>{selected.status === 'ready_for_qbo' ? 'Ready for QBO Sync' : 'Approve Draft for QBO Sync'}</button></footer>
        </main> : null}
      </div>
    </section>
  );
}
