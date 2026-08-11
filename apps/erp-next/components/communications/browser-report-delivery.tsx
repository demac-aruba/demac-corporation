'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import type { BrowserOfficeReviewRecord } from '../../lib/browser-field';
import { BROWSER_REPORT_DELIVERIES_KEY, createReportDelivery, eligibleApprovedReviews, mergeReportDeliveries, type BrowserReportDeliveryRecord, type ReportDeliveryChannel } from '../../lib/browser-report-delivery';
import styles from './browser-report-delivery.module.css';

export function BrowserReportDelivery() {
  const [reviews, setReviews] = useState<BrowserOfficeReviewRecord[]>([]);
  const [deliveries, setDeliveries] = useState<BrowserReportDeliveryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ReportDeliveryChannel>('whatsapp');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const storedReviews = loadBrowserValue<BrowserOfficeReviewRecord[]>(browserKeys.officeReviews, []);
    const storedDeliveries = loadBrowserValue<BrowserReportDeliveryRecord[]>(BROWSER_REPORT_DELIVERIES_KEY, []);
    setReviews(storedReviews);
    setDeliveries(storedDeliveries);
    setSelectedId(eligibleApprovedReviews(storedReviews, storedDeliveries)[0]?.id ?? null);
  }, []);

  const eligible = useMemo(() => eligibleApprovedReviews(reviews, deliveries), [reviews, deliveries]);
  const selected = eligible.find((review) => review.id === selectedId) ?? eligible[0];

  const markSent = () => {
    if (!selected) return;
    const delivery = createReportDelivery(selected, channel, recipient, note);
    const next = mergeReportDeliveries(deliveries, delivery);
    setDeliveries(next);
    saveBrowserValue(BROWSER_REPORT_DELIVERIES_KEY, next);
    const remaining = eligibleApprovedReviews(reviews, next);
    setSelectedId(remaining[0]?.id ?? null);
    setRecipient('');
    setNote('');
    setNotice(`${selected.workOrderId} marked sent via ${channel === 'whatsapp' ? 'WhatsApp' : 'email'}. This records the office action only; ERP Next did not send an external message automatically.`);
  };

  if (!eligible.length && !deliveries.length) return null;

  return (
    <section className={styles.queue}>
      <header><div><span>CUSTOMER DELIVERY CONTROL</span><h2>Approved Service Reports</h2><p>Only office-approved reports enter this queue. Delivery remains a human action until the communication integrations are explicitly authorized.</p></div><b>{eligible.length} ready to send</b></header>
      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}
      <div className={styles.layout}>
        <aside className={styles.list}>
          <div className={styles.listLabel}>READY FOR DELIVERY</div>
          {eligible.length ? eligible.map((review) => <button type="button" className={selected?.id === review.id ? styles.active : ''} key={review.id} onClick={() => { setSelectedId(review.id); setNotice(null); }}><div><strong>{review.workOrderId}</strong><span>{review.customer}</span><small>{review.site} · {review.language}</small></div><b>Approved</b></button>) : <div className={styles.emptyList}>No approved reports waiting.</div>}
          {deliveries.length ? <><div className={styles.listLabel}>RECENTLY SENT</div>{deliveries.slice(0,5).map((delivery) => <article key={delivery.id}><div><strong>{delivery.workOrderId}</strong><span>{delivery.customer}</span><small>{delivery.channel} · {new Date(delivery.sentAt).toLocaleString()}</small></div><b className={styles.sent}>Sent</b></article>)}</> : null}
        </aside>
        <main className={styles.detail}>
          {selected ? <>
            <div className={styles.detailHead}><div><span>{selected.id}</span><h3>{selected.customer}</h3><p>{selected.workOrderId} · {selected.site} · {selected.language}</p></div><b>OFFICE APPROVED</b></div>
            <section className={styles.reportPreview}><span>CUSTOMER REPORT SUMMARY</span><p>{selected.professionalSummary}</p></section>
            <section className={styles.deliveryControls}>
              <div className={styles.channelChoice}><span>Delivery channel</span><div><button type="button" className={channel === 'whatsapp' ? styles.selectedChannel : ''} onClick={() => setChannel('whatsapp')}>WhatsApp</button><button type="button" className={channel === 'email' ? styles.selectedChannel : ''} onClick={() => setChannel('email')}>Email</button></div></div>
              <label>Recipient / destination<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={channel === 'whatsapp' ? '+297 customer number' : 'customer@example.com'} /></label>
              <label>Office delivery note<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional internal note about how/when the report was delivered" /></label>
            </section>
            <section className={styles.guardrail}><span>NO AUTO-SEND</span><strong>“Mark Sent” records a human delivery decision; it does not call WhatsApp, email, Meta or any external provider.</strong><p>When provider integrations are activated, the send action will remain a governed explicit command with audit evidence unless DEMAC later approves low-risk automation.</p></section>
            <footer><div><span>Report language</span><strong>{selected.language}</strong></div><button type="button" onClick={markSent}>Mark Sent via {channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</button></footer>
          </> : <div className={styles.emptyDetail}><strong>All approved reports are accounted for</strong><p>Recently sent items remain visible in the delivery history on the left.</p></div>}
        </main>
      </div>
    </section>
  );
}
