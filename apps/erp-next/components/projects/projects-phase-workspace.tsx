'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  projectCapacityPlan,
  projectMetrics,
  projectTypeUsesMaterialBudget,
  type BrowserProject,
  type BrowserProjectsPreviewState,
  type ProjectAssignment,
} from '@/lib/browser-projects';
import {
  commitProjectsWithoutSamples,
  EMPTY_PROJECTS_STATE,
  loadProjectsWithoutSamples,
  saveProjectsWithoutSamples,
} from '@/lib/project-record-sanitizer';
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
import styles from './projects-phase-workspace.module.css';

const COMPANY_TEMPLATE_KEY = 'demac.erp-next.project-phase-templates.preview.v1';

type View = 'portfolio' | 'planner' | 'technician';
type NoticeTone = 'success' | 'warning';
type Tone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate';

function number(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

function money(value: number) {
  return `Afl. ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function percent(value: number) {
  return `${number(Math.max(0, value), 1)}%`;
}

function dateLabel(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
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

function projectStatusTone(status: BrowserProject['status']): Tone {
  if (status === 'Completed') return 'green';
  if (status === 'Active' || status === 'Planned' || status === 'Near Completion') return 'blue';
  if (status === 'On Hold') return 'amber';
  if (status === 'Cancelled') return 'red';
  return 'slate';
}

function Pill({ label, tone = 'slate' }: { label: string; tone?: Tone }) {
  return <span className={`${styles.pill} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>{label}</span>;
}

function Progress({ value, tone = 'blue' }: { value: number; tone?: Tone }) {
  return <div className={styles.progressTrack}><i className={styles[`fill${tone[0].toUpperCase()}${tone.slice(1)}`]} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function Metric({ code, label, value, note, tone }: { code: string; label: string; value: string; note: string; tone: Tone }) {
  return <article className={styles.metric}><span className={`${styles.metricIcon} ${styles[`icon${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>{code}</span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>;
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

function nextDate(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function CreateProjectDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (project: BrowserProject) => Promise<void> }) {
  const [workDays, setWorkDays] = useState('1');
  const [type, setType] = useState('Installation Project');
  const [error, setError] = useState('');
  const parsedWorkDays = Number(workDays);
  const capacity = Number.isInteger(parsedWorkDays) && parsedWorkDays > 0 ? projectCapacityPlan(parsedWorkDays) : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      if (!capacity) throw new Error('Estimated work days must be a positive whole number.');
      const projectNumber = String(form.get('projectNumber') ?? '').trim();
      const name = String(form.get('name') ?? '').trim();
      const customerName = String(form.get('customerName') ?? '').trim();
      const location = String(form.get('location') ?? '').trim();
      const startsOn = String(form.get('startsOn') ?? '').trim();
      const estimatedCompletionOn = String(form.get('estimatedCompletionOn') ?? '').trim();
      const totalUnits = Number(form.get('totalUnits'));
      if (!projectNumber || !name || !customerName || !location) throw new Error('Project number, project name, customer, and location are required.');
      if (!Number.isInteger(totalUnits) || totalUnits < 1) throw new Error('Total units must be a positive whole number.');
      if (!startsOn || !estimatedCompletionOn || estimatedCompletionOn < startsOn) throw new Error('Enter a valid project date range.');
      const materialValue = String(form.get('materialBudget') ?? '').trim();
      const parsedMaterial = materialValue ? Number(materialValue) : null;
      if (parsedMaterial !== null && (!Number.isFinite(parsedMaterial) || parsedMaterial < 0)) throw new Error('Material budget must be a valid non-negative amount.');
      const stamp = Date.now();
      const project: BrowserProject = {
        id: `PRJ-LOCAL-${stamp}`,
        projectNumber,
        name,
        customerId: '',
        customerName,
        siteId: '',
        location,
        contactPerson: String(form.get('contactPerson') ?? '').trim() || customerName,
        type,
        description: String(form.get('description') ?? '').trim() || `${name} · ${type}.`,
        technicianInstructions: String(form.get('technicianInstructions') ?? '').trim() || undefined,
        status: 'Draft',
        priority: 'Normal',
        managerId: '',
        managerName: String(form.get('managerName') ?? '').trim() || 'Not assigned',
        startsOn,
        estimatedCompletionOn,
        totalUnits,
        completedUnits: 0,
        unitType: 'Units',
        ...capacity,
        scheduledFutureHours: 0,
        actualLaborHours: 0,
        materialBudget: projectTypeUsesMaterialBudget(type) ? parsedMaterial : null,
        materialActual: 0,
        assignedVans: [],
        phases: [],
        materials: [],
        expenses: [],
        costEntries: [],
        assignments: [],
      };
      await onSave(project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project could not be created.');
    }
  };

  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Create project record">
      <header><div><span>Projects · Feature Preview</span><h2>Create Project Record</h2><p>Enter an actual project record for this preview. This form does not create or edit CRM customers, properties, appointments, Work Orders, or inventory records.</p></div><button type="button" onClick={onClose} disabled={busy}>×</button></header>
      <form onSubmit={submit}>
        <div className={styles.formGrid}>
          <label><span>Project number *</span><input name="projectNumber" required placeholder="PRJ-1013" /></label>
          <label><span>Project type *</span><select name="type" value={type} onChange={(event) => setType(event.target.value)}><option>Installation Project</option><option>Service Project</option><option>VRF Project</option><option>Maintenance Contract</option></select></label>
          <label className={styles.formWide}><span>Project name *</span><input name="name" required placeholder="Enter the actual project name" /></label>
          <label><span>Customer *</span><input name="customerName" required placeholder="Customer or company" /></label>
          <label><span>Contact person</span><input name="contactPerson" placeholder="Primary site contact" /></label>
          <label className={styles.formWide}><span>Location *</span><input name="location" required placeholder="Property or project location" /></label>
          <label><span>Start date *</span><input name="startsOn" type="date" required defaultValue={nextDate(0)} /></label>
          <label><span>Estimated completion *</span><input name="estimatedCompletionOn" type="date" required defaultValue={nextDate(30)} /></label>
          <label><span>Total units *</span><input name="totalUnits" type="number" min="1" step="1" required defaultValue="1" /></label>
          <label><span>Estimated work days *</span><input name="estimatedWorkDays" type="number" min="1" step="1" required value={workDays} onChange={(event) => setWorkDays(event.target.value)} /></label>
          <label><span>Capacity preview</span><input readOnly value={capacity ? `${capacity.estimatedLaborHours}h · ${capacity.estimatedSlots} slots` : ''} /></label>
          <label><span>Project manager</span><input name="managerName" placeholder="Not assigned" /></label>
          {projectTypeUsesMaterialBudget(type) ? <label className={styles.formWide}><span>Material budget (Afl.) · optional</span><input name="materialBudget" type="number" min="0" step="0.01" /></label> : null}
          <label className={styles.formWide}><span>Project description</span><textarea name="description" rows={3} placeholder="Project objective and general scope" /></label>
          <label className={styles.formWide}><span>Project instructions for all technicians</span><textarea name="technicianInstructions" rows={4} placeholder="Access, safety, site, customer, and reporting instructions" /></label>
        </div>
        {error ? <div className={styles.formError} role="alert">{error}</div> : null}
        <footer><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={busy || !capacity}>{busy ? 'Saving…' : 'Create Project'}</button></footer>
      </form>
    </section>
  </div>;
}

export function ProjectsPhaseWorkspace() {
  const { principal } = useAuth();
  const canView = principal.active && principal.capabilities.has('projects.view');
  const canManage = canView && principal.capabilities.has('projects.manage');
  const canManageRef = useRef(canManage);
  canManageRef.current = canManage;

  const [state, setState] = useState<BrowserProjectsPreviewState>(EMPTY_PROJECTS_STATE);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('portfolio');
  const [projectId, setProjectId] = useState('');
  const [query, setQuery] = useState('');
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [phaseDialog, setPhaseDialog] = useState<{ mode: 'create' | 'edit'; phaseId?: string } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [schedulePhaseId, setSchedulePhaseId] = useState('');
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [technicianAssignmentId, setTechnicianAssignmentId] = useState('');
  const [companyTemplates, setCompanyTemplates] = useState<PhaseTemplate[]>([]);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('success');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canView) {
      setReady(true);
      return undefined;
    }
    const reload = () => {
      const loaded = loadProjectsWithoutSamples();
      setState(loaded.state);
      setProjectId((current) => loaded.state.projects.some((project) => project.id === current)
        ? current
        : loaded.state.selectedProjectId || loaded.state.projects[0]?.id || '');
      if (!loaded.state.projects.length) setView('portfolio');
      if (loaded.removedIds.length) {
        setNotice(`${loaded.removedIds.length} seeded sample project${loaded.removedIds.length === 1 ? '' : 's'} removed. User-created project records were preserved.`);
        setNoticeTone('success');
      }
    };
    reload();
    setCompanyTemplates(loadCompanyTemplates());
    setReady(true);
    const onStorage = () => reload();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [canView]);

  useEffect(() => {
    if (canManage) return;
    setCreateProjectOpen(false);
    setPhaseDialog(null);
    setTemplatesOpen(false);
    setSaveTemplateOpen(false);
    setSchedulePhaseId('');
  }, [canManage]);

  const project = state.projects.find((candidate) => candidate.id === projectId);
  const phases = useMemo(() => project ? projectPhases(project) : [], [project]);
  const summary = useMemo(() => project ? phaseCapacitySummary(project) : null, [project]);
  const metrics = useMemo(() => project ? projectMetrics(project) : null, [project]);
  const selectedPhase = phases.find((phase) => phase.id === selectedPhaseId) ?? phases[0];
  const editPhase = phaseDialog?.mode === 'edit' ? phases.find((phase) => phase.id === phaseDialog.phaseId) : undefined;
  const schedulePhase = phases.find((phase) => phase.id === schedulePhaseId);
  const technicianAssignment = project?.assignments.find((assignment) => assignment.id === technicianAssignmentId);
  const technicianPhase = technicianAssignment ? phases.find((phase) => phase.id === technicianAssignment.phaseId) : undefined;

  useEffect(() => {
    if (!phases.length) {
      setSelectedPhaseId('');
      return;
    }
    if (!phases.some((phase) => phase.id === selectedPhaseId)) setSelectedPhaseId(phases[0].id);
  }, [phases, selectedPhaseId]);

  const showNotice = (message: string, tone: NoticeTone = 'success') => {
    setNotice(message);
    setNoticeTone(tone);
  };

  const openProject = (candidate: BrowserProject) => {
    const next = { ...state, selectedProjectId: candidate.id };
    setState(next);
    saveProjectsWithoutSamples(next);
    setProjectId(candidate.id);
    setSelectedPhaseId('');
    setTechnicianAssignmentId('');
    setView('planner');
    setNotice('');
  };

  const createProject = async (created: BrowserProject) => {
    if (!canManageRef.current) throw new Error('Projects management permission is required.');
    setBusy(true);
    try {
      const next = await commitProjectsWithoutSamples(state, (latest) => {
        if (latest.projects.some((candidate) => candidate.projectNumber.trim().toLocaleLowerCase('en') === created.projectNumber.trim().toLocaleLowerCase('en'))) {
          throw new Error(`Project number ${created.projectNumber} already exists in this browser.`);
        }
        return { ...latest, selectedProjectId: created.id, projects: [created, ...latest.projects] };
      }, {
        authorize: () => {
          if (!canManageRef.current) throw new Error('Projects management permission changed before save.');
        },
      });
      setState(next);
      setProjectId(created.id);
      setCreateProjectOpen(false);
      setView('planner');
      showNotice(`${created.projectNumber} was created in this feature-preview browser only. CRM and Scheduling were not changed.`);
    } finally {
      setBusy(false);
    }
  };

  const commitProject = async (reducer: (latest: BrowserProject) => BrowserProject) => {
    if (!project) throw new Error('Select a project first.');
    if (!canManageRef.current) throw new Error('Projects management permission is required.');
    setBusy(true);
    try {
      const next = await commitProjectsWithoutSamples(state, (latest) => {
        const latestProject = latest.projects.find((candidate) => candidate.id === project.id);
        if (!latestProject) throw new Error('The project is no longer available.');
        return replaceProjectInState(latest, reducer(latestProject));
      }, {
        authorize: () => {
          if (!canManageRef.current) throw new Error('Projects management permission changed before save.');
        },
      });
      setState(next);
      return next.projects.find((candidate) => candidate.id === project.id)!;
    } finally {
      setBusy(false);
    }
  };

  const savePhase = async (input: PhaseDraftInput) => {
    if (!project) return;
    const before = new Set(project.phases.map((phase) => phase.id));
    const updated = await commitProject((latest) => input.phaseId ? editProjectPhase(latest, input) : createProjectPhase(latest, input));
    const saved = input.phaseId
      ? updated.phases.find((phase) => phase.id === input.phaseId)
      : updated.phases.find((phase) => !before.has(phase.id));
    if (saved) setSelectedPhaseId(saved.id);
    setPhaseDialog(null);
    showNotice(input.phaseId ? `${input.name} was updated.` : `${input.name} was created with ${input.plannedHours}h of phase capacity.`);
  };

  const removePhase = async (phase: PlannedProjectPhase) => {
    if (!window.confirm(`Delete ${phase.name}? Only phases without scheduled or actual activity may be removed.`)) return;
    try {
      await commitProject((latest) => deleteProjectPhase(latest, phase.id));
      showNotice(`${phase.name} was removed.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'The phase could not be removed.', 'warning');
    }
  };

  const movePhase = async (phase: PlannedProjectPhase, direction: -1 | 1) => {
    if (!project) return;
    const ordered = projectPhases(project);
    const index = ordered.findIndex((candidate) => candidate.id === phase.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const ids = ordered.map((candidate) => candidate.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await commitProject((latest) => reorderProjectPhases(latest, ids));
      showNotice('Phase order updated.');
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'The phase order could not be saved.', 'warning');
    }
  };

  const applyTemplate = async (template: PhaseTemplate) => {
    const updated = await commitProject((latest) => applyPhaseTemplate(latest, template));
    setTemplatesOpen(false);
    setSelectedPhaseId(projectPhases(updated)[0]?.id ?? '');
    showNotice(`${template.name} was copied into this project. Every phase remains editable.`);
  };

  const saveCompanyTemplate = async (name: string) => {
    if (!project) return;
    const template = companyTemplateFromProject(project, name);
    const next = [template, ...companyTemplates.filter((candidate) => candidate.name.toLocaleLowerCase('en') !== template.name.toLocaleLowerCase('en'))];
    if (!persistCompanyTemplates(next)) throw new Error('The company template could not be saved in this browser.');
    setCompanyTemplates(next);
    setSaveTemplateOpen(false);
    showNotice(`${template.name} is now available under My Company Templates.`);
  };

  const deleteCompanyTemplate = (templateId: string) => {
    const next = companyTemplates.filter((template) => template.id !== templateId);
    if (!persistCompanyTemplates(next)) {
      showNotice('The company template could not be removed.', 'warning');
      return;
    }
    setCompanyTemplates(next);
    showNotice('Company template removed.');
  };

  const createAssignment = async (input: PreviewPhaseAssignmentInput) => {
    if (!project) return;
    const before = new Set(project.assignments.map((assignment) => assignment.id));
    const updated = await commitProject((latest) => schedulePreviewPhaseAssignment(latest, input));
    const assignment = updated.assignments.find((candidate) => !before.has(candidate.id));
    setSchedulePhaseId('');
    if (assignment) setTechnicianAssignmentId(assignment.id);
    showNotice('Phase capacity was reserved in this feature preview only. The live Scheduling agenda was not changed.');
  };

  const updateAssignment = async (assignmentId: string, status: ProjectAssignment['status']) => {
    try {
      await commitProject((latest) => updatePreviewAssignmentStatus(latest, assignmentId, status));
      showNotice(`Assignment ${assignmentId} is now ${status.toLocaleLowerCase('en')}.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'The assignment status could not be saved.', 'warning');
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
      showNotice('Actual time and phase progress were posted once inside this feature preview.');
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'The assignment could not be completed.', 'warning');
      throw cause;
    }
  };

  const completePhase = async (phase: PlannedProjectPhase) => {
    try {
      await commitProject((latest) => markProjectPhaseComplete(latest, phase.id));
      showNotice(`${phase.name} was marked complete after its blockers were revalidated.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : 'The phase could not be completed.', 'warning');
    }
  };

  const copyBriefing = async (phase: PlannedProjectPhase) => {
    if (!project) return;
    try {
      await navigator.clipboard.writeText(phaseBriefing(project, phase));
      showNotice('Structured project and phase briefing copied.');
    } catch {
      showNotice('The browser could not copy the briefing.', 'warning');
    }
  };

  if (!canView) return <section className={styles.workspace}><article className={styles.panel}><div className={styles.emptyState}><span>PR</span><h2>Projects access required</h2><p>Your role does not have permission to view Projects.</p></div></article></section>;
  if (!ready) return <div className={styles.loading}>Loading Projects…</div>;

  if (view === 'technician' && project) {
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

  const filtered = state.projects.filter((candidate) => {
    const needle = query.trim().toLocaleLowerCase('en');
    return !needle || [candidate.projectNumber, candidate.name, candidate.customerName, candidate.location, candidate.type]
      .some((value) => value.toLocaleLowerCase('en').includes(needle));
  });

  const portfolioHours = state.projects.reduce((sum, candidate) => sum + candidate.actualLaborHours, 0);
  const portfolioSpend = state.projects.reduce((sum, candidate) => sum + candidate.materialActual, 0);
  const atRisk = state.projects.filter((candidate) => projectMetrics(candidate).health !== 'On Track').length;

  if (view === 'portfolio' || !project || !summary || !metrics) {
    return <section className={styles.workspace} aria-busy={busy}>
      <div className={styles.featureBanner}><div><span>FEATURE PREVIEW</span><strong>Projects · No seeded sample records</strong><p>Only project records stored for this browser origin are shown. CRM, Scheduling, Work Orders, Field, Inventory, payroll, invoicing, and accounting are not modified here.</p></div></div>
      {notice ? <div className={`${styles.notice} ${noticeTone === 'warning' ? styles.noticeWarning : ''}`}><span>{noticeTone === 'warning' ? '!' : '✓'}</span><p>{notice}</p><button type="button" onClick={() => setNotice('')}>×</button></div> : null}
      <header className={styles.pageHeader}><div><span>Commercial & Project Operations</span><h1>Projects</h1><p>Open an actual project record to create, edit, allocate, schedule, and monitor its phases.</p></div><div className={styles.headerActions}><button type="button" className={styles.primaryButton} onClick={() => setCreateProjectOpen(true)} disabled={!canManage}>＋ Create Project</button></div></header>
      <div className={styles.metrics}>
        <Metric code="PR" label="Project records" value={String(state.projects.length)} note="No seeded samples" tone="blue" />
        <Metric code="AR" label="At risk" value={String(atRisk)} note="Based on recorded project actuals" tone={atRisk ? 'amber' : 'green'} />
        <Metric code="HR" label="Actual project hours" value={`${number(portfolioHours, 1)}h`} note="Across visible project records" tone="purple" />
        <Metric code="AF" label="Material actuals" value={money(portfolioSpend)} note="Recorded project consumption" tone="green" />
      </div>
      <article className={styles.panel}>
        <div className={styles.portfolioToolbar}><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project number, customer, location…" /></label><strong>{filtered.length} project{filtered.length === 1 ? '' : 's'}</strong></div>
        {!state.projects.length ? <div className={styles.emptyState}><span>PR</span><h2>No project records exist on this preview domain</h2><p>The project you created under demac-aruba.com is stored in that domain’s browser storage and cannot be read by a separate Vercel preview domain. Nothing was copied, deleted, or changed in CRM or Scheduling.</p><button type="button" className={styles.primaryButton} onClick={() => setCreateProjectOpen(true)} disabled={!canManage}>Create an Actual Project Record Here</button></div> : <div className={styles.projectTable}>
          <div className={styles.projectTableHeader}><span>Project</span><span>Customer / Location</span><span>Physical</span><span>Labor</span><span>Materials</span><span>Status</span><span>Action</span></div>
          {filtered.map((candidate) => {
            const candidateMetrics = projectMetrics(candidate);
            return <div className={styles.projectRow} key={candidate.id}>
              <div><strong>{candidate.name}</strong><small>{candidate.projectNumber} · {candidate.type}</small></div>
              <div><strong>{candidate.customerName}</strong><small>{candidate.location}</small></div>
              <div><strong>{percent(candidateMetrics.physicalCompletion)}</strong><Progress value={candidateMetrics.physicalCompletion} /></div>
              <div><strong>{number(candidate.actualLaborHours, 1)}h / {number(candidate.estimatedLaborHours)}h</strong><Progress value={candidateMetrics.laborConsumption} tone={candidateMetrics.laborConsumption > 100 ? 'red' : 'blue'} /></div>
              <div><strong>{money(candidate.materialActual)}</strong><small>{candidate.materialBudget === null ? 'No baseline' : `of ${money(candidate.materialBudget)}`}</small></div>
              <div><Pill label={candidate.status} tone={projectStatusTone(candidate.status)} /></div>
              <div><button type="button" className={styles.primaryButton} onClick={() => openProject(candidate)}>Open Phases</button></div>
            </div>;
          })}
        </div>}
      </article>
      {createProjectOpen ? <CreateProjectDialog busy={busy} onClose={() => setCreateProjectOpen(false)} onSave={createProject} /> : null}
    </section>;
  }

  const allocationStyle = { '--allocation': `${Math.min(360, summary.allocationPercent * 3.6)}deg` } as CSSProperties;
  const selectedAssignments = selectedPhase ? phaseAssignments(project, selectedPhase.id) : [];
  const blockers = selectedPhase ? phaseCompletionBlockers(project, selectedPhase.id) : [];
  const completedPhases = phases.filter((phase) => phase.workflowStatus === 'Completed').length;

  return <section className={styles.workspace} aria-busy={busy}>
    <div className={styles.featureBanner}><div><span>FEATURE PREVIEW</span><strong>Projects · Integrated Phase Planning</strong><p>This branch adds phase controls to the actual Project record selected below. No seeded project is injected and no live CRM, Scheduling, Work Order, Field, Inventory, payroll, invoice, or accounting write occurs.</p></div></div>
    {!canManage ? <div className={`${styles.notice} ${styles.noticeWarning}`}><span>i</span><p>Your account has read-only Projects access.</p></div> : null}
    {notice ? <div className={`${styles.notice} ${noticeTone === 'warning' ? styles.noticeWarning : ''}`}><span>{noticeTone === 'warning' ? '!' : '✓'}</span><p>{notice}</p><button type="button" onClick={() => setNotice('')}>×</button></div> : null}

    <header className={styles.pageHeader}><div><nav><button type="button" onClick={() => setView('portfolio')}>Projects</button><span>›</span><span>{project.projectNumber}</span></nav><div className={styles.titleLine}><h1>{project.name}</h1><Pill label={project.status} tone={projectStatusTone(project.status)} /></div><p>{project.projectNumber} · {project.type} · {project.location}</p></div><div className={styles.headerActions}><button type="button" className={styles.secondaryButton} onClick={() => setView('portfolio')}>← Portfolio</button><button type="button" className={styles.primaryButton} onClick={() => setPhaseDialog({ mode: 'create' })} disabled={!canManage}>＋ Create Custom Phase</button></div></header>

    <div className={styles.projectContext}><label><span>Current project</span><select value={project.id} onChange={(event) => { const next = state.projects.find((candidate) => candidate.id === event.target.value); if (next) openProject(next); }}>{state.projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.projectNumber} · {candidate.name}</option>)}</select></label><div><span>Customer</span><strong>{project.customerName}</strong></div><div><span>Project manager</span><strong>{project.managerName}</strong></div><div><span>Project dates</span><strong>{dateLabel(project.startsOn)} – {dateLabel(project.estimatedCompletionOn)}</strong></div></div>

    <div className={styles.metrics}>
      <Metric code="ST" label="Status" value={project.status} note={metrics.health} tone={metrics.health === 'On Track' ? 'green' : metrics.health === 'At Risk' ? 'amber' : 'red'} />
      <Metric code="PC" label="Physical completion" value={percent(metrics.physicalCompletion)} note={`${project.completedUnits} / ${project.totalUnits} ${project.unitType.toLocaleLowerCase('en')}`} tone="purple" />
      <Metric code="LB" label="Labor budget" value={`${number(project.estimatedLaborHours)}h`} note={`${project.estimatedSlots} slots · ${project.estimatedWorkDays} van-days`} tone="green" />
      <Metric code="PA" label="Phase allocation" value={`${number(summary.allocated)}h`} note={`${number(summary.unallocated)}h unallocated`} tone={summary.unallocated ? 'blue' : 'green'} />
      <Metric code="SC" label="Scheduled" value={`${number(summary.scheduled, 1)}h`} note="Phase preview reservations" tone="blue" />
      <Metric code="AC" label="Actual phase labor" value={`${number(summary.actual, 1)}h`} note={`${completedPhases} / ${phases.length} phases complete`} tone="amber" />
    </div>

    <div className={styles.tabs}><button type="button" disabled>Overview</button><button type="button" className={styles.activeTab}>Phases</button><button type="button" disabled>Materials</button><button type="button" disabled>Expenses</button><button type="button" disabled>Financials</button><span /><small>Only the Phases experience is changed in this isolated preview.</small></div>

    <div className={styles.mainLayout}>
      <main className={styles.mainColumn}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Owner-defined execution plan</span><h2>Project Phases</h2><p>Create each phase manually or copy an optional editable template. The combined phase allocation cannot exceed the project’s approved labor capacity.</p></div><div className={styles.panelActions}><button type="button" className={styles.primaryButton} onClick={() => setPhaseDialog({ mode: 'create' })} disabled={!canManage}>＋ Create Custom Phase</button><button type="button" className={styles.secondaryButton} onClick={() => setTemplatesOpen(true)} disabled={!canManage}>Templates</button><button type="button" className={styles.secondaryButton} onClick={() => setSaveTemplateOpen(true)} disabled={!canManage || !phases.length}>Save as Template</button></div></div>
          <div className={styles.capacityStrip}><div><span>Total approved</span><strong>{number(summary.total)}h</strong><small>{project.estimatedSlots} slots</small></div><div><span>Allocated</span><strong>{number(summary.allocated)}h</strong><small>{percent(summary.allocationPercent)}</small></div><div><span>Unallocated</span><strong>{number(summary.unallocated)}h</strong></div><div><span>Scheduled</span><strong>{number(summary.scheduled, 1)}h</strong></div><div><span>Actual</span><strong>{number(summary.actual, 1)}h</strong></div></div>
          {!phases.length ? <div className={styles.emptyState}><span>PH</span><h2>No phases yet</h2><p>Create the phases according to your own project plan. Suggested and company templates are optional and fully editable.</p><div><button type="button" className={styles.primaryButton} onClick={() => setPhaseDialog({ mode: 'create' })} disabled={!canManage}>＋ Create First Phase</button><button type="button" className={styles.secondaryButton} onClick={() => setTemplatesOpen(true)} disabled={!canManage}>Browse Optional Templates</button></div></div> : <div className={styles.phaseList}>
            {phases.map((phase, index) => {
              const progress = phaseProgressPercent(phase);
              const risk = phaseRisk(project, phase);
              const scheduled = phaseScheduledHours(project, phase.id);
              const remaining = phaseRemainingHours(project, phase);
              return <article key={phase.id} className={`${styles.phaseCard} ${selectedPhase?.id === phase.id ? styles.phaseCardSelected : ''}`}>
                <div className={styles.phaseOrder}><button type="button" onClick={() => void movePhase(phase, -1)} disabled={!canManage || index === 0}>↑</button><i>{index + 1}</i><button type="button" onClick={() => void movePhase(phase, 1)} disabled={!canManage || index === phases.length - 1}>↓</button></div>
                <button type="button" className={styles.phaseMain} onClick={() => setSelectedPhaseId(phase.id)}><div><strong>{phase.name}</strong><small>{phase.scopeOfWork}</small><span><Pill label={phase.workflowStatus} tone={statusTone(phase.workflowStatus)} /><Pill label={risk} tone={riskTone(risk)} /></span></div></button>
                <div className={styles.phaseNumbers}><div><span>Planned</span><strong>{number(phase.estimatedLaborHours)}h</strong></div><div><span>Scheduled</span><strong>{number(scheduled, 1)}h</strong></div><div><span>Actual</span><strong>{number(phase.actualLaborHours, 1)}h</strong></div><div><span>Available</span><strong>{number(remaining, 1)}h</strong></div></div>
                <div className={styles.phaseProgress}><span>{percent(progress)} · {phase.progressMethod}</span><Progress value={progress} tone={risk === 'On Track' ? 'green' : risk === 'At Risk' ? 'amber' : 'red'} /><small>{dateLabel(phase.startsOn)} – {dateLabel(phase.endsOn)}</small></div>
                <div className={styles.phaseActions}><button type="button" onClick={() => setPhaseDialog({ mode: 'edit', phaseId: phase.id })} disabled={!canManage}>Edit</button><button type="button" onClick={() => setSchedulePhaseId(phase.id)} disabled={!canManage || phase.workflowStatus === 'Completed' || phase.workflowStatus === 'Cancelled'}>Plan Visit</button><button type="button" onClick={() => void completePhase(phase)} disabled={!canManage || phase.workflowStatus === 'Completed'}>Complete</button><button type="button" onClick={() => void removePhase(phase)} disabled={!canManage}>Delete</button></div>
              </article>;
            })}
          </div>}
        </article>

        {selectedPhase ? <article className={styles.panel}><div className={styles.panelHeader}><div><span>Phase activity</span><h2>{selectedPhase.name}</h2><p>Planned visits and technician progress associated with this phase.</p></div><button type="button" className={styles.secondaryButton} onClick={() => void copyBriefing(selectedPhase)}>Copy Technician Briefing</button></div>{selectedAssignments.length ? <div className={styles.assignmentList}>{selectedAssignments.map((assignment) => <div key={assignment.id}><div><strong>{assignment.scheduledDate ? dateLabel(assignment.scheduledDate) : 'Date pending'} · {assignment.vanId.replace('VAN-', 'Van ')}</strong><small>{assignment.scheduledHours}h · {assignment.technicianIds.join(' · ') || 'Crew not entered'}</small></div><Pill label={assignment.postedAt ? 'Posted' : assignment.status} tone={assignment.postedAt ? 'green' : assignment.status === 'Paused' ? 'amber' : 'blue'} /><button type="button" className={styles.primaryButton} onClick={() => { setTechnicianAssignmentId(assignment.id); setView('technician'); }}>Open Technician View</button></div>)}</div> : <div className={styles.emptyInline}><p>No visits have been planned for this phase.</p><button type="button" className={styles.secondaryButton} onClick={() => setSchedulePhaseId(selectedPhase.id)} disabled={!canManage}>Plan First Visit</button></div>}</article> : null}
      </main>

      <aside className={styles.rightRail}>
        <article className={styles.panel}><div className={styles.railHeader}><span>Phase capacity allocation</span><h2>{number(summary.allocated)}h of {number(summary.total)}h</h2></div><div className={styles.capacityRing} style={allocationStyle}><div><strong>{percent(summary.allocationPercent)}</strong><span>allocated</span></div></div><dl className={styles.summaryList}><div><dt>Unallocated</dt><dd>{number(summary.unallocated)}h</dd></div><div><dt>Scheduled</dt><dd>{number(summary.scheduled, 1)}h</dd></div><div><dt>Actual</dt><dd>{number(summary.actual, 1)}h</dd></div></dl></article>
        {selectedPhase ? <article className={styles.panel}><div className={styles.railHeader}><span>Selected phase</span><h2>{selectedPhase.name}</h2></div><dl className={styles.detailList}><div><dt>Objective</dt><dd>{selectedPhase.objective}</dd></div><div><dt>Scope of work</dt><dd>{selectedPhase.scopeOfWork}</dd></div><div><dt>Out of scope</dt><dd>{selectedPhase.outOfScope || 'Not specified'}</dd></div><div><dt>Technician instructions</dt><dd>{selectedPhase.technicianInstructions || 'Not specified'}</dd></div><div><dt>Completion criteria</dt><dd>{selectedPhase.completionCriteria}</dd></div><div><dt>Manager</dt><dd>{selectedPhase.responsibleManager}</dd></div></dl>{blockers.length ? <div className={styles.blockerBox}><strong>Completion blockers</strong>{blockers.map((blocker) => <span key={blocker}>• {blocker}</span>)}</div> : <div className={styles.readyBox}>No completion blockers detected.</div>}</article> : null}
      </aside>
    </div>

    {phaseDialog ? <PhaseDialog project={project} phase={editPhase} busy={busy} onClose={() => setPhaseDialog(null)} onSave={savePhase} /> : null}
    {templatesOpen ? <TemplateDialog project={project} suggested={suggestedPhaseTemplates} company={companyTemplates} busy={busy} onClose={() => setTemplatesOpen(false)} onApply={applyTemplate} onDeleteCompany={deleteCompanyTemplate} /> : null}
    {saveTemplateOpen ? <SaveTemplateDialog project={project} busy={busy} onClose={() => setSaveTemplateOpen(false)} onSave={saveCompanyTemplate} /> : null}
    {schedulePhase ? <SchedulePhaseDialog project={project} phase={schedulePhase} busy={busy} onClose={() => setSchedulePhaseId('')} onSave={createAssignment} /> : null}
  </section>;
}
