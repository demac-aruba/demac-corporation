'use client';
import { useState, type FormEvent } from 'react';
import type { CentralProject } from '@/lib/projects/registry-types';
import { materialBudgetInput, materialBudgetLabel, parseMaterialBudget } from '@/lib/projects/material-budget';
import { PlanDialog } from './project-plan-dialog';
import s from './projects-central.module.css';

const label = (amount: number | null | undefined) => amount == null ? 'Not estimated' : materialBudgetLabel({ currency: 'AWG', amountMinor: amount });
export function ProjectMaterialBudget({ project, disabled, onRevise }: { project: CentralProject; disabled: boolean; onRevise: () => void }) {
  const baseline = project.materialBudgetBaseline;
  const originalLabel = !baseline || baseline.provenance === 'not_recorded' ? 'Not recorded — review original evidence' : label(baseline.originalAmountMinor);
  return <section className={s.card} aria-label="Material budget and operational costs">
    <div className={s.sectionTitle}><h2>Material budget and operational costs</h2>
      <button className={s.button} type="button" disabled={disabled} onClick={onRevise}>Revise material budget</button></div>
    <dl className={s.detailList}>
      <dt>{baseline?.provenance === 'imported_snapshot' ? 'Captured imported budget' : 'Original material budget'}</dt><dd>{originalLabel}</dd>
      <dt>Current material budget</dt><dd>{label(project.details?.materialBudget?.amountMinor)}</dd>
      <dt>Registered expenses</dt><dd>Not connected to this shared record</dd>
      <dt>Available material balance</dt><dd>Unknown — verified allocations required</dd>
      <dt>Material budget overrun</dt><dd>Unknown — verified allocations required</dd>
    </dl>
    <p className={s.muted}>Budget period: {project.startsOn} → {project.estimatedCompletionOn}. {baseline ? `Material budget revision ${baseline.revision}.` : 'Earlier revisions are not verified.'} Van time and recorded hours are separate from these monetary amounts.</p>
    <p className={s.notice}>Confirmed manual expenses can support operational tracking without an accounting connection. Browser-only expenses remain local evidence until their source and Project allocation are reviewed. No missing amount is treated as zero, paid, reconciled or synchronized.</p>
  </section>;
}

export function MaterialBudgetDialog({ project, busy, onClose, onSave }: {
  project: CentralProject; busy: boolean; onClose: () => void;
  onSave: (action: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget); setError('');
    try {
      const materialBudget = parseMaterialBudget(String(form.get('amount') ?? ''));
      const reason = String(form.get('reason') ?? '').trim();
      if (!reason) throw Error('Record the reason for this budget revision.');
      if (form.get('confirm') !== 'on') throw Error('Confirm the revised material budget.');
      await onSave('revise_material_budget', { projectId: project.id, expectedVersion: project.version, materialBudget, reason });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The budget revision could not be confirmed.'); }
  };
  return <PlanDialog title="Revise material budget" busy={busy} onClose={onClose}>
    <form className={s.form} onSubmit={event => void submit(event)}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: '1rem' }}>
        <p>Current material budget: {label(project.details?.materialBudget?.amountMinor)}. The recorded original is preserved.</p>
        <label>Revised material budget (AWG)<input aria-label="Revised material budget (AWG)" name="amount" type="number" min="0.01" step="0.01" defaultValue={project.details?.materialBudget ? materialBudgetInput(project.details.materialBudget.amountMinor) : ''}/></label>
        <p className={s.muted}>Leave blank only to explicitly mark the current estimate as unknown. This does not erase the original budget or revision history.</p>
        <label>Reason for material budget revision<textarea name="reason" aria-label="Reason for material budget revision" required maxLength={1000}/></label>
        <label className={s.check}><input name="confirm" type="checkbox" required/>I confirm this budget revision. It does not record an expense or change stock.</label>
        {error && <p role="alert" className={s.error}>{error}</p>}
        <div className={s.actions}><button type="button" className={s.button} onClick={onClose}>Cancel</button><button className={s.primary} type="submit">Save material budget revision</button></div>
      </fieldset>
    </form>
  </PlanDialog>;
}
