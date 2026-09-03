import { defaultSchedulingSettings } from './scheduling';
import { loadBrowserValue, saveBrowserValue } from './browser-store';

export const BROWSER_PROJECTS_PREVIEW_KEY = 'demac.erp-next.projects.preview.v1';
export const BROWSER_PROJECTS_PREVIEW_WRITE_LOCK = 'demac-projects-preview-write';
export const PROJECT_CAPACITY_SLOT_MINUTES = 60;
export const GENERAL_PROJECT_WORK_PHASE_ID = 'GENERAL-PROJECT-WORK';

export function projectCapacityPlan(estimatedWorkDays: number) {
  if (!Number.isFinite(estimatedWorkDays) || estimatedWorkDays <= 0 || !Number.isInteger(estimatedWorkDays)) {
    throw new Error('Estimated work days must be a positive whole number.');
  }
  const slotsPerWorkDay = defaultSchedulingSettings.serviceStartTimes.length;
  const estimatedSlots = estimatedWorkDays * slotsPerWorkDay;
  return {
    estimatedWorkDays,
    slotsPerWorkDay,
    slotDurationMinutes: PROJECT_CAPACITY_SLOT_MINUTES,
    estimatedSlots,
    estimatedLaborHours: estimatedSlots * PROJECT_CAPACITY_SLOT_MINUTES / 60,
  };
}

export function projectTypeUsesMaterialBudget(projectType: string) {
  return projectType.trim().toLocaleLowerCase('en') !== 'service project';
}

export function normalizeOptionalMaterialBudget(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '' || normalized === null || normalized === undefined) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Material budget must be a valid non-negative AWG amount.');
  }
  return amount === 0 ? null : amount;
}

export type ProjectStatus = 'Draft' | 'Planned' | 'Active' | 'On Hold' | 'Near Completion' | 'Completed' | 'Cancelled';
export type ProjectHealth = 'On Track' | 'At Risk' | 'Over Budget';
export type PhaseStatus = 'Completed' | 'In Progress' | 'Planned' | 'Delayed';
export type MaterialUsageStatus = 'Used' | 'Returned' | 'Damaged' | 'Wasted' | 'Lost';

export type ProjectPhase = {
  id: string;
  name: string;
  status: PhaseStatus;
  estimatedLaborHours: number;
  actualLaborHours: number;
  estimatedMaterialCost: number;
  actualMaterialCost: number;
  unitsPlanned: number;
  unitsCompleted: number;
  progress: number;
  startsOn: string;
  endsOn: string;
};

export type ProjectMaterialUsage = {
  id: string;
  date: string;
  item: string;
  quantity: number;
  unit: string;
  unitCost: number;
  source: 'Van Inventory' | 'Warehouse' | 'External Purchase';
  van: string;
  technician: string;
  assignmentId: string;
  phaseId: string;
  status: MaterialUsageStatus;
};

export type ProjectExpense = {
  id: string;
  date: string;
  vendor: string;
  description: string;
  amount: number;
  costType: 'Purchased Material' | 'Equipment' | 'Transportation' | 'Other';
  phaseId: string;
  source: 'Receipt · AI' | 'Invoice' | 'Bill' | 'Card Import';
  status: 'Pending Review' | 'Approved' | 'Rejected';
  confidence?: number;
};

export type ProjectCostEntry = {
  id: string;
  date: string;
  costType: 'Labor' | 'Inventory Material' | 'Purchased Material' | 'Equipment' | 'Transportation' | 'Other';
  sourceType: 'Work Log' | 'Material Usage' | 'Expense';
  sourceId: string;
  description: string;
  amount: number;
  phaseId: string;
  vendorOrEmployee: string;
};

export type ProjectAssignment = {
  id: string;
  projectId: string;
  phaseId: string;
  vanId: string;
  technicianIds: string[];
  scheduledHours: number;
  actualHours: number;
  unitsPlanned: number;
  unitsCompleted: number;
  status: 'Scheduled' | 'In Progress' | 'Paused' | 'Completed';
  postedAt?: string;
  appointmentId?: string;
  workOrderId?: string;
  bookingStatus?: 'temporary_hold' | 'confirmed';
  scheduledSlots?: number;
  scheduledDate?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
};

export type BrowserProject = {
  id: string;
  projectNumber: string;
  name: string;
  customerId: string;
  customerName: string;
  siteId: string;
  location: string;
  contactPerson: string;
  type: string;
  description: string;
  technicianInstructions?: string;
  status: ProjectStatus;
  priority: 'Low' | 'Normal' | 'High' | 'Critical';
  managerId: string;
  managerName: string;
  contractValue?: number;
  laborRate?: number;
  otherEstimatedCosts?: number;
  startsOn: string;
  estimatedCompletionOn: string;
  totalUnits: number;
  completedUnits: number;
  unitType: string;
  estimatedWorkDays: number;
  slotsPerWorkDay: number;
  slotDurationMinutes: number;
  estimatedSlots: number;
  estimatedLaborHours: number;
  scheduledFutureHours: number;
  actualLaborHours: number;
  materialBudget: number | null;
  materialActual: number;
  assignedVans: string[];
  phases: ProjectPhase[];
  materials: ProjectMaterialUsage[];
  expenses: ProjectExpense[];
  costEntries: ProjectCostEntry[];
  assignments: ProjectAssignment[];
};

export type BrowserProjectsPreviewState = {
  version: 1;
  selectedProjectId: string;
  projects: BrowserProject[];
};

export type BrowserProjectsPreviewTransactionOptions = {
  authorize?: () => void;
  read?: () => BrowserProjectsPreviewState;
  write?: (state: BrowserProjectsPreviewState) => boolean;
  runExclusive?: (operation: () => BrowserProjectsPreviewState) => Promise<BrowserProjectsPreviewState>;
};

export type ProjectSchedulingPlan = {
  scheduledHours: number;
  scheduledSlots: number;
  remainingHoursBefore: number;
  remainingHoursAfter: number;
};

export type ProjectSchedulingLinkInput = {
  projectId: string;
  customerId: string;
  siteId: string;
  phaseId: string;
  appointmentId: string;
  workOrderId: string;
  bookingStatus: 'temporary_hold' | 'confirmed';
  vanId: string;
  technicianIds?: string[];
  scheduledSlots: number;
  unitsPlanned?: number;
  scheduledDate?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
};

