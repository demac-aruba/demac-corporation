'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  BROWSER_PROJECTS_PREVIEW_KEY,
  commitBrowserProjectsPreviewMutation,
  createProjectsPreviewState,
  loadBrowserProjectsPreviewState,
  projectMetrics,
  type BrowserProject,
  type BrowserProjectsPreviewState,
  type ProjectAssignment,
} from '@/lib/browser-projects';
import {
  applyPhaseTemplate,
  companyTemplateFromProject,
  completePreviewPhaseAssignment,
  createProjectPhase,
  deleteProjectPhase,
  editProjectPhase,
  markProjectPhaseComplete,
  phaseAssignments,
  phaseBriefing,
  phaseCapacitySummary,
  phaseCompletionBlockers,
  phaseProgressPercent,
  phaseRemainingHours,
  phaseRisk,
  phaseScheduledHours,
  projectPhases,
  reorderProjectPhases,
  replaceProjectInState,
  schedulePreviewPhaseAssignment,
  suggestedPhaseTemplates,
  updatePreviewAssignmentStatus,
  type PhaseDraftInput,
  type PhaseTemplate,
  type PhaseWorkflowStatus,
  type PlannedProjectPhase,
  type PreviewPhaseAssignmentInput,
} from '@/lib/project-phase-planner';
import {
  PhaseDialog,
  SaveTemplateDialog,
  SchedulePhaseDialog,
  TemplateDialog,
} from './project-phase-planner-dialogs';
import { ProjectPhaseTechnicianPreview } from './project-phase-technician-preview';
import styles from './project-phase-planner-preview.module.css';

const COMPANY_TEMPLATE_KEY = 'demac.erp-next.project-phase-templates.preview.v1';
const DEMO_PROJECT_ID = 'DEMO-PRJ-PHASE-PLANNER-001';

type PlannerNoticeTone = 'success' | 'warning';
type Tone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate';

