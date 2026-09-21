'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { CentralProject, ProjectPhasePlan } from '@/lib/projects/registry-types';
import type { RegistryRequest } from '@/lib/projects/registry-client-core';
import { PlanDialog } from './project-plan-dialog';
import s from './projects-central.module.css';

type Progress = { completedUnits: number | null; checklistIds: string[] };
type Review = {
  mode: 'phase_progress_review'; projectId: string; projectVersion: number; phaseId: string;
  phase: ProjectPhasePlan; digest: string; canRecord: boolean; blockers: string[];
  previous: { eventId: string; reviewedAt: string; reviewedBy: string; current: boolean;
    progress: Progress; measure: { percent: number | null } | null; reason: string } | null;
  sources: Array<{ workOrderId: string; vanId: string | null; revisionId: string }>;
};
type Props = {
  project: CentralProject; phase: ProjectPhasePlan; request: RegistryRequest;
  canManage: boolean; busy: boolean; onClose: () => void;
  onSave: (action: string, data: Record<string, unknown>) => Promise<void>;
};
const explanations: Record<string, string> = {
  phase_no_approved_progress_source: 'At least one completed visit with current Office approval is required to support this review.',
  project_phase_closed: 'This phase has already been accepted. Reopen it before recording additional work or a correction.',
  phase_evidence_incomplete: 'The complete evidence could not be read within this review. Do not treat a partial read as full progress.',
  legacy_import_requires_reconciliation: 'Reconcile the imported Project history before certifying progress.',
  project_not_open: 'Reopen the Project before changing its scope records.',
};
export function PhaseProgressDialog({ project, phase, request, canManage, busy, onClose, onSave }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [units, setUnits] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [correction, setCorrection] = useState(false);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setReview(null); setLoading(true); setError(''); setCorrection(false); setUnits(''); setChecked([]);
    void request<Review>({ action: 'get_phase_progress', data: { projectId: project.id, phaseId: phase.id } }, controller.signal)
      .then(value => {
        if (value.mode !== 'phase_progress_review' || value.projectId !== project.id || value.phaseId !== phase.id
            || value.projectVersion !== project.version || typeof value.canRecord !== 'boolean'
            || !/^[a-f0-9]{64}$/.test(value.digest) || !Array.isArray(value.blockers) || !Array.isArray(value.sources)
            || (value.previous && (!value.previous.progress || !Array.isArray(value.previous.progress.checklistIds)))) {
          throw new Error('The Project changed or its evidence is invalid. Close this review and refresh Projects.');
        }
        if (!current) return;
        setReview(value);
        if (value.previous) {
          setUnits(value.previous.progress.completedUnits === null ? '' : String(value.previous.progress.completedUnits));
          setChecked(value.previous.progress.checklistIds.filter(id => phase.checklist.some(item => item.id === id)));
        }
      }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Progress evidence is unavailable.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [request, project.id, project.version, phase.id, refresh]);
  const unitsValid = phase.progressMethod !== 'units' || (units.trim() !== '' && Number.isSafeInteger(Number(units))
    && Number(units) >= 0 && Number(units) <= phase.unitsPlanned);
  const previous = review?.previous;
  const reducing = Boolean(previous && ((previous.progress.completedUnits !== null && phase.progressMethod === 'units'
      && unitsValid && Number(units) < previous.progress.completedUnits)
    || previous.progress.checklistIds.some(id => !checked.includes(id))));
  const disabled = busy || !canManage || !review?.canRecord || !unitsValid || !reason.trim() || (reducing && !correction);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !review) return;
    setError('');
    try {
      await onSave('record_phase_progress', { projectId: project.id, phaseId: phase.id,
        expectedVersion: project.version, previewDigest: review.digest, reason,
        progress: { completedUnits: phase.progressMethod === 'units' ? Number(units) : null, checklistIds: checked },
        ...(reducing && previous ? { correctsEventId: previous.eventId } : {}),
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The checkpoint could not be confirmed.'); }
  };
  return <PlanDialog title={`Review partial progress — ${phase.name}`} busy={busy} onClose={onClose}>
    <div className={s.form}>
      <p className={s.notice}>Record the verified total completed to date, not the additional amount for this visit. This checkpoint does not close the phase, change a technician report, or add worked hours.</p>
      {loading && <p role="status">Reading approved Field evidence…</p>}
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button type="button" className={s.button} disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>Recheck progress evidence</button>
      {review && <>
        {previous && <section className={previous.current ? s.notice : s.warning}>
          <strong>{previous.current ? 'Current reviewed checkpoint' : 'Prior checkpoint — evidence needs renewed review'}</strong>
          <p>{previous.reviewedAt} · {previous.progress.completedUnits === null ? 'Checklist / scope review' : `${previous.progress.completedUnits} units recorded`}</p>
          {previous.current && previous.measure?.percent !== null && previous.measure?.percent !== undefined
            && <p>{new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(previous.measure.percent)}% of this phase's defined scope reviewed. Completion is still a separate approval.</p>}
          <p>{previous.reason}</p>
        </section>}
        {review.blockers.length > 0 && <div className={s.warning}>{review.blockers.map(code => <p key={code}>{explanations[code] || code.replaceAll('_', ' ')}</p>)}</div>}
        <section><h3>Approved source reports</h3>{review.sources.map(row => <p key={row.workOrderId}>{row.workOrderId} · {row.vanId || 'Van unresolved'} · {row.revisionId}</p>)}</section>
        <form className={s.form} onSubmit={event => void submit(event)}>
          {phase.progressMethod === 'units' && <label>Cumulative verified units — planned {phase.unitsPlanned}
            <input aria-label="Cumulative verified units" type="number" required min={0} max={phase.unitsPlanned} step={1}
              value={units} disabled={busy || !canManage} onChange={event => setUnits(event.target.value)}/>
          </label>}
          {phase.checklist.map(item => <label className={s.check} key={item.id}><input type="checkbox"
            checked={checked.includes(item.id)} disabled={busy || !canManage}
            onChange={event => setChecked(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>
            {item.label}{item.required === false ? ' (optional)' : ''}</label>)}
          {['hours', 'approval'].includes(phase.progressMethod) && <p className={s.muted}>No physical percentage is inferred from spent hours or an approval-only method. The checkpoint records reviewed scope notes.</p>}
          {reducing && <label className={s.check}><input type="checkbox" checked={correction} disabled={busy || !canManage}
            onChange={event => setCorrection(event.target.checked)}/>I am correcting the previous checkpoint. Its original value and evidence must remain in the audit history.</label>}
          <label>Progress review or correction note<textarea required maxLength={1000} value={reason}
            disabled={busy || !canManage} onChange={event => setReason(event.target.value)}/></label>
          <button type="submit" className={s.primary} disabled={disabled}>Save cumulative checkpoint</button>
        </form>
      </>}
    </div>
  </PlanDialog>;
}