export type BrowserProjectEditInput = {
  projectId: string;
  name: string;
  type: string;
  siteId: string;
  location: string;
  status: ProjectStatus;
  priority: BrowserProject['priority'];
  totalUnits: number;
  materialBudget: number | null;
  startsOn: string;
  estimatedCompletionOn: string;
  estimatedWorkDays: number;
  technicianInstructions?: string;
};

const phases: ProjectPhase[] = [
  { id: 'PH-01', name: 'Site Preparation', status: 'Completed', estimatedLaborHours: 8, actualLaborHours: 8, estimatedMaterialCost: 450, actualMaterialCost: 420, unitsPlanned: 1, unitsCompleted: 1, progress: 100, startsOn: 'Aug 4', endsOn: 'Aug 6' },
  { id: 'PH-02', name: 'Preinstallation', status: 'Completed', estimatedLaborHours: 12, actualLaborHours: 11, estimatedMaterialCost: 750, actualMaterialCost: 720, unitsPlanned: 2, unitsCompleted: 2, progress: 100, startsOn: 'Aug 6', endsOn: 'Aug 9' },
  { id: 'PH-03', name: 'Copper / Piping', status: 'Completed', estimatedLaborHours: 20, actualLaborHours: 18, estimatedMaterialCost: 2200, actualMaterialCost: 2140, unitsPlanned: 3, unitsCompleted: 3, progress: 100, startsOn: 'Aug 9', endsOn: 'Aug 16' },
  { id: 'PH-04', name: 'Indoor Installation', status: 'In Progress', estimatedLaborHours: 28, actualLaborHours: 21, estimatedMaterialCost: 1600, actualMaterialCost: 1370, unitsPlanned: 3, unitsCompleted: 1, progress: 60, startsOn: 'Aug 16', endsOn: 'Aug 28' },
  { id: 'PH-05', name: 'Outdoor Installation', status: 'Planned', estimatedLaborHours: 16, actualLaborHours: 4, estimatedMaterialCost: 900, actualMaterialCost: 500, unitsPlanned: 1, unitsCompleted: 0, progress: 20, startsOn: 'Aug 28', endsOn: 'Sep 3' },
  { id: 'PH-06', name: 'Electrical', status: 'Planned', estimatedLaborHours: 14, actualLaborHours: 2, estimatedMaterialCost: 650, actualMaterialCost: 300, unitsPlanned: 1, unitsCompleted: 0, progress: 10, startsOn: 'Sep 3', endsOn: 'Sep 8' },
  { id: 'PH-07', name: 'Vacuum / Testing', status: 'Planned', estimatedLaborHours: 12, actualLaborHours: 1, estimatedMaterialCost: 300, actualMaterialCost: 0, unitsPlanned: 1, unitsCompleted: 0, progress: 0, startsOn: 'Sep 8', endsOn: 'Sep 11' },
  { id: 'PH-08', name: 'Commissioning', status: 'Planned', estimatedLaborHours: 10, actualLaborHours: 1, estimatedMaterialCost: 150, actualMaterialCost: 0, unitsPlanned: 0, unitsCompleted: 0, progress: 0, startsOn: 'Sep 11', endsOn: 'Sep 14' },
];

const materials: ProjectMaterialUsage[] = [
  { id: 'MU-1041', date: 'Aug 18', item: 'Copper Pipe 3/8”', quantity: 50, unit: 'm', unitCost: 12, source: 'Van Inventory', van: 'Van 2', technician: 'Miguel Reyes', assignmentId: 'ASG-1041', phaseId: 'PH-04', status: 'Used' },
  { id: 'MU-1042', date: 'Aug 18', item: 'Electrical Cable 4×1.5mm²', quantity: 80, unit: 'm', unitCost: 4.25, source: 'Van Inventory', van: 'Van 2', technician: 'Miguel Reyes', assignmentId: 'ASG-1041', phaseId: 'PH-04', status: 'Used' },
  { id: 'MU-1043', date: 'Aug 19', item: 'VRF Branch Selector', quantity: 2, unit: 'pcs', unitCost: 780, source: 'Warehouse', van: 'Van 5', technician: 'Ronald Mauri', assignmentId: 'ASG-1042', phaseId: 'PH-04', status: 'Used' },
  { id: 'MU-1044', date: 'Aug 20', item: 'Drain Pipe PVC 25mm', quantity: 30, unit: 'm', unitCost: 5, source: 'Van Inventory', van: 'Van 2', technician: 'Miguel Reyes', assignmentId: 'ASG-1043', phaseId: 'PH-04', status: 'Used' },
  { id: 'MU-1045', date: 'Aug 21', item: 'Insulation 1/2”', quantity: 20, unit: 'm', unitCost: 8.5, source: 'External Purchase', van: '—', technician: 'Edwin Calvo', assignmentId: 'ASG-1044', phaseId: 'PH-04', status: 'Used' },
  { id: 'MU-1046', date: 'Aug 21', item: 'Copper Pipe 1/4”', quantity: 12, unit: 'm', unitCost: 9.5, source: 'Van Inventory', van: 'Van 2', technician: 'Miguel Reyes', assignmentId: 'ASG-1044', phaseId: 'PH-04', status: 'Returned' },
  { id: 'MU-1047', date: 'Aug 22', item: 'Wall Brackets', quantity: 2, unit: 'pcs', unitCost: 36, source: 'External Purchase', van: '—', technician: 'Edwin Calvo', assignmentId: 'ASG-1045', phaseId: 'PH-04', status: 'Damaged' },
];

const expenses: ProjectExpense[] = [
  { id: 'EXP-1088', date: 'Aug 28', vendor: 'A1 Hardware Aruba', description: 'Box of galvanized nails', amount: 100, costType: 'Purchased Material', phaseId: 'PH-04', source: 'Receipt · AI', status: 'Pending Review', confidence: 98 },
  { id: 'EXP-1082', date: 'Aug 24', vendor: 'CoolTech Aruba', description: 'VRF branch selector boxes', amount: 1380, costType: 'Equipment', phaseId: 'PH-04', source: 'Bill', status: 'Approved' },
  { id: 'EXP-1079', date: 'Aug 20', vendor: 'Aruba Freight Services', description: 'Delivery — VRF units', amount: 420, costType: 'Transportation', phaseId: 'PH-02', source: 'Invoice', status: 'Approved' },
  { id: 'EXP-1075', date: 'Aug 17', vendor: 'Tech Supply Aruba', description: 'Insulation — Armaflex 1/2”', amount: 312.45, costType: 'Purchased Material', phaseId: 'PH-03', source: 'Receipt · AI', status: 'Approved' },
];

