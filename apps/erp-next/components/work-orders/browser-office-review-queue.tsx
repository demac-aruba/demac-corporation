'use client';

import { useEffect, useState } from 'react';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import type { BrowserOfficeReviewRecord } from '../../lib/browser-field';
import styles from './browser-office-review-queue.module.css';

export function BrowserOfficeReviewQueue() {
  const [reviews, setReviews] = useState<BrowserOfficeReviewRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadBrowserValue<BrowserOfficeReviewRecord[]>(browserKeys.officeReviews, []);
    setReviews(stored);
    setSelectedId(stored.find((review) => review.status === 'pending')?.id ?? stored[0]?.id ?? null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveBrowserValue(browserKeys.officeReviews, reviews);
  }, [ready, reviews]);

  const selected = reviews.find((review) => review.id === selectedId);
  const pending = reviews.filter((review) => review.status === 'pending').length;

  const updateSelected = (patch: Partial<BrowserOfficeReviewRecord>) => {
    if (!selected) return;
    setReviews((current) => current.map((review) => review.id === selected.id ? { ...review, ...patch } : review));
  };

  const decide = (status: 'approved' | 'returned') => {
    if (!selected) return;
    updateSelected({ status, reviewedAt: new Date().toISOString() });
  };

  if (!ready || !reviews.length) return null;

  return (
    <section className={styles.queue}>
      <header><div><span>OFFICE QUALITY GATE</span><h2>Field Reports Awaiting Review</h2><p>Technician completion never equals customer delivery. Office review remains a separate controlled decision.</p></div><b>{pending} pending</b></header>
      <div className={styles.layout}>
        <aside className={styles.list}>{reviews.slice().reverse().map((review) => <button type="button" className={selected?.id === review.id ? styles.active : ''} key={review.id} onClick={() => setSelectedId(review.id)}><div><strong>{review.workOrderId}</strong><span>{review.customer}</span><small>{review.site}</small></div><b className={review.status === 'approved' ? styles.approved : review.status === 'returned' ? styles.returned : styles.pending}>{review.status}</b></button>)}</aside>
        {selected ? <main className={styles.detail}>
          <div className={styles.detailHead}><div><span>{selected.id}</span><h3>{selected.customer}</h3><p>{selected.workOrderId} · {selected.site} · submitted {new Date(selected.submittedAt).toLocaleString()}</p></div><b className={selected.status === 'approved' ? styles.approved : selected.status === 'returned' ? styles.returned : styles.pending}>{selected.status}</b></div>
          <div className={styles.summaryGrid}><section><span>ORIGINAL TECHNICIAN SUMMARY</span><p>{selected.technicianSummary}</p></section><section><span>PROFESSIONALIZED CUSTOMER SUMMARY</span><p>{selected.professionalSummary}</p></section></div>
          <div className={styles.reviewControls}><label>Customer report language<select value={selected.language} disabled={selected.status === 'approved'} onChange={(event) => updateSelected({ language: event.target.value as BrowserOfficeReviewRecord['language'] })}><option>English</option><option>Spanish</option><option>Papiamento</option></select></label><label className={styles.note}>Office review note<textarea rows={3} disabled={selected.status === 'approved'} value={selected.reviewerNote ?? ''} onChange={(event) => updateSelected({ reviewerNote: event.target.value })} placeholder="Corrections, customer wording, quality note..." /></label></div>
          {selected.status === 'returned' ? <div className={styles.returnedNote}><span>RETURNED FOR CORRECTION</span><strong>The technician can reopen this same Work Order in Field.</strong><p>When the corrected report is resubmitted, this same review ID returns to Pending instead of creating a duplicate review.</p></div> : null}
          <div className={styles.guardrail}><div><span>CUSTOMER DELIVERY CONTROL</span><strong>Nothing is sent automatically from this review queue.</strong><p>Approval means the report is office-approved and ready for a human to send through the appropriate customer channel. Returning it sends it back for correction.</p></div></div>
          <footer><button type="button" className={styles.returnButton} disabled={selected.status === 'approved'} onClick={() => decide('returned')}>Return for Correction</button><button type="button" className={styles.approveButton} disabled={selected.status === 'approved'} onClick={() => decide('approved')}>{selected.status === 'approved' ? 'Approved' : 'Approve Report'}</button></footer>
        </main> : null}
      </div>
    </section>
  );
}
