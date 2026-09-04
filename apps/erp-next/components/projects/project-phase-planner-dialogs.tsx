'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { projectMetrics, type BrowserProject } from '@/lib/browser-projects';
import {
  phaseBriefing,
  phaseCapacitySummary,
  phaseRemainingHours,
  projectPhases,
  type PhaseDraftInput,
  type PhasePriority,
  type PhaseProgressMethod,
  type PhaseTemplate,
  type PhaseWorkflowStatus,
  type PlannedProjectPhase,
  type PreviewPhaseAssignmentInput,
} from '@/lib/project-phase-planner';
import styles from './project-phase-planner-preview.module.css';

const workflowStatuses: PhaseWorkflowStatus[] = [
  'Draft',
  'Ready to Schedule',
  'In Progress',
  'Blocked',
  'On Hold',
  'Near Completion',
  'Completed',
  'Cancelled',
];
const priorities: PhasePriority[] = ['Low', 'Normal', 'High', 'Critical'];
const methods: Array<{ value: PhaseProgressMethod; label: string; help: string }> = [
  { value: 'units', label: 'Units completed', help: 'Rooms, systems, equipment, or repeated work.' },
  { value: 'checklist', label: 'Checklist completion', help: 'Controlled tasks that require defined steps.' },
  { value: 'hours', label: 'Actual hours', help: 'Engineering, supervision, or time-based work.' },
  { value: 'approval', label: 'Manager approval', help: 'Commissioning, handover, or administrative closeout.' },
];
const vans = ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4', 'VAN-5'];

function number(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

function useFocusTrap(dialogRef: RefObject<HTMLElement | null>) {
  return (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]',
    )];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