export function createProjectsPreviewState(): BrowserProjectsPreviewState {
  const baselineCapacity = projectCapacityPlan(20);
  const project: BrowserProject = {
    id: 'DEMO-PRJ-VRF-001', projectNumber: 'PRJ-1007', name: 'Veterinaria Aruba VRF Installation', customerId: 'DEMO-CUS-VET-001', customerName: 'Veterinaria Aruba', siteId: 'DEMO-SITE-VET-NOORD', location: 'Noord, Aruba', contactPerson: 'Juan Richard Martinez', type: 'VRF Project', description: 'Design and installation of a VRF HVAC system for a new veterinary clinic.', status: 'Active', priority: 'High', managerId: 'DEMO-EMP-PM-001', managerName: 'Christian Marquez', contractValue: 48750, laborRate: 56, otherEstimatedCosts: 16845, startsOn: '2026-08-04', estimatedCompletionOn: '2026-09-30', totalUnits: 12, completedUnits: 7, unitType: 'VRF Units', ...baselineCapacity, scheduledFutureHours: 24, actualLaborHours: 66, materialBudget: 7000, materialActual: 5450, assignedVans: ['VAN-1', 'VAN-2', 'VAN-5'], phases: structuredClone(phases), materials: structuredClone(materials), expenses: structuredClone(expenses),
    costEntries: [
      { id: 'CE-LABOR-001', date: 'Aug 26', costType: 'Labor', sourceType: 'Work Log', sourceId: 'WL-1048', description: 'Certified technician labor through Aug 26', amount: 3696, phaseId: 'PH-04', vendorOrEmployee: 'Project Crew' },
      { id: 'CE-MATERIAL-001', date: 'Aug 26', costType: 'Inventory Material', sourceType: 'Material Usage', sourceId: 'MU-BATCH-001', description: 'Consumed inventory materials through Aug 26', amount: 5137.55, phaseId: 'PH-04', vendorOrEmployee: 'DEMAC Inventory' },
      { id: 'CE-EXP-1075', date: 'Aug 17', costType: 'Purchased Material', sourceType: 'Expense', sourceId: 'EXP-1075', description: 'Insulation — Armaflex 1/2”', amount: 312.45, phaseId: 'PH-03', vendorOrEmployee: 'Tech Supply Aruba' },
      { id: 'CE-EXP-1082', date: 'Aug 24', costType: 'Equipment', sourceType: 'Expense', sourceId: 'EXP-1082', description: 'VRF branch selector boxes', amount: 1380, phaseId: 'PH-04', vendorOrEmployee: 'CoolTech Aruba' },
      { id: 'CE-TRANSPORT-001', date: 'Aug 20', costType: 'Transportation', sourceType: 'Expense', sourceId: 'EXP-1079', description: 'Delivery — VRF units', amount: 420, phaseId: 'PH-02', vendorOrEmployee: 'Aruba Freight Services' },
      { id: 'CE-OTHER-001', date: 'Aug 21', costType: 'Other', sourceType: 'Expense', sourceId: 'EXP-OTHER-001', description: 'Site access and equipment rental', amount: 425, phaseId: 'PH-01', vendorOrEmployee: 'Multiple' },
    ],
    assignments: [{ id: 'ASG-1052', projectId: 'DEMO-PRJ-VRF-001', phaseId: 'PH-04', vanId: 'VAN-2', technicianIds: ['DEMO-EMP-KEVIN', 'DEMO-EMP-WALTER'], scheduledHours: 4, actualHours: 155 / 60, unitsPlanned: 3, unitsCompleted: 2, status: 'In Progress' }],
  };
  const portfolio: BrowserProject[] = [
    project,
    { ...project, id: 'DEMO-PRJ-SVC-002', projectNumber: 'PRJ-1001', name: 'Renaissance HVAC Service 2026', customerId: 'DEMO-CUS-RWC-001', customerName: 'Renaissance Wind Creek', siteId: 'DEMO-SITE-RWC-ORANJESTAD', location: 'Oranjestad, Aruba', contactPerson: 'Facilities Office', type: 'Service Project', description: 'Annual HVAC service program for the Renaissance Wind Creek property.', contractValue: undefined, laborRate: undefined, otherEstimatedCosts: undefined, status: 'Active', completedUnits: 68, totalUnits: 100, actualLaborHours: 78, materialBudget: null, materialActual: 42500, assignedVans: ['VAN-1', 'VAN-2', 'VAN-4'], phases: [], materials: [], expenses: [], costEntries: [], assignments: [] },
    { ...project, ...projectCapacityPlan(16), id: 'DEMO-PRJ-INSTALL-003', projectNumber: 'PRJ-1002', name: 'New Apartment Complex HVAC Installation', customerId: 'DEMO-CUS-MRE-001', customerName: 'Marquez Real Estate', siteId: 'DEMO-SITE-MRE-NOORD', location: 'Noord, Aruba', contactPerson: 'Project Office', type: 'Installation Project', description: 'Multi-unit HVAC installation for the Marquez Real Estate apartment complex.', contractValue: undefined, laborRate: undefined, otherEstimatedCosts: undefined, status: 'Active', completedUnits: 92, totalUnits: 100, actualLaborHours: 120, materialBudget: 70000, materialActual: 68000, assignedVans: ['VAN-2', 'VAN-3'], phases: [], materials: [], expenses: [], costEntries: [], assignments: [] },
    { ...project, ...projectCapacityPlan(5), id: 'DEMO-PRJ-SVC-004', projectNumber: 'PRJ-1003', name: 'OCA Deep Cleaning Phase 1', customerId: 'DEMO-CUS-OCA-001', customerName: 'OCA', siteId: 'DEMO-SITE-OCA-PARADERA', location: 'Paradera, Aruba', contactPerson: 'Operations Office', type: 'Service Project', description: 'Phase-one deep cleaning program for OCA air-conditioning equipment.', contractValue: undefined, laborRate: undefined, otherEstimatedCosts: undefined, status: 'Active', completedUnits: 30, totalUnits: 30, actualLaborHours: 36, materialBudget: null, materialActual: 14500, assignedVans: ['VAN-1', 'VAN-3'], phases: [], materials: [], expenses: [], costEntries: [], assignments: [] },
    { ...project, ...projectCapacityPlan(10), id: 'DEMO-PRJ-MAINT-005', projectNumber: 'PRJ-1004', name: 'Beachfront Villas Preventive Maintenance', customerId: 'DEMO-CUS-BEACH-001', customerName: 'Private Client', siteId: 'DEMO-SITE-BEACH-MALMOK', location: 'Malmok, Aruba', contactPerson: 'Property Manager', type: 'Maintenance Contract', description: 'Preventive HVAC maintenance for a beachfront villa portfolio.', contractValue: undefined, laborRate: undefined, otherEstimatedCosts: undefined, status: 'Near Completion', completedUnits: 75, totalUnits: 100, actualLaborHours: 45, materialBudget: 40000, materialActual: 28000, assignedVans: ['VAN-1'], phases: [], materials: [], expenses: [], costEntries: [], assignments: [] },
  ];
  return { version: 1, selectedProjectId: project.id, projects: portfolio };
}

