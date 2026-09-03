'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  loadBookingMasterReferenceData,
  normalizeBookingPhone,
  type BookingCustomer,
  type BookingMasterReferenceData,
} from '@/lib/live-scheduling-booking-data';
import { createOfficeCustomer, createOfficeLifecycleRequestId } from '@/lib/office-booking-authority';
import { primeLiveSchedulingReferenceCache } from '@/lib/live-scheduling-fast';
import {
  BROWSER_PROJECTS_PREVIEW_KEY,
  GENERAL_PROJECT_WORK_PHASE_ID,
  commitBrowserProjectsPreviewMutation,
  createProjectsPreviewState,
  editBrowserProject,
  linkProjectExpense,
  loadBrowserProjectsPreviewState,
  normalizeOptionalMaterialBudget,
  postProjectAssignment,
  projectAssignmentsForHandoff,
  projectAssignmentUsesCanonicalLifecycle,
  projectCapacityPlan,
  projectCompletionBlockers,
  projectHasOperationalActivity,
  projectMetrics,
  projectTypeUsesMaterialBudget,
  reduceProjectInState,
  type BrowserProject,
  type BrowserProjectsPreviewState,
  type ProjectAssignment,
  type ProjectHealth,
  type ProjectStatus,
} from '@/lib/browser-projects';
import styles from './projects-workspace.module.css';

type WorkspaceView = 'portfolio' | 'detail' | 'technician';
type DetailTab = 'Overview' | 'Phases' | 'Materials' | 'Expenses' | 'Financials';
type Tone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate';

const detailTabs: DetailTab[] = ['Overview', 'Phases', 'Materials', 'Expenses', 'Financials'];
const statusOptions: Array<'All' | ProjectStatus> = ['All', 'Active', 'Near Completion', 'Planned', 'Completed', 'Draft', 'On Hold'];
const projectTypeOptions = ['Installation Project', 'Service Project', 'VRF Project', 'Maintenance Contract'];
const projectEditStatusOptions: ProjectStatus[] = ['Draft', 'Planned', 'Active', 'On Hold', 'Near Completion', 'Cancelled'];
const projectPriorityOptions: BrowserProject['priority'][] = ['Low', 'Normal', 'High', 'Critical'];
const assignmentMaterials = [
  { item: 'Copper Pipe 3/8”', quantity: 6, unit: 'm', unitCost: 12 },
  { item: 'Electrical Cable 4×1.5mm²', quantity: 18, unit: 'm', unitCost: 4.25 },
  { item: 'Drain Pipe PVC 25mm', quantity: 6, unit: 'm', unitCost: 5 },
  { item: 'Wall Brackets', quantity: 2, unit: 'pcs', unitCost: 36 },
];
const currencyFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormatters = new Map<number, Intl.NumberFormat>();

function money(value: number) {
  return `Afl. ${currencyFormatter.format(value)}`;
}

function number(value: number, digits = 0) {
  let formatter = numberFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits });
    numberFormatters.set(digits, formatter);
  }
  return formatter.format(value);
}

