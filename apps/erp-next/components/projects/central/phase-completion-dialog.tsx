'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { CentralProject, ProjectPhasePlan } from '@/lib/projects/registry-types';
import type { RegistryRequest } from '@/lib/projects/registry-client-core';
import { PlanDialog } from './project-plan-dialog';
import s from './projects-central.module.css';

type Review = {
  mode: 'phase_completion_review'; projectId: string; projectVersion: number; phaseId: string;
  phase: ProjectPhasePlan; status: 'open' | 'approved' | 'reopened' | 'needs_review';
  canApprove: boolean; digest: string | null; blockers: string[];
  sources: Array<{ workOrderId: string; vanId: string | null; reviewStatus: string | null; revisionId: string | null }>;
};
type Props = {
  project: CentralProject; phase: ProjectPhasePlan; request: RegistryRequest;
  busy: boolean; canManage: boolean; onClose: () => void;
  onSave: (action: string, data: Record<string, unknown>) => Promise<void>;
};
const explanations: Record<string, string> = {
  phase_no_completed_work: 'No completed Field work supports this phase yet.',
  phase_office_approval_pending: 'One or more work reports still need Office Review approval.',
  phase_execution_pending: 'A Field visit is still open or has not been completed.',
  phase_temporary_hold_pending: 'A temporary booking hold is still outstanding.',
  phase_prerequisite_not_current: 'A prerequisite phase needs current approval.',
  phase_evidence_incomplete: 'The evidence exceeds this review scope; reconcile it before closing.',
  legacy_import_requires_reconciliation: 'Imported history must be reconciled first.',
  phase_source_changed: 'Supporting records changed after approval. Reopen and review the phase.',
  phase_definition_changed: 'The phase scope changed after approval. Reopen and review it.',
  phase_links_changed: 'The phase appointment links changed after approval.',
};

export function PhaseCompletionDialog({ project, phase, request, busy, canManage, onClose, onSave }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [reason, setReason] = useState('');
  const [criteria, setCriteria] = useState(false);
  const [units, setUnits] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setReview(null); setLoading(true); setError(''); setCriteria(false); setUnits(''); setChecked([]);
    void request<Review>({ action: 'get_phase_completion', data: { projectId: project.id, phaseId: phase.id } }, controller.signal)
      .then(value => {
        if (value.mode !== 'phase_completion_review' || value.projectId !== project.id
            || value.phaseId !== phase.id || value.projectVersion !== project.version
            || !Array.isArray(value.blockers) || !Array.isArray(value.sources)
            || typeof value.canApprove !== 'boolean'
            || !['open', 'approved', 'reopened', 'needs_review'].includes(value.status)) {
          throw new Error('The project changed or its evidence is invalid. Close this review and refresh Projects.');
        }
        if (current) setReview(value);
      })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Could not read phase evidence.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [request, project.id, project.version, phase.id, refresh]);

  const closed = review?.status === 'approved' || review?.status === 'needs_review';
  const confirmed = criteria && (phase.progressMethod !== 'units' || Number(units) === phase.unitsPlanned)
    && phase.checklist.every(item => item.required === false || checked.includes(item.id));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!review || busy || !canManage || !reason.trim() || (!closed && (!review.canApprove || !confirmed))) return;
    setError('');
    try {
      const data: Record<string, unknown> = { projectId: project.id, phaseId: phase.id, expectedVersion: project.version, reason };
      if (!closed) Object.assign(data, { previewDigest: review.digest, confirmation: {
        criteriaConfirmed: criteria, verifiedUnits: phase.progressMethod === 'units' ? Number(units) : null, checklistIds: checked,
      } });
      await onSave(closed ? 'reopen_phase' : 'approve_phase_completion', data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The result could not be confirmed.'); }
  };
  return <PlanDialog title={`Review phase completion — ${phase.name}`} busy={busy} onClose={onClose}>
    <div className={s.form}>
      <p className={s.notice}>Approve the completed scope only after reviewing its Field evidence. Booking time and budget consumption do not prove completion. No Field report, payroll, invoice or appointment will be changed.</p>
      {loading && <p role="status">Checking current Field approvals and prerequisites…</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      <button type="button" className={s.button} disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>Recheck evidence</button>
      {review && <>
        <strong role="status">{review.status === 'approved' ? 'Scope completion approved' : review.status === 'needs_review' ? 'Prior approval needs review' : 'Awaiting scope approval'}</strong>
        {review.blockers.length > 0 && <div className={s.warning}>{review.blockers.map(code => <p key={code}>{explanations[code] || code.replaceAll('_', ' ')}</p>)}</div>}
        {review.sources.map(row => <article className={s.card} key={row.workOrderId}>
          <strong>{row.workOrderId} · {row.vanId || 'Van unresolved'}</strong>
          <p>Office Review: {row.reviewStatus || 'Not approved'}</p><small>{row.revisionId || 'No frozen revision'}</small>
        </article>)}
        <form className={s.form} onSubmit={event => void submit(event)}>
          {!closed && <>
            <p className={s.prewrap}><strong>Completion criteria:</strong> {phase.completionCriteria}</p>
            {phase.progressMethod === 'units' && <label>Verified completed units — planned {phase.unitsPlanned}
              <input type="number" min={0} max={phase.unitsPlanned} step={1} required value={units} disabled={busy || !canManage} onChange={event => setUnits(event.target.value)}/>
            </label>}
            {phase.checklist.map(item => <label className={s.check} key={item.id}>
              <input type="checkbox" disabled={busy || !canManage} checked={checked.includes(item.id)} onChange={event => setChecked(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>
              {item.label}{item.required === false ? ' (optional)' : ''}
            </label>)}
            <label className={s.check}><input type="checkbox" checked={criteria} disabled={busy || !canManage} onChange={event => setCriteria(event.target.checked)}/>I reviewed the evidence and confirm that this phase's scope and completion criteria are satisfied.</label>
          </>}
          <label>{closed ? 'Reason to reopen for additional work or correction' : 'Scope review note'}<textarea required maxLength={1000} value={reason} disabled={busy || !canManage} onChange={event => setReason(event.target.value)}/></label>
          {closed && <p className={s.notice}>Reopening retains the original approval in the audit history. Dependent phases will require a current prerequisite approval before new bookings.</p>}
          <button type="submit" className={s.primary} disabled={busy || !canManage || !reason.trim() || (!closed && (!review.canApprove || !confirmed))}>
            {closed ? 'Reopen phase' : 'Approve phase completion'}
          </button>
        </form>
      </>}
    </div>
  </PlanDialog>;
}