export function projectMetrics(project: BrowserProject) {
  const physicalCompletion = project.totalUnits > 0 ? project.completedUnits / project.totalUnits * 100 : 0;
  const laborConsumption = project.estimatedLaborHours > 0 ? project.actualLaborHours / project.estimatedLaborHours * 100 : 0;
  const materialBudgetSet = project.materialBudget !== null && project.materialBudget > 0;
  const materialConsumption = materialBudgetSet ? project.materialActual / project.materialBudget! * 100 : null;
  const remainingUnscheduledHours = Math.max(0, project.estimatedLaborHours - project.actualLaborHours - project.scheduledFutureHours);
  const materialRemaining = materialBudgetSet ? project.materialBudget! - project.materialActual : null;
  const materialOverBudget = materialConsumption !== null && materialConsumption > 100;
  const materialAtRisk = materialConsumption !== null && materialConsumption >= 80;
  const health: ProjectHealth = laborConsumption > 100 || materialOverBudget ? 'Over Budget' : laborConsumption >= 90 || materialAtRisk ? 'At Risk' : 'On Track';
  return { physicalCompletion, laborConsumption, materialBudgetSet, materialConsumption, remainingUnscheduledHours, materialRemaining, health };
}

export function projectCompletionBlockers(project: BrowserProject): string[] {
  const blockers: string[] = [];
  const unpostedAssignments = project.assignments.filter((assignment) => !assignment.postedAt);
  if (project.scheduledFutureHours > 0 || unpostedAssignments.length > 0) {
    blockers.push('future or unposted Scheduling work remains');
  }
  if (project.totalUnits <= 0) {
    blockers.push('the Project has no positive unit baseline to complete');
  } else if (project.completedUnits !== project.totalUnits) {
    blockers.push(`${project.completedUnits} of ${project.totalUnits} units are complete`);
  }
  const incompletePhases = project.phases.filter((phase) => phase.status !== 'Completed'
    || phase.progress < 100
    || phase.unitsCompleted < phase.unitsPlanned);
  if (incompletePhases.length > 0) {
    blockers.push(`${incompletePhases.length} phase${incompletePhases.length === 1 ? ' is' : 's are'} still incomplete`);
  }
  return blockers;
}

export function projectHasOperationalActivity(project: BrowserProject) {
  return project.completedUnits > 0
    || project.actualLaborHours > 0
    || project.scheduledFutureHours > 0
    || project.materialActual > 0
    || project.assignments.length > 0
    || project.materials.length > 0
    || project.expenses.length > 0
    || project.costEntries.length > 0
    || project.assignedVans.length > 0
    || project.phases.some((phase) => phase.status !== 'Planned'
      || phase.actualLaborHours > 0
      || phase.actualMaterialCost > 0
      || phase.unitsCompleted > 0);
}

function isLegacyInheritedProject(project: BrowserProject) {
  return /^DEMO-PRJ-\d{13}$/.test(project.id)
    && project.managerId === 'DEMO-EMP-PM-001'
    && project.managerName === 'Christian Marquez'
    && project.unitType === 'VRF Units';
}

export function migrateLegacyBrowserProjectsPreviewState(state: BrowserProjectsPreviewState): BrowserProjectsPreviewState {
  let changed = false;
  const projects = state.projects.map((project) => {
    if (!isLegacyInheritedProject(project)) return project;
    changed = true;
    return {
      ...project,
      managerId: '',
      managerName: 'Not assigned',
      unitType: 'Units',
      contractValue: undefined,
      laborRate: undefined,
      otherEstimatedCosts: undefined,
    };
  });
  return changed ? { ...state, projects } : state;
}

export function normalizeBrowserProjectsPreviewState(
  candidate: BrowserProjectsPreviewState,
  fallback: BrowserProjectsPreviewState = createProjectsPreviewState(),
): BrowserProjectsPreviewState {
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.projects) || candidate.projects.length === 0) {
    return fallback;
  }
  const migrated = migrateLegacyBrowserProjectsPreviewState(candidate);
  const projects = migrated.projects.map((project) => {
    const workDays = Number.isInteger(project.estimatedWorkDays) && project.estimatedWorkDays > 0
      ? project.estimatedWorkDays
      : 20;
    return {
      ...project,
      ...projectCapacityPlan(workDays),
      materialBudget: projectTypeUsesMaterialBudget(project.type) ? project.materialBudget ?? null : null,
    };
  });
  const selectedProjectId = projects.some((project) => project.id === migrated.selectedProjectId)
    ? migrated.selectedProjectId
    : projects[0].id;
  return { ...migrated, selectedProjectId, projects };
}

export function loadBrowserProjectsPreviewState(fallback: BrowserProjectsPreviewState = createProjectsPreviewState()) {
  return normalizeBrowserProjectsPreviewState(
    loadBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, fallback),
    fallback,
  );
}

