'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listMayaCancellations, listMayaWaitlist, type CancellationFilter, type MayaCancellationRow, type MayaWaitlistRow } from '../lib/maya-operations';
import styles from './maya-operations-workspace.module.css';

type View = 'cancellations' | 'waitlist';
function arubaToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Aruba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function timestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Aruba', dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Not recorded';
}
function mergeRows<T extends { id: string }>(previous: T[], incoming: T[]) { return [...new Map([...previous, ...incoming].map(row => [row.id, row])).values()]; }
const stateLabels = { waiting: 'Waiting', withdrawn: 'Withdrawn', expired: 'Expired', needs_review: 'Needs review' };

export function MayaOperationsWorkspace() {
  const [view, setView] = useState<View>('cancellations');
  const [draft, setDraft] = useState<CancellationFilter>({ from: '', to: '' });
  const [applied, setApplied] = useState<CancellationFilter>({ from: '', to: '' });
  const [cancellations, setCancellations] = useState<MayaCancellationRow[]>([]);
  const [waitlist, setWaitlist] = useState<MayaWaitlistRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const serial = useRef(0);

  useEffect(() => { const today = arubaToday(); setDraft({ from: today, to: today }); setApplied({ from: today, to: today }); }, []);
  const load = useCallback(async (afterId?: string) => {
    if (!applied.from || !applied.to) return;
    const request = ++serial.current;
    setBusy(true); setError('');
    if (!afterId) { setCancellations([]); setWaitlist([]); setNextCursor(null); setLoadedAt(''); }
    try {
      if (view === 'cancellations') {
        const page = await listMayaCancellations(applied, afterId);
        if (request !== serial.current) return;
        setCancellations(previous => afterId ? mergeRows(previous, page.rows) : page.rows);
        setNextCursor(page.nextCursor); setLoadedAt(page.checkedAt);
      } else {
        const page = await listMayaWaitlist(afterId);
        if (request !== serial.current) return;
        setWaitlist(previous => afterId ? mergeRows(previous, page.rows) : page.rows);
        setNextCursor(page.nextCursor); setLoadedAt(page.checkedAt);
      }
    } catch (cause) {
      if (request === serial.current) setError(cause instanceof Error ? cause.message : 'The list could not be loaded.');
    } finally { if (request === serial.current) setBusy(false); }
  }, [view, applied]);
  useEffect(() => { void load(); return () => { serial.current += 1; }; }, [load]);
  const matches = useCallback((row: { customer: string; address: string; sector: string }) => `${row.customer} ${row.address} ${row.sector}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()), [search]);
  const visibleCancellations = useMemo(() => cancellations.filter(matches), [cancellations, matches]);
  const visibleWaitlist = useMemo(() => waitlist.filter(matches), [waitlist, matches]);
  const loadedCount = view === 'cancellations' ? cancellations.length : waitlist.length;
  const visibleCount = view === 'cancellations' ? visibleCancellations.length : visibleWaitlist.length;

  return <section className={styles.root} aria-label="Maya operational workspace">
    <header className={styles.header}>
      <div><Link className={styles.back} href="/customer-ai">← Maya conversations</Link><h1>Maya operations</h1><p>Cancellation history and customer waiting preferences.</p></div>
      <span className={styles.badge}>Read-only workspace</span>
    </header>
    <nav className={styles.views} aria-label="Operational lists">
      <button type="button" aria-pressed={view === 'cancellations'} onClick={() => { setView('cancellations'); setSearch(''); }}>Cancellations</button>
      <button type="button" aria-pressed={view === 'waitlist'} onClick={() => { setView('waitlist'); setSearch(''); }}>Waiting list & earlier dates</button>
    </nav>
    <div className={styles.notice}>
      {view === 'cancellations'
        ? 'A cancelled appointment is historical evidence, not a guarantee that its former slot is still available. Availability must be checked again before offering it.'
        : 'Waiting preferences do not reserve capacity or change an existing appointment. Proactive offers are not available in this version.'}
    </div>
    <div className={styles.toolbar}>
      {view === 'cancellations' && <form onSubmit={event => { event.preventDefault(); setApplied({ ...draft }); }} className={styles.dates}>
        <label>Cancelled from<input type="date" required value={draft.from} max={draft.to || undefined} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></label>
        <label>Through<input type="date" required value={draft.to} min={draft.from || undefined} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></label>
        <button type="submit" disabled={busy}>Apply dates</button>
      </form>}
      <label className={styles.search}>Search loaded records<input type="search" placeholder="Customer, address or sector" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button type="button" onClick={() => void load()} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
    </div>
    {error && <div className={styles.error} role="alert"><strong>Unable to refresh this list.</strong><p>{error}</p>{loadedCount > 0 && <p>Previously loaded records remain below. They have not been refreshed.</p>}</div>}
    <div className={styles.summary} aria-live="polite">{loadedAt ? `${visibleCount} shown · ${loadedCount} loaded · Checked ${timestamp(loadedAt)} · Aruba time` : busy ? 'Loading canonical records…' : 'No records loaded yet.'}</div>
    <div className={styles.records} aria-busy={busy}>
      {view === 'cancellations' && visibleCancellations.map(row => <article className={styles.card} key={row.id}>
        <div className={styles.cardHeading}><h2>{row.customer}</h2><span className={styles.cancelled}>Cancelled</span></div>
        <dl className={styles.facts}>
          <div><dt>Former appointment</dt><dd>{row.scheduledDate || 'Date not recorded'} {row.scheduledTime}</dd></div>
          <div><dt>Property / sector</dt><dd>{row.address || 'Address unavailable'}{row.sector ? ` · ${row.sector}` : ''}</dd></div>
          <div><dt>Cancellation recorded</dt><dd>{timestamp(row.cancelledAt)}</dd></div>
        </dl>
        {!row.identityVerified && <p className={styles.warning}>Customer / property details require review.</p>}
        <details><summary>Cancellation details</summary><div className={styles.detailBody}>
          <p><strong>Reason:</strong> {row.reason || 'No reason recorded'}</p>
          {row.note && <p><strong>Note:</strong> {row.note}</p>}
          <p><strong>Recorded by:</strong> {row.actor || 'Not recorded'}</p>
          {row.workLines.length > 0 && <p><strong>Scheduled work:</strong> {row.workLines.map(line => `${line.quantity ?? '—'} × ${line.service.replaceAll('_', ' ')}`).join('; ')}</p>}
          <p className={styles.reference}>Appointment reference: {row.id}</p>
        </div></details>
      </article>)}
      {view === 'waitlist' && visibleWaitlist.map(row => <article className={styles.card} key={row.id}>
        <div className={styles.cardHeading}><h2>{row.customer}</h2><span className={styles.badge}>{stateLabels[row.state] || 'Needs review'}</span></div>
        <p className={styles.kind}>{row.kind === 'earlier_appointment' ? 'Wants an earlier appointment' : 'Needs an appointment'}</p>
        <dl className={styles.facts}>
          <div><dt>Existing appointment</dt><dd>{row.originalDate ? `${row.originalDate} ${row.originalTime}` : 'No appointment linked'}</dd></div>
          <div><dt>Property / sector</dt><dd>{row.address || 'Address unavailable'}{row.sector ? ` · ${row.sector}` : ''}</dd></div>
          <div><dt>Requested date range</dt><dd>{row.dateFrom || 'Not specified'} → {row.dateTo || 'Not specified'}</dd></div>
        </dl>
        {row.state === 'needs_review' && <p className={styles.warning}>The linked booking or identity has changed. Review before using this preference.</p>}
        <details><summary>Customer request & evidence</summary><div className={styles.detailBody}>
          <blockquote>{row.preference}</blockquote><p><strong>Last recorded:</strong> {timestamp(row.requestedAt)}</p>
          <p className={styles.reference}>Source message: {row.sourceMessageId || 'Not recorded'}</p>
          <p className={styles.reference}>Conversation: {row.conversationId || 'Not recorded'}</p>
        </div></details>
      </article>)}
      {!busy && !error && loadedAt && visibleCount === 0 && <div className={styles.empty}>
        <h2>{search ? 'No matches in the loaded records' : view === 'cancellations' ? 'No recorded cancellations in this range' : 'No waiting preferences recorded'}</h2>
        <p>{search ? 'Clear the search or load more records.' : view === 'cancellations' ? 'Choose another cancellation date range to review earlier records.' : 'Requests will appear here after governed capture is enabled and customers express a waiting preference.'}</p>
      </div>}
    </div>
    {nextCursor && <button className={styles.more} type="button" disabled={busy} onClick={() => void load(nextCursor)}>Load more records</button>}
    <footer className={styles.footer}>{view === 'cancellations'
      ? 'Dates refer to when the cancellation was recorded, not the appointment date. Records without a recorded cancellation timestamp are not included. Maximum range: 31 days.'
      : 'Only the active WhatsApp account is included. Historical conversations are not automatically scanned by this screen.'}</footer>
  </section>;
}