function DialogShell({
  eyebrow,
  title,
  description,
  wide = false,
  busy = false,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  wide?: boolean;
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const trap = useFocusTrap(ref);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input,button:not([disabled]),select,textarea')?.focus();
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [busy, onClose]);
  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section ref={ref} className={`${styles.modal} ${wide ? styles.modalWide : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={trap}>
      <header><div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close">×</button></header>
      {children}
    </section>
  </div>;
}

export function PhaseDialog({
  project,
  phase,
  busy,
  onClose,
  onSave,
}: {
  project: BrowserProject;
  phase?: PlannedProjectPhase;
  busy: boolean;
  onClose: () => void;
  onSave: (input: PhaseDraftInput) => Promise<void>;
}) {
  const phases = projectPhases(project);
  const summary = phaseCapacitySummary(project);
  const nextSequence = phases.length ? Math.max(...phases.map((item) => item.sequence)) + 10 : 10;
  const [method, setMethod] = useState<PhaseProgressMethod>(phase?.progressMethod ?? 'units');
  const [hours, setHours] = useState(String(phase?.estimatedLaborHours ?? Math.min(8, Math.max(1, summary.unallocated))));
  const [error, setError] = useState('');
  const parsedHours = Number(hours);
  const allocatedWithoutCurrent = summary.allocated - (phase?.estimatedLaborHours ?? 0);
  const remainingAfterSave = project.estimatedLaborHours - allocatedWithoutCurrent - (Number.isFinite(parsedHours) ? parsedHours : 0);
  const dependencies = phases.filter((candidate) => candidate.id !== phase?.id);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await onSave({
        phaseId: phase?.id,
        name: String(form.get('name') ?? ''),
        sequence: Number(form.get('sequence')),
        objective: String(form.get('objective') ?? ''),
        scopeOfWork: String(form.get('scopeOfWork') ?? ''),
        outOfScope: String(form.get('outOfScope') ?? ''),
        plannedHours: Number(form.get('plannedHours')),
        progressMethod: String(form.get('progressMethod') ?? 'units') as PhaseProgressMethod,
        plannedUnits: Number(form.get('plannedUnits')) || 0,
        checklistText: String(form.get('checklistText') ?? ''),
        startsOn: String(form.get('startsOn') ?? ''),
        endsOn: String(form.get('endsOn') ?? ''),
        dependencies: form.getAll('dependencies').map(String),
        technicianInstructions: String(form.get('technicianInstructions') ?? ''),
        completionCriteria: String(form.get('completionCriteria') ?? ''),
        priority: String(form.get('priority') ?? 'Normal') as PhasePriority,
        responsibleManager: String(form.get('responsibleManager') ?? ''),
        workflowStatus: String(form.get('workflowStatus') ?? 'Draft') as PhaseWorkflowStatus,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The phase could not be saved.');
    }
  };

  return <DialogShell
    eyebrow="Projects · Phase Planning"
    title={phase ? 'Edit Custom Phase' : 'Create Custom Phase'}
    description="Define the work in your own order. Templates are optional and every copied phase remains editable."
    wide
    busy={busy}
    onClose={onClose}
  >
    <form onSubmit={submit}>
      <div className={styles.modalBody}>
        <div className={styles.formGrid}>
          <label className={styles.formWide}><span>Phase name *</span><input name="name" required autoFocus defaultValue={phase?.name ?? ''} placeholder="Example: Refrigerant Piping & Drainage" /></label>
          <label><span>Sequence / order *</span><input name="sequence" type="number" min="1" step="1" required defaultValue={phase?.sequence ?? nextSequence} /></label>
          <label><span>Workflow status</span><select name="workflowStatus" defaultValue={phase?.workflowStatus ?? 'Draft'}>{workflowStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className={styles.formWide}><span>Objective / reason *</span><textarea name="objective" rows={3} required defaultValue={phase?.objective ?? ''} placeholder="Why is this phase needed?" /></label>
          <label><span>Scope of work *</span><textarea name="scopeOfWork" rows={6} required defaultValue={phase?.scopeOfWork ?? ''} placeholder="Describe the work included in this phase…" /></label>
          <label><span>Out of scope · optional</span><textarea name="outOfScope" rows={6} defaultValue={phase?.outOfScope ?? ''} placeholder="Clarify exclusions and boundaries…" /></label>
          <label><span>Planned capacity *</span><div className={styles.inputSuffix}><input name="plannedHours" type="number" min="1" step="1" required value={hours} onChange={(event) => setHours(event.target.value)} /><b>hours</b></div><small>One slot equals {project.slotDurationMinutes / 60} hour of Van capacity.</small></label>
          <label><span>Progress method *</span><select name="progressMethod" value={method} onChange={(event) => setMethod(event.target.value as PhaseProgressMethod)}>{methods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>{methods.find((item) => item.value === method)?.help}</small></label>
          {method === 'units' ? <label><span>Planned units *</span><input name="plannedUnits" type="number" min="1" step="1" required defaultValue={phase?.unitsPlanned || project.totalUnits} /></label> : <input name="plannedUnits" type="hidden" value="0" />}
          {method === 'checklist' ? <label className={styles.formWide}><span>Checklist · one item per line *</span><textarea name="checklistText" rows={6} required defaultValue={phase?.checklist.map((item) => item.label).join('\n') ?? ''} placeholder={'Install supports\nComplete pressure test\nUpload concealed-work photos'} /></label> : null}
          <label><span>Planned start date *</span><input name="startsOn" type="date" required defaultValue={phase?.startsOn ?? project.startsOn} /></label>
          <label><span>Target completion date *</span><input name="endsOn" type="date" required defaultValue={phase?.endsOn ?? project.estimatedCompletionOn} /></label>
          <label className={styles.formWide}><span>Dependencies · optional</span><select name="dependencies" multiple defaultValue={phase?.dependencies ?? []}>{dependencies.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.sequence} · {candidate.name}</option>)}</select><small>Use Ctrl/Cmd to select more than one prerequisite.</small></label>
          <label className={styles.formWide}><span>Technician instructions</span><textarea name="technicianInstructions" rows={5} maxLength={2000} defaultValue={phase?.technicianInstructions ?? ''} placeholder="Safety, access, installation method, measurements, photos, or reporting instructions…" /></label>
          <label className={styles.formWide}><span>Completion criteria *</span><textarea name="completionCriteria" rows={4} required defaultValue={phase?.completionCriteria ?? ''} placeholder="How will management know this phase is complete?" /></label>
          <label><span>Priority *</span><select name="priority" defaultValue={phase?.priority ?? 'Normal'}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
          <label><span>Responsible manager</span><input name="responsibleManager" defaultValue={phase?.responsibleManager === 'Not assigned' ? project.managerName : phase?.responsibleManager ?? project.managerName} placeholder="Not assigned" /></label>
        </div>
        <aside className={styles.liveCapacity}>
          <span>Capacity Summary · Live</span>
          <dl>
            <div><dt>Project capacity</dt><dd>{number(project.estimatedLaborHours)}h</dd></div>
            <div><dt>Already allocated</dt><dd>{number(allocatedWithoutCurrent)}h</dd></div>
            <div className={styles.livePhase}><dt>This phase</dt><dd>{Number.isFinite(parsedHours) ? number(parsedHours) : '—'}h</dd></div>
            <div className={remainingAfterSave < 0 ? styles.liveNegative : styles.liveRemaining}><dt>Remaining after save</dt><dd>{number(remainingAfterSave)}h</dd></div>
          </dl>
          <p>Draft projects may keep unallocated capacity. The complete phase portfolio can never exceed the approved Project labor budget.</p>
        </aside>
      </div>
      {error ? <div className={styles.formError} role="alert">{error}</div> : null}
      <footer><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={busy || remainingAfterSave < 0}>{busy ? 'Saving…' : 'Save Phase'}</button></footer>
    </form>
  </DialogShell>;
}

export function TemplateDialog({
  project,
  suggested,
  company,
  busy,
  onClose,
  onApply,
  onDeleteCompany,
}: {
  project: BrowserProject;
  suggested: PhaseTemplate[];
  company: PhaseTemplate[];
  busy: boolean;
  onClose: () => void;
  onApply: (template: PhaseTemplate) => Promise<void>;
  onDeleteCompany: (templateId: string) => void;
}) {
  const [tab, setTab] = useState<'Suggested' | 'Company'>('Suggested');
  const [error, setError] = useState('');
  const templates = tab === 'Suggested' ? suggested : company;
  const summary = phaseCapacitySummary(project);
  const apply = async (template: PhaseTemplate) => {
    setError('');
    try {
      await onApply(template);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The template could not be applied.');
    }
  };
  return <DialogShell eyebrow="Projects · Optional Accelerators" title="Phase Template Library" description="Start from a suggested workflow or reuse a DEMAC company template. Every copied phase can be renamed, reordered, resized, or deleted." wide busy={busy} onClose={onClose}>
    <div className={styles.templateTabs}><button type="button" className={tab === 'Suggested' ? styles.activeTemplateTab : ''} onClick={() => setTab('Suggested')}>Suggested Templates</button><button type="button" className={tab === 'Company' ? styles.activeTemplateTab : ''} onClick={() => setTab('Company')}>My Company Templates</button><span>{number(summary.unallocated)}h unallocated</span></div>
    {error ? <div className={styles.formError} role="alert">{error}</div> : null}
    <div className={styles.templateGrid}>{templates.length ? templates.map((template) => <article className={styles.templateCard} key={template.id}>
      <header><span>{template.source} Template</span><h3>{template.name}</h3><p>{template.description}</p></header>
      <div className={styles.templateMeta}><span>{template.phases.length} phases</span>{template.projectTypes.map((type) => <span key={type}>{type}</span>)}</div>
      <ol>{template.phases.slice(0, 8).map((phase) => <li key={phase.name}>{phase.name}</li>)}</ol>
      <footer><button type="button" className={styles.primaryButton} disabled={busy || summary.unallocated < template.phases.length} onClick={() => void apply(template)}>Use Editable Copy</button>{template.source === 'Company' ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => onDeleteCompany(template.id)}>Delete</button> : null}</footer>
    </article>) : <div className={styles.templateEmpty}><strong>No company templates yet</strong><p>Create your own phases for a project, then select “Save as Company Template” to reuse that exact DEMAC workflow later.</p></div>}</div>
    <div className={styles.modalFooterOnly}><button type="button" className={styles.secondaryButton} onClick={onClose}>Close</button></div>
  </DialogShell>;
}

export function SaveTemplateDialog({
  project,
  busy,
  onClose,
  onSave,
}: {
  project: BrowserProject;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      await onSave(String(new FormData(event.currentTarget).get('name') ?? ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The company template could not be saved.');
    }
  };
  return <DialogShell eyebrow="DEMAC Company Templates" title="Save Project Phases as Template" description="Save this structure for future projects. The template stores reusable planning defaults, not the current Project’s actual progress." busy={busy} onClose={onClose}>
    <form onSubmit={submit}><div className={styles.simpleForm}><label><span>Template name *</span><input name="name" required autoFocus defaultValue={`DEMAC ${project.type} Workflow`} /></label><div className={styles.infoBox}>{projectPhases(project).length} phases will be converted into an editable company template. Capacity will scale to the next Project’s available hours.</div>{error ? <div className={styles.formError}>{error}</div> : null}</div><footer><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={busy}>Save Company Template</button></footer></form>
  </DialogShell>;
}

export function SchedulePhaseDialog({
  project,
  phase,
  busy,
  onClose,
  onSave,
}: {
  project: BrowserProject;
  phase: PlannedProjectPhase;
  busy: boolean;
  onClose: () => void;
  onSave: (input: PreviewPhaseAssignmentInput) => Promise<void>;
}) {
  const [slots, setSlots] = useState('1');
  const [error, setError] = useState('');
  const slotCount = Number(slots);
  const hours = Number.isFinite(slotCount) ? slotCount * project.slotDurationMinutes / 60 : 0;
  const remaining = phaseRemainingHours(project, phase);
  const projectRemaining = projectMetrics(project).remainingUnscheduledHours;
  const briefing = useMemo(() => phaseBriefing(project, phase), [phase, project]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await onSave({
        phaseId: phase.id,
        scheduledDate: String(form.get('scheduledDate') ?? ''),
        scheduledStart: String(form.get('scheduledStart') ?? ''),
        scheduledSlots: Number(form.get('scheduledSlots')),
        vanId: String(form.get('vanId') ?? ''),
        technicianIds: String(form.get('technicianIds') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
        unitsPlanned: Number(form.get('unitsPlanned')) || 0,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The preview assignment could not be created.');
    }
  };
  return <DialogShell eyebrow="Projects · Scheduling Handoff" title={`Schedule ${phase.name}`} description="Reserve this phase’s approved capacity and preview the structured handoff sent to the assigned technicians." wide busy={busy} onClose={onClose}>
    <form onSubmit={submit}><div className={styles.simpleForm}>
      <div className={styles.scheduleSummary}><div><span>Phase budget</span><strong>{number(phase.estimatedLaborHours)}h</strong></div><div><span>Phase available</span><strong>{number(remaining, 1)}h</strong></div><div><span>Project available</span><strong>{number(projectRemaining, 1)}h</strong></div><div><span>This visit</span><strong>{number(hours, 1)}h</strong></div></div>
      <label><span>Scheduled date *</span><input name="scheduledDate" type="date" required defaultValue={phase.startsOn} /></label>
      <label><span>Start time *</span><input name="scheduledStart" type="time" required defaultValue="08:00" /></label>
      <label><span>Assigned Van *</span><select name="vanId" defaultValue="VAN-1">{vans.map((van) => <option key={van} value={van}>{van.replace('VAN-', 'Van ')}</option>)}</select></label>
      <label><span>Van capacity slots *</span><select name="scheduledSlots" value={slots} onChange={(event) => setSlots(event.target.value)}>{Array.from({ length: project.slotsPerWorkDay }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} slot{value === 1 ? '' : 's'} · {number(value * project.slotDurationMinutes / 60)}h</option>)}</select></label>
      <label><span>Technician IDs or names</span><input name="technicianIds" placeholder="Miguel Reyes, Walter" /></label>
      <label><span>Units planned for this visit</span><input name="unitsPlanned" type="number" min="0" step="1" defaultValue={phase.progressMethod === 'units' ? Math.min(phase.unitsPlanned, 2) : 0} /></label>
      <div className={hours > remaining || hours > projectRemaining ? styles.alertBox : styles.infoBox}>This visit reserves {number(hours, 1)}h. {number(Math.max(0, remaining - hours), 1)}h will remain uncommitted in this phase.</div>
      <div className={styles.briefingPreview}><span>Technician handoff preview</span><p>{briefing}</p></div>
      {error ? <div className={styles.formError}>{error}</div> : null}
    </div><footer className={styles.scheduleFooter}><a className={styles.secondaryButton} href="/scheduling">Open Canonical Scheduling</a><span /><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={busy || hours > remaining || hours > projectRemaining}>Create Preview Assignment</button></footer></form>
  </DialogShell>;
}