export function reduceProjectInState(
  state: BrowserProjectsPreviewState,
  projectId: string,
  reducer: (latestProject: Readonly<BrowserProject>) => BrowserProject,
): BrowserProjectsPreviewState {
  const index = state.projects.findIndex((project) => project.id === projectId);
  if (index < 0) throw new Error(`Project ${projectId || '(missing id)'} is not available in this preview.`);
  const currentProject = state.projects[index];
  const nextProject = reducer(currentProject);
  if (nextProject.id !== currentProject.id) {
    throw new Error('A Project mutation cannot change its identity.');
  }
  if (nextProject === currentProject) return state;
  return {
    ...state,
    selectedProjectId: currentProject.id,
    projects: state.projects.map((project, projectIndex) => projectIndex === index ? nextProject : project),
  };
}

export async function commitBrowserProjectsPreviewMutation(
  fallback: BrowserProjectsPreviewState,
  mutation: (latestState: BrowserProjectsPreviewState) => BrowserProjectsPreviewState,
  options: BrowserProjectsPreviewTransactionOptions = {},
): Promise<BrowserProjectsPreviewState> {
  const operation = () => {
    options.authorize?.();
    const latest = normalizeBrowserProjectsPreviewState(
      options.read ? options.read() : loadBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, fallback),
      fallback,
    );
    const next = normalizeBrowserProjectsPreviewState(mutation(latest), latest);
    const saved = options.write
      ? options.write(next)
      : saveBrowserValue(BROWSER_PROJECTS_PREVIEW_KEY, next);
    if (!saved) {
      throw new Error('Project changes could not be saved in browser preview storage. Nothing was changed in this view.');
    }
    return next;
  };

  if (options.runExclusive) return options.runExclusive(operation);
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(BROWSER_PROJECTS_PREVIEW_WRITE_LOCK, operation);
  }
  return operation();
}

const editableProjectTypes = new Set(['Installation Project', 'Service Project', 'VRF Project', 'Maintenance Contract']);
const editableProjectStatuses = new Set<ProjectStatus>(['Draft', 'Planned', 'Active', 'On Hold', 'Near Completion', 'Completed', 'Cancelled']);
const editableProjectPriorities = new Set<BrowserProject['priority']>(['Low', 'Normal', 'High', 'Critical']);

function normalizedProjectEditText(value: string, label: string, maximumLength: number) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${label} is required to edit a Project.`);
  if (normalized.length > maximumLength) throw new Error(`${label} must be ${maximumLength} characters or fewer.`);
  return normalized;
}

function normalizedProjectEditDate(value: string, label: string) {
  const normalized = normalizedProjectEditText(value, label, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${label} must use a valid YYYY-MM-DD date.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} must use a valid YYYY-MM-DD date.`);
  }
  return normalized;
}

function normalizedTechnicianInstructions(value: string | undefined) {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error('Technician instructions must be text.');
  }
  const normalized = value?.trim();
  if (normalized && normalized.length > 2000) {
    throw new Error('Technician instructions must be 2000 characters or fewer.');
  }
  return normalized || undefined;
}

export function editBrowserProject(
  state: BrowserProjectsPreviewState,
  input: BrowserProjectEditInput,
): BrowserProjectsPreviewState {
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
  const projectIndex = state.projects.findIndex((project) => project.id === projectId);
  if (projectIndex < 0) throw new Error(`Project ${projectId || '(missing id)'} is not available in this preview.`);
  const project = state.projects[projectIndex];
  const name = normalizedProjectEditText(input.name, 'Project name', 180);
  const type = normalizedProjectEditText(input.type, 'Project type', 80);
  if (!editableProjectTypes.has(type)) throw new Error(`Project type ${type} is not supported.`);
  const siteId = typeof input.siteId === 'string' ? input.siteId.trim() : '';
  if (siteId.length > 180) throw new Error('Project Property ID must be 180 characters or fewer.');
  const location = normalizedProjectEditText(input.location, 'Project location', 240);
  if (!editableProjectStatuses.has(input.status)) throw new Error(`Project status ${String(input.status)} is not supported.`);
  if ((project.status === 'Completed') !== (input.status === 'Completed')) {
    throw new Error('Completed Project status can only change through the dedicated completion workflow.');
  }
  const structureLocked = projectHasOperationalActivity(project);
  if (structureLocked && (type !== project.type || siteId !== project.siteId || location !== project.location)) {
    throw new Error('Project type and Service Property cannot change after Scheduling work or actual cost exists.');
  }
  if (structureLocked && input.status !== project.status) {
    throw new Error('Project lifecycle status must change through canonical Scheduling controls after work has been scheduled.');
  }
  if (!editableProjectPriorities.has(input.priority)) throw new Error(`Project priority ${String(input.priority)} is not supported.`);
  if (!Number.isInteger(input.totalUnits) || input.totalUnits < 0 || input.totalUnits < project.completedUnits) {
    throw new Error(`Total units must be a non-negative whole number at least equal to the ${project.completedUnits} completed units.`);
  }
  const startsOn = normalizedProjectEditDate(input.startsOn, 'Project start date');
  const estimatedCompletionOn = normalizedProjectEditDate(input.estimatedCompletionOn, 'Estimated completion date');
  if (estimatedCompletionOn < startsOn) {
    throw new Error('Estimated completion date cannot be earlier than the Project start date.');
  }
  const capacity = projectCapacityPlan(input.estimatedWorkDays);
  const committedLaborHours = project.actualLaborHours + project.scheduledFutureHours;
  if (capacity.estimatedLaborHours < committedLaborHours) {
    throw new Error(`Estimated labor hours cannot be below the ${committedLaborHours} actual and scheduled hours already committed.`);
  }
  const materialBudget = projectTypeUsesMaterialBudget(type)
    ? normalizeOptionalMaterialBudget(input.materialBudget)
    : null;
  const technicianInstructions = normalizedTechnicianInstructions(input.technicianInstructions);
  const previousAutomaticDescription = `${project.name} · ${project.type}.`;
  const description = project.description === previousAutomaticDescription
    ? `${name} · ${type}.`
    : project.description;
  const nextProject: BrowserProject = {
    ...project,
    name,
    type,
    description,
    siteId,
    location,
    status: input.status,
    priority: input.priority,
    totalUnits: input.totalUnits,
    materialBudget,
    startsOn,
    estimatedCompletionOn,
    ...capacity,
    technicianInstructions,
  };
  if (
    project.name === nextProject.name
    && project.type === nextProject.type
    && project.description === nextProject.description
    && project.siteId === nextProject.siteId
    && project.location === nextProject.location
    && project.status === nextProject.status
    && project.priority === nextProject.priority
    && project.totalUnits === nextProject.totalUnits
    && project.materialBudget === nextProject.materialBudget
    && project.startsOn === nextProject.startsOn
    && project.estimatedCompletionOn === nextProject.estimatedCompletionOn
    && project.estimatedWorkDays === nextProject.estimatedWorkDays
    && project.slotsPerWorkDay === nextProject.slotsPerWorkDay
    && project.slotDurationMinutes === nextProject.slotDurationMinutes
    && project.estimatedSlots === nextProject.estimatedSlots
    && project.estimatedLaborHours === nextProject.estimatedLaborHours
    && project.technicianInstructions === nextProject.technicianInstructions
  ) return state;
  return {
    ...state,
    projects: state.projects.map((candidate, index) => index === projectIndex ? nextProject : candidate),
  };
}

