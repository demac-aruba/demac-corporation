'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { CentralProject } from '@/lib/projects/registry-types';
import type { RegistryRequest } from '@/lib/projects/registry-client-core';
import { PlanDialog } from './project-plan-dialog';
import s from './projects-central.module.css';

type HistoryReview = {
  mode: 'history_reconciliation_preview'; projectId: string; projectVersion: number;
  digest: string; canFinalize: boolean; alreadyReviewed: boolean;
  linkedAppointments: number; linkedWorkOrders: number; unlinkedIndexes: number[];
  limitations: string[]; rows: Array<{ index: number; status: string; appointmentId: string | null;
    workOrderId: string | null; resolvedAppointmentId?: string | null }>;
  blockers: Array<{ code: string; index?: number; appointmentId?: string | null }>;
};
const explanations: Record<string, string> = {
  archived_actuals_not_certified: 'Archived hours, quantities, money and completion remain historical statements, not verified Field or accounting values.',
  backup_restore_not_certified: 'This review is not proof of a Cloud backup or successful restoration.',
  review_covers_saved_source_and_current_links_only: 'I reviewed the saved source and current links, and checked for additional original operator records outside this snapshot.',
  source_appointment_not_associated: 'Associate this existing appointment through Scheduling activity before finalizing.',
  source_phase_conflict: 'The archived and linked phases differ. Reconcile the original reference; do not create another booking.',
  source_work_order_missing: 'The original Work Order could not be found. It cannot be silently discarded.',
};
type Props = { project: CentralProject; request: RegistryRequest; busy: boolean; canManage: boolean;
  onClose: () => void; onSave: (action: string, data: Record<string, unknown>) => Promise<void> };
export function HistoryReconciliationDialog({ project, request, busy, canManage, onClose, onSave }: Props) {
  const [review, setReview] = useState<HistoryReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    setReview(null); setLoading(true); setError(''); setConfirmed(false); setAcknowledged([]); setNotes({});
    void request<HistoryReview>({ action: 'preview_history_reconciliation', data: { projectId: project.id } }, controller.signal)
      .then(value => {
        if (value.mode !== 'history_reconciliation_preview' || value.projectId !== project.id
            || value.projectVersion !== project.version || !/^[a-f0-9]{64}$/.test(value.digest)
            || typeof value.canFinalize !== 'boolean' || !Array.isArray(value.rows)
            || !Array.isArray(value.blockers) || !Array.isArray(value.limitations) || !Array.isArray(value.unlinkedIndexes)) {
          throw new Error('The Project changed or its review is invalid. Close and refresh Projects before continuing.');
        }
        if (active) setReview(value);
      }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Historical review is unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [request, project.id, project.version, refresh]);
  const ready = review?.canFinalize && !busy && canManage && confirmed && reason.trim()
    && acknowledged.length === review.limitations.length && review.unlinkedIndexes.every(index => notes[index]?.trim());
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!ready || !review) return; setError('');
    try {
      await onSave('finalize_history_reconciliation', { projectId: project.id, expectedVersion: project.version,
        previewDigest: review.digest, scopeConfirmed: confirmed, acknowledgedLimitations: acknowledged,
        unlinkedNotes: review.unlinkedIndexes.map(index => ({ index, reason: notes[index] })), reason });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The historical review could not be confirmed.'); }
  };
  return <PlanDialog title="Review imported scheduling history" busy={busy} onClose={onClose}>
    <div className={s.form}>
      <p className={s.notice}>This checks the original Project's references against existing appointments and all related Work Orders, including support Vans. It does not create bookings, replace customer records, or turn old totals into verified work.</p>
      {loading && <p role="status">Checking archived references and current links…</p>}
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button type="button" className={s.button} disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>Recheck historical references</button>
      {review && <>
        <p>{review.linkedAppointments} current linked appointments · {review.linkedWorkOrders} related Work Orders.</p>
        {review.alreadyReviewed && <p className={s.notice}>Scheduling references were reviewed. No additional finalization is needed. The original archive and review history remain preserved.</p>}
        {review.rows.map(row => <div className={s.card} key={row.index}><strong>Original assignment {row.index + 1}</strong>
          <p>{row.workOrderId || 'No Work Order ID'} · {row.resolvedAppointmentId || row.appointmentId || 'No appointment ID'}</p>
          <p>{row.status.replaceAll('_', ' ')}</p>
        </div>)}
        {review.blockers.length > 0 && <div role="alert" className={s.warning}>{review.blockers.map((blocker, index) =>
          <p key={index}>{explanations[blocker.code] || blocker.code.replaceAll('_', ' ')}{blocker.index !== undefined ? ` — source row ${blocker.index + 1}` : ''}</p>)}</div>}
        {!review.alreadyReviewed && <form className={s.form} onSubmit={event => void submit(event)}>
          {review.unlinkedIndexes.map(index => <label key={index}>Explain unverified source row {index + 1}
            <textarea required maxLength={1000} disabled={busy || !canManage} value={notes[index] || ''}
              onChange={event => setNotes(current => ({ ...current, [index]: event.target.value }))}/>
            <small className={s.muted}>There is no source reference. This row will remain archived and unverified, not counted as executed work.</small>
          </label>)}
          {review.limitations.map(code => <label key={code} className={s.check}><input type="checkbox" disabled={busy || !canManage}
            checked={acknowledged.includes(code)} onChange={event => setAcknowledged(current => event.target.checked ? [...current, code] : current.filter(item => item !== code))}/>
            {explanations[code] || code.replaceAll('_', ' ')}</label>)}
          <label className={s.check}><input type="checkbox" disabled={busy || !canManage} checked={confirmed}
            onChange={event => setConfirmed(event.target.checked)}/>I reviewed the original scheduling references and all current associations. Known missing or conflicting references must not be excluded.</label>
          <label>Historical review note<textarea required maxLength={1000} disabled={busy || !canManage} value={reason} onChange={event => setReason(event.target.value)}/></label>
          <button type="submit" className={s.primary} disabled={!ready}>Finalize scheduling-history review</button>
        </form>}
      </>}
    </div>
  </PlanDialog>;
}
