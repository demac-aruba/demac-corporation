'use client';

import { useState, type FormEvent } from 'react';
import type { BrowserProject, ProjectAssignment } from '@/lib/browser-projects';
import {
  phaseProgressPercent,
  phaseRemainingHours,
  phaseScheduledHours,
  type PlannedProjectPhase,
} from '@/lib/project-phase-planner';
import styles from './project-phase-planner-preview.module.css';

function number(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}
function percent(value: number) {
  return `${number(Math.max(0, value), 1)}%`;
}
function dateLabel(value?: string) {
  if (!value) return 'Date pending';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function timeLabel(value?: string) {
  if (!value) return 'Time pending';
  const [hourText, minute = '00'] = value.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}
function StatusPill({ label, tone }: { label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'slate' }) {
  return <span className={`${styles.pill} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>{label}</span>;
}
function Progress({ value }: { value: number }) {
  return <div className={styles.progressWrap}><div className={styles.progressTrack}><i className={styles.fillGreen} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div></div>;
}

export function ProjectPhaseTechnicianPreview({
  project,
  phase,
  assignment,
  canManage,
  busy,
  notice,
  noticeTone,
  onDismissNotice,
  onBack,
  onStart,
  onPause,
  onComplete,
}: {
  project: BrowserProject;
  phase?: PlannedProjectPhase;
  assignment?: ProjectAssignment;
  canManage: boolean;
  busy: boolean;
  notice: string;
  noticeTone: 'success' | 'warning';
  onDismissNotice: () => void;
  onBack: () => void;
  onStart: () => void;
  onPause: () => void;
  onComplete: (input: {
    actualHours: number;
    unitsCompleted: number;
    note: string;
    evidenceCount: number;
    checklistCompletedIds: string[];
  }) => Promise<void>;
}) {
  const [error, setError] = useState('');
  if (!phase || !assignment) {
    return <section className={styles.workspace}>
      <button type="button" className={styles.secondaryButton} onClick={onBack}>← Back to Phase Planner</button>
      <article className={styles.panel}><div className={styles.emptyState}><span className={styles.emptyIcon}>FA</span><h2>No phase assignment selected</h2><p>Schedule preview work from a phase before opening the technician experience.</p></div></article>
    </section>;
  }

  const posted = Boolean(assignment.postedAt);
  const progress = phaseProgressPercent(phase);
  const statusTone = posted ? 'green' : assignment.status === 'Paused' ? 'amber' : assignment.status === 'Completed' ? 'green' : 'blue';
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await onComplete({
        actualHours: Number(form.get('actualHours')),
        unitsCompleted: Number(form.get('unitsCompleted')) || 0,
        note: String(form.get('note') ?? ''),
        evidenceCount: Number(form.get('evidenceCount')) || 0,
        checklistCompletedIds: form.getAll('checklist').map(String),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Completion could not be posted.');
    }
  };

  return <section className={styles.workspace} aria-busy={busy}>
    <div className={styles.previewBanner}><div><span>SIMULATED TECHNICIAN PORTAL</span><strong>Phase handoff and progress validation</strong><p>This interaction is browser-only and does not create a canonical Work Visit, inventory movement, invoice, or payroll record.</p></div><div><a href="/field">Open Current Field App</a></div></div>
    {notice ? <div className={`${styles.notice} ${noticeTone === 'warning' ? styles.noticeWarning : ''}`} role={noticeTone === 'warning' ? 'alert' : 'status'}><span>{noticeTone === 'warning' ? '!' : '✓'}</span><p>{notice}</p><button type="button" onClick={onDismissNotice}>×</button></div> : null}

    <header className={styles.pageHeader}>
      <div><nav><button type="button" onClick={onBack}>Phase Planner</button><span>›</span><span>{assignment.id}</span></nav><div className={styles.projectTitle}><h1>{project.name}</h1><StatusPill label={posted ? 'Posted' : assignment.status} tone={statusTone} /></div><p>{project.projectNumber} · {phase.name}</p></div>
      <div className={styles.headerActions}><button type="button" className={styles.secondaryButton} onClick={onBack}>← Back to Project</button><a className={styles.secondaryButton} href="/field">Canonical Technician Portal</a></div>
    </header>

    <div className={styles.jobMeta}>
      <div><span>Customer</span><strong>{project.customerName}</strong><small>{project.location}</small></div>
      <div><span>Phase</span><strong>{phase.name}</strong><small>{phase.workflowStatus}</small></div>
      <div><span>Assigned Van</span><strong>{assignment.vanId.replace('VAN-', 'Van ')}</strong><small>{assignment.technicianIds.join(' · ') || 'Assigned Van crew'}</small></div>
      <div><span>Scheduled</span><strong>{dateLabel(assignment.scheduledDate)} · {timeLabel(assignment.scheduledStart)}</strong><small>{number(assignment.scheduledHours, 1)}h · {assignment.scheduledSlots ?? '—'} slots</small></div>
      <div><span>Visit units</span><strong>{assignment.unitsCompleted} / {assignment.unitsPlanned}</strong><small>{project.unitType}</small></div>
      <div><span>Phase progress</span><strong>{percent(progress)}</strong><Progress value={progress} /></div>
    </div>

    <div className={styles.techActions}>
      <button type="button" className={styles.primaryButton} onClick={onStart} disabled={!canManage || busy || posted || assignment.status === 'In Progress'}>▶ Start Work</button>
      <button type="button" className={styles.secondaryButton} onClick={onPause} disabled={!canManage || busy || posted || assignment.status !== 'In Progress'}>Ⅱ Pause</button>
      <span />
      <StatusPill label={`${number(phaseRemainingHours(project, phase), 1)}h phase capacity remaining`} tone="blue" />
    </div>

    <div className={styles.techLayout}>
      <main className={styles.techMain}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Structured work briefing</span><h2>Instructions for this assignment</h2><p>Project and phase instructions are separated so the technician understands the permanent site rules and today’s exact scope.</p></div></div>
          <div className={styles.briefingSections}>
            <section><span>PROJECT INSTRUCTIONS</span><p>{project.technicianInstructions || 'No Project-level instructions.'}</p></section>
            <section><span>PHASE OBJECTIVE</span><p>{phase.objective}</p></section>
            <section><span>PHASE SCOPE</span><p>{phase.scopeOfWork}</p></section>
            <section><span>OUT OF SCOPE</span><p>{phase.outOfScope || 'No exclusions recorded.'}</p></section>
            <section><span>PHASE TECHNICIAN INSTRUCTIONS</span><p>{phase.technicianInstructions || 'No additional phase instructions.'}</p></section>
            <section><span>COMPLETION CRITERIA</span><p>{phase.completionCriteria}</p></section>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Field record</span><h2>{posted ? 'Posted completion' : 'Record work and progress'}</h2><p>Scheduled time remains a plan. Actual hours, units, checklist progress, notes, and evidence are posted once when the visit is completed.</p></div></div>
          {posted ? <div className={styles.postedState}><span>✓</span><strong>Assignment posted</strong><p>Posted {assignment.postedAt ? new Date(assignment.postedAt).toLocaleString('en-US', { timeZone: 'America/Aruba' }) : ''}. Repeating completion creates no duplicate actual hours or progress.</p></div> : <form className={styles.completionForm} onSubmit={submit}>
            <label><span>Actual hours *</span><input name="actualHours" type="number" min="0" step="0.25" required defaultValue={assignment.scheduledHours} /></label>
            <label><span>Units completed</span><input name="unitsCompleted" type="number" min="0" max={assignment.unitsPlanned} step="1" defaultValue={assignment.unitsPlanned} /></label>
            <label><span>Photo / evidence count</span><input name="evidenceCount" type="number" min="0" step="1" defaultValue="4" /></label>
            <label className={styles.formWide}><span>Technician report / progress note</span><textarea name="note" rows={5} placeholder="Describe completed work, blockers, measurements, follow-up needs, or changes in scope…" /></label>
            {phase.progressMethod === 'checklist' ? <fieldset className={styles.fieldChecklist}><legend>Checklist completed during this visit</legend>{phase.checklist.map((item) => <label key={item.id}><input type="checkbox" name="checklist" value={item.id} defaultChecked={item.done} /><span>{item.label}</span>{item.required ? <small>Required</small> : null}</label>)}</fieldset> : null}
            {error ? <div className={styles.formError} role="alert">{error}</div> : null}
            <footer><button type="submit" className={styles.primaryButton} disabled={!canManage || busy}>✓ Complete Assignment & Post Progress</button></footer>
          </form>}
        </article>
      </main>

      <aside className={styles.rightRail}>
        <article className={styles.panel}><div className={styles.railHeader}><span>Phase control</span><h2>Progress and capacity</h2></div><dl className={styles.summaryList}><div><dt>Phase budget</dt><dd>{number(phase.estimatedLaborHours)}h</dd></div><div><dt>Scheduled now</dt><dd>{number(phaseScheduledHours(project, phase.id), 1)}h</dd></div><div><dt>Actual to date</dt><dd>{number(phase.actualLaborHours, 1)}h</dd></div><div><dt>Uncommitted</dt><dd>{number(phaseRemainingHours(project, phase), 1)}h</dd></div></dl></article>
        <article className={styles.panel}><div className={styles.railHeader}><span>Evidence rule</span><h2>Before completing</h2></div><div className={styles.railBody}><p>Record the actual time, units or checklist progress, a clear field note, and the required evidence. Report blockers instead of manufacturing completion.</p><small>In production, these inputs belong to Field Operations Authority and will be validated against the assigned Work Order and Work Visit.</small></div></article>
      </aside>
    </div>
  </section>;
}