function assignmentDateLabel(value?: string) {
  if (!value) return 'Date pending';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function assignmentTimeLabel(value?: string) {
  if (!value) return '';
  const [hourText, minute = '00'] = value.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function percent(value: number) {
  return `${number(Math.max(0, value), 1)}%`;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedCustomerText(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function customerLabel(customer: BookingCustomer) {
  return text(customer.name) || text(customer.company) || text(customer.legalName) || customer.id;
}

function propertiesForCustomer(references: BookingMasterReferenceData | null, customerId: string) {
  if (!references || !customerId) return [];
  return references.properties.filter((property) => property.clientId === customerId && property.active !== false);
}

function exactCustomerMatches(references: BookingMasterReferenceData | null, query: string) {
  const normalized = normalizedCustomerText(query);
  if (!references || !normalized) return [];
  return references.clients.filter((customer) => customer.active !== false
    && [customer.name, customer.company, customer.legalName]
      .some((candidate) => normalizedCustomerText(candidate) === normalized));
}

function exactCustomerMatch(references: BookingMasterReferenceData | null, query: string) {
  const matches = exactCustomerMatches(references, query);
  return matches.length === 1 ? matches[0] : undefined;
}

function matchingCustomers(references: BookingMasterReferenceData | null, query: string) {
  const tokens = normalizedCustomerText(query).split(' ').filter(Boolean);
  if (!references || !tokens.length) return [];
  return references.clients.filter((customer) => customer.active !== false).filter((customer) => {
    const properties = propertiesForCustomer(references, customer.id);
    const values = [
      customer.name,
      customer.company,
      customer.legalName,
      customer.phone,
      customer.whatsapp,
      customer.email,
      customer.address,
      customer.zone,
      ...properties.flatMap((property) => [property.name, property.address, property.addressNormalized, property.zone, property.neighborhood]),
    ].map(normalizedCustomerText).filter(Boolean);
    return tokens.every((token) => values.some((value) => value.includes(token)));
  }).slice(0, 8);
}

function optionalMoney(value: number | null) {
  return value === null ? 'Not set' : money(value);
}

function date(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function clampPercent(value: number) {
  return `${Math.max(0, Math.min(100, value))}%`;
}

function healthTone(health: ProjectHealth): Tone {
  return health === 'On Track' ? 'green' : health === 'At Risk' ? 'amber' : 'red';
}

function statusTone(status: string): Tone {
  if (status === 'Active' || status === 'In Progress') return 'blue';
  if (status === 'Completed' || status === 'Approved' || status === 'Used') return 'green';
  if (status === 'Near Completion' || status === 'Pending Review' || status === 'Returned') return 'amber';
  if (status === 'Delayed' || status === 'Damaged' || status === 'Rejected') return 'red';
  return 'slate';
}

function StatusPill({ label, tone = statusTone(label) }: { label: string; tone?: Tone }) {
  return <span className={`${styles.pill} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>{label}</span>;
}

function ProgressBar({ value, tone = 'blue', label }: { value: number; tone?: Tone; label?: string }) {
  return <div className={styles.progressWrap} aria-label={label ?? `${percent(value)} complete`}>
    <div className={styles.progressTrack}><i className={styles[`fill${tone[0].toUpperCase()}${tone.slice(1)}`]} style={{ width: clampPercent(value) }} /></div>
    {label ? <small>{label}</small> : null}
  </div>;
}

function MetricCard({ code, label, value, note, tone = 'blue' }: { code: string; label: string; value: string; note: string; tone?: Tone }) {
  return <article className={styles.metricCard}>
    <div className={`${styles.metricIcon} ${styles[`icon${tone[0].toUpperCase()}${tone.slice(1)}`]}`} aria-hidden="true">{code}</div>
    <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
  </article>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className={styles.emptyState}><span aria-hidden="true">PR</span><strong>{title}</strong><p>{text}</p></div>;
}

export function ProjectsWorkspace() {
  const { principal } = useAuth();
  const canViewProjects = principal.active && principal.capabilities.has('projects.view');
  const canManageProjects = canViewProjects && principal.capabilities.has('projects.manage');
  const canManageProjectsRef = useRef(canManageProjects);
  canManageProjectsRef.current = canManageProjects;
  const [state, setState] = useState<BrowserProjectsPreviewState>(() => createProjectsPreviewState());
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<WorkspaceView>('portfolio');
  const [activeTab, setActiveTab] = useState<DetailTab>('Overview');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ProjectStatus>('All');
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<'success' | 'warning'>('success');
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaveError, setEditSaveError] = useState('');
  const [reviewExpenseId, setReviewExpenseId] = useState('');
  const [activeAssignmentId, setActiveAssignmentId] = useState('ASG-1052');
  const [crmReferences, setCrmReferences] = useState<BookingMasterReferenceData | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmError, setCrmError] = useState('');
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectSaveError, setProjectSaveError] = useState('');
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const expenseTriggerRef = useRef<HTMLButtonElement>(null);

  const refreshCrmReferences = useCallback(async () => {
    if (!canManageProjectsRef.current) {
      setCrmError('Your account does not have permission to manage Projects.');
      return;
    }
    setCrmLoading(true);
    setCrmError('');
    try {
      setCrmReferences(await loadBookingMasterReferenceData());
    } catch (error) {
      setCrmError(error instanceof Error ? error.message : 'Canonical CRM could not be loaded.');
    } finally {
      setCrmLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canViewProjects) {
      setReady(true);
      return undefined;
    }
    setReady(false);
    const reloadProjects = () => {
      setState(loadBrowserProjectsPreviewState(createProjectsPreviewState()));
    };
    reloadProjects();
    setReady(true);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === BROWSER_PROJECTS_PREVIEW_KEY) reloadProjects();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [canViewProjects]);

  useEffect(() => {
    if (!createOpen && !editOpen) return;
    setProjectSaveError('');
    setEditSaveError('');
    void refreshCrmReferences();
  }, [createOpen, editOpen, refreshCrmReferences]);

  useEffect(() => {
    if (canManageProjects) return;
    setCreateOpen(false);
    setEditOpen(false);
    if (!canViewProjects) setReviewExpenseId('');
  }, [canManageProjects, canViewProjects]);

  useEffect(() => {
    if (!createOpen && !editOpen && !reviewExpenseId) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (createOpen && projectSaving) {
        event.preventDefault();
        return;
      }
      setCreateOpen(false);
      setEditOpen(false);
      setReviewExpenseId('');
      if (createOpen) window.setTimeout(() => createTriggerRef.current?.focus(), 0);
      if (editOpen) window.setTimeout(() => editTriggerRef.current?.focus(), 0);
      if (reviewExpenseId) window.setTimeout(() => expenseTriggerRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [createOpen, editOpen, projectSaving, reviewExpenseId]);

  const selectedProject = state.projects.find((project) => project.id === state.selectedProjectId) ?? state.projects[0];
  const selectedMetrics = projectMetrics(selectedProject);
  const selectedAssignment = selectedProject.assignments.find((assignment) => assignment.id === activeAssignmentId)
    ?? projectAssignmentsForHandoff(selectedProject)[0];
  const reviewExpense = selectedProject.expenses.find((expense) => expense.id === reviewExpenseId);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en');
    return state.projects.filter((project) => {
      const matchesStatus = statusFilter === 'All' || project.status === statusFilter;
      const matchesQuery = !normalized || [project.name, project.projectNumber, project.customerName, project.managerName, project.type]
        .some((field) => field.toLocaleLowerCase('en').includes(normalized));
      return matchesStatus && matchesQuery;
    });
  }, [query, state.projects, statusFilter]);

  const portfolioMetrics = useMemo(() => {
    const active = state.projects.filter((project) => project.status === 'Active').length;
    const near = state.projects.filter((project) => project.status === 'Near Completion' || projectMetrics(project).physicalCompletion >= 90).length;
    const overLabor = state.projects.filter((project) => projectMetrics(project).laborConsumption > 100).length;
    const overMaterial = state.projects.filter((project) => (projectMetrics(project).materialConsumption ?? 0) > 100).length;
    const hours = state.projects.reduce((sum, project) => sum + project.actualLaborHours, 0);
    const spend = state.projects.reduce((sum, project) => sum + project.materialActual, 0);
    return { active, near, overLabor, overMaterial, hours, spend, attention: near + overLabor + overMaterial };
  }, [state.projects]);

  if (!canViewProjects) {
    return <section className={styles.workspace}>
      <article className={styles.panel} role="alert">
        <EmptyState title="Projects access required" text="Your account does not have permission to view the Projects module." />
      </article>
    </section>;
  }

  async function commitSelectedProject(reducer: (latestProject: Readonly<BrowserProject>) => BrowserProject) {
    if (!canManageProjectsRef.current) {
      throw new Error('Your account does not have permission to manage Projects.');
    }
    const next = await commitBrowserProjectsPreviewMutation(state, (latest) => reduceProjectInState(latest, selectedProject.id, reducer), {
      authorize: () => {
        if (!canManageProjectsRef.current) {
          throw new Error('Your Projects management permission changed before the Project could be saved.');
        }
      },
    });
    setState(next);
    return next.projects.find((project) => project.id === selectedProject.id)!;
  }

  function showNotice(message: string, tone: 'success' | 'warning' = 'success') {
    setNoticeTone(tone);
    setNotice(message);
  }

  function openProject(project: BrowserProject) {
    setState((current) => ({ ...current, selectedProjectId: project.id }));
    setActiveTab('Overview');
    setView('detail');
    setNotice('');
  }

  function openCreateProject() {
    if (!canManageProjectsRef.current) {
      showNotice('Your account has read-only Projects access. Create Project requires Projects management permission.', 'warning');
      return;
    }
    setCreateOpen(true);
  }

  function openEditProject() {
    if (!canManageProjectsRef.current) {
      showNotice('Your account has read-only Projects access. Edit Project requires Projects management permission.', 'warning');
      return;
    }
    setEditSaveError('');
    setEditOpen(true);
  }

  function openExpenseReview(expenseId: string, trigger: HTMLButtonElement) {
    expenseTriggerRef.current = trigger;
    setReviewExpenseId(expenseId);
  }

  function closeExpenseReview() {
    setReviewExpenseId('');
    window.setTimeout(() => expenseTriggerRef.current?.focus(), 0);
  }

  async function resetDemo() {
    if (!canManageProjectsRef.current) {
      showNotice('Your account has read-only Projects access. Reset demo requires Projects management permission.', 'warning');
      return;
    }
    try {
      const next = await commitBrowserProjectsPreviewMutation(state, () => createProjectsPreviewState(), {
        authorize: () => {
          if (!canManageProjectsRef.current) throw new Error('Your Projects management permission changed before reset.');
        },
      });
      setState(next);
      setView('portfolio');
      setActiveTab('Overview');
      setActiveAssignmentId('ASG-1052');
      setReviewExpenseId('');
      showNotice('Preview reset to the validated Projects baseline.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The Projects preview could not be reset.', 'warning');
    }
  }

  async function markComplete() {
    if (!canManageProjectsRef.current) {
      showNotice('Your account has read-only Projects access. Mark Complete requires Projects management permission.', 'warning');
      return;
    }
    const completionBlockers = projectCompletionBlockers(selectedProject);
    if (completionBlockers.length > 0) {
      showNotice(`${selectedProject.projectNumber} cannot be closed yet: ${completionBlockers.join('; ')}. Resolve Scheduling work through its canonical lifecycle and post real field completion first; Mark Complete never manufactures operational progress.`, 'warning');
      return;
    }
    if (!window.confirm(`Mark ${selectedProject.projectNumber} · ${selectedProject.name} complete? This changes the Project lifecycle status; recorded field progress remains unchanged.`)) return;
    try {
      await commitSelectedProject((latestProject) => {
        const latestBlockers = projectCompletionBlockers(latestProject);
        if (latestBlockers.length > 0) {
          throw new Error(`${latestProject.projectNumber} changed and cannot be closed yet: ${latestBlockers.join('; ')}.`);
        }
        return latestProject.status === 'Completed'
          ? latestProject as BrowserProject
          : { ...latestProject, status: 'Completed' as const };
      });
      showNotice(`${selectedProject.projectNumber} marked complete in preview data.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The Project could not be marked complete.', 'warning');
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageProjectsRef.current) {
      setProjectSaveError('Your account does not have permission to create Projects.');
      return;
    }
    if (projectSaving) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const customerId = String(form.get('customerId') ?? '').trim();
    const customerNameInput = String(form.get('customerName') ?? '').trim();
    const customerAction = String(form.get('customerAction') ?? '');
    if (!name || !customerNameInput) return;
    if (!crmReferences) {
      setProjectSaveError('Canonical CRM is not available. Reload customer records before saving this project.');
      return;
    }

    setProjectSaving(true);
    setProjectSaveError('');
    try {
      let customer = crmReferences.clients.find((candidate) => candidate.id === customerId && candidate.active !== false)
        ?? exactCustomerMatch(crmReferences, customerNameInput);
      let customerCreated = false;

      if (!customer) {
        if (customerAction !== 'create') {
          throw new Error('Select an existing customer or choose Create new customer before saving.');
        }
        const phone = normalizeBookingPhone(String(form.get('customerPhone') ?? ''));
        const email = String(form.get('customerEmail') ?? '').trim();
        if (!phone) throw new Error('Phone / WhatsApp is required to create a canonical customer.');
        const duplicate = crmReferences.clients.find((candidate) => {
          const candidatePhones = [candidate.phone, candidate.whatsapp].map((value) => normalizeBookingPhone(text(value))).filter(Boolean);
          return candidatePhones.includes(phone)
            || Boolean(email && text(candidate.email).toLocaleLowerCase('en') === email.toLocaleLowerCase('en'));
        });
        if (duplicate) {
          throw new Error(`This phone, WhatsApp, or email already belongs to ${customerLabel(duplicate)}. Select that existing customer instead.`);
        }
        const result = await createOfficeCustomer({
          requestId: String(form.get('customerRequestId') ?? ''),
          customer: {
            name: customerNameInput,
            company: customerNameInput,
            legalName: customerNameInput,
            type: 'Commercial',
            phone,
            whatsapp: phone,
            email,
            preferredLanguage: 'Papiamento',
          },
        });
        customer = result.customer as unknown as BookingCustomer;
        customerCreated = true;
        primeLiveSchedulingReferenceCache({ clients: [customer] });
        setCrmReferences((current) => current ? {
          ...current,
          clients: [customer!, ...current.clients.filter((candidate) => candidate.id !== customer!.id)],
        } : current);
      }

      const type = String(form.get('type') ?? 'Installation Project');
      const capacity = projectCapacityPlan(Number(form.get('workDays')));
      const materialBudgetValue = normalizeOptionalMaterialBudget(form.get('materialBudget'));
      const materialBudget = projectTypeUsesMaterialBudget(type) ? materialBudgetValue : null;
      const technicianInstructions = String(form.get('technicianInstructions') ?? '').trim();
      const propertyId = String(form.get('propertyId') ?? '').trim();
      const property = crmReferences.properties.find((candidate) => candidate.id === propertyId && candidate.clientId === customer.id);
      const customerName = customerLabel(customer);
      const template = createProjectsPreviewState().projects[0];
      const draftToken = String(Date.now());
      const id = `DEMO-PRJ-${draftToken}`;
      const next = await commitBrowserProjectsPreviewMutation(state, (latest) => {
        if (latest.projects.some((project) => project.id === id)) {
          throw new Error('A Project draft with this preview identity already exists. Try saving again.');
        }
        const usedNumbers = new Set(latest.projects.map((project) => project.projectNumber));
        let projectSequence = 1000 + latest.projects.length + 8;
        while (usedNumbers.has(`PRJ-${projectSequence}`)) projectSequence += 1;
        const project: BrowserProject = {
          ...template,
          id,
          projectNumber: `PRJ-${projectSequence}`,
          name,
          customerId: customer.id,
          customerName,
          siteId: property?.id ?? '',
          location: text(property?.address) || text(property?.zone) || 'Property to be confirmed',
          contactPerson: 'Not set',
          type,
          description: `${name} · ${type}.`,
          technicianInstructions,
          status: 'Draft',
          priority: 'Normal',
          managerId: '',
          managerName: 'Not assigned',
          contractValue: undefined,
          laborRate: undefined,
          otherEstimatedCosts: undefined,
          startsOn: String(form.get('startsOn') ?? '2026-09-07'),
          estimatedCompletionOn: String(form.get('endsOn') ?? '2026-10-16'),
          totalUnits: Number(form.get('units')) || 1,
          completedUnits: 0,
          unitType: 'Units',
          ...capacity,
          actualLaborHours: 0,
          scheduledFutureHours: 0,
          materialBudget,
          materialActual: 0,
          phases: [], materials: [], expenses: [], costEntries: [], assignments: [], assignedVans: [],
        };
        return { ...latest, selectedProjectId: id, projects: [project, ...latest.projects] };
      }, {
        authorize: () => {
          if (!canManageProjectsRef.current) {
            throw new Error('Your Projects management permission changed before the Project could be saved. Reload and try again.');
          }
        },
      });
      const project = next.projects.find((candidate) => candidate.id === id)!;
      setState(next);
      setCreateOpen(false);
      window.setTimeout(() => createTriggerRef.current?.focus(), 0);
      showNotice(customerCreated
        ? `${customerName} was created in canonical CRM and ${project.projectNumber} was saved as a browser-only draft.`
        : `${project.projectNumber} was linked to ${customerName} and saved as a browser-only draft.`);
    } catch (error) {
      setProjectSaveError(error instanceof Error ? error.message : 'The project draft could not be saved.');
    } finally {
      setProjectSaving(false);
    }
  }

  async function editProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageProjectsRef.current) {
      setEditSaveError('Your account does not have permission to edit Projects.');
      return;
    }
    const form = new FormData(event.currentTarget);
    const structureLocked = projectHasOperationalActivity(selectedProject);
    const type = structureLocked ? selectedProject.type : String(form.get('type') ?? selectedProject.type);
    const siteId = structureLocked ? selectedProject.siteId : String(form.get('propertyId') ?? selectedProject.siteId).trim();
    const property = !structureLocked && siteId
      ? crmReferences?.properties.find((candidate) => candidate.id === siteId && candidate.clientId === selectedProject.customerId && candidate.active !== false)
      : undefined;
    if (!structureLocked && siteId && crmReferences && !crmError && !property) {
      setEditSaveError('Select an active Service Property that belongs to this Project customer, or choose “Select later”.');
      return;
    }
    const location = structureLocked
      ? selectedProject.location
      : property
        ? text(property.address) || text(property.zone) || selectedProject.location
        : siteId === selectedProject.siteId ? selectedProject.location : 'Property to be confirmed';
    try {
      const input = {
        projectId: selectedProject.id,
        name: String(form.get('name') ?? ''),
        type,
        siteId,
        location,
        status: String(form.get('status') ?? selectedProject.status) as ProjectStatus,
        priority: String(form.get('priority') ?? selectedProject.priority) as BrowserProject['priority'],
        totalUnits: Number(form.get('totalUnits')),
        materialBudget: projectTypeUsesMaterialBudget(type)
          ? normalizeOptionalMaterialBudget(form.get('materialBudget'))
          : null,
        startsOn: String(form.get('startsOn') ?? ''),
        estimatedCompletionOn: String(form.get('estimatedCompletionOn') ?? ''),
        estimatedWorkDays: Number(form.get('estimatedWorkDays')),
        technicianInstructions: String(form.get('technicianInstructions') ?? ''),
      };
      const next = await commitBrowserProjectsPreviewMutation(state, (latest) => editBrowserProject(latest, input), {
        authorize: () => {
          if (!canManageProjectsRef.current) {
            throw new Error('Your Projects management permission changed before the Project could be saved.');
          }
        },
      });
      setState(next);
      setEditOpen(false);
      setEditSaveError('');
      window.setTimeout(() => editTriggerRef.current?.focus(), 0);
      showNotice(`${selectedProject.projectNumber} updated. New Scheduling visits will use the latest Project details and technician instructions.`);
    } catch (error) {
      setEditSaveError(error instanceof Error ? error.message : 'The Project changes could not be saved.');
    }
  }

  async function updateAssignmentStatus(status: ProjectAssignment['status']) {
    if (!canManageProjectsRef.current) {
      showNotice('Your account has read-only Projects access. Assignment changes require Projects management permission.', 'warning');
      return;
    }
    if (!selectedAssignment) return;
    try {
      await commitSelectedProject((latestProject) => {
        const latestAssignment = latestProject.assignments.find((assignment) => assignment.id === selectedAssignment.id);
        if (!latestAssignment) throw new Error(`Assignment ${selectedAssignment.id} is no longer available.`);
        if (latestAssignment.postedAt) return latestProject as BrowserProject;
        if (projectAssignmentUsesCanonicalLifecycle(latestAssignment)) {
          throw new Error('This assignment is governed by canonical Scheduling and Field Operations. Open the Technician Portal to change its lifecycle.');
        }
        return {
          ...latestProject,
          assignments: latestProject.assignments.map((assignment) => assignment.id === latestAssignment.id ? { ...assignment, status } : assignment),
        };
      });
      showNotice(`${selectedAssignment.id} is now ${status.toLocaleLowerCase('en')}.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The assignment status could not be saved.', 'warning');
    }
  }

  async function completeAssignment() {
    if (!canManageProjectsRef.current) {
      showNotice('Your account has read-only Projects access. Completing assignments requires Projects management permission.', 'warning');
      return;
    }
    if (!selectedAssignment) return;
    try {
      await commitSelectedProject((latestProject) => postProjectAssignment(latestProject as BrowserProject, {
        assignmentId: selectedAssignment.id,
        materialLines: assignmentMaterials,
        postedAt: new Date().toISOString(),
      }));
      showNotice(selectedAssignment.postedAt
        ? `${selectedAssignment.id} was already posted — no duplicate labor or material entry was created.`
        : `${selectedAssignment.id} completed. Actual labor and consumed materials posted once.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The assignment could not be completed.', 'warning');
    }
  }

  async function confirmExpense() {
    if (!canManageProjectsRef.current) {
      showNotice('Your account has read-only Projects access. Linking expenses requires Projects management permission.', 'warning');
      return;
    }
    if (!reviewExpense) return;
    const alreadyLinked = reviewExpense.status === 'Approved' || selectedProject.costEntries.some((entry) => entry.sourceId === reviewExpense.id);
    try {
      await commitSelectedProject((latestProject) => linkProjectExpense(latestProject as BrowserProject, reviewExpense.id));
      closeExpenseReview();
      showNotice(alreadyLinked
        ? `${reviewExpense.id} was already linked — no duplicate cost entry was created.`
        : `${reviewExpense.id} approved and linked once to Project Costing.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The expense link could not be saved.', 'warning');
    }
  }

  return <section className={styles.workspace} aria-busy={!ready}>
    <div className={styles.previewBanner} role="note">
      <div><span className={styles.previewTag}>PREVIEW DATA</span><strong>Projects · Fast Product Validation</strong><p>Project records stay browser-only. Customer search and explicit new-customer creation use canonical CRM; no inventory, payroll, or accounting writes.</p></div>
      <div className={styles.previewActions}><a href="/scheduling">Scheduling</a><a href="/inventory">Inventory</a><a href="/expenses">Expenses</a><a href="/field">Field</a><button type="button" onClick={resetDemo} disabled={!canManageProjects} title={canManageProjects ? 'Restore the validated preview baseline' : 'Projects management permission required'}>Reset demo</button></div>
    </div>

    {!canManageProjects ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="status"><span aria-hidden="true">i</span><p>You have read-only Projects access. Creating, editing, completing, posting, and linking records requires Projects management permission.</p></div> : null}
    {notice ? <div className={`${styles.notice} ${noticeTone === 'warning' ? styles.noticeWarning : ''}`} role={noticeTone === 'warning' ? 'alert' : 'status'}><span aria-hidden="true">{noticeTone === 'warning' ? '!' : '✓'}</span><p>{notice}</p><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div> : null}

    {view === 'portfolio' ? <>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>Commercial & Project Operations</span><h1>Projects</h1><p>Track scope, field execution, labor, material consumption, and project cost from one module in DEMAC ERP Next.</p></div>
        <div className={styles.headerActions}><button type="button" className={styles.secondaryButton} onClick={() => showNotice('Portfolio export is represented in this validation slice; no file was generated.')}>⇧ Export</button><button ref={createTriggerRef} type="button" className={styles.primaryButton} onClick={openCreateProject} disabled={!canManageProjects} title={canManageProjects ? 'Create Project' : 'Projects management permission required'}>＋ Create Project</button></div>
      </header>

      <div className={styles.portfolioMetrics}>
        <MetricCard code="PR" label="Active projects" value={String(portfolioMetrics.active)} note="Across current operations" tone="blue" />
        <MetricCard code="NC" label="Near completion" value={String(portfolioMetrics.near)} note="90% complete or flagged" tone="green" />
        <MetricCard code="LB" label="Over labor budget" value={String(portfolioMetrics.overLabor)} note="Requires manager review" tone={portfolioMetrics.overLabor ? 'amber' : 'green'} />
        <MetricCard code="MB" label="Over material budget" value={String(portfolioMetrics.overMaterial)} note="Based on actual consumption" tone={portfolioMetrics.overMaterial ? 'red' : 'green'} />
        <MetricCard code="HR" label="Project hours" value={`${number(portfolioMetrics.hours, 1)}h`} note="Preview portfolio actuals" tone="purple" />
        <MetricCard code="AF" label="Material spend" value={money(portfolioMetrics.spend)} note="Actual project consumption" tone="blue" />
      </div>

      <div className={styles.portfolioLayout}>
        <article className={styles.panel}>
          <div className={styles.toolbar}>
            <label className={styles.searchField}><span aria-hidden="true">⌕</span><span className={styles.srOnly}>Search projects</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, customers, managers…" /></label>
            <label className={styles.selectField}><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'All' | ProjectStatus)}>{statusOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <button type="button" className={styles.textButton} onClick={() => { setQuery(''); setStatusFilter('All'); }}>Clear filters</button>
            <span className={styles.resultCount}>{filteredProjects.length} project{filteredProjects.length === 1 ? '' : 's'}</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.projectTable}>
              <thead><tr><th>Project</th><th>Customer / Type</th><th>Physical completion</th><th>Labor used / budget</th><th>Materials used / budget</th><th>Status</th><th>Vans / Manager</th></tr></thead>
              <tbody>{filteredProjects.map((project) => {
                const metrics = projectMetrics(project);
                return <tr key={project.id}>
                  <td><button type="button" className={styles.projectLink} onClick={() => openProject(project)}>{project.name}</button><small>{project.projectNumber}</small></td>
                  <td><strong>{project.customerName}</strong><small>{project.type}</small></td>
                  <td><strong>{percent(metrics.physicalCompletion)}</strong><ProgressBar value={metrics.physicalCompletion} /></td>
                  <td><strong>{number(project.actualLaborHours, 1)}h / {number(project.estimatedLaborHours)}h</strong><ProgressBar value={metrics.laborConsumption} tone={metrics.laborConsumption > 100 ? 'red' : 'blue'} label={percent(metrics.laborConsumption)} /></td>
                  <td><strong>{money(project.materialActual)} / {optionalMoney(project.materialBudget)}</strong><ProgressBar value={metrics.materialConsumption ?? 0} tone={metrics.materialConsumption === null ? 'slate' : metrics.materialConsumption > 100 ? 'red' : metrics.materialConsumption >= 80 ? 'amber' : 'green'} label={metrics.materialConsumption === null ? 'Not set' : percent(metrics.materialConsumption)} /></td>
                  <td><StatusPill label={project.status} /></td>
                  <td><strong>{project.assignedVans.length ? project.assignedVans.join(', ').replaceAll('VAN-', 'Van ') : 'Unassigned'}</strong><small>{project.managerName}</small></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          {!filteredProjects.length ? <EmptyState title="No projects match" text="Change the status or search term to see preview records." /> : null}
        </article>

        <aside className={styles.rightRail} aria-label="Portfolio attention">
          <article className={styles.panel}>
            <div className={styles.panelHeader}><div><span>Exception-first</span><h2>Projects requiring attention</h2></div><b>{portfolioMetrics.attention}</b></div>
            <div className={styles.attentionList}>
              <button type="button" onClick={() => setStatusFilter('Active')}><i className={styles.dangerDot}>!</i><span><strong>Labor budget exceeded</strong><small>{portfolioMetrics.overLabor} projects above budget</small></span><b>›</b></button>
              <button type="button" onClick={() => setStatusFilter('Active')}><i className={styles.warningDot}>△</i><span><strong>Material budget exceeded</strong><small>{portfolioMetrics.overMaterial} project above budget</small></span><b>›</b></button>
              <button type="button" onClick={() => setStatusFilter('Near Completion')}><i className={styles.purpleDot}>◷</i><span><strong>Near completion</strong><small>{portfolioMetrics.near} projects need handover planning</small></span><b>›</b></button>
            </div>
          </article>
          <article className={styles.panel}>
            <div className={styles.panelHeader}><div><span>Authority model</span><h2>One operational flow</h2></div></div>
            <div className={styles.flowList}>
              <a href="/scheduling"><span>1</span><div><strong>Plan assignments</strong><small>Schedule retains planned hours.</small></div></a>
              <a href="/field"><span>2</span><div><strong>Execute in field</strong><small>Technicians post actual hours and usage.</small></div></a>
              <a href="/inventory"><span>3</span><div><strong>Consume materials</strong><small>Transfers are not consumption.</small></div></a>
              <a href="/expenses"><span>4</span><div><strong>Review expenses</strong><small>One transaction, linked to costing.</small></div></a>
            </div>
          </article>
        </aside>
      </div>
    </> : view === 'technician' ? <TechnicianView project={selectedProject} assignment={selectedAssignment} canManage={canManageProjects} onBack={() => setView('detail')} onStart={() => updateAssignmentStatus('In Progress')} onPause={() => updateAssignmentStatus('Paused')} onComplete={completeAssignment} /> : <ProjectDetail project={selectedProject} activeTab={activeTab} setActiveTab={setActiveTab} canManage={canManageProjects} onBack={() => setView('portfolio')} editButtonRef={editTriggerRef} onEdit={openEditProject} onTechnician={(assignmentId) => { setActiveAssignmentId(assignmentId); setView('technician'); }} onMarkComplete={markComplete} onReviewExpense={openExpenseReview} />}

    {createOpen && canManageProjects ? <CreateProjectDialog references={crmReferences} loading={crmLoading} loadError={crmError} saving={projectSaving} saveError={projectSaveError} onRetry={() => void refreshCrmReferences()} onClose={() => { setCreateOpen(false); window.setTimeout(() => createTriggerRef.current?.focus(), 0); }} onSubmit={createProject} /> : null}
    {editOpen && canManageProjects ? <EditProjectDialog key={selectedProject.id} project={selectedProject} references={crmReferences} loading={crmLoading} loadError={crmError} saveError={editSaveError} onRetry={() => void refreshCrmReferences()} onClose={() => { setEditOpen(false); setEditSaveError(''); window.setTimeout(() => editTriggerRef.current?.focus(), 0); }} onSubmit={editProject} /> : null}
    {reviewExpense ? <ExpenseReviewDrawer project={selectedProject} expense={reviewExpense} canManage={canManageProjects} onClose={closeExpenseReview} onConfirm={confirmExpense} /> : null}
  </section>;
}

function ProjectDetail({ project, activeTab, setActiveTab, canManage, onBack, editButtonRef, onEdit, onTechnician, onMarkComplete, onReviewExpense }: { project: BrowserProject; activeTab: DetailTab; setActiveTab: (tab: DetailTab) => void; canManage: boolean; onBack: () => void; editButtonRef: RefObject<HTMLButtonElement | null>; onEdit: () => void; onTechnician: (assignmentId: string) => void; onMarkComplete: () => void; onReviewExpense: (id: string, trigger: HTMLButtonElement) => void }) {
  const metrics = projectMetrics(project);
  const pendingExpense = project.expenses.find((expense) => expense.status === 'Pending Review');
  const handoffAssignments = projectAssignmentsForHandoff(project);
  return <>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><button type="button" onClick={onBack}>Projects</button><span>›</span><span>{project.projectNumber}</span></nav>
    <header className={styles.pageHeader}>
      <div><div className={styles.titleLine}><h1>{project.name}</h1><StatusPill label={project.status} /></div><p>{project.description}</p></div>
      <div className={styles.headerActions}><button type="button" className={styles.secondaryButton} onClick={onBack}><span aria-hidden="true">← </span>Portfolio</button><button ref={editButtonRef} type="button" className={styles.secondaryButton} onClick={onEdit} disabled={!canManage} title={canManage ? 'Edit Project' : 'Projects management permission required'}><span aria-hidden="true">✎ </span>Edit Project</button><a className={styles.secondaryButton} href="/scheduling"><span aria-hidden="true">＋ </span>Open Scheduling</a><button type="button" className={styles.dangerButton} onClick={onMarkComplete} disabled={!canManage || project.status === 'Completed'} title={!canManage ? 'Projects management permission required' : undefined}><span aria-hidden="true">✓ </span>{project.status === 'Completed' ? 'Completed' : 'Mark Complete'}</button></div>
    </header>

    <div className={styles.projectMeta}>
      <div><span>Customer</span><strong>{project.customerName}</strong></div><div><span>Project type</span><strong>{project.type}</strong></div><div><span>Project manager</span><strong>{project.managerName}</strong></div><div><span>Location</span><strong>{project.location}</strong></div><div><span>Start date</span><strong>{date(project.startsOn)}</strong></div><div><span>Estimated completion</span><strong>{date(project.estimatedCompletionOn)}</strong></div>
    </div>

    <div className={styles.detailMetrics}>
      <MetricCard code="ST" label="Status" value={project.status} note={metrics.health} tone={healthTone(metrics.health)} />
      <MetricCard code="PC" label="Physical completion" value={percent(metrics.physicalCompletion)} note={`${project.completedUnits} / ${project.totalUnits} units`} tone="purple" />
      <MetricCard code="LB" label="Labor budget" value={`${number(project.estimatedLaborHours)}h`} note={`${number(project.estimatedSlots)} slots · ${number(project.estimatedWorkDays)} van-days`} tone="green" />
      <MetricCard code="RL" label="Remaining labor" value={`${number(metrics.remainingUnscheduledHours, 1)}h`} note={`${number(project.scheduledFutureHours)}h scheduled`} tone="blue" />
      <MetricCard code="MB" label="Material budget" value={optionalMoney(project.materialBudget)} note={metrics.materialConsumption === null ? 'Optional baseline not set' : `${percent(metrics.materialConsumption)} used`} tone={metrics.materialConsumption === null ? 'slate' : 'amber'} />
      <MetricCard code="MR" label="Material remaining" value={optionalMoney(metrics.materialRemaining)} note={metrics.materialRemaining === null ? 'Actual cost still tracked' : 'Consumption-based'} tone={metrics.materialRemaining !== null && metrics.materialRemaining < 0 ? 'red' : metrics.materialRemaining === null ? 'slate' : 'green'} />
    </div>

    <div className={styles.tabBar} role="tablist" aria-label="Project workspace views">{detailTabs.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? styles.activeTab : ''} key={tab} onClick={() => setActiveTab(tab)}>{tab}{tab === 'Expenses' && pendingExpense ? <b>1</b> : null}</button>)}<a href="/scheduling">Schedule ↗</a><a href="/field">Work history ↗</a></div>

    {activeTab === 'Overview' ? <OverviewTab project={project} onTab={setActiveTab} /> : null}
    {activeTab === 'Phases' ? <PhasesTab project={project} /> : null}
    {activeTab === 'Materials' ? <MaterialsTab project={project} /> : null}
    {activeTab === 'Expenses' ? <ExpensesTab project={project} canManage={canManage} onReviewExpense={onReviewExpense} /> : null}
    {activeTab === 'Financials' ? <FinancialsTab project={project} /> : null}

    {handoffAssignments.map((handoffAssignment) => {
      const canonicalHandoff = projectAssignmentUsesCanonicalLifecycle(handoffAssignment);
      const handoffStatus = handoffAssignment.bookingStatus === 'temporary_hold'
        ? 'Temporary hold'
        : handoffAssignment.bookingStatus === 'confirmed'
          ? 'Confirmed'
          : handoffAssignment.postedAt
            ? 'Completed'
            : handoffAssignment.status;
      return <article key={handoffAssignment.id} className={`${styles.panel} ${styles.assignmentStrip}`}>
        <div><span>{canonicalHandoff ? 'Scheduling handoff' : 'Simulated technician handoff'}</span><strong>{handoffAssignment.id} · {handoffAssignment.vanId.replace('VAN-', 'Van ')}</strong><small>{canonicalHandoff ? 'Read-only Scheduling snapshot; execution remains in the canonical Field workflow.' : 'Open the clearly labeled simulated technician preview.'}</small></div>
        <StatusPill label={handoffStatus} />
        <button type="button" className={styles.secondaryButton} onClick={() => onTechnician(handoffAssignment.id)}>{canonicalHandoff ? 'View Scheduling snapshot →' : 'Open simulated job →'}</button>
      </article>;
    })}
  </>;
}

function OverviewTab({ project, onTab }: { project: BrowserProject; onTab: (tab: DetailTab) => void }) {
  const metrics = projectMetrics(project);
  const materialConsumption = metrics.materialConsumption ?? 0;
  const phasesComplete = project.phases.filter((phase) => phase.status === 'Completed').length;
  return <div className={styles.detailLayout}>
    <div className={styles.mainColumn}>
      <div className={styles.overviewCards}>
        <article className={styles.panel}><div className={styles.panelHeader}><div><span>Execution</span><h2>Completion vs consumption</h2></div></div><div className={styles.chartArea}><div className={styles.chartGrid}><i style={{ height: `${metrics.physicalCompletion}%` }}><b>{percent(metrics.physicalCompletion)}</b><span>Physical</span></i><i style={{ height: `${Math.min(100, metrics.laborConsumption)}%` }}><b>{percent(metrics.laborConsumption)}</b><span>Labor</span></i><i className={materialConsumption >= 80 ? styles.chartWarning : ''} style={{ height: `${Math.min(100, materialConsumption)}%` }}><b>{metrics.materialConsumption === null ? 'N/A' : percent(materialConsumption)}</b><span>Material</span></i></div></div></article>
        <article className={styles.panel}><div className={styles.panelHeader}><div><span>Units</span><h2>Installation progress</h2></div></div><div className={styles.unitHero}><strong>{project.completedUnits} <span>/ {project.totalUnits}</span></strong><p>{project.unitType}</p><ProgressBar value={metrics.physicalCompletion} tone="green" label={`${project.totalUnits - project.completedUnits} units remaining`} /><button type="button" onClick={() => onTab('Phases')}>View phases →</button></div></article>
        <article className={styles.panel}><div className={styles.panelHeader}><div><span>Forward plan</span><h2>Scheduled work</h2></div></div><div className={styles.scheduleHero}><strong>{number(project.scheduledFutureHours)}h</strong><span>next 30 days</span><p>{project.assignments.length} active or planned assignment</p><a href="/scheduling">Open Scheduling →</a></div></article>
      </div>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>Project controls</span><h2>Progress and budget health</h2></div><StatusPill label={metrics.health} tone={healthTone(metrics.health)} /></div><div className={styles.controlRows}>
        <div><div><strong>Physical completion</strong><small>Installed units and phase sign-offs</small></div><ProgressBar value={metrics.physicalCompletion} tone="green" /><b>{percent(metrics.physicalCompletion)}</b><span>{project.completedUnits} / {project.totalUnits} units</span></div>
        <div><div><strong>Labor consumption</strong><small>Actual hours versus approved estimate</small></div><ProgressBar value={metrics.laborConsumption} tone={metrics.laborConsumption > 100 ? 'red' : 'blue'} /><b>{percent(metrics.laborConsumption)}</b><span>{number(project.actualLaborHours, 1)}h / {number(project.estimatedLaborHours)}h</span></div>
        <div><div><strong>Material consumption</strong><small>{metrics.materialConsumption === null ? 'Actual cost tracked without an optional baseline' : 'Used project materials versus budget'}</small></div><ProgressBar value={materialConsumption} tone={metrics.materialConsumption === null ? 'slate' : materialConsumption >= 80 ? 'amber' : 'green'} /><b>{metrics.materialConsumption === null ? 'N/A' : percent(materialConsumption)}</b><span>{money(project.materialActual)} / {optionalMoney(project.materialBudget)}</span></div>
      </div></article>
    </div>
    <aside className={styles.rightRail}>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>Project overview</span><h2>Scope summary</h2></div></div><dl className={styles.factList}><div><dt>Manager</dt><dd>{project.managerName}</dd></div><div><dt>Contact</dt><dd>{project.contactPerson}</dd></div><div><dt>Location</dt><dd>{project.location}</dd></div><div><dt>Priority</dt><dd>{project.priority}</dd></div><div><dt>Phases</dt><dd>{phasesComplete} / {project.phases.length} complete</dd></div><div><dt>Assigned vans</dt><dd>{project.assignedVans.length}</dd></div><div className={styles.instructionFact}><dt>Technician instructions</dt><dd>{project.technicianInstructions?.trim() || 'Not set yet'}</dd></div></dl></article>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>Attention</span><h2>Budget signal</h2></div></div><div className={styles.budgetSignal}><div className={styles.ring} style={{ '--ring': `${Math.min(100, materialConsumption) * 3.6}deg` } as React.CSSProperties}><strong>{metrics.materialConsumption === null ? 'N/A' : percent(materialConsumption)}</strong><span>{metrics.materialConsumption === null ? 'not set' : 'used'}</span></div><p>{metrics.materialConsumption === null ? 'No optional material baseline is set; actual material cost is still tracked.' : materialConsumption >= 80 ? 'Material consumption has crossed the 80% early-warning threshold.' : 'Material consumption remains within the current threshold.'}</p><button type="button" onClick={() => onTab('Materials')}>Review materials</button></div></article>
    </aside>
  </div>;
}

function PhasesTab({ project }: { project: BrowserProject }) {
  if (!project.phases.length) return <article className={styles.panel}><EmptyState title="No phases yet" text="Add the scope breakdown when this draft is ready for planning." /></article>;
  return <div className={styles.detailLayout}>
    <article className={styles.panel}><div className={styles.panelHeader}><div><span>Work breakdown</span><h2>Project phases</h2><p>Estimated and actual effort stay separate through execution.</p></div><button type="button" className={styles.smallButton} disabled title="Phase authoring follows owner validation">＋ Add Phase</button></div><div className={styles.tableWrap}><table className={styles.phaseTable}><thead><tr><th>#</th><th>Phase</th><th>Status</th><th>Est. labor</th><th>Actual</th><th>Est. materials</th><th>Actual</th><th>Units</th><th>Progress</th><th>Timeline</th></tr></thead><tbody>{project.phases.map((phase, index) => <tr key={phase.id}><td>{index + 1}</td><td><strong>{phase.name}</strong><small>{phase.id}</small></td><td><StatusPill label={phase.status} /></td><td>{number(phase.estimatedLaborHours)}h</td><td>{number(phase.actualLaborHours, 1)}h</td><td>{money(phase.estimatedMaterialCost)}</td><td>{money(phase.actualMaterialCost)}</td><td>{phase.unitsCompleted} / {phase.unitsPlanned}</td><td><strong>{percent(phase.progress)}</strong><ProgressBar value={phase.progress} tone={phase.status === 'Completed' ? 'green' : 'blue'} /></td><td><div className={styles.timelineCell}><span style={{ width: `${Math.max(14, Math.min(100, phase.progress || 45))}%` }} />{phase.startsOn} – {phase.endsOn}</div></td></tr>)}</tbody></table></div></article>
    <aside className={styles.rightRail}><article className={styles.panel}><div className={styles.panelHeader}><div><span>Phase progress</span><h2>{project.phases.filter((phase) => phase.status === 'Completed').length} of {project.phases.length} complete</h2></div></div><div className={styles.railBody}><ProgressBar value={project.phases.filter((phase) => phase.status === 'Completed').length / project.phases.length * 100} tone="green" label="Overall phase completion" /></div></article><article className={styles.panel}><div className={styles.panelHeader}><div><span>Current active phase</span><h2>{project.phases.find((phase) => phase.status === 'In Progress')?.name ?? 'Planning'}</h2></div></div><div className={styles.railBody}><p>Actuals come from technician work logs and consumed materials, not from the schedule.</p><a href="/field">Open Field Operations →</a></div></article></aside>
  </div>;
}

function MaterialsTab({ project }: { project: BrowserProject }) {
  const metrics = projectMetrics(project);
  const materialConsumption = metrics.materialConsumption ?? 0;
  if (!project.materials.length) return <article className={styles.panel}><EmptyState title="No material usage" text="Consumed inventory and approved purchases will appear here." /></article>;
  return <div className={styles.detailLayout}>
    <article className={styles.panel}><div className={styles.panelHeader}><div><span>Project costing</span><h2>Material history</h2><p>Transfers preserve custody; only consumption affects project actuals.</p></div><a className={styles.smallButton} href="/inventory">Open Inventory ↗</a></div><div className={styles.tableWrap}><table className={styles.materialTable}><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Unit cost</th><th>Total cost</th><th>Source</th><th>Van / Technician</th><th>Assignment</th><th>Status</th></tr></thead><tbody>{project.materials.map((row) => <tr key={row.id}><td>{row.date}</td><td><strong>{row.item}</strong><small>{row.id}</small></td><td>{number(row.quantity, 2)} {row.unit}</td><td>{money(row.unitCost)}</td><td>{money(row.quantity * row.unitCost)}</td><td><StatusPill label={row.source} tone={row.source === 'External Purchase' ? 'blue' : 'green'} /></td><td><strong>{row.van}</strong><small>{row.technician}</small></td><td>{row.assignmentId}</td><td><StatusPill label={row.status} /></td></tr>)}</tbody></table></div></article>
    <aside className={styles.rightRail}><article className={styles.panel}><div className={styles.panelHeader}><div><span>Consumption</span><h2>Material budget</h2></div></div><div className={styles.budgetSignal}><div className={styles.ring} style={{ '--ring': `${Math.min(100, materialConsumption) * 3.6}deg` } as React.CSSProperties}><strong>{metrics.materialConsumption === null ? 'N/A' : percent(materialConsumption)}</strong><span>{metrics.materialConsumption === null ? 'not set' : 'used'}</span></div><dl className={styles.factList}><div><dt>Used</dt><dd>{money(project.materialActual)}</dd></div><div><dt>Remaining</dt><dd>{optionalMoney(metrics.materialRemaining)}</dd></div><div><dt>Budget</dt><dd>{optionalMoney(project.materialBudget)}</dd></div></dl></div></article><article className={styles.panel}><div className={styles.panelHeader}><div><span>Quality</span><h2>Adjustments</h2></div></div><div className={styles.railBody}><strong>{project.materials.filter((row) => row.status === 'Returned').length} returned · {project.materials.filter((row) => row.status === 'Damaged').length} damaged</strong><p>Returned material does not become negative consumption until inventory receives it.</p></div></article></aside>
  </div>;
}

function ExpensesTab({ project, canManage, onReviewExpense }: { project: BrowserProject; canManage: boolean; onReviewExpense: (id: string, trigger: HTMLButtonElement) => void }) {
  if (!project.expenses.length) return <article className={styles.panel}><EmptyState title="No project expenses" text="Receipts, invoices, bills, and card imports linked to this project appear here." /></article>;
  const approved = project.expenses.filter((expense) => expense.status === 'Approved').reduce((sum, expense) => sum + expense.amount, 0);
  return <><div className={styles.expenseMetrics}><MetricCard code="EX" label="External purchases" value={money(project.expenses.reduce((sum, expense) => sum + expense.amount, 0))} note="Preview project total" tone="green" /><MetricCard code="RV" label="Pending review" value={money(project.expenses.filter((expense) => expense.status === 'Pending Review').reduce((sum, expense) => sum + expense.amount, 0))} note={`${project.expenses.filter((expense) => expense.status === 'Pending Review').length} transaction`} tone="amber" /><MetricCard code="AP" label="Approved" value={money(approved)} note="Linked transactions" tone="blue" /></div><article className={styles.panel}><div className={styles.panelHeader}><div><span>One entry · one post</span><h2>Project expenses</h2><p>AI suggestions remain reviewable before they affect project costing.</p></div><a className={styles.smallButton} href="/expenses">Open Expenses ↗</a></div><div className={styles.tableWrap}><table className={styles.expenseTable}><thead><tr><th>Date</th><th>Vendor</th><th>Description</th><th>Amount</th><th>Cost type</th><th>Phase</th><th>Source</th><th>Status</th></tr></thead><tbody>{project.expenses.map((expense) => <tr key={expense.id} className={expense.status === 'Pending Review' ? styles.pendingRow : ''}><td>{expense.date}</td><td><button type="button" className={styles.projectLink} disabled={expense.status !== 'Pending Review'} onClick={(event) => onReviewExpense(expense.id, event.currentTarget)} aria-label={`${expense.status === 'Pending Review' ? canManage ? 'Review' : 'Inspect' : 'Approved'} expense ${expense.id} from ${expense.vendor}`}>{expense.vendor}</button><small>{expense.id}</small></td><td>{expense.description}</td><td><strong>{money(expense.amount)}</strong></td><td>{expense.costType}</td><td>{project.phases.find((phase) => phase.id === expense.phaseId)?.name ?? expense.phaseId}</td><td>{expense.source}</td><td><StatusPill label={expense.status} /></td></tr>)}</tbody></table></div></article></>;
}

function FinancialsTab({ project }: { project: BrowserProject }) {
  const byType = project.costEntries.reduce<Record<string, number>>((acc, entry) => ({ ...acc, [entry.costType]: (acc[entry.costType] ?? 0) + entry.amount }), {});
  const actualCost = project.costEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const laborRate = typeof project.laborRate === 'number' && Number.isFinite(project.laborRate) && project.laborRate >= 0
    ? project.laborRate
    : null;
  const contractValue = typeof project.contractValue === 'number' && Number.isFinite(project.contractValue) && project.contractValue >= 0
    ? project.contractValue
    : null;
  const estimatedCost = laborRate === null
    ? null
    : project.estimatedLaborHours * laborRate + (project.materialBudget ?? 0) + Math.max(0, project.otherEstimatedCosts ?? 0);
  const profit = contractValue === null ? null : contractValue - actualCost;
  const margin = contractValue && profit !== null ? profit / contractValue * 100 : null;
  return <>
    <div className={styles.financialMetrics}>
      <MetricCard code="CV" label="Contract value" value={contractValue === null ? 'Not set' : money(contractValue)} note={contractValue === null ? 'No commercial value recorded' : 'Recorded preview baseline'} tone={contractValue === null ? 'slate' : 'blue'} />
      <MetricCard code="EC" label="Estimated cost" value={estimatedCost === null ? 'Not set' : money(estimatedCost)} note={estimatedCost === null ? 'Labor rate not recorded' : 'Recorded budget inputs'} tone={estimatedCost === null ? 'slate' : 'green'} />
      <MetricCard code="AC" label="Actual cost" value={money(actualCost)} note="From project cost entries" tone="purple" />
      <MetricCard code="GP" label="Gross profit" value={profit === null ? 'Not available' : money(profit)} note={margin === null ? 'Contract value required' : `${percent(margin)} gross margin`} tone={profit === null ? 'slate' : profit >= 0 ? 'green' : 'red'} />
    </div>
    <div className={styles.detailLayout}>
      <article className={styles.panel}>
        <div className={styles.panelHeader}><div><span>Cost ledger</span><h2>Project cost entries</h2><p>Each source posts once, while financial and operational dimensions remain linked.</p></div></div>
        {project.costEntries.length ? <div className={styles.tableWrap}><table className={styles.costTable}><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Source</th><th>Vendor / Employee</th><th>Amount</th></tr></thead><tbody>{project.costEntries.map((entry) => <tr key={entry.id}><td>{entry.date}</td><td><StatusPill label={entry.costType} tone="blue" /></td><td><strong>{entry.description}</strong><small>{entry.phaseId}</small></td><td>{entry.sourceType} · {entry.sourceId}</td><td>{entry.vendorOrEmployee}</td><td><strong>{money(entry.amount)}</strong></td></tr>)}</tbody></table></div> : <EmptyState title="No cost entries" text="Real source-linked labor, material, and approved expense entries will appear here." />}
      </article>
      <aside className={styles.rightRail}>
        <article className={styles.panel}><div className={styles.panelHeader}><div><span>Actual cost</span><h2>Category breakdown</h2></div></div>{project.costEntries.length ? <div className={styles.breakdownList}>{Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([label, value], index) => <div key={label}><span><i className={styles[`breakdown${index % 5}`]} />{label}</span><strong>{money(value)}</strong><small>{percent(actualCost ? value / actualCost * 100 : 0)}</small></div>)}</div> : <div className={styles.railBody}><strong>No actual costs posted</strong><p>Project financials stay empty until a governed source creates a cost entry.</p></div>}</article>
        <article className={styles.panel}><div className={styles.panelHeader}><div><span>Control status</span><h2>Financial readiness</h2></div></div><div className={styles.auditList}><div><i className={estimatedCost === null ? styles.pendingAudit : ''}>{estimatedCost === null ? '○' : '✓'}</i><span><strong>{estimatedCost === null ? 'Financial baseline not set' : 'Financial baseline available'}</strong><small>{estimatedCost === null ? 'Record approved rate and budget inputs' : 'Derived only from recorded Project inputs'}</small></span></div><div><i className={project.costEntries.length ? '' : styles.pendingAudit}>{project.costEntries.length ? '✓' : '○'}</i><span><strong>{project.costEntries.length ? 'Actual costs posted' : 'No actual costs posted'}</strong><small>{project.costEntries.length ? 'Source-linked Project entries' : 'Awaiting governed operational sources'}</small></span></div><div><i className={styles.pendingAudit}>○</i><span><strong>Final review not recorded</strong><small>Approval status is not assumed</small></span></div></div></article>
      </aside>
    </div>
  </>;
}

function TechnicianView({ project, assignment, canManage, onBack, onStart, onPause, onComplete }: { project: BrowserProject; assignment?: ProjectAssignment; canManage: boolean; onBack: () => void; onStart: () => void; onPause: () => void; onComplete: () => void }) {
  if (!assignment) return <><button type="button" className={styles.backButton} onClick={onBack}>← Back to project</button><article className={styles.panel}><EmptyState title="No assignment selected" text="Create an assignment from the project to preview the technician workflow." /></article></>;
  const phase = project.phases.find((row) => row.id === assignment.phaseId);
  const phaseLabel = phase?.name ?? (assignment.phaseId === GENERAL_PROJECT_WORK_PHASE_ID ? 'General project work' : assignment.phaseId);
  const crewLabel = assignment.technicianIds.length ? assignment.technicianIds.join(' · ') : 'Assigned Van crew';
  const scheduledTime = assignmentTimeLabel(assignment.scheduledStart);
  const posted = Boolean(assignment.postedAt);
  const canonicalLinked = projectAssignmentUsesCanonicalLifecycle(assignment);
  const materialCost = assignmentMaterials.reduce((sum, row) => sum + row.quantity * row.unitCost, 0);
  const laborRate = typeof project.laborRate === 'number' && Number.isFinite(project.laborRate) && project.laborRate >= 0
    ? project.laborRate
    : null;
  const laborCost = laborRate === null ? null : assignment.actualHours * laborRate;
  const totalCost = laborCost === null ? null : laborCost + materialCost;
  const actualMinutes = Math.max(0, Math.round(assignment.actualHours * 60));
  const actualDuration = `${Math.floor(actualMinutes / 60)}h ${actualMinutes % 60}m`;
  const metadata = <div className={styles.jobMeta}><div><span>Customer</span><strong>{project.customerName}</strong><small>{project.location}</small></div><div><span>Phase</span><strong>{phaseLabel}</strong><small>{assignment.phaseId}</small></div><div><span>Assigned van</span><strong>{assignment.vanId.replace('VAN-', 'Van ')}</strong><small>{assignment.workOrderId ?? assignment.id}</small></div><div><span>Technicians</span><strong>{crewLabel}</strong><small>{assignment.technicianIds.length ? `${assignment.technicianIds.length} team member${assignment.technicianIds.length === 1 ? '' : 's'}` : 'Crew comes from canonical Scheduling'}</small></div><div><span>Scheduled</span><strong>{assignmentDateLabel(assignment.scheduledDate)}{scheduledTime ? ` · ${scheduledTime}` : ''}</strong><small>{number(assignment.scheduledHours, 1)} hours · {assignment.scheduledSlots ?? '—'} slots</small></div><div><span>Units planned</span><strong>{assignment.unitsPlanned} {project.unitType}</strong><small>{assignment.unitsCompleted} completed</small></div></div>;
  if (canonicalLinked) {
    const temporaryHold = assignment.bookingStatus === 'temporary_hold';
    const confirmed = assignment.bookingStatus === 'confirmed';
    const canonicalStatus = temporaryHold ? 'Temporary hold' : confirmed ? 'Confirmed' : 'Scheduling linked';
    return <>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb"><button type="button" onClick={onBack}>Projects</button><span>›</span><button type="button" onClick={onBack}>{project.projectNumber}</button><span>›</span><span>{assignment.id}</span></nav>
      <header className={styles.pageHeader}><div><span className={styles.eyebrow}>Scheduling-linked Project Job</span><div className={styles.titleLine}><h1>{project.name}</h1><StatusPill label={canonicalStatus} /></div><p>Read-only Project context for the canonical Appointment and Work Order.</p></div><div className={styles.headerActions}><button type="button" className={styles.secondaryButton} onClick={onBack}>← Back to Project</button></div></header>
      {metadata}
      <div className={styles.infoStrip} role="note"><span>i</span><p>{temporaryHold ? 'This capacity is a Temporary Hold. Confirm it in Scheduling before field execution; no customer confirmation or Project actuals are posted here.' : confirmed ? 'Start, pause, time, materials, evidence, and completion belong to the canonical Technician Portal. Projects does not duplicate or release this Scheduling capacity.' : 'This legacy Project link has no confirmed booking status. Review it in Scheduling before field execution; Projects remains read-only.'}</p></div>
      <div className={styles.headerActions}><a className={styles.secondaryButton} href="/scheduling">Open Scheduling</a>{confirmed ? <a className={styles.primaryButton} href="/field">Open Technician Portal</a> : null}</div>
      <article className={styles.panel}><EmptyState title={temporaryHold ? 'Awaiting confirmation' : confirmed ? 'Execution stays canonical' : 'Scheduling review required'} text={temporaryHold ? 'Confirm or release this hold in Scheduling. Projects retains only the linked planning snapshot.' : confirmed ? 'Use the Technician Portal for real work. Completed actuals can later feed the Project without creating a second operational record.' : 'Resolve this link through Scheduling before a technician starts work.'} /></article>
    </>;
  }
  return <>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><button type="button" onClick={onBack}>Projects</button><span>›</span><button type="button" onClick={onBack}>{project.projectNumber}</button><span>›</span><span>{assignment.id}</span></nav>
    <header className={styles.pageHeader}><div><span className={styles.eyebrow}>Simulated Technician Preview</span><div className={styles.titleLine}><h1>{project.name}</h1><StatusPill label={posted ? 'Completed' : assignment.status} /></div><p>Browser-only simulator for product validation; it is not a canonical Appointment or Work Order.</p></div><div className={styles.headerActions}><button type="button" className={styles.secondaryButton} onClick={onBack}>← Back to Project</button></div></header>
    {metadata}
    <div className={styles.jobActions}><button type="button" className={styles.primaryButton} onClick={onStart} disabled={!canManage || posted || assignment.status === 'In Progress'} title={!canManage ? 'Projects management permission required' : undefined}>▶ Start Job</button><button type="button" className={styles.secondaryButton} onClick={onPause} disabled={!canManage || posted || assignment.status !== 'In Progress'} title={!canManage ? 'Projects management permission required' : undefined}>Ⅱ Pause</button><a href="/inventory">＋ Add Materials</a><a href="/field">▣ Add Photos</a><button type="button" className={styles.dangerButton} onClick={onComplete} disabled={!canManage || posted} title={!canManage ? 'Projects management permission required' : undefined}>✓ {posted ? 'Assignment Posted' : 'Complete Assignment'}</button></div>
    <div className={styles.infoStrip}><span>i</span><p>Scheduled hours remain planned. Completing posts {number(assignment.actualHours, 2)} actual hours and consumed materials exactly once.</p></div>
    <div className={styles.jobGrid}>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>Simulated actuals</span><h2>Time tracking</h2></div><StatusPill label={posted ? 'Posted' : assignment.status} /></div><div className={styles.timeHero}><div><span>Actual hours</span><strong>{actualDuration}</strong></div><div><span>Started at</span><strong>{scheduledTime || 'Not recorded'}</strong></div></div><div className={styles.timeSplit}><div><span>Scheduled</span><strong>{number(assignment.scheduledHours)}h 00m</strong></div><div><span>Remaining</span><strong>{number(Math.max(0, assignment.scheduledHours - assignment.actualHours), 2)}h</strong></div></div></article>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>From {assignment.vanId.replace('VAN-', 'Van ')}</span><h2>Materials used</h2></div><b>{assignmentMaterials.length} items</b></div><div className={styles.materialLines}>{assignmentMaterials.map((row) => <div key={row.item}><span><strong>{row.item}</strong><small>{row.unit}</small></span><b>{number(row.quantity, 2)}</b><em>{money(row.quantity * row.unitCost)}</em></div>)}</div></article>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>Assignment impact</span><h2>Actual project cost</h2></div></div><dl className={styles.impactList}><div><dt>Labor used</dt><dd>{number(assignment.actualHours, 2)}h</dd></div><div><dt>Labor cost</dt><dd>{optionalMoney(laborCost)}</dd></div><div><dt>Materials added</dt><dd>{money(materialCost)}</dd></div><div className={styles.impactTotal}><dt>Total cost</dt><dd>{totalCost === null ? 'Not available' : money(totalCost)}</dd></div></dl><small className={styles.idempotencyNote}>{posted ? `Posted ${assignment.postedAt ? new Date(assignment.postedAt).toLocaleString() : ''}. Repeating completion creates no duplicate.` : laborRate === null ? 'Completion records actual labor without creating a labor cost because this Project has no recorded labor rate.' : 'Completion creates source-linked cost entries and marks this assignment posted.'}</small></article>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>Units</span><h2>Completed on site</h2></div><b>{assignment.unitsCompleted} of {assignment.unitsPlanned}</b></div><div className={styles.unitStatus}><strong>{assignment.unitsCompleted}</strong><span>complete</span><ProgressBar value={assignment.unitsPlanned ? assignment.unitsCompleted / assignment.unitsPlanned * 100 : 0} tone="green" label={`${percent(assignment.unitsPlanned ? assignment.unitsCompleted / assignment.unitsPlanned * 100 : 0)} of assignment`} /></div></article>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>Field quality</span><h2>Issue found</h2></div><StatusPill label="Open" tone="red" /></div><div className={styles.issueBox}><strong>Insufficient ceiling space in Exam Room 2</strong><p>Requires re-routing of drain pipe. Reported by Kevin Luis.</p><a href="/field">Open field issue →</a></div></article>
      <article className={styles.panel}><div className={styles.panelHeader}><div><span>Evidence</span><h2>Photos</h2></div><b>4</b></div><div className={styles.photoGrid}>{['Copper lines', 'Piping', 'Indoor unit', 'Outdoor unit'].map((label, index) => <div key={label} className={styles[`photo${index + 1}`]}><span>{label}</span></div>)}</div></article>
    </div>
  </>;
}

type CreateProjectDialogProps = {
  references: BookingMasterReferenceData | null;
  loading: boolean;
  loadError: string;
  saving: boolean;
  saveError: string;
  onRetry: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

function CreateProjectDialog({ references, loading, loadError, saving, saveError, onRetry, onClose, onSubmit }: CreateProjectDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [projectType, setProjectType] = useState('Installation Project');
  const [workDays, setWorkDays] = useState('10');
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [createCustomer, setCreateCustomer] = useState(false);
  const [customerRequestId] = useState(() => createOfficeLifecycleRequestId('projects-customer-create'));
  const parsedWorkDays = Number(workDays);
  const validWorkDays = Number.isInteger(parsedWorkDays) && parsedWorkDays > 0;
  const capacity = validWorkDays ? projectCapacityPlan(parsedWorkDays) : null;
  const exactCustomers = exactCustomerMatches(references, customerQuery);
  const exactCustomer = exactCustomers.length === 1 ? exactCustomers[0] : undefined;
  const ambiguousCustomer = exactCustomers.length > 1;
  const selectedCustomer = references?.clients.find((customer) => customer.id === selectedCustomerId);
  const resolvedCustomer = selectedCustomer ?? exactCustomer;
  const results = useMemo(() => matchingCustomers(references, customerQuery), [customerQuery, references]);
  const customerProperties = propertiesForCustomer(references, resolvedCustomer?.id ?? '');
  const canOfferCreate = customerQuery.trim().length >= 2 && exactCustomers.length === 0 && !loading && !loadError;
  const customerReady = Boolean(resolvedCustomer || createCustomer);

  const chooseCustomer = (customer: BookingCustomer) => {
    setCustomerQuery(customerLabel(customer));
    setSelectedCustomerId(customer.id);
    setCreateCustomer(false);
  };

  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), a[href]')];
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

  return <div className={styles.overlay} role="presentation">
    <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="create-project-title" aria-describedby="create-project-description" onKeyDown={keepFocusInside}>
      <header>
        <div><span>Projects · CRM + Scheduling</span><h2 id="create-project-title">Create Project</h2><p id="create-project-description">Create a project draft linked to the same customer identity used by Scheduling.</p></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Close create project dialog">×</button>
      </header>
      <form onSubmit={onSubmit}>
        <div className={styles.formGrid}>
          <label className={styles.wide}><span>Project name *</span><input name="name" required autoFocus defaultValue="Marquis Apartments" /></label>

          <div className={`${styles.customerPicker} ${styles.wide}`}>
            <label htmlFor="project-customer-search"><span>Customer name *</span></label>
            <input
              id="project-customer-search"
              name="customerName"
              value={customerQuery}
              required
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={Boolean(customerQuery.trim() && !selectedCustomerId && !createCustomer)}
              aria-controls="project-customer-results"
              aria-describedby="project-customer-help"
              placeholder={loading ? 'Loading customers from CRM…' : 'Start typing a customer name…'}
              onChange={(event) => {
                setCustomerQuery(event.target.value);
                setSelectedCustomerId('');
                setCreateCustomer(false);
              }}
            />
            <input type="hidden" name="customerId" value={resolvedCustomer?.id ?? ''} />
            <input type="hidden" name="customerAction" value={createCustomer ? 'create' : resolvedCustomer ? 'select' : ''} />
            <input type="hidden" name="customerRequestId" value={customerRequestId} />
            <small id="project-customer-help" className={styles.fieldHelp}>
              {loading ? 'Searching the canonical clients and properties used by Scheduling…'
                : loadError ? 'Customer search is unavailable; retry before saving.'
                  : ambiguousCustomer ? 'More than one active CRM customer has this exact name. Select the correct record below.'
                    : resolvedCustomer ? `Existing CRM customer selected · ${resolvedCustomer.id}`
                    : createCustomer ? `New canonical customer: ${customerQuery.trim()}`
                      : 'Select an existing customer or explicitly create a new one.'}
            </small>

            {loadError ? <div className={styles.inlineError} role="alert"><span>{loadError}</span><button type="button" onClick={onRetry}>Retry CRM</button></div> : null}
            {!selectedCustomerId && !createCustomer && customerQuery.trim() && !loading && !loadError ? <div id="project-customer-results" className={styles.customerResults} role="listbox" aria-label="Customer search results">
              {results.map((customer) => {
                const property = propertiesForCustomer(references, customer.id)[0];
                return <button key={customer.id} type="button" role="option" aria-selected={resolvedCustomer?.id === customer.id} onClick={() => chooseCustomer(customer)}>
                  <span><strong>{customerLabel(customer)}</strong><small>{text(customer.company) && text(customer.company) !== customerLabel(customer) ? customer.company : text(customer.phone) || text(customer.email) || customer.id}</small></span>
                  <em>{text(property?.address) || text(customer.zone) || 'No property yet'}</em>
                </button>;
              })}
              {canOfferCreate ? <button type="button" className={styles.createCustomerOption} onClick={() => { setSelectedCustomerId(''); setCreateCustomer(true); }}>
                <span><strong>＋ Create “{customerQuery.trim()}”</strong><small>No exact CRM customer selected</small></span><em>New customer</em>
              </button> : null}
              {!results.length && !canOfferCreate ? <p>No matching customer.</p> : null}
            </div> : null}
          </div>

          {createCustomer ? <>
            <label><span>Customer phone / WhatsApp *</span><input name="customerPhone" type="tel" required placeholder="+297 5XX XXXX" /></label>
            <label><span>Customer email · optional</span><input name="customerEmail" type="email" placeholder="name@example.com" /></label>
          </> : null}

          {resolvedCustomer && customerProperties.length ? <label className={styles.wide}><span>Property / service location</span><select name="propertyId" defaultValue={customerProperties.length === 1 ? customerProperties[0].id : ''} key={resolvedCustomer.id}><option value="">Select later — project remains Draft</option>{customerProperties.map((property) => <option key={property.id} value={property.id}>{text(property.name) || 'Property'} · {text(property.address) || text(property.zone) || property.id}</option>)}</select></label> : null}
          {resolvedCustomer && !customerProperties.length ? <div className={`${styles.inlineNote} ${styles.wide}`}>This customer has no Property yet. The project can remain Draft, but Scheduling will require a service location.</div> : null}

          <label><span>Project type</span><select name="type" value={projectType} onChange={(event) => setProjectType(event.target.value)}><option>Installation Project</option><option>Service Project</option><option>VRF Project</option><option>Maintenance Contract</option></select></label>
          <label><span>Total units</span><input name="units" type="number" min="1" step="1" defaultValue="18" /></label>
          <label><span>Start date</span><input name="startsOn" type="date" defaultValue="2026-09-07" /></label>
          <label><span>Estimated completion</span><input name="endsOn" type="date" defaultValue="2026-10-16" /></label>
          <label><span>Estimated work days *</span><input name="workDays" type="number" min="1" step="1" required value={workDays} onChange={(event) => setWorkDays(event.target.value)} /></label>
          <label><span>Available slots per work day</span><input value={capacity?.slotsPerWorkDay ?? ''} readOnly aria-label="Available slots per work day" /></label>
          <label><span>Estimated slots</span><input name="estimatedSlots" value={capacity?.estimatedSlots ?? ''} readOnly aria-label="Estimated slots" /></label>
          <label><span>Labor budget (hours)</span><input name="laborHours" value={capacity?.estimatedLaborHours ?? ''} readOnly aria-label="Labor budget hours" /></label>
          <label className={styles.wide}><span>Technician instructions · optional</span><textarea name="technicianInstructions" rows={4} placeholder="Access, equipment, safety, or site instructions for every project visit…" /></label>
          {projectTypeUsesMaterialBudget(projectType) ? <label className={styles.wide}><span>Material budget (Afl.) · optional</span><input name="materialBudget" type="number" min="0" step="0.01" placeholder="No material budget set" /></label> : <div className={`${styles.inlineNote} ${styles.wide}`}>Service projects do not request a material budget. Material expenses can still be tracked as actual cost.</div>}
        </div>
        <div className={styles.dataRule}><strong>ONE CUSTOMER ID · ONE SCHEDULING CAPACITY RULE</strong><p>Customer search and creation use the canonical CRM shared with Scheduling. Six one-hour capacity slots are available per normal van-day, so work days automatically determine estimated slots and operational labor hours. All amounts are in Aruban florins (Afl.).</p></div>
        {saveError ? <div className={styles.formError} role="alert">{saveError}</div> : null}
        <footer><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={saving || loading || Boolean(loadError) || !customerReady || !validWorkDays}>{saving ? 'Saving…' : 'Save Draft'}</button></footer>
      </form>
    </section>
  </div>;
}

type EditProjectDialogProps = {
  project: BrowserProject;
  references: BookingMasterReferenceData | null;
  loading: boolean;
  loadError: string;
  saveError: string;
  onRetry: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function EditProjectDialog({ project, references, loading, loadError, saveError, onRetry, onClose, onSubmit }: EditProjectDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [projectType, setProjectType] = useState(project.type);
  const [workDays, setWorkDays] = useState(String(project.estimatedWorkDays));
  const [propertyId, setPropertyId] = useState(project.siteId);
  const structureLocked = projectHasOperationalActivity(project);
  const parsedWorkDays = Number(workDays);
  const validWorkDays = Number.isInteger(parsedWorkDays) && parsedWorkDays > 0;
  const capacity = validWorkDays ? projectCapacityPlan(parsedWorkDays) : null;
  const committedHours = project.actualLaborHours + project.scheduledFutureHours;
  const hoursPerVanDay = project.slotsPerWorkDay * project.slotDurationMinutes / 60;
  const minimumWorkDays = Math.max(1, Math.ceil(committedHours / hoursPerVanDay));
  const customerProperties = propertiesForCustomer(references, project.customerId);
  const currentPropertyListed = customerProperties.some((property) => property.id === project.siteId);
  const propertyLinkUnavailable = !structureLocked
    && Boolean(references)
    && !loading
    && !loadError
    && Boolean(propertyId)
    && !customerProperties.some((property) => property.id === propertyId);

  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), a[href]')];
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

  return <div className={styles.overlay} role="presentation">
    <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="edit-project-title" aria-describedby="edit-project-description" onKeyDown={keepFocusInside}>
      <header>
        <div><span>{project.projectNumber} · Project controls</span><h2 id="edit-project-title">Edit Project</h2><p id="edit-project-description">Update the project plan and the default instructions used for future technician visits.</p></div>
        <button type="button" onClick={onClose} aria-label="Close edit project dialog">×</button>
      </header>
      <form onSubmit={onSubmit}>
        <div className={styles.formGrid}>
          <label className={styles.wide}><span>Project name *</span><input name="name" required autoFocus defaultValue={project.name} /></label>
          <label><span>Project number</span><input value={project.projectNumber} readOnly tabIndex={-1} /></label>
          <label><span>Customer · locked identity</span><input value={project.customerName} readOnly tabIndex={-1} /></label>

          {structureLocked ? <label className={styles.wide}><span>Property / service location · locked after operational activity</span><input value={project.location} readOnly /></label> : <label className={styles.wide}><span>Property / service location</span><select name="propertyId" value={propertyId} disabled={loading || Boolean(loadError)} onChange={(event) => setPropertyId(event.target.value)}><option value="">Select later — Project remains without a service location</option>{project.siteId && !currentPropertyListed ? <option value={project.siteId}>{project.location} · current link unavailable in CRM</option> : null}{customerProperties.map((property) => <option key={property.id} value={property.id}>{text(property.name) || 'Property'} · {text(property.address) || text(property.zone) || property.id}</option>)}</select></label>}
          {!structureLocked && loading ? <div className={`${styles.inlineNote} ${styles.wide}`}>Loading this customer’s canonical Service Properties…</div> : null}
          {!structureLocked && loadError ? <div className={`${styles.inlineError} ${styles.wide}`} role="alert"><span>{loadError}</span><button type="button" onClick={onRetry}>Retry CRM</button></div> : null}
          {propertyLinkUnavailable ? <div className={`${styles.inlineError} ${styles.wide}`} role="alert"><span>The current Service Property is inactive or unavailable. Choose an active property or “Select later” before saving.</span></div> : null}

          <label><span>Project type</span><select name="type" value={projectType} disabled={structureLocked} onChange={(event) => setProjectType(event.target.value)}>{projectTypeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label><span>Status{structureLocked ? ' · use lifecycle controls after scheduling starts' : ''}</span><select name="status" defaultValue={project.status} disabled={project.status === 'Completed' || structureLocked}>{project.status === 'Completed' ? <option>Completed</option> : projectEditStatusOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label><span>Priority</span><select name="priority" defaultValue={project.priority}>{projectPriorityOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label><span>Total units *</span><input name="totalUnits" type="number" min={project.completedUnits} step="1" required defaultValue={project.totalUnits} /></label>
          <label><span>Start date *</span><input name="startsOn" type="date" required defaultValue={project.startsOn} /></label>
          <label><span>Estimated completion *</span><input name="estimatedCompletionOn" type="date" required defaultValue={project.estimatedCompletionOn} /></label>
          <label><span>Estimated work days *</span><input name="estimatedWorkDays" type="number" min={minimumWorkDays} step="1" required value={workDays} onChange={(event) => setWorkDays(event.target.value)} /></label>
          <label><span>Available slots per work day</span><input value={capacity?.slotsPerWorkDay ?? ''} readOnly tabIndex={-1} aria-label="Available slots per work day" /></label>
          <label><span>Estimated slots</span><input value={capacity?.estimatedSlots ?? ''} readOnly tabIndex={-1} aria-label="Estimated slots" /></label>
          <label><span>Labor budget (hours)</span><input value={capacity?.estimatedLaborHours ?? ''} readOnly tabIndex={-1} aria-label="Labor budget hours" /></label>
          <label className={styles.wide}><span>Technician instructions · default for future visits</span><textarea name="technicianInstructions" rows={5} maxLength={2000} defaultValue={project.technicianInstructions ?? ''} placeholder="Access, equipment, safety, contact, or site instructions…" /></label>
          {projectTypeUsesMaterialBudget(projectType) ? <label className={styles.wide}><span>Material budget (Afl.) · optional</span><input name="materialBudget" type="number" min="0" step="0.01" defaultValue={project.materialBudget ?? ''} placeholder="No material budget set" /></label> : <div className={`${styles.inlineNote} ${styles.wide}`}>Service projects do not require a material budget. Actual material expenses remain traceable.</div>}
        </div>
        {structureLocked ? <div className={styles.dataRule}><strong>OPERATIONAL IDENTITY PROTECTED</strong><p>Customer, Project type, Service Property, and lifecycle status are locked because this Project already has scheduled work or actual cost. Name, dates, plan, priority, and future technician instructions can still be updated.</p></div> : null}
        <div className={styles.dataRule}><strong>FUTURE SCHEDULING VISITS</strong><p>Scheduling loads the latest Project name, type, property, and technician instructions for a new visit. Existing Appointments and Work Orders keep the historical details captured when they were created.</p></div>
        {committedHours > 0 ? <div className={styles.inlineNote}>The labor plan cannot be reduced below {number(committedHours, 1)} committed hours ({number(project.actualLaborHours, 1)} actual + {number(project.scheduledFutureHours, 1)} scheduled).</div> : null}
        {saveError ? <div className={styles.formError} role="alert">{saveError}</div> : null}
        <footer><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={!validWorkDays || propertyLinkUnavailable}>Save changes</button></footer>
      </form>
    </section>
  </div>;
}

function ExpenseReviewDrawer({ project, expense, canManage, onClose, onConfirm }: { project: BrowserProject; expense: BrowserProject['expenses'][number]; canManage: boolean; onClose: () => void; onConfirm: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const phase = project.phases.find((row) => row.id === expense.phaseId);
  useEffect(() => {
    drawerRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, []);
  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !drawerRef.current) return;
    const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
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
  return <div className={styles.overlay} role="presentation">
    <aside ref={drawerRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="expense-review-title" aria-describedby="expense-review-description" onKeyDown={keepFocusInside}>
      <header><div><span>AI suggestion · Simulated preview</span><h2 id="expense-review-title">AI Expense Review</h2><p id="expense-review-description">Review source evidence and confirm the project-cost link.</p></div><button type="button" onClick={onClose} aria-label="Close AI expense review">×</button></header>
      <div className={styles.drawerBody}>
        <section className={styles.receipt}><span>A1 HARDWARE ARUBA</span><small>Oranjestad, Aruba</small><hr /><p>Receipt #: 0045128</p><p>Box of galvanized nails</p><strong>TOTAL &nbsp; {money(expense.amount)}</strong><small>Paid by Card</small></section>
        <section className={styles.aiFields}><div className={styles.aiIntro}><span>AI interpretation</span><StatusPill label={`${expense.confidence ?? 0}% confidence`} tone="green" /></div><label><span>Vendor</span><input value={expense.vendor} readOnly /></label><label><span>Amount</span><input value={money(expense.amount)} readOnly /></label><label><span>Suggested project</span><input value={project.name} readOnly /></label><label><span>Suggested cost type</span><input value={expense.costType} readOnly /></label><label><span>Phase</span><input value={phase?.name ?? expense.phaseId} readOnly /></label><div className={styles.confidence}><span>Confidence score</span><strong>{expense.confidence ?? 0}%</strong><ProgressBar value={expense.confidence ?? 0} tone="green" /></div></section>
        <section className={styles.accountingRule}><span>✓</span><div><strong>One transaction. One post. No duplication.</strong><p>Confirmation updates the operational project dimension and creates one source-linked cost entry. It does not simulate an accounting ledger.</p></div></section>
      </div>
      <footer><button type="button" className={styles.secondaryButton} onClick={onClose}>Reject for now</button><button type="button" className={styles.secondaryButton} disabled title="Detail editing follows owner validation">Edit Details</button><button type="button" className={styles.primaryButton} onClick={onConfirm} disabled={!canManage} title={canManage ? 'Confirm and link this expense' : 'Projects management permission required'}>Confirm & Link</button></footer>
    </aside>
  </div>;
}