const schedulableProjectStatuses = new Set<ProjectStatus>(['Draft', 'Planned', 'Active', 'Near Completion']);

function normalizedProjectSearchText(value: unknown) {
  return typeof value === 'string'
    ? value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
    : '';
}

export function projectIsSchedulable(project: BrowserProject): boolean {
  return schedulableProjectStatuses.has(project.status);
}

export function searchProjectsForScheduling(projects: BrowserProject[], query: string): BrowserProject[] {
  const tokens = normalizedProjectSearchText(query).split(' ').filter(Boolean);
  return projects.filter((project) => {
    if (!projectIsSchedulable(project)) return false;
    if (!tokens.length) return true;
    const searchable = normalizedProjectSearchText([
      project.projectNumber,
      project.name,
      project.customerName,
      project.location,
      project.type,
    ].join(' '));
    return tokens.every((token) => searchable.includes(token));
  });
}

function scheduledHoursForSlots(project: BrowserProject, scheduledSlots: number) {
  const slotsPerWorkDay = Number.isInteger(project.slotsPerWorkDay) && project.slotsPerWorkDay > 0
    ? project.slotsPerWorkDay
    : defaultSchedulingSettings.serviceStartTimes.length;
  if (!Number.isInteger(scheduledSlots) || scheduledSlots < 1 || scheduledSlots > slotsPerWorkDay) {
    throw new Error(`Project scheduled slots must be a whole number between 1 and ${slotsPerWorkDay}.`);
  }
  const slotDurationMinutes = Number.isFinite(project.slotDurationMinutes) && project.slotDurationMinutes > 0
    ? project.slotDurationMinutes
    : PROJECT_CAPACITY_SLOT_MINUTES;
  return scheduledSlots * slotDurationMinutes / 60;
}

export function planProjectScheduling(project: BrowserProject, scheduledSlots: number): ProjectSchedulingPlan {
  const scheduledHours = scheduledHoursForSlots(project, scheduledSlots);
  if (!projectIsSchedulable(project)) {
    throw new Error(`Project ${project.projectNumber} is not available for Scheduling while ${project.status}.`);
  }
  const remainingHoursBefore = projectMetrics(project).remainingUnscheduledHours;
  if (scheduledHours > remainingHoursBefore) {
    throw new Error(`This assignment needs ${scheduledHours} hours, but ${remainingHoursBefore} project labor hours remain unscheduled.`);
  }
  return {
    scheduledHours,
    scheduledSlots,
    remainingHoursBefore,
    remainingHoursAfter: remainingHoursBefore - scheduledHours,
  };
}

function stableProjectAssignmentId(workOrderId: string) {
  return `PASG-${workOrderId}`;
}

function normalizedIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required to link a Project assignment.`);
  return normalized;
}

function normalizedProjectPhaseId(project: BrowserProject, value: string) {
  const normalized = value.trim();
  if (!project.phases.length) {
    if (!normalized || normalized === GENERAL_PROJECT_WORK_PHASE_ID) return GENERAL_PROJECT_WORK_PHASE_ID;
    throw new Error(`Project phase ${normalized} does not belong to ${project.projectNumber}.`);
  }
  if (!normalized) throw new Error('Project phase id is required to link a Project assignment.');
  const phase = project.phases.find((candidate) => candidate.id === normalized);
  if (!phase) {
    throw new Error(`Project phase ${normalized} does not belong to ${project.projectNumber}.`);
  }
  if (phase.status === 'Completed') {
    throw new Error(`Project phase ${normalized} is completed and cannot accept new Scheduling work.`);
  }
  return normalized;
}

function normalizedUnitsPlanned(value: number | undefined) {
  const units = value ?? 0;
  if (!Number.isInteger(units) || units < 0) {
    throw new Error('Project assignment units planned must be a non-negative whole number.');
  }
  return units;
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function projectAssignmentUsesCanonicalLifecycle(assignment: ProjectAssignment) {
  return Boolean(
    assignment.appointmentId?.trim()
    || assignment.workOrderId?.trim()
    || assignment.bookingStatus,
  );
}

export function projectAssignmentsForHandoff(project: BrowserProject): ProjectAssignment[] {
  const canonical: ProjectAssignment[] = [];
  const preview: ProjectAssignment[] = [];
  for (let index = project.assignments.length - 1; index >= 0; index -= 1) {
    const assignment = project.assignments[index];
    (projectAssignmentUsesCanonicalLifecycle(assignment) ? canonical : preview).push(assignment);
  }
  return [...canonical, ...preview];
}

export function linkProjectSchedulingAssignment(
  state: BrowserProjectsPreviewState,
  input: ProjectSchedulingLinkInput,
): BrowserProjectsPreviewState {
  const projectId = normalizedIdentifier(input.projectId, 'Project id');
  const customerId = normalizedIdentifier(input.customerId, 'Canonical customer id');
  const siteId = normalizedIdentifier(input.siteId, 'Canonical Service Property id');
  const appointmentId = normalizedIdentifier(input.appointmentId, 'Canonical appointment id');
  const workOrderId = normalizedIdentifier(input.workOrderId, 'Canonical work order id');
  const vanId = normalizedIdentifier(input.vanId, 'Van id');
  const project = state.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Project ${projectId} is not available in this preview.`);
  if (project.customerId !== customerId) {
    throw new Error(`Project ${project.projectNumber} is not linked to canonical customer ${customerId}.`);
  }
  if (!project.siteId || project.siteId !== siteId) {
    throw new Error(`Project ${project.projectNumber} must use canonical Service Property ${siteId} before Scheduling can link work.`);
  }
  const phaseId = normalizedProjectPhaseId(project, input.phaseId);
  const assignmentId = stableProjectAssignmentId(workOrderId);
  const linkedProject = state.projects.find((candidate) => candidate.assignments.some((assignment) => (
    assignment.workOrderId === workOrderId || assignment.id === assignmentId
  )));
  if (linkedProject && linkedProject.id !== project.id) {
    throw new Error(`Canonical work order ${workOrderId} is already linked to ${linkedProject.projectNumber}.`);
  }
  const appointmentProject = state.projects.find((candidate) => candidate.assignments.some((assignment) => (
    assignment.appointmentId === appointmentId
  )));
  if (appointmentProject && appointmentProject.id !== project.id) {
    throw new Error(`Canonical appointment ${appointmentId} is already linked to ${appointmentProject.projectNumber}.`);
  }

  const scheduledHours = scheduledHoursForSlots(project, input.scheduledSlots);
  const unitsPlanned = normalizedUnitsPlanned(input.unitsPlanned);
  const technicianIds = input.technicianIds === undefined
    ? undefined
    : [...new Set(input.technicianIds.map((value) => value.trim()).filter(Boolean))];
  const existingIndex = project.assignments.findIndex((assignment) => (
    assignment.workOrderId === workOrderId || assignment.id === assignmentId
  ));

  if (existingIndex >= 0) {
    const existing = project.assignments[existingIndex];
    if (
      existing.projectId !== projectId
      || existing.phaseId !== phaseId
      || existing.appointmentId !== appointmentId
      || existing.vanId !== vanId
      || existing.scheduledHours !== scheduledHours
      || (existing.scheduledSlots ?? input.scheduledSlots) !== input.scheduledSlots
      || existing.unitsPlanned !== unitsPlanned
    ) {
      throw new Error(`Canonical work order ${workOrderId} conflicts with its existing Project assignment.`);
    }
    const bookingStatus = existing.bookingStatus === 'confirmed' ? 'confirmed' : input.bookingStatus;
    const nextAssignment: ProjectAssignment = {
      ...existing,
      bookingStatus,
      technicianIds: technicianIds ?? existing.technicianIds,
      scheduledSlots: input.scheduledSlots,
      scheduledDate: input.scheduledDate ?? existing.scheduledDate,
      scheduledStart: input.scheduledStart ?? existing.scheduledStart,
      scheduledEnd: input.scheduledEnd ?? existing.scheduledEnd,
    };
    if (
      existing.bookingStatus === nextAssignment.bookingStatus
      && existing.scheduledSlots === nextAssignment.scheduledSlots
      && existing.scheduledDate === nextAssignment.scheduledDate
      && existing.scheduledStart === nextAssignment.scheduledStart
      && existing.scheduledEnd === nextAssignment.scheduledEnd
      && sameStringArray(existing.technicianIds, nextAssignment.technicianIds)
    ) return state;
    const nextProject = {
      ...project,
      assignments: project.assignments.map((assignment, index) => index === existingIndex ? nextAssignment : assignment),
    };
    return {
      ...state,
      selectedProjectId: project.id,
      projects: state.projects.map((candidate) => candidate.id === project.id ? nextProject : candidate),
    };
  }

  const scheduledPlan = planProjectScheduling(project, input.scheduledSlots);
  const assignment: ProjectAssignment = {
    id: assignmentId,
    projectId,
    phaseId,
    appointmentId,
    workOrderId,
    bookingStatus: input.bookingStatus,
    vanId,
    technicianIds: technicianIds ?? [],
    scheduledHours: scheduledPlan.scheduledHours,
    scheduledSlots: scheduledPlan.scheduledSlots,
    scheduledDate: input.scheduledDate,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    actualHours: 0,
    unitsPlanned,
    unitsCompleted: 0,
    status: 'Scheduled',
  };
  const nextProject: BrowserProject = {
    ...project,
    status: project.status === 'Draft' ? 'Planned' : project.status,
    scheduledFutureHours: project.scheduledFutureHours + assignment.scheduledHours,
    assignedVans: project.assignedVans.includes(vanId) ? project.assignedVans : [...project.assignedVans, vanId],
    assignments: [...project.assignments, assignment],
  };
  return {
    ...state,
    selectedProjectId: project.id,
    projects: state.projects.map((candidate) => candidate.id === project.id ? nextProject : candidate),
  };
}

export type AssignmentPostInput = {
  assignmentId: string;
  materialLines: Array<{ item: string; quantity: number; unit: string; unitCost: number }>;
  postedAt: string;
};

export function scheduleProjectAssignment(project: BrowserProject, assignment: ProjectAssignment): BrowserProject {
  if (assignment.projectId !== project.id || project.assignments.some((row) => row.id === assignment.id)) return project;
  return {
    ...project,
    scheduledFutureHours: project.scheduledFutureHours + Math.max(0, assignment.scheduledHours),
    assignments: [...project.assignments, assignment],
  };
}

function normalizedAssignmentPostTimestamp(value: string) {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== normalized
  ) {
    throw new Error('Project assignment postedAt must be a valid ISO UTC timestamp.');
  }
  return normalized;
}

function normalizedAssignmentMaterialLines(input: AssignmentPostInput['materialLines']) {
  if (!Array.isArray(input)) throw new Error('Project assignment material lines must be an array.');
  return input.map((line, index) => {
    const item = line.item.trim();
    const unit = line.unit.trim();
    if (!item) throw new Error(`Project assignment material line ${index + 1} item is required.`);
    if (!unit) throw new Error(`Project assignment material line ${index + 1} unit is required.`);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error(`Project assignment material line ${index + 1} quantity must be a finite number greater than zero.`);
    }
    if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
      throw new Error(`Project assignment material line ${index + 1} unit cost must be a finite non-negative number.`);
    }
    return { ...line, item, unit };
  });
}

