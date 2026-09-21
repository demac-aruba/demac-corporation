'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { CentralProject } from '@/lib/projects/registry-types';
import type { RegistryRequest } from '@/lib/projects/registry-client-core';
import { PlanDialog } from './project-plan-dialog';
import s from './projects-central.module.css';

const states = ['Draft', 'Planned', 'Active', 'On Hold', 'Near Completion', 'Completed', 'Cancelled'];
type Review = {
  mode: 'project_lifecycle_review'; projectId: string; projectVersion: number; currentStatus: string;
  targetStatus: string; noop: boolean; reopening: boolean; terminal: boolean;
  canApply: boolean; blockers: string[]; digest: string; workOrderCount: number | null;
};
type Props = {
  project: CentralProject; request: RegistryRequest; canManage: boolean; busy: boolean;
  onClose: () => void; onSave: (action: string, data: Record<string, unknown>) => Promise<void>;
};
const explanations: Record<string, string> = {
  project_phase_approval_pending: 'Each phase needs current explicit scope acceptance before completing the Project.',
  project_open_operational_work: 'There are outstanding visits or reservations. Resolve them through Scheduling / Field before cancelling the Project.',
  phase_execution_pending: 'A visit is still open or does not match the approved Office revision.',
  phase_office_approval_pending: 'A work report is still awaiting Office approval.',
  phase_temporary_hold_pending: 'A temporary booking hold is still outstanding.',
  phase_no_completed_work: 'No completed, approved work supports a Project completion yet.',
  legacy_import_requires_reconciliation: 'The imported historical records require reconciliation first.',
  project_evidence_incomplete: 'The full operational history exceeds this review. A partial page cannot certify closure.',
};
export function ProjectLifecycleDialog({ project, request, canManage, busy, onClose, onSave }: Props) {
  const [target, setTarget] = useState(project.planningStatus);
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [reopeningConfirmed, setReopeningConfirmed] = useState(false);
  useEffect(() => {
    setReview(null); setError(''); setScopeConfirmed(false); setReopeningConfirmed(false);
    if (target === project.planningStatus) { setLoading(false); return; }
    let current = true; const controller = new AbortController(); setLoading(true);
    void request<Review>({ action: 'preview_project_status', data: { projectId: project.id, targetStatus: target } }, controller.signal)
      .then(value => {
        if (value.mode !== 'project_lifecycle_review' || value.projectId !== project.id || value.projectVersion !== project.version
            || value.currentStatus !== project.planningStatus || value.targetStatus !== target
            || typeof value.canApply !== 'boolean' || typeof value.reopening !== 'boolean'
            || !Array.isArray(value.blockers) || !/^[a-f0-9]{64}$/.test(value.digest)) {
          throw new Error('Project state changed. Close this dialog and refresh before continuing.');
        }
        if (current) setReview(value);
      }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'The lifecycle review is unavailable.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [request, project.id, project.version, project.planningStatus, target]);
  const allowed = canManage && !busy && !loading && review?.canApply && !review.noop && reason.trim()
    && (target !== 'Completed' || scopeConfirmed) && (!review.reopening || reopeningConfirmed);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!allowed || !review) return; setError('');
    try { await onSave('transition_project_status', { projectId: project.id, expectedVersion: project.version,
      targetStatus: target, previewDigest: review.digest, reason, scopeConfirmed, reopeningConfirmed }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The status change could not be verified.'); }
  };
  return <PlanDialog title="Review Project status" busy={busy} onClose={onClose}>
    <form className={s.form} onSubmit={event => void submit(event)}>
      <p className={s.notice}>This changes the Project record only. It does not cancel or reschedule appointments, release capacity, change customer records or post financial transactions. Completion is never automatic from spent time or budget.</p>
      <p>Current status: <strong>{project.planningStatus}</strong></p>
      <label>New Project status<select aria-label="New Project status" value={target} disabled={busy || !canManage} onChange={event => setTarget(event.target.value)}>
        {states.map(state => <option key={state}>{state}</option>)}
      </select></label>
      {loading && <p role="status">Checking current Project and operational evidence…</p>}
      {error && <p role="alert" className={s.error}>{error}</p>}
      {review?.blockers.length ? <div className={s.warning}>{review.blockers.map(code => <p key={code}>{explanations[code] || code.replaceAll('_', ' ')}</p>)}</div> : null}
      {target === 'On Hold' && <p className={s.warning}>New Project bookings will be paused. Already scheduled appointments remain unchanged; handle any rescheduling in Scheduling.</p>}
      {target === 'Completed' && <label className={s.check}><input type="checkbox" disabled={busy || !canManage} checked={scopeConfirmed}
        onChange={event => setScopeConfirmed(event.target.checked)}/>I reviewed the completed work and confirm that the entire Project scope is finished.</label>}
      {review?.reopening && <label className={s.check}><input type="checkbox" disabled={busy || !canManage} checked={reopeningConfirmed}
        onChange={event => setReopeningConfirmed(event.target.checked)}/>I explicitly authorize reopening this Project to Active. Prior closure and all operational history must be retained.</label>}
      <label>Reason for status change<textarea required maxLength={1000} value={reason} disabled={busy || !canManage} onChange={event => setReason(event.target.value)}/></label>
      <button type="submit" className={s.primary} disabled={!allowed}>Confirm Project status</button>
    </form>
  </PlanDialog>;
}
