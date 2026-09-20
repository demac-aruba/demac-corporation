'use client';

import { useState, type FormEvent } from 'react';
import { minutesLabel } from '@/lib/projects/registry-client-core';
import type { CentralProject } from '@/lib/projects/registry-types';
import { PlanDialog } from './project-plan-dialog';
import s from './projects-central.module.css';

export function ProjectEstimateDialog({ project, busy, onClose, onSave }: {
  project: CentralProject; busy: boolean; onClose: () => void;
  onSave: (action: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const hours = Number(form.get('hours'));
    const minutes = Number(form.get('minutes'));
    const total = hours * 60 + minutes;
    const reason = String(form.get('reason') ?? '').trim();
    setError('');
    try {
      if (!Number.isSafeInteger(hours) || hours < 0 || !Number.isSafeInteger(minutes) || minutes < 0 || minutes > 59
        || !Number.isSafeInteger(total) || total < 1 || total > 100000000) {
        throw Error('Enter a positive estimate in whole hours and minutes.');
      }
      if (!reason) throw Error('Explain why the planning estimate is changing.');
      await onSave('revise_estimate', {
        projectId: project.id, expectedVersion: project.version, budgetedVanMinutes: total, reason,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The revision could not be confirmed.');
    }
  };

  return <PlanDialog title="Revise project estimate" busy={busy} onClose={onClose}>
    <form className={s.form} onSubmit={event => void submit(event)}>
      <p>Original estimate: <strong>{minutesLabel(project.budget.originalMinutes)}</strong>.<br/>
        Current estimate: <strong>{minutesLabel(project.budget.currentMinutes)}</strong> · Revision {project.budget.revision}.</p>
      <p className={s.notice}>Budget overruns do not require an estimate revision to book available Van time.
        This explicit revision preserves the original estimate and records your reason. Scheduled time, worked time and scope completion remain separate.</p>
      <div className={s.formGrid}>
        <label>Revised Van hours<input name="hours" type="number" min="0" step="1" max="1666666" required disabled={busy}
          defaultValue={Math.floor(project.budget.currentMinutes / 60)}/></label>
        <label>Additional minutes<input name="minutes" type="number" min="0" max="59" step="1" required disabled={busy}
          defaultValue={project.budget.currentMinutes % 60}/></label>
      </div>
      <label>Reason for estimate revision<textarea name="reason" maxLength={1000} required disabled={busy}/></label>
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.actions}>
        <button type="button" className={s.button} onClick={onClose}>Cancel</button>
        <button type="submit" className={s.primary} disabled={busy}>Save estimate revision</button>
      </div>
    </form>
  </PlanDialog>;
}