function number(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}
function percent(value: number) {
  return `${number(Math.max(0, value), 1)}%`;
}
function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function statusTone(status: PhaseWorkflowStatus): Tone {
  if (status === 'Completed' || status === 'Ready to Schedule') return 'green';
  if (status === 'In Progress' || status === 'Near Completion') return 'blue';
  if (status === 'Blocked' || status === 'Cancelled') return 'red';
  if (status === 'On Hold') return 'amber';
  return 'slate';
}
function riskTone(risk: ReturnType<typeof phaseRisk>): Tone {
  return risk === 'On Track' ? 'green' : risk === 'At Risk' ? 'amber' : 'red';
}
function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`${styles.pill} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>{label}</span>;
}
function Progress({ value, tone = 'blue', label }: { value: number; tone?: Tone; label?: string }) {
  return <div className={styles.progressWrap} aria-label={label ?? `${percent(value)} complete`}><div className={styles.progressTrack}><i className={styles[`fill${tone[0].toUpperCase()}${tone.slice(1)}`]} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>{label ? <small>{label}</small> : null}</div>;
}
function MetricCard({ code, label, value, note, tone }: { code: string; label: string; value: string; note: string; tone: Tone }) {
  return <article className={styles.metricCard}><span className={`${styles.metricIcon} ${styles[`icon${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>{code}</span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>;
}

function plannerDemoProject(): BrowserProject {
  const source = createProjectsPreviewState().projects[0];
  return {
    ...source,
    id: DEMO_PROJECT_ID,
    projectNumber: 'PRJ-1013',
    name: 'Matthijs - VRF House',
    customerId: 'DEMO-CUS-MATTHIJS-001',
    customerName: 'Matthijs Bijen',
    siteId: 'DEMO-SITE-MATTHIJS-001',
    location: 'San Fuego Z/N',
    contactPerson: 'Matthijs Bijen',
    type: 'VRF Project',
    description: 'Residential VRF installation organized through owner-defined execution phases.',
    technicianInstructions: 'Check in with the customer before entering work areas. Protect finished surfaces and report blockers immediately.',
    status: 'Draft',
    priority: 'High',
    managerId: '',
    managerName: 'Not assigned',
    contractValue: 9000,
    laborRate: undefined,
    otherEstimatedCosts: undefined,
    startsOn: '2026-09-11',
    estimatedCompletionOn: '2026-10-16',
    totalUnits: 11,
    completedUnits: 0,
    unitType: 'Units',
    estimatedWorkDays: 11,
    slotsPerWorkDay: 6,
    slotDurationMinutes: 60,
    estimatedSlots: 66,
    estimatedLaborHours: 66,
    scheduledFutureHours: 0,
    actualLaborHours: 0,
    materialBudget: 9000,
    materialActual: 0,
    assignedVans: [],
    phases: [],
    materials: [],
    expenses: [],
    costEntries: [],
    assignments: [],
  };
}
function ensurePlannerDemo(state: BrowserProjectsPreviewState): BrowserProjectsPreviewState {
  if (state.projects.some((project) => project.id === DEMO_PROJECT_ID)) return state;
  const demo = plannerDemoProject();
  return { ...state, selectedProjectId: demo.id, projects: [demo, ...state.projects] };
}
function loadCompanyTemplates(): PhaseTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(COMPANY_TEMPLATE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item) => item?.source === 'Company' && Array.isArray(item.phases)) : [];
  } catch {
    return [];
  }
}
function persistCompanyTemplates(templates: PhaseTemplate[]) {
  try {
    window.localStorage.setItem(COMPANY_TEMPLATE_KEY, JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}

export function ProjectPhasePlannerPreview() {
  const { principal } = useAuth();
  const canView = principal.active && principal.capabilities.has('projects.view');
  const canManage = canView && principal.capabilities.has('projects.manage');
  const canManageRef = useRef(canManage);
  canManageRef.current = canManage;
  const [state, setState] = useState<BrowserProjectsPreviewState>(() => ensurePlannerDemo(createProjectsPreviewState()));
  const [projectId, setProjectId] = useState(DEMO_PROJECT_ID);
  const [ready, setReady] = useState(false);
  const [phaseDialog, setPhaseDialog] = useState<{ mode: 'create' | 'edit'; phaseId?: string } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [schedulePhaseId, setSchedulePhaseId] = useState('');
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [technicianAssignmentId, setTechnicianAssignmentId] = useState('');
  const [view, setView] = useState<'planner' | 'technician'>('planner');
  const [companyTemplates, setCompanyTemplates] = useState<PhaseTemplate[]>([]);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<PlannerNoticeTone>('success');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canView) {
      setReady(true);
      return undefined;
    }
    const reload = () => {
      const loaded = ensurePlannerDemo(loadBrowserProjectsPreviewState(createProjectsPreviewState()));
      setState(loaded);
      setProjectId((current) => loaded.projects.some((project) => project.id === current) ? current : loaded.selectedProjectId);
    };
    reload();
    setCompanyTemplates(loadCompanyTemplates());
    setReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === BROWSER_PROJECTS_PREVIEW_KEY) reload();
      if (event.key === COMPANY_TEMPLATE_KEY) setCompanyTemplates(loadCompanyTemplates());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [canView]);

  useEffect(() => {
    if (canManage) return;
    setPhaseDialog(null);
    setTemplatesOpen(false);
    setSaveTemplateOpen(false);
    setSchedulePhaseId('');
  }, [canManage]);

  const project = state.projects.find((candidate) => candidate.id === projectId) ?? state.projects[0];
  const phases = useMemo(() => projectPhases(project), [project]);
  const summary = useMemo(() => phaseCapacitySummary(project), [project]);
  const metrics = useMemo(() => projectMetrics(project), [project]);
  const selectedPhase = phases.find((phase) => phase.id === selectedPhaseId) ?? phases[0];
  const editPhase = phaseDialog?.mode === 'edit' ? phases.find((phase) => phase.id === phaseDialog.phaseId) : undefined;
  const schedulePhase = phases.find((phase) => phase.id === schedulePhaseId);
  const technicianAssignment = project.assignments.find((assignment) => assignment.id === technicianAssignmentId);
  const technicianPhase = technicianAssignment ? phases.find((phase) => phase.id === technicianAssignment.phaseId) : undefined;

  useEffect(() => {
    if (!phases.length) {
      setSelectedPhaseId('');
      return;
    }
    if (!phases.some((phase) => phase.id === selectedPhaseId)) setSelectedPhaseId(phases[0].id);
  }, [phases, selectedPhaseId]);

  const showNotice = (message: string, tone: PlannerNoticeTone = 'success') => {
    setNotice(message);
    setNoticeTone(tone);
  };

  const commitProject = async (reducer: (latestProject: BrowserProject) => BrowserProject) => {
    if (!canManageRef.current) throw new Error('Projects management permission is required.');
    setBusy(true);
    try {
      const next = await commitBrowserProjectsPreviewMutation(state, (latestState) => {
        const prepared = ensurePlannerDemo(latestState);
        const latestProject = prepared.projects.find((candidate) => candidate.id === project.id);
        if (!latestProject) throw new Error('The Project is no longer available.');
        return replaceProjectInState(prepared, reducer(latestProject));
      }, {
        authorize: () => {
          if (!canManageRef.current) throw new Error('Projects management permission changed before the update could be saved.');
        },
      });
      setState(next);
      return next.projects.find((candidate) => candidate.id === project.id)!;
    } finally {
      setBusy(false);
    }
  };

  const savePhase = async (input: PhaseDraftInput) => {
    const before = new Set(project.phases.map((phase) => phase.id));
    const updated = await commitProject((latest) => input.phaseId ? editProjectPhase(latest, input) : createProjectPhase(latest, input));
    const saved = input.phaseId ? updated.phases.find((phase) => phase.id === input.phaseId) : updated.phases.find((phase) => !before.has(phase.id));
    if (saved) setSelectedPhaseId(saved.id);
    setPhaseDialog(null);
    showNotice(input.phaseId ? `${input.name} was updated.` : `${input.name} was created with ${input.plannedHours}h of approved phase capacity.`);
  };

  const removePhase = async (phase: PlannedProjectPhase) => {
    if (!window.confirm(`Delete ${phase.name}? Only phases without assignments or actual activity may be removed.`)) return;
    try {
      await commitProject((latest) => deleteProjectPhase(latest, phase.id));
      showNotice(`${phase.name} was removed.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The phase could not be removed.', 'warning');
    }
  };

  const movePhase = async (phase: PlannedProjectPhase, direction: -1 | 1) => {
    const ordered = projectPhases(project);
    const index = ordered.findIndex((candidate) => candidate.id === phase.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const ids = ordered.map((candidate) => candidate.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await commitProject((latest) => reorderProjectPhases(latest, ids));
      showNotice('Phase order updated.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The phase order could not be saved.', 'warning');
    }
  };

  const applyTemplate = async (template: PhaseTemplate) => {
    const updated = await commitProject((latest) => applyPhaseTemplate(latest, template));
    setTemplatesOpen(false);
    setSelectedPhaseId(projectPhases(updated)[0]?.id ?? '');
    showNotice(`${template.name} was copied into this Project. Every phase is now independently editable.`);
  };

  const saveCompanyTemplate = async (name: string) => {
    if (!canManageRef.current) throw new Error('Projects management permission is required.');
    const template = companyTemplateFromProject(project, name);
    const next = [template, ...companyTemplates.filter((candidate) => candidate.name.toLocaleLowerCase('en') !== template.name.toLocaleLowerCase('en'))];
    if (!persistCompanyTemplates(next)) throw new Error('The company template could not be saved in preview storage.');
    setCompanyTemplates(next);
    setSaveTemplateOpen(false);
    showNotice(`${template.name} is available under My Company Templates.`);
  };

  const deleteCompanyTemplate = (templateId: string) => {
    const next = companyTemplates.filter((template) => template.id !== templateId);
    if (!persistCompanyTemplates(next)) {
      showNotice('The company template could not be removed from preview storage.', 'warning');
      return;
    }
    setCompanyTemplates(next);
    showNotice('Company template removed.');
  };

  const createAssignment = async (input: PreviewPhaseAssignmentInput) => {
    const before = new Set(project.assignments.map((assignment) => assignment.id));
    const updated = await commitProject((latest) => schedulePreviewPhaseAssignment(latest, input));
    const assignment = updated.assignments.find((candidate) => !before.has(candidate.id));
    setSchedulePhaseId('');
    if (assignment) setTechnicianAssignmentId(assignment.id);
    showNotice(`${phases.find((phase) => phase.id === input.phaseId)?.name ?? 'Phase'} reserved ${input.scheduledSlots} Project slot${input.scheduledSlots === 1 ? '' : 's'} in the browser preview.`);
  };

  const updateAssignment = async (assignmentId: string, status: ProjectAssignment['status']) => {
    try {
      await commitProject((latest) => updatePreviewAssignmentStatus(latest, assignmentId, status));
      showNotice(`Assignment ${assignmentId} is now ${status.toLocaleLowerCase('en')}.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The assignment status could not be saved.', 'warning');
    }
  };

  const completeAssignment = async (input: { actualHours: number; unitsCompleted: number; note: string; evidenceCount: number; checklistCompletedIds: string[] }) => {
    try {
      await commitProject((latest) => completePreviewPhaseAssignment(latest, {
        assignmentId: technicianAssignmentId,
        actualHours: input.actualHours,
        unitsCompleted: input.unitsCompleted,
        note: input.note,
        evidenceCount: input.evidenceCount,
        checklistCompletedIds: input.checklistCompletedIds,
        postedAt: new Date().toISOString(),
        technicianName: principal.displayName,
      }));
      showNotice('Actual time and phase progress were posted once. Repeating completion will not create a duplicate.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The assignment could not be completed.', 'warning');
      throw error;
    }
  };

  const completePhase = async (phase: PlannedProjectPhase) => {
    try {
      await commitProject((latest) => markProjectPhaseComplete(latest, phase.id));
      showNotice(`${phase.name} was marked complete after its blockers were revalidated.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The phase could not be completed.', 'warning');
    }
  };

  const copyBriefing = async (phase: PlannedProjectPhase) => {
    try {
      await navigator.clipboard.writeText(phaseBriefing(project, phase));
      showNotice('Structured Project and phase briefing copied.');
    } catch {
      showNotice('The browser could not copy the briefing.', 'warning');
    }
  };

  const resetDemo = async () => {
    if (project.id !== DEMO_PROJECT_ID) {
      showNotice('Reset is available only for the isolated PRJ-1013 validation Project.', 'warning');
      return;
    }
    if (!window.confirm('Reset PRJ-1013 phase-planner preview data?')) return;
    try {
      await commitProject(() => plannerDemoProject());
      setSelectedPhaseId('');
      setTechnicianAssignmentId('');
      setView('planner');
      showNotice('PRJ-1013 restored to an empty 66-hour phase plan.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The preview could not be reset.', 'warning');
    }
  };

  if (!canView) {
    return <section className={styles.workspace}><article className={styles.panel}><div className={styles.emptyState}><span className={styles.emptyIcon}>PR</span><h2>Projects access required</h2><p>Your role does not have permission to view Project planning or technician instructions.</p></div></article></section>;
  }
  if (!ready) return <div className={styles.loadingCard}>Loading Projects phase-planner preview…</div>;
  if (view === 'technician') {
    return <ProjectPhaseTechnicianPreview
      project={project}
      phase={technicianPhase}
      assignment={technicianAssignment}
      canManage={canManage}
      busy={busy}
      notice={notice}
      noticeTone={noticeTone}
      onDismissNotice={() => setNotice('')}
      onBack={() => setView('planner')}
      onStart={() => void updateAssignment(technicianAssignmentId, 'In Progress')}
      onPause={() => void updateAssignment(technicianAssignmentId, 'Paused')}
      onComplete={completeAssignment}
    />;
  }

  const allocationStyle = { '--allocation': `${Math.min(360, summary.allocationPercent * 3.6)}deg` } as CSSProperties;
  const blockers = selectedPhase ? phaseCompletionBlockers(project, selectedPhase.id) : [];
  const selectedAssignments = selectedPhase ? phaseAssignments(project, selectedPhase.id) : [];
  const completedPhases = phases.filter((phase) => phase.workflowStatus === 'Completed').length;

  return <section className={styles.workspace} aria-busy={busy}>
    <div className={styles.previewBanner} role="note"><div><span>PREVIEW DATA</span><strong>Projects · Custom Phase Planner</strong><p>Browser-only Fast Product Validation. No canonical Scheduling, Field, Inventory, payroll, invoice, or accounting write occurs from this page.</p></div><div><a href="/projects">Current Projects</a><a href="/scheduling">Scheduling</a><a href="/field">Field App</a></div></div>
    {!canManage ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status"><span>i</span><p>You have read-only access. Creating phases, reserving capacity, and posting simulated technician progress require Projects management permission.</p></div> : null}
    {notice ? <div className={`${styles.notice} ${noticeTone === 'warning' ? styles.noticeWarning : ''}`} role={noticeTone === 'warning' ? 'alert' : 'status'}><span>{noticeTone === 'warning' ? '!' : '✓'}</span><p>{notice}</p><button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></div> : null}

    <header className={styles.pageHeader}>
      <div><nav><a href="/projects">Projects</a><span>›</span><span>{project.projectNumber}</span><span>›</span><span>Phase Planner Preview</span></nav><div className={styles.projectTitle}><h1>{project.projectNumber} · {project.name}</h1><StatusPill label={project.status} tone={project.status === 'Draft' ? 'slate' : project.status === 'Completed' ? 'green' : 'blue'} /></div><p>{project.type} · {project.location}</p></div>
      <div className={styles.headerActions}><a className={styles.secondaryButton} href="/projects">← Portfolio</a><button type="button" className={styles.secondaryButton} onClick={() => void resetDemo()} disabled={!canManage || project.id !== DEMO_PROJECT_ID}>Reset Demo</button><a className={styles.secondaryButton} href="/scheduling">Open Scheduling</a><button type="button" className={styles.primaryButton} onClick={() => setPhaseDialog({ mode: 'create' })} disabled={!canManage}>＋ Create Phase</button></div>
    </header>

    <div className={styles.projectPickerBar}>
      <label><span>Validation Project</span><select value={project.id} onChange={(event) => { setProjectId(event.target.value); setSelectedPhaseId(''); setTechnicianAssignmentId(''); setNotice(''); }}>{state.projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.projectNumber} · {candidate.name}</option>)}</select></label>
      <div><span>Customer</span><strong>{project.customerName}</strong></div><div><span>Approved capacity</span><strong>{number(project.estimatedLaborHours)}h · {project.estimatedSlots} slots · {project.estimatedWorkDays} van-days</strong></div><div><span>Project dates</span><strong>{dateLabel(project.startsOn)} – {dateLabel(project.estimatedCompletionOn)}</strong></div>
    </div>

    <div className={styles.metrics}>
      <MetricCard code="ST" label="Status" value={project.status} note={metrics.health} tone={metrics.health === 'On Track' ? 'green' : metrics.health === 'At Risk' ? 'amber' : 'red'} />
      <MetricCard code="PC" label="Physical completion" value={percent(metrics.physicalCompletion)} note={`${project.completedUnits} / ${project.totalUnits} ${project.unitType.toLocaleLowerCase('en')}`} tone="purple" />
      <MetricCard code="LB" label="Labor budget" value={`${number(project.estimatedLaborHours)}h`} note={`${project.estimatedSlots} one-hour slots`} tone="green" />
      <MetricCard code="PA" label="Phase allocation" value={`${number(summary.allocated)}h`} note={`${number(summary.unallocated)}h still unallocated`} tone={summary.unallocated ? 'blue' : 'green'} />
      <MetricCard code="SC" label="Scheduled capacity" value={`${number(summary.scheduled, 1)}h`} note="Planned, not actual labor" tone="blue" />
      <MetricCard code="AC" label="Actual phase labor" value={`${number(summary.actual, 1)}h`} note={`${completedPhases} / ${phases.length} phases complete`} tone="amber" />
    </div>

    <div className={styles.tabs}><a href="/projects">Overview</a><button type="button" className={styles.activeTab}>Phases</button><a href="/projects">Materials</a><a href="/projects">Expenses</a><a href="/projects">Financials</a><span /><a href="/scheduling">Schedule ↗</a><a href="/field">Work history ↗</a></div>

    <div className={styles.mainLayout}>
      <main className={styles.mainColumn}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Owner-defined execution plan</span><h2>Phase Planning</h2><p>Create your own phases from scratch or copy an optional template. Capacity is validated against the approved Project hours.</p></div><div className={styles.panelActions}><button type="button" className={styles.primaryButton} onClick={() => setPhaseDialog({ mode: 'create' })} disabled={!canManage}>＋ Create Custom Phase</button><button type="button" className={styles.secondaryButton} onClick={() => setTemplatesOpen(true)} disabled={!canManage}>Suggested Templates</button><button type="button" className={styles.secondaryButton} onClick={() => setSaveTemplateOpen(true)} disabled={!canManage || !phases.length}>Save as Template</button></div></div>
          <div className={styles.capacityStrip}><div><span>Total Approved Capacity</span><strong>{number(summary.total)}h</strong><em>{project.estimatedSlots} slots</em></div><div><span>Allocated</span><strong>{number(summary.allocated)}h</strong><em>{percent(summary.allocationPercent)}</em></div><div><span>Unallocated</span><strong>{number(summary.unallocated)}h</strong></div><div><span>Scheduled</span><strong>{number(summary.scheduled, 1)}h</strong></div><div><span>Actual</span><strong>{number(summary.actual, 1)}h</strong></div></div>
          {!phases.length ? <div className={styles.emptyState}><span className={styles.emptyIcon}>PH</span><h2>No phases have been created</h2><p>Build this project around your own execution plan, or use a fully editable template only as a starting point.</p><div><button type="button" className={styles.primaryButton} onClick={() => setPhaseDialog({ mode: 'create' })} disabled={!canManage}>＋ Create Custom Phase</button><button type="button" className={styles.secondaryButton} onClick={() => setTemplatesOpen(true)} disabled={!canManage}>Browse Templates</button></div></div> : <>
            <div className={styles.phaseTableHeader}><span>Phase</span><span>Planned</span><span>Scheduled</span><span>Actual</span><span>Available</span><span>Progress</span><span>Target / Method</span><span>Actions</span></div>
            <div className={styles.phaseList}>{phases.map((phase, index) => {
              const progress = phaseProgressPercent(phase);
              const risk = phaseRisk(project, phase);
              const scheduled = phaseScheduledHours(project, phase.id);
              const remaining = phaseRemainingHours(project, phase);
              return <div key={phase.id} className={`${styles.phaseRow} ${selectedPhase?.id === phase.id ? styles.phaseRowSelected : ''}`}>
                <div className={styles.phaseIdentity}><div className={styles.reorderButtons}><button type="button" onClick={() => void movePhase(phase, -1)} disabled={!canManage || index === 0} aria-label={`Move ${phase.name} up`}>↑</button><button type="button" onClick={() => void movePhase(phase, 1)} disabled={!canManage || index === phases.length - 1} aria-label={`Move ${phase.name} down`}>↓</button></div><button type="button" className={styles.phaseSelect} onClick={() => setSelectedPhaseId(phase.id)}><i>{index + 1}</i><span><strong>{phase.name}</strong><small>{phase.scopeOfWork}</small><span className={styles.inlinePills}><StatusPill label={phase.workflowStatus} tone={statusTone(phase.workflowStatus)} /><StatusPill label={risk} tone={riskTone(risk)} /></span></span></button></div>
                <div data-label="Planned"><strong>{number(phase.estimatedLaborHours)}h</strong><small>{phase.sequence} order</small></div>
                <div data-label="Scheduled"><strong>{number(scheduled, 1)}h</strong><small>future capacity</small></div>
                <div data-label="Actual"><strong>{number(phase.actualLaborHours, 1)}h</strong><small>posted work</small></div>
                <div data-label="Available"><strong>{number(remaining, 1)}h</strong><small>uncommitted</small></div>
                <div data-label="Progress"><strong>{percent(progress)}</strong><Progress value={progress} tone={risk === 'On Track' ? 'green' : risk === 'At Risk' ? 'amber' : 'red'} /></div>
                <div data-label="Target / Method"><strong>{dateLabel(phase.endsOn)}</strong><small>{phase.progressMethod} · {phase.unitsPlanned ? `${phase.unitsCompleted}/${phase.unitsPlanned} units` : `${phase.checklist.filter((item) => item.done).length}/${phase.checklist.length} checks`}</small></div>
                <div className={styles.rowActions}><button type="button" onClick={() => setPhaseDialog({ mode: 'edit', phaseId: phase.id })} disabled={!canManage}>Edit</button><button type="button" onClick={() => setSchedulePhaseId(phase.id)} disabled={!canManage || remaining <= 0 || phase.workflowStatus === 'Completed' || phase.workflowStatus === 'Cancelled'}>Schedule</button><button type="button" className={styles.iconButton} onClick={() => void copyBriefing(phase)} title="Copy technician briefing">⎘</button></div>
              </div>;
            })}</div>
          </>}
        </article>

        {selectedPhase ? <article className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Selected phase</span><h2>{selectedPhase.sequence} · {selectedPhase.name}</h2><p>{selectedPhase.objective}</p></div><div className={styles.panelActions}><StatusPill label={selectedPhase.workflowStatus} tone={statusTone(selectedPhase.workflowStatus)} /><StatusPill label={phaseRisk(project, selectedPhase)} tone={riskTone(phaseRisk(project, selectedPhase))} /></div></div>
          <div className={styles.detailGrid}><section><span>OBJECTIVE / REASON</span><p>{selectedPhase.objective}</p></section><section><span>SCOPE OF WORK</span><p>{selectedPhase.scopeOfWork}</p></section><section><span>OUT OF SCOPE</span><p>{selectedPhase.outOfScope || 'No exclusions recorded.'}</p></section><section><span>TECHNICIAN INSTRUCTIONS</span><p>{selectedPhase.technicianInstructions || 'No phase-specific instructions. Project instructions still apply.'}</p></section><section><span>COMPLETION CRITERIA</span><p>{selectedPhase.completionCriteria}</p></section><section><span>MANAGEMENT</span><p>{selectedPhase.responsibleManager} · {selectedPhase.priority} priority</p></section></div>
          {selectedPhase.checklist.length ? <div className={styles.checklistPanel}><header><strong>Phase checklist</strong><span>{selectedPhase.checklist.filter((item) => item.done).length} / {selectedPhase.checklist.length} complete</span></header>{selectedPhase.checklist.map((item) => <div key={item.id}><i>{item.done ? '✓' : '○'}</i><span>{item.label}</span><small>{item.required ? 'Required' : 'Optional'}</small></div>)}</div> : null}
          <div className={styles.assignmentSection}><header><div><span>Scheduling and Field handoff</span><h3>Phase assignments</h3></div><b>{selectedAssignments.length}</b></header>{selectedAssignments.length ? selectedAssignments.map((assignment) => <button type="button" key={assignment.id} onClick={() => { setTechnicianAssignmentId(assignment.id); setView('technician'); }}><div><strong>{assignment.id} · {assignment.vanId.replace('VAN-', 'Van ')}</strong><small>{assignment.scheduledDate ? dateLabel(assignment.scheduledDate) : 'Date pending'} · {number(assignment.scheduledHours, 1)}h · {assignment.technicianIds.join(', ') || 'Van crew'}</small></div><div><StatusPill label={assignment.postedAt ? 'Posted' : assignment.status} tone={assignment.postedAt ? 'green' : assignment.status === 'Paused' ? 'amber' : 'blue'} /><span>Open technician view →</span></div></button>) : <div className={styles.assignmentEmpty}>No visits are assigned to this phase yet.</div>}</div>
          <div className={styles.detailFooter}><div>{blockers.length ? <span className={styles.blockerText}>Completion blockers: {blockers.join('; ')}.</span> : <span className={styles.readyText}>All current completion controls are clear.</span>}</div><div><button type="button" className={styles.dangerTextButton} onClick={() => void removePhase(selectedPhase)} disabled={!canManage}>Delete Phase</button><button type="button" className={styles.secondaryButton} onClick={() => setSchedulePhaseId(selectedPhase.id)} disabled={!canManage || phaseRemainingHours(project, selectedPhase) <= 0}>Schedule Work</button><button type="button" className={styles.primaryButton} onClick={() => void completePhase(selectedPhase)} disabled={!canManage || blockers.length > 0 || selectedPhase.workflowStatus === 'Completed'}>✓ Mark Phase Complete</button></div></div>
        </article> : null}
      </main>

      <aside className={styles.rightRail}>
        <article className={styles.panel}><div className={styles.railHeader}><span>Capacity control</span><h2>Phase Capacity Allocation</h2></div><div className={styles.capacityRing} style={allocationStyle}><strong>{number(summary.total)}h</strong><span>Total Project Capacity</span></div><dl className={styles.summaryList}><div><dt>Allocated to phases</dt><dd>{number(summary.allocated)}h</dd></div><div><dt>Still unallocated</dt><dd>{number(summary.unallocated)}h</dd></div><div><dt>Scheduled future work</dt><dd>{number(summary.scheduled, 1)}h</dd></div><div><dt>Posted actual work</dt><dd>{number(summary.actual, 1)}h</dd></div></dl>{summary.allocated > summary.total ? <div className={styles.alertBox}>Phase allocation exceeds the approved Project budget.</div> : summary.unallocated === 0 ? <div className={styles.successBox}>All approved Project capacity has been assigned to phases.</div> : <div className={styles.infoBox}>Draft planning may keep {number(summary.unallocated)}h available for later phases or contingency.</div>}</article>
        <article className={styles.panel}><div className={styles.railHeader}><span>Dependencies</span><h2>Execution sequence</h2></div>{selectedPhase?.dependencies.length ? <div className={styles.assignmentList}>{selectedPhase.dependencies.map((id) => { const dependency = phases.find((phase) => phase.id === id); return dependency ? <button type="button" key={id} onClick={() => setSelectedPhaseId(id)}><span><strong>{dependency.name}</strong><small>{dependency.workflowStatus}</small></span><StatusPill label={dependency.workflowStatus === 'Completed' ? 'Clear' : 'Blocking'} tone={dependency.workflowStatus === 'Completed' ? 'green' : 'amber'} /></button> : null; })}</div> : <p className={styles.railEmpty}>The selected phase has no prerequisite phase.</p>}</article>
        <article className={styles.panel}><div className={styles.railHeader}><span>Technician briefing</span><h2>Structured instructions</h2></div><div className={styles.railBody}><p>{selectedPhase ? phaseBriefing(project, selectedPhase) : 'Select a phase to preview the Project and phase instructions sent to technicians.'}</p><small>Existing visits retain their historical instruction snapshot; future visits use the latest approved phase details.</small></div>{selectedPhase ? <button type="button" className={styles.railLink} onClick={() => void copyBriefing(selectedPhase)}>Copy full briefing →</button> : null}</article>
        <article className={styles.panel}><div className={styles.railHeader}><span>Technician portal</span><h2>Scheduled phase work</h2></div>{project.assignments.length ? <div className={styles.assignmentList}>{project.assignments.slice().reverse().slice(0, 5).map((assignment) => <button type="button" key={assignment.id} onClick={() => { setTechnicianAssignmentId(assignment.id); setView('technician'); }}><span><strong>{phases.find((phase) => phase.id === assignment.phaseId)?.name ?? assignment.phaseId}</strong><small>{assignment.vanId.replace('VAN-', 'Van ')} · {number(assignment.scheduledHours, 1)}h</small></span><StatusPill label={assignment.postedAt ? 'Posted' : assignment.status} tone={assignment.postedAt ? 'green' : 'blue'} /></button>)}</div> : <p className={styles.railEmpty}>Schedule a phase to open the simulated personal technician workflow.</p>}<a className={styles.railLink} href="/field">Open canonical Field App →</a></article>
      </aside>
    </div>

    {phaseDialog && canManage ? <PhaseDialog project={project} phase={editPhase} busy={busy} onClose={() => setPhaseDialog(null)} onSave={savePhase} /> : null}
    {templatesOpen && canManage ? <TemplateDialog project={project} suggested={suggestedPhaseTemplates.filter((template) => template.projectTypes.includes(project.type))} company={companyTemplates} busy={busy} onClose={() => setTemplatesOpen(false)} onApply={applyTemplate} onDeleteCompany={deleteCompanyTemplate} /> : null}
    {saveTemplateOpen && canManage ? <SaveTemplateDialog project={project} busy={busy} onClose={() => setSaveTemplateOpen(false)} onSave={saveCompanyTemplate} /> : null}
    {schedulePhase && canManage ? <SchedulePhaseDialog project={project} phase={schedulePhase} busy={busy} onClose={() => setSchedulePhaseId('')} onSave={createAssignment} /> : null}
  </section>;
}
