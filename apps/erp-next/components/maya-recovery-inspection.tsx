'use client';

import { useEffect, useRef, useState } from 'react';
import { inspectMayaRecoveryCandidates, type MayaPage, type MayaRecoveryRow } from '../lib/maya-operations';
import styles from './maya-operations-workspace.module.css';

const labels: Record<MayaRecoveryRow['status'], string> = {
  compatible_for_review: 'Compatible for review', incompatible: 'Does not fit this opening',
  needs_review: 'Needs review', needs_work_details: 'Work details needed', excluded: 'Not eligible for this check',
};
const reasons: Record<string, string> = {
  canonical_snapshot_compatible: 'The complete work fits the former opening under current scheduling rules. Customer confirmation is still required.',
  interest_not_waiting: 'This request is no longer marked as waiting.',
  invalid_interest: 'The saved preference is incomplete.',
  invalid_preference_dates: 'The recorded date preference needs review.',
  interest_expired: 'The requested date range has expired.',
  outside_requested_dates: 'This opening is outside the requested dates.',
  interest_identity_changed: 'The saved request no longer has a consistent identity.',
  source_identity_changed: 'The original message or conversation could not be verified.',
  pilot_or_ownership_blocked: 'The current pilot permissions or operator ownership prevent using this request.',
  interest_requires_reconfirmation: 'A newer message or ownership change requires reviewing the request again.',
  interest_evidence_missing: 'The original customer request could not be verified.',
  customer_identity_changed: 'The sender no longer resolves to the same customer.',
  property_or_sector_requires_review: 'The property, address or sector needs verification.',
  unbooked_workload_not_recorded: 'The waiting request has no verified service and quantity yet. No duration has been guessed.',
  original_appointment_changed: 'The original appointment has changed or has a pending operational restriction.',
  target_not_earlier: 'This opening is not earlier than the existing appointment.',
  original_work_requires_review: 'The original work-order links need review.',
  original_work_changed: 'The original work has started, changed ownership or has an operational restriction.',
  original_workload_invalid: 'The full original workload could not be verified.',
  capacity_route_or_calendar_unavailable: 'The exact opening does not satisfy the current route, calendar, crew or workload requirements.',
  work_exceeds_cancelled_capacity: 'The work needs capacity outside the cancelled appointment’s former opening.',
  capacity_reoccupied_or_unreleased: 'Capacity has been occupied again or its release is not confirmed.',
};
function checkedTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Aruba', dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Time unavailable';
}

export function MayaRecoveryInspection({ cancelledAppointmentId }: { cancelledAppointmentId: string }) {
  const [page, setPage] = useState<MayaPage<MayaRecoveryRow> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const serial = useRef(0);
  useEffect(() => {
    serial.current += 1; setPage(null); setBusy(false); setError('');
    return () => { serial.current += 1; };
  }, [cancelledAppointmentId]);

  async function inspect(afterId?: string) {
    const version = ++serial.current;
    setBusy(true); setError(''); setPage(null);
    try {
      const result = await inspectMayaRecoveryCandidates(cancelledAppointmentId, afterId);
      if (version === serial.current) setPage(result);
    } catch (cause) {
      if (version === serial.current) setError(cause instanceof Error ? cause.message : 'Compatibility could not be checked.');
    } finally { if (version === serial.current) setBusy(false); }
  }
  const count = page?.rows.filter(row => row.status === 'compatible_for_review').length || 0;

  return <details>
    <summary>Check waiting-list compatibility</summary>
    <div className={styles.detailBody}>
      <p>This check does not send messages, reserve capacity or move appointments. Results are snapshots for review, not confirmed offers.</p>
      <button type="button" disabled={busy} onClick={() => void inspect()}>{busy ? 'Checking…' : page ? 'Check again from the start' : 'Check recorded waiting requests'}</button>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {busy && <p aria-live="polite">Checking the exact opening against the canonical schedule…</p>}
      {page && <div aria-live="polite">
        <p><strong>{count} compatible for review</strong> among {page.rows.length} records on this page. Checked {checkedTime(page.checkedAt)} · Aruba time.</p>
        {page.rows.length === 0 && <p>No waiting records were found on this page.</p>}
        {page.rows.map(row => <article key={row.caseId} className={styles.card}>
          <h3>{row.customer || 'Waiting request'}</h3>
          <p><strong>{labels[row.status] || 'Needs review'}</strong></p>
          <p>{reasons[row.reason] || 'This request needs additional verification.'}</p>
          {row.address && <p>{row.address}{row.sector ? ` · ${row.sector}` : ''}</p>}
          {row.status === 'compatible_for_review' && <p>
            Existing appointment: {row.originalDate} {row.originalTime}. Possible earlier time: {row.date} {row.time}–{row.endTime}.
          </p>}
          <p className={styles.reference}>Request reference: {row.caseId}</p>
        </article>)}
        {page.nextCursor && <button type="button" disabled={busy} onClick={() => void inspect(page.nextCursor || undefined)}>Check next waiting records</button>}
        <p className={styles.reference}>Each page is checked separately. List order is not a contact priority. Later messages must be reviewed, and availability must be verified again before any offer or booking.</p>
      </div>}
    </div>
  </details>;
}