export function postProjectAssignment(project: BrowserProject, input: AssignmentPostInput): BrowserProject {
  const assignmentId = input.assignmentId.trim();
  const assignment = project.assignments.find((row) => row.id === assignmentId);
  if (!assignment) throw new Error(`Project assignment ${assignmentId || '(empty)'} does not exist in ${project.projectNumber}.`);
  if (assignment.postedAt) return project;
  if (assignment.projectId !== project.id) {
    throw new Error(`Project assignment ${assignment.id} belongs to a different Project.`);
  }
  if (projectAssignmentUsesCanonicalLifecycle(assignment)) {
    throw new Error(`Project assignment ${assignment.id} is linked to the canonical Appointment and Work Order lifecycle. Record actual time, completion, units, and materials through Field Operations.`);
  }
  const phase = project.phases.find((row) => row.id === assignment.phaseId);
  const generalProjectWork = assignment.phaseId === GENERAL_PROJECT_WORK_PHASE_ID && project.phases.length === 0;
  if (!phase && !generalProjectWork) {
    throw new Error(`Project assignment ${assignment.id} phase ${assignment.phaseId || '(empty)'} does not belong to ${project.projectNumber}.`);
  }
  if (!Number.isFinite(assignment.actualHours) || assignment.actualHours < 0) {
    throw new Error('Project assignment actual hours must be a finite non-negative number.');
  }
  if (!Number.isInteger(assignment.unitsCompleted) || assignment.unitsCompleted < 0) {
    throw new Error('Project assignment units completed must be a non-negative whole number.');
  }
  const postedAt = normalizedAssignmentPostTimestamp(input.postedAt);
  const materialLines = normalizedAssignmentMaterialLines(input.materialLines);
  const materialAmount = materialLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const postedDate = new Date(postedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const technician = assignment.technicianIds.length ? assignment.technicianIds.join(' + ') : 'Unassigned';
  const laborRate = typeof project.laborRate === 'number' && Number.isFinite(project.laborRate) && project.laborRate >= 0
    ? project.laborRate
    : null;
  const remainingProjectUnits = Math.max(0, project.totalUnits - project.completedUnits);
  const remainingPhaseUnits = phase
    ? Math.max(0, phase.unitsPlanned - phase.unitsCompleted)
    : remainingProjectUnits;
  const acceptedUnitDelta = Math.min(
    Math.max(0, assignment.unitsCompleted),
    remainingProjectUnits,
    remainingPhaseUnits,
  );
  const nextMaterials: ProjectMaterialUsage[] = materialLines.map((line, index) => ({ id: `${assignment.id}-MU-${index + 1}`, date: postedDate, item: line.item, quantity: line.quantity, unit: line.unit, unitCost: line.unitCost, source: 'Van Inventory', van: assignment.vanId.replace('VAN-', 'Van '), technician, assignmentId: assignment.id, phaseId: assignment.phaseId, status: 'Used' }));
  const laborEntries: ProjectCostEntry[] = laborRate === null ? [] : [{ id: `${assignment.id}-LABOR`, date: postedDate, costType: 'Labor', sourceType: 'Work Log', sourceId: `${assignment.id}-WORKLOG`, description: 'Actual technician labor', amount: assignment.actualHours * laborRate, phaseId: assignment.phaseId, vendorOrEmployee: technician }];
  const materialEntries: ProjectCostEntry[] = nextMaterials.map((line) => ({ id: `CE-${line.id}`, date: line.date, costType: 'Inventory Material', sourceType: 'Material Usage', sourceId: line.id, description: `${line.item} — actual project consumption`, amount: line.quantity * line.unitCost, phaseId: line.phaseId, vendorOrEmployee: line.technician }));
  return {
    ...project,
    completedUnits: project.completedUnits + acceptedUnitDelta,
    scheduledFutureHours: Math.max(0, project.scheduledFutureHours - Math.max(0, assignment.scheduledHours)),
    actualLaborHours: project.actualLaborHours + assignment.actualHours,
    materialActual: project.materialActual + materialAmount,
    materials: [...project.materials, ...nextMaterials],
    costEntries: [...project.costEntries, ...laborEntries, ...materialEntries],
    phases: project.phases.map((row) => row.id === assignment.phaseId ? { ...row, actualLaborHours: row.actualLaborHours + assignment.actualHours, actualMaterialCost: row.actualMaterialCost + materialAmount, unitsCompleted: row.unitsCompleted + acceptedUnitDelta, progress: Math.min(100, Math.round((row.unitsCompleted + acceptedUnitDelta) / Math.max(1, row.unitsPlanned) * 100)) } : row),
    assignments: project.assignments.map((row) => row.id === assignment.id ? { ...row, unitsCompleted: acceptedUnitDelta, status: 'Completed', postedAt } : row),
  };
}

export function linkProjectExpense(project: BrowserProject, expenseId: string): BrowserProject {
  const expense = project.expenses.find((row) => row.id === expenseId);
  if (!expense) return project;
  const existingEntry = project.costEntries.find((entry) => entry.sourceType === 'Expense' && entry.sourceId === expense.id);
  if (existingEntry) {
    if (expense.status === 'Approved') return project;
    return { ...project, expenses: project.expenses.map((row) => row.id === expense.id ? { ...row, status: 'Approved' } : row) };
  }
  const materialIncrement = expense.costType === 'Purchased Material' ? expense.amount : 0;
  const entry: ProjectCostEntry = { id: `CE-${expense.id}`, date: expense.date, costType: expense.costType, sourceType: 'Expense', sourceId: expense.id, description: expense.description, amount: expense.amount, phaseId: expense.phaseId, vendorOrEmployee: expense.vendor };
  return { ...project, materialActual: project.materialActual + materialIncrement, expenses: project.expenses.map((row) => row.id === expense.id ? { ...row, status: 'Approved' } : row), costEntries: [...project.costEntries, entry] };
}

export function updateProjectInState(state: BrowserProjectsPreviewState, project: BrowserProject) {
  return { ...state, selectedProjectId: project.id, projects: state.projects.map((row) => row.id === project.id ? project : row) };
}
