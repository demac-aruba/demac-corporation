import assert from 'node:assert/strict';
import type { BrowserProject, ProjectAssignment } from '../lib/browser-projects';
import {
  commitBrowserProjectsPreviewMutation,
  createProjectsPreviewState,
  editBrowserProject,
  GENERAL_PROJECT_WORK_PHASE_ID,
  linkProjectExpense,
  linkProjectSchedulingAssignment,
  migrateLegacyBrowserProjectsPreviewState,
  normalizeOptionalMaterialBudget,
  planProjectScheduling,
  postProjectAssignment,
  projectAssignmentsForHandoff,
  projectAssignmentUsesCanonicalLifecycle,
  projectCapacityPlan,
  projectCompletionBlockers,
  projectMetrics,
  projectTypeUsesMaterialBudget,
  reduceProjectInState,
  scheduleProjectAssignment,
  searchProjectsForScheduling,
} from '../lib/browser-projects';
import { navigationGroups } from '../lib/navigation';
import { roleCapabilities } from '../lib/security';

function assertNear(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${message} (expected ${expected}, received ${actual})`);
}

function actualProjectCost(project: BrowserProject) {
  return project.costEntries.reduce((sum, entry) => sum + entry.amount, 0);
}

const operationsNavigation = navigationGroups.find((group) => group.label === 'Operations');
const managementNavigation = navigationGroups.find((group) => group.label === 'Management');
assert.ok(operationsNavigation, 'The integrated ERP navigation must retain its Operations group.');
assert.ok(managementNavigation, 'The integrated ERP navigation must retain its Management group.');
const schedulingIndex = operationsNavigation.items.findIndex((item) => item.href === '/scheduling');
const projectsIndex = operationsNavigation.items.findIndex((item) => item.href === '/projects');
assert.equal(projectsIndex, schedulingIndex + 1, 'Projects must appear immediately below Scheduling & Dispatch in Operations.');
assert.equal(managementNavigation.items.some((item) => item.href === '/projects'), false, 'Projects must not be duplicated under Management.');
assert.deepEqual(
  operationsNavigation.items[projectsIndex]?.roles,
  ['super_admin', 'operations', 'project_manager', 'finance'],
  'Projects navigation must remain visible only to the roles with projects.view capability.',
);
assert.equal(roleCapabilities.office_operator.has('projects.view'), false, 'Office operators must not read Projects or Project technician instructions from Scheduling.');
assert.equal(roleCapabilities.office_operator.has('projects.manage'), false, 'Office operators must not link Scheduling writes to Projects.');
assert.equal(roleCapabilities.finance.has('projects.view'), true, 'Finance keeps read-only Project visibility.');
assert.equal(roleCapabilities.finance.has('projects.manage'), false, 'Read-only Project visibility must not imply permission to link or write Project scheduling records.');

const state = createProjectsPreviewState();
const project = state.projects.find((row) => row.id === state.selectedProjectId);

assert.deepEqual(projectCapacityPlan(10), { estimatedWorkDays: 10, slotsPerWorkDay: 6, slotDurationMinutes: 60, estimatedSlots: 60, estimatedLaborHours: 60 }, 'Ten van-days must derive sixty canonical Scheduling slots and sixty operational hours.');
assert.deepEqual(projectCapacityPlan(15), { estimatedWorkDays: 15, slotsPerWorkDay: 6, slotDurationMinutes: 60, estimatedSlots: 90, estimatedLaborHours: 90 }, 'Fifteen van-days must derive ninety slots and hours, never an unrelated manual value.');
for (const invalidDays of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => projectCapacityPlan(invalidDays), /positive whole number/, `Invalid work-day value ${invalidDays} must not produce a silent labor budget.`);
}
assert.equal(projectTypeUsesMaterialBudget('Service Project'), false, 'Service projects must not request a material budget.');
assert.equal(projectTypeUsesMaterialBudget('Installation Project'), true, 'Installation projects may offer an optional material budget.');
assert.equal(normalizeOptionalMaterialBudget(''), null, 'A blank optional material budget must remain absent.');
assert.equal(normalizeOptionalMaterialBudget('0'), null, 'A zero optional material budget must normalize to the same absent baseline as a blank value.');
assert.equal(normalizeOptionalMaterialBudget('1250.50'), 1250.5, 'A positive optional material budget must preserve its AWG amount.');
assert.throws(() => normalizeOptionalMaterialBudget('-1'), /non-negative AWG amount/, 'A negative material budget must be rejected.');

assert.ok(project, 'The preview must select a canonical project that exists in the seeded portfolio.');
assert.equal(project.id, 'DEMO-PRJ-VRF-001', 'The canonical preview project ID must remain stable.');
assert.equal(project.projectNumber, 'PRJ-1007', 'The canonical preview project number must remain stable.');
assert.equal(project.totalUnits, 12, 'The canonical VRF project must seed twelve planned units.');
assert.equal(project.completedUnits, 7, 'The canonical VRF project must seed seven completed units.');
assert.equal(project.estimatedLaborHours, 120, 'The canonical labor budget must seed 120 hours.');
assert.equal(project.actualLaborHours, 66, 'Only posted work must seed the 66 actual labor hours.');
assert.equal(project.scheduledFutureHours, 24, 'Future scheduled work must remain a separate planning value.');
assert.equal(project.materialBudget, 7000, 'The canonical material budget must seed Afl. 7,000.');
assert.equal(project.materialActual, 5450, 'Only consumed or purchased material must seed the Afl. 5,450 actual.');

const expectedPortfolioIdentity = [
  ['DEMO-PRJ-VRF-001', 'DEMO-CUS-VET-001', 'Veterinaria Aruba', 'DEMO-SITE-VET-NOORD', 'Noord, Aruba'],
  ['DEMO-PRJ-SVC-002', 'DEMO-CUS-RWC-001', 'Renaissance Wind Creek', 'DEMO-SITE-RWC-ORANJESTAD', 'Oranjestad, Aruba'],
  ['DEMO-PRJ-INSTALL-003', 'DEMO-CUS-MRE-001', 'Marquez Real Estate', 'DEMO-SITE-MRE-NOORD', 'Noord, Aruba'],
  ['DEMO-PRJ-SVC-004', 'DEMO-CUS-OCA-001', 'OCA', 'DEMO-SITE-OCA-PARADERA', 'Paradera, Aruba'],
  ['DEMO-PRJ-MAINT-005', 'DEMO-CUS-BEACH-001', 'Private Client', 'DEMO-SITE-BEACH-MALMOK', 'Malmok, Aruba'],
];
assert.deepEqual(
  state.projects.map((row) => [row.id, row.customerId, row.customerName, row.siteId, row.location]),
  expectedPortfolioIdentity,
  'Every portfolio seed must retain its own stable, internally consistent Customer and Property identity.',
);
assert.equal(new Set(state.projects.map((row) => row.customerId)).size, state.projects.length, 'A demo Customer ID must not identify multiple portfolio customers.');
assert.equal(new Set(state.projects.map((row) => row.siteId)).size, state.projects.length, 'A demo Property ID must not identify multiple portfolio locations.');
for (const derivedProject of state.projects.slice(1)) {
  assert.equal(derivedProject.contractValue, undefined, `${derivedProject.projectNumber} must not inherit the primary demo Project contract value.`);
  assert.equal(derivedProject.laborRate, undefined, `${derivedProject.projectNumber} must not inherit the primary demo Project labor rate.`);
  assert.equal(derivedProject.otherEstimatedCosts, undefined, `${derivedProject.projectNumber} must not inherit the primary demo Project other estimated costs.`);
}

const legacyTimestampProject: BrowserProject = {
  ...project,
  id: 'DEMO-PRJ-1788364800000',
  projectNumber: 'PRJ-1013',
  name: 'Marquis Apartments',
  status: 'Planned',
  assignments: project.assignments.map((assignment) => ({ ...assignment, projectId: 'DEMO-PRJ-1788364800000' })),
};
const legacyTimestampState = { version: 1 as const, selectedProjectId: legacyTimestampProject.id, projects: [legacyTimestampProject] };
const migratedTimestampState = migrateLegacyBrowserProjectsPreviewState(legacyTimestampState);
const migratedTimestampProject = migratedTimestampState.projects[0];
assert.equal(migratedTimestampProject.managerId, '', 'Legacy timestamp Projects must not retain the demo manager identity.');
assert.equal(migratedTimestampProject.managerName, 'Not assigned', 'Legacy timestamp Projects must show that no manager was recorded.');
assert.equal(migratedTimestampProject.unitType, 'Units', 'Legacy timestamp Projects must not retain the demo VRF unit type.');
assert.equal(migratedTimestampProject.contractValue, undefined, 'Legacy timestamp Projects must not retain an invented demo contract value.');
assert.equal(migratedTimestampProject.laborRate, undefined, 'Legacy timestamp Projects must not retain an invented demo labor rate.');
assert.equal(migratedTimestampProject.otherEstimatedCosts, undefined, 'Legacy timestamp Projects must not retain invented demo other costs.');
assert.strictEqual(migratedTimestampProject.assignments, legacyTimestampProject.assignments, 'Migration must preserve linked Scheduling activity exactly.');
assert.equal(migratedTimestampProject.name, legacyTimestampProject.name, 'Migration must preserve user-entered Project identity.');
assert.equal(legacyTimestampProject.managerId, 'DEMO-EMP-PM-001', 'Migration must not mutate the source object.');
assert.strictEqual(migrateLegacyBrowserProjectsPreviewState(migratedTimestampState), migratedTimestampState, 'Legacy migration must be idempotent.');
assert.strictEqual(migrateLegacyBrowserProjectsPreviewState(state), state, 'Named demo fixtures must not be changed by timestamp-draft migration.');
const customizedTimestampProject = { ...legacyTimestampProject, managerId: '', managerName: 'Not assigned' };
const customizedTimestampState = { version: 1 as const, selectedProjectId: customizedTimestampProject.id, projects: [customizedTimestampProject] };
assert.strictEqual(migrateLegacyBrowserProjectsPreviewState(customizedTimestampState), customizedTimestampState, 'Timestamp Projects without the exact inherited signature must remain untouched.');

const previewHandoff = project.assignments[0];
const canonicalHandoffOne: ProjectAssignment = { ...previewHandoff, id: 'PASG-WO-1', appointmentId: 'APT-1', workOrderId: 'WO-1' };
const canonicalHandoffTwo: ProjectAssignment = { ...previewHandoff, id: 'PASG-WO-2', appointmentId: 'APT-2', workOrderId: 'WO-2' };
const laterPreviewHandoff: ProjectAssignment = { ...previewHandoff, id: 'ASG-LATER-PREVIEW' };
assert.deepEqual(projectAssignmentsForHandoff({ ...project, assignments: [] }), [], 'A Project without assignments must have no technician handoff.');
const orderedHandoffs = projectAssignmentsForHandoff({ ...project, assignments: [previewHandoff, canonicalHandoffOne, canonicalHandoffTwo, laterPreviewHandoff] });
assert.deepEqual(orderedHandoffs.map((assignment) => assignment.id), ['PASG-WO-2', 'PASG-WO-1', 'ASG-LATER-PREVIEW', previewHandoff.id], 'Handoffs must expose every assignment, with the newest canonical links first.');
assert.deepEqual([previewHandoff, canonicalHandoffOne, canonicalHandoffTwo, laterPreviewHandoff].map((assignment) => assignment.id), [previewHandoff.id, 'PASG-WO-1', 'PASG-WO-2', 'ASG-LATER-PREVIEW'], 'Handoff selection must not mutate source ordering.');

const unchangedProjectEdit = {
  projectId: project.id,
  name: project.name,
  type: project.type,
  siteId: project.siteId,
  location: project.location,
  status: project.status,
  priority: project.priority,
  totalUnits: project.totalUnits,
  materialBudget: project.materialBudget,
  startsOn: project.startsOn,
  estimatedCompletionOn: project.estimatedCompletionOn,
  estimatedWorkDays: project.estimatedWorkDays,
  technicianInstructions: project.technicianInstructions,
};
assert.strictEqual(
  editBrowserProject(state, unchangedProjectEdit),
  state,
  'Editing a Project with the same normalized values must be an idempotent state no-op.',
);

const editableProject: BrowserProject = {
  ...project,
  completedUnits: 0,
  actualLaborHours: 0,
  scheduledFutureHours: 0,
  materialActual: 0,
  assignments: [],
  materials: [],
  expenses: [],
  costEntries: [],
  assignedVans: [],
  phases: [],
};
const editableProjectState = {
  ...state,
  projects: state.projects.map((row) => row.id === editableProject.id ? editableProject : row),
};

const projectEdit = {
  ...unchangedProjectEdit,
  name: '  Veterinaria Aruba Modernization  ',
  type: 'Installation Project',
  siteId: '  DEMO-SITE-VET-EAGLE  ',
  location: '  Eagle Beach, Aruba  ',
  status: 'On Hold' as const,
  priority: 'Critical' as const,
  totalUnits: 15,
  materialBudget: 8500,
  startsOn: '2026-08-05',
  estimatedCompletionOn: '2026-10-15',
  estimatedWorkDays: 18,
  technicianInstructions: '  Use the west gate and confirm roof access before arrival.  ',
};
const editedProjectState = editBrowserProject(editableProjectState, projectEdit);
const editedProject = editedProjectState.projects.find((row) => row.id === project.id);
assert.ok(editedProject, 'The edited Project must remain in the portfolio under its stable ID.');
assert.equal(editedProject.name, 'Veterinaria Aruba Modernization', 'Project edits must trim and persist the Project name.');
assert.equal(editedProject.type, 'Installation Project', 'Project edits must persist a supported Project type.');
assert.equal(editedProject.description, project.description, 'A custom Project description must not be overwritten by a name or type edit.');
assert.equal(editedProject.siteId, 'DEMO-SITE-VET-EAGLE', 'Project edits must trim and persist the selected Property ID.');
assert.equal(editedProject.location, 'Eagle Beach, Aruba', 'Project edits must trim and persist the Project location.');
assert.equal(editedProject.status, 'On Hold', 'Project edits may persist a non-completion status change.');
assert.equal(editedProject.priority, 'Critical', 'Project edits must persist a supported priority.');
assert.equal(editedProject.totalUnits, 15, 'Project total units must persist when they remain above completed units.');
assert.equal(editedProject.materialBudget, 8500, 'A non-Service Project may persist an optional AWG material budget.');
assert.equal(editedProject.startsOn, '2026-08-05', 'Project edits must persist a valid start date.');
assert.equal(editedProject.estimatedCompletionOn, '2026-10-15', 'Project edits must persist a valid estimated completion date.');
assert.deepEqual(
  {
    estimatedWorkDays: editedProject.estimatedWorkDays,
    slotsPerWorkDay: editedProject.slotsPerWorkDay,
    slotDurationMinutes: editedProject.slotDurationMinutes,
    estimatedSlots: editedProject.estimatedSlots,
    estimatedLaborHours: editedProject.estimatedLaborHours,
  },
  projectCapacityPlan(18),
  'Editing work days must recalculate every capacity snapshot through the canonical plan.',
);
assert.equal(editedProject.technicianInstructions, 'Use the west gate and confirm roof access before arrival.', 'Technician instructions must be trimmed and persisted.');
assert.equal(editedProject.customerId, project.customerId, 'Project editing must preserve the canonical Customer ID.');
assert.equal(editedProject.customerName, project.customerName, 'Project editing must preserve the canonical Customer name.');
assert.equal(editedProject.managerId, project.managerId, 'Project editing must preserve the Project manager ID.');
assert.equal(editedProject.managerName, project.managerName, 'Project editing must preserve the Project manager name.');
assert.equal(editedProject.actualLaborHours, editableProject.actualLaborHours, 'Project editing must preserve actual labor.');
assert.equal(editedProject.scheduledFutureHours, editableProject.scheduledFutureHours, 'Project editing must preserve already scheduled labor.');
assert.equal(editedProject.materialActual, editableProject.materialActual, 'Project editing must preserve actual material cost.');
assert.strictEqual(editedProject.assignments, editableProject.assignments, 'Project editing must preserve the canonical assignment collection by reference.');
assert.strictEqual(editedProject.phases, editableProject.phases, 'Project editing must preserve operational phases by reference.');
assert.strictEqual(editedProject.materials, editableProject.materials, 'Project editing must preserve material history by reference.');
assert.strictEqual(editedProject.expenses, editableProject.expenses, 'Project editing must preserve expense history by reference.');
assert.strictEqual(editedProject.costEntries, editableProject.costEntries, 'Project editing must preserve cost history by reference.');
assert.strictEqual(editedProject.assignedVans, editableProject.assignedVans, 'Project editing must preserve participating Vans by reference.');
assert.strictEqual(editedProjectState.projects[1], state.projects[1], 'Editing one Project must preserve every untouched portfolio object.');
assert.equal(editedProjectState.selectedProjectId, state.selectedProjectId, 'Editing a Project must preserve portfolio selection state.');
assert.strictEqual(
  editBrowserProject(editedProjectState, projectEdit),
  editedProjectState,
  'Replaying an already applied Project edit must return the identical state reference.',
);

const automaticDescriptionProject: BrowserProject = {
  ...editableProject,
  id: 'DEMO-PRJ-AUTO-DESCRIPTION',
  name: 'Original Project Name',
  type: 'Service Project',
  description: 'Original Project Name · Service Project.',
};
const automaticDescriptionState = {
  ...state,
  selectedProjectId: automaticDescriptionProject.id,
  projects: [automaticDescriptionProject, ...state.projects],
};
const renamedAutomaticDescriptionState = editBrowserProject(automaticDescriptionState, {
  ...unchangedProjectEdit,
  projectId: automaticDescriptionProject.id,
  name: 'Renamed Project',
  type: 'Maintenance Contract',
  materialBudget: null,
});
assert.equal(
  renamedAutomaticDescriptionState.projects[0].description,
  'Renamed Project · Maintenance Contract.',
  'An automatically generated Project description must follow later name and type edits.',
);

const serviceProjectEditState = editBrowserProject(editableProjectState, {
  ...unchangedProjectEdit,
  type: 'Service Project',
  materialBudget: 9000,
});
assert.equal(
  serviceProjectEditState.projects.find((row) => row.id === project.id)?.materialBudget,
  null,
  'Editing a Project to Service Project must force its material budget to null.',
);
const committedCapacityBoundary = editBrowserProject(state, {
  ...unchangedProjectEdit,
  estimatedWorkDays: 15,
});
assert.equal(
  committedCapacityBoundary.projects.find((row) => row.id === project.id)?.estimatedLaborHours,
  project.actualLaborHours + project.scheduledFutureHours,
  'Edited capacity may equal, but never fall below, labor hours already actual or scheduled.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, type: 'Installation Project' }),
  /cannot change after Scheduling work or actual cost exists/,
  'Project type must remain protected after operational activity exists.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, siteId: 'DEMO-SITE-OTHER', location: 'Other location' }),
  /cannot change after Scheduling work or actual cost exists/,
  'The canonical Service Property must remain protected after operational activity exists.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, status: 'On Hold' }),
  /lifecycle status must change through canonical Scheduling controls/,
  'Generic editing must not change lifecycle status while canonical Scheduling work exists.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, name: '   ' }),
  /Project name is required/,
  'A Project edit must reject an empty name.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, type: 'Unknown Project Type' }),
  /is not supported/,
  'A Project edit must reject an unsupported type.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, startsOn: '2026-02-30' }),
  /valid YYYY-MM-DD date/,
  'A Project edit must reject a nonexistent calendar date.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, startsOn: '2026-10-01', estimatedCompletionOn: '2026-09-30' }),
  /cannot be earlier/,
  'A Project edit must reject an estimated completion before its start date.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, estimatedWorkDays: 14 }),
  /cannot be below the 90 actual and scheduled hours already committed/,
  'Edited capacity must not fall below posted plus already scheduled Project labor.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, totalUnits: project.completedUnits - 1 }),
  /at least equal to the 7 completed units/,
  'Edited total units must not fall below already completed units.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, totalUnits: 12.5 }),
  /whole number/,
  'Edited total units must remain a whole number.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, materialBudget: -1 }),
  /non-negative AWG amount/,
  'A Project edit must reject a negative material budget.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, technicianInstructions: 'x'.repeat(2001) }),
  /2000 characters or fewer/,
  'A Project edit must reject unbounded technician instructions.',
);
assert.throws(
  () => editBrowserProject(state, { ...unchangedProjectEdit, status: 'Completed' }),
  /dedicated completion workflow/,
  'The generic Project editor must not bypass the dedicated completion workflow.',
);
const completedProjectState = {
  ...state,
  projects: state.projects.map((row) => row.id === project.id ? { ...row, status: 'Completed' as const } : row),
};
assert.throws(
  () => editBrowserProject(completedProjectState, { ...unchangedProjectEdit, status: 'Active' }),
  /dedicated completion workflow/,
  'The generic Project editor must not reopen a completed Project.',
);

const completionReadyProject: BrowserProject = {
  ...project,
  id: 'DEMO-PRJ-COMPLETION-READY',
  totalUnits: 1,
  completedUnits: 1,
  scheduledFutureHours: 0,
  assignments: [],
  phases: [],
};
assert.deepEqual(
  projectCompletionBlockers(completionReadyProject),
  [],
  'Project completion must be available only when all recorded unit progress is complete and no Scheduling work remains.',
);
assert.match(
  projectCompletionBlockers({ ...completionReadyProject, completedUnits: 0 }).join('; '),
  /0 of 1 units are complete/,
  'Project completion must not manufacture missing physical unit progress.',
);
assert.match(
  projectCompletionBlockers({ ...completionReadyProject, totalUnits: 0, completedUnits: 0 }).join('; '),
  /no positive unit baseline/,
  'A zero-unit Project must not be treated as physically complete.',
);
assert.match(
  projectCompletionBlockers({
    ...completionReadyProject,
    assignments: [{ ...project.assignments[0], status: 'Completed', postedAt: undefined }],
  }).join('; '),
  /unposted Scheduling work remains/,
  'An assignment status alone must not bypass completion before its field actuals are posted.',
);
assert.match(
  projectCompletionBlockers({
    ...completionReadyProject,
    phases: [{ ...project.phases[0], status: 'In Progress', progress: 90 }],
  }).join('; '),
  /1 phase is still incomplete/,
  'Project completion must require every phase to already reflect real completed progress.',
);

assert.deepEqual(
  searchProjectsForScheduling(state.projects, 'veterinaria aruba').map((row) => row.id),
  [project.id],
  'Scheduling project search must match all normalized name tokens.',
);
assert.deepEqual(
  searchProjectsForScheduling(state.projects, 'PRJ-1007').map((row) => row.id),
  [project.id],
  'Scheduling project search must match a formatted project number.',
);
const accentedSearchProject: BrowserProject = { ...project, id: 'DEMO-PRJ-ACCENTED', name: 'Clínica Águila' };
assert.deepEqual(
  searchProjectsForScheduling([accentedSearchProject], 'clinica aguila').map((row) => row.id),
  [accentedSearchProject.id],
  'Scheduling project search must ignore case and accents.',
);
assert.equal(
  searchProjectsForScheduling([{ ...project, status: 'Completed' }], '').length,
  0,
  'Completed projects must not be offered for new Scheduling work.',
);

assert.deepEqual(
  planProjectScheduling(project, 6),
  { scheduledHours: 6, scheduledSlots: 6, remainingHoursBefore: 30, remainingHoursAfter: 24 },
  'A full Project workday must preserve six whole Scheduling slots and derive six labor hours.',
);
assert.deepEqual(
  planProjectScheduling({ ...project, slotDurationMinutes: 30 }, 6),
  { scheduledHours: 3, scheduledSlots: 6, remainingHoursBefore: 30, remainingHoursAfter: 27 },
  'Project labor hours must derive from slots multiplied by the Project slot duration.',
);
for (const invalidSlots of [0, 0.5, 6.5, 7, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => planProjectScheduling(project, invalidSlots),
    /whole number between 1 and 6/,
    `Invalid scheduled-slot value ${invalidSlots} must be rejected.`,
  );
}
assert.throws(
  () => planProjectScheduling({ ...project, status: 'On Hold' }, 1),
  /not available for Scheduling/,
  'An On Hold project must not accept new Scheduling work.',
);
assert.throws(
  () => planProjectScheduling({ ...project, actualLaborHours: 119.5, scheduledFutureHours: 0 }, 1),
  /0.5 project labor hours remain unscheduled/,
  'A Scheduling plan must not exceed remaining project labor hours.',
);

const schedulingLinkInput = {
  projectId: project.id,
  customerId: project.customerId,
  siteId: project.siteId,
  phaseId: 'PH-05',
  appointmentId: 'APT-PROJECT-2001',
  workOrderId: 'WO-APT-PROJECT-2001-1',
  bookingStatus: 'temporary_hold' as const,
  vanId: 'VAN-3',
  technicianIds: ['DEMO-EMP-SCHEDULED', 'DEMO-EMP-SCHEDULED', 'DEMO-EMP-HELPER'],
  scheduledSlots: 6,
  unitsPlanned: 1,
  scheduledDate: '2026-09-10',
  scheduledStart: '08:30',
  scheduledEnd: '15:00',
};
assert.throws(
  () => linkProjectSchedulingAssignment(state, { ...schedulingLinkInput, customerId: 'DEMO-CUS-OTHER' }),
  /not linked to canonical customer/,
  'A canonical Appointment customer must match the Project customer before linking.',
);
assert.throws(
  () => linkProjectSchedulingAssignment(state, { ...schedulingLinkInput, siteId: 'DEMO-SITE-OTHER' }),
  /must use canonical Service Property/,
  'A canonical Appointment property must match the Project Service Property before linking.',
);
const linkedSchedulingState = linkProjectSchedulingAssignment(state, schedulingLinkInput);
const linkedSchedulingProject = linkedSchedulingState.projects.find((row) => row.id === project.id);
assert.ok(linkedSchedulingProject, 'The linked Scheduling Project must remain in preview state.');
const linkedSchedulingAssignment = linkedSchedulingProject.assignments.find((row) => row.workOrderId === schedulingLinkInput.workOrderId);
assert.ok(linkedSchedulingAssignment, 'A canonical Work Order must create one source-linked Project Assignment.');
assert.equal(linkedSchedulingAssignment.id, `PASG-${schedulingLinkInput.workOrderId}`, 'The preview assignment ID must derive from its canonical Work Order.');
assert.equal(linkedSchedulingAssignment.appointmentId, schedulingLinkInput.appointmentId, 'The Project Assignment must retain its canonical Appointment ID.');
assert.equal(linkedSchedulingAssignment.bookingStatus, 'temporary_hold', 'A canonical temporary hold must remain distinguishable from a confirmation.');
assert.equal(projectAssignmentUsesCanonicalLifecycle(linkedSchedulingAssignment), true, 'A Scheduling-linked Project Assignment must use the canonical Appointment and Work Order lifecycle.');
assert.equal(linkedSchedulingAssignment.scheduledHours, 6, 'The linked Project Assignment must derive labor hours from its whole Scheduling slots.');
assert.equal(linkedSchedulingAssignment.scheduledSlots, 6, 'The linked Project Assignment must preserve its whole Scheduling slots.');
assert.deepEqual(linkedSchedulingAssignment.technicianIds, ['DEMO-EMP-SCHEDULED', 'DEMO-EMP-HELPER'], 'Technician IDs must be normalized without duplicates.');
assert.equal(linkedSchedulingProject.scheduledFutureHours, project.scheduledFutureHours + 6, 'Linking a canonical booking must reserve derived future project hours exactly once.');
assert.equal(linkedSchedulingProject.actualLaborHours, project.actualLaborHours, 'Scheduling persistence must not fabricate actual labor.');
assert.equal(linkedSchedulingProject.materialActual, project.materialActual, 'Scheduling persistence must not fabricate material consumption.');
assert.equal(actualProjectCost(linkedSchedulingProject), actualProjectCost(project), 'Scheduling persistence must not fabricate project cost.');
assert.equal(linkedSchedulingProject.assignedVans.filter((vanId) => vanId === 'VAN-3').length, 1, 'A newly linked Van must appear once in Project participation.');

const renamedAfterConcurrentScheduling = reduceProjectInState(linkedSchedulingState, project.id, (latestProject) => ({
  ...latestProject,
  name: 'Veterinaria Aruba VRF · Revised',
}));
const renamedConcurrentProject = renamedAfterConcurrentScheduling.projects.find((row) => row.id === project.id);
assert.ok(renamedConcurrentProject, 'A Project reducer must preserve the selected Project.');
assert.equal(renamedConcurrentProject.name, 'Veterinaria Aruba VRF · Revised', 'A Project reducer must apply the requested UI change.');
assert.strictEqual(renamedConcurrentProject.assignments, linkedSchedulingProject.assignments, 'A Project reducer applied to the latest snapshot must preserve concurrent Scheduling assignments.');
assert.equal(renamedConcurrentProject.scheduledFutureHours, linkedSchedulingProject.scheduledFutureHours, 'A Project reducer must preserve the latest scheduled capacity.');
assert.strictEqual(renamedAfterConcurrentScheduling.projects.find((row) => row.id !== project.id), linkedSchedulingState.projects.find((row) => row.id !== project.id), 'A Project reducer must preserve unrelated Projects by reference.');
assert.strictEqual(reduceProjectInState(linkedSchedulingState, project.id, (latestProject) => latestProject as BrowserProject), linkedSchedulingState, 'A no-op Project reducer must preserve state identity.');
assert.throws(() => reduceProjectInState(linkedSchedulingState, 'PRJ-MISSING', (latestProject) => latestProject as BrowserProject), /not available/, 'A reducer must reject a missing Project identity.');
assert.throws(() => reduceProjectInState(linkedSchedulingState, project.id, (latestProject) => ({ ...latestProject, id: 'OTHER' })), /cannot change its identity/, 'A reducer must not allow Project identity replacement.');

const fifteenDayEdit = { ...unchangedProjectEdit, estimatedWorkDays: 15 };
assert.equal(editBrowserProject(state, fifteenDayEdit).projects.find((row) => row.id === project.id)?.estimatedLaborHours, 90, 'The stale Project snapshot would allow a fifteen-day capacity plan before new Scheduling work arrives.');
assert.throws(() => editBrowserProject(linkedSchedulingState, fifteenDayEdit), /cannot be below the 96 actual and scheduled hours/, 'Reapplying an edit to the latest snapshot must reject capacity made stale by concurrent Scheduling work.');

assert.strictEqual(
  linkProjectSchedulingAssignment(linkedSchedulingState, schedulingLinkInput),
  linkedSchedulingState,
  'Replaying the same canonical temporary hold must be an idempotent state no-op.',
);
const confirmedSchedulingInput = { ...schedulingLinkInput, bookingStatus: 'confirmed' as const };
const confirmedSchedulingState = linkProjectSchedulingAssignment(linkedSchedulingState, confirmedSchedulingInput);
const confirmedSchedulingProject = confirmedSchedulingState.projects.find((row) => row.id === project.id)!;
assert.equal(confirmedSchedulingProject.assignments.length, linkedSchedulingProject.assignments.length, 'Confirming an existing hold must not duplicate its Project Assignment.');
assert.equal(confirmedSchedulingProject.scheduledFutureHours, linkedSchedulingProject.scheduledFutureHours, 'Confirming an existing hold must not reserve the same hours twice.');
assert.equal(confirmedSchedulingProject.assignments.find((row) => row.workOrderId === schedulingLinkInput.workOrderId)?.bookingStatus, 'confirmed', 'Confirmation must promote the linked hold status.');
assert.strictEqual(
  linkProjectSchedulingAssignment(confirmedSchedulingState, confirmedSchedulingInput),
  confirmedSchedulingState,
  'Replaying an already confirmed canonical booking must be an idempotent state no-op.',
);

const phaseLessServiceProject = state.projects.find((row) => row.id === 'DEMO-PRJ-SVC-002');
assert.ok(phaseLessServiceProject, 'The preview portfolio must retain a Service Project without explicit phases.');
assert.throws(
  () => linkProjectSchedulingAssignment(linkedSchedulingState, {
    ...schedulingLinkInput,
    projectId: phaseLessServiceProject.id,
    customerId: phaseLessServiceProject.customerId,
    siteId: phaseLessServiceProject.siteId,
    phaseId: '',
  }),
  /already linked/,
  'A canonical Work Order must never reserve labor in two different Projects.',
);
assert.throws(
  () => linkProjectSchedulingAssignment(linkedSchedulingState, {
    ...schedulingLinkInput,
    projectId: phaseLessServiceProject.id,
    customerId: phaseLessServiceProject.customerId,
    siteId: phaseLessServiceProject.siteId,
    phaseId: '',
    workOrderId: 'WO-APT-PROJECT-2001-SECOND',
  }),
  /Canonical appointment .* already linked/,
  'Work Orders from one canonical Appointment must never be split across different Projects.',
);
const draftServiceProject: BrowserProject = {
  ...phaseLessServiceProject,
  status: 'Draft',
  completedUnits: 0,
  actualLaborHours: 0,
  scheduledFutureHours: 0,
  assignedVans: [],
  assignments: [],
};
const draftServiceState = {
  ...state,
  selectedProjectId: draftServiceProject.id,
  projects: state.projects.map((row) => row.id === draftServiceProject.id ? draftServiceProject : row),
};
assert.deepEqual(
  searchProjectsForScheduling(draftServiceState.projects, draftServiceProject.projectNumber).map((row) => row.id),
  [draftServiceProject.id],
  'A newly created Draft Project must be visible immediately in Scheduling search.',
);
const serviceSchedulingInput = {
  projectId: draftServiceProject.id,
  customerId: draftServiceProject.customerId,
  siteId: draftServiceProject.siteId,
  phaseId: '',
  appointmentId: 'APT-PROJECT-SERVICE-2002',
  workOrderId: 'WO-APT-PROJECT-SERVICE-2002-1',
  bookingStatus: 'confirmed' as const,
  vanId: 'VAN-4',
  scheduledSlots: 2,
};
const linkedServiceState = linkProjectSchedulingAssignment(draftServiceState, serviceSchedulingInput);
const linkedServiceProject = linkedServiceState.projects.find((row) => row.id === draftServiceProject.id);
assert.ok(linkedServiceProject, 'A phase-less Service Project must remain available after linking canonical Scheduling work.');
assert.equal(linkedServiceProject.status, 'Planned', 'The first linked canonical assignment must transition a Draft Project to Planned.');
assert.equal(linkedServiceProject.scheduledFutureHours, 2, 'The first Draft Project assignment must reserve its hours exactly once.');
const linkedServiceAssignment = linkedServiceProject.assignments.find((row) => row.workOrderId === serviceSchedulingInput.workOrderId);
assert.ok(linkedServiceAssignment, 'A canonical booking must link to a phase-less Service Project.');
assert.equal(
  linkedServiceAssignment.phaseId,
  GENERAL_PROJECT_WORK_PHASE_ID,
  'An empty phase selection on a phase-less Service Project must persist the stable general-work sentinel.',
);
assert.strictEqual(
  linkProjectSchedulingAssignment(linkedServiceState, { ...serviceSchedulingInput, phaseId: GENERAL_PROJECT_WORK_PHASE_ID }),
  linkedServiceState,
  'Retrying phase-less Service work with the explicit general-work sentinel must be idempotent.',
);
assert.throws(
  () => linkProjectSchedulingAssignment({
    ...draftServiceState,
    projects: draftServiceState.projects.map((row) => row.id === draftServiceProject.id ? { ...row, siteId: '' } : row),
  }, serviceSchedulingInput),
  /must use canonical Service Property/,
  'A Project without a canonical Service Property must not become locked by its first Scheduling assignment.',
);
const canonicalServiceWorkInProgress: BrowserProject = {
  ...linkedServiceProject,
  assignments: linkedServiceProject.assignments.map((assignment) => assignment.id === linkedServiceAssignment.id
    ? { ...assignment, actualHours: 1.5, status: 'In Progress' }
    : assignment),
};
assert.throws(
  () => postProjectAssignment(canonicalServiceWorkInProgress, {
    assignmentId: linkedServiceAssignment.id,
    materialLines: [],
    postedAt: '2026-09-02T16:00:00.000Z',
  }),
  /linked to the canonical Appointment and Work Order lifecycle/,
  'Projects preview must not post actuals or completion for a Scheduling-linked Work Order.',
);
const alreadyPostedCanonicalProject: BrowserProject = {
  ...linkedServiceProject,
  assignments: linkedServiceProject.assignments.map((assignment) => assignment.id === linkedServiceAssignment.id
    ? { ...assignment, status: 'Completed', postedAt: '2026-09-02T15:00:00.000Z' }
    : assignment),
};
assert.strictEqual(
  postProjectAssignment(alreadyPostedCanonicalProject, {
    assignmentId: linkedServiceAssignment.id,
    materialLines: [{ item: '', quantity: 0, unit: '', unitCost: -1 }],
    postedAt: 'invalid',
  }),
  alreadyPostedCanonicalProject,
  'A replay of an already-posted assignment must remain an idempotent no-op before canonical or payload validation.',
);
const previewGeneralServiceAssignment: ProjectAssignment = {
  id: 'ASG-PREVIEW-SERVICE-2002',
  projectId: linkedServiceProject.id,
  phaseId: GENERAL_PROJECT_WORK_PHASE_ID,
  vanId: 'VAN-4',
  technicianIds: [],
  scheduledHours: 2,
  scheduledSlots: 2,
  scheduledDate: '2026-09-10',
  scheduledStart: '08:30',
  scheduledEnd: '10:30',
  actualHours: 1.5,
  unitsPlanned: 0,
  unitsCompleted: 0,
  status: 'In Progress',
};
assert.equal(projectAssignmentUsesCanonicalLifecycle(previewGeneralServiceAssignment), false, 'A preview-only assignment without Appointment or Work Order identity may exercise the simulated posting workflow.');
const previewGeneralServiceWork: BrowserProject = {
  ...draftServiceProject,
  status: 'Planned',
  scheduledFutureHours: 2,
  assignedVans: ['VAN-4'],
  assignments: [previewGeneralServiceAssignment],
};
const previewPostInput = {
  assignmentId: previewGeneralServiceAssignment.id,
  materialLines: [] as Array<{ item: string; quantity: number; unit: string; unitCost: number }>,
  postedAt: '2026-09-02T16:00:00.000Z',
};
const projectWithPreviewAssignment = (assignment: ProjectAssignment): BrowserProject => ({
  ...previewGeneralServiceWork,
  assignments: [assignment],
});
assert.throws(
  () => postProjectAssignment(previewGeneralServiceWork, { ...previewPostInput, assignmentId: 'ASG-MISSING' }),
  /does not exist/,
  'Posting must reject an assignment that does not exist in the Project.',
);
const foreignProjectAssignment: ProjectAssignment = {
  ...previewGeneralServiceAssignment,
  id: 'ASG-FOREIGN-PROJECT',
  projectId: 'DEMO-PRJ-OTHER',
};
assert.throws(
  () => postProjectAssignment(projectWithPreviewAssignment(foreignProjectAssignment), { ...previewPostInput, assignmentId: foreignProjectAssignment.id }),
  /belongs to a different Project/,
  'Posting must reject an assignment whose Project identity does not match its container.',
);
const invalidPhaseAssignment: ProjectAssignment = {
  ...previewGeneralServiceAssignment,
  id: 'ASG-INVALID-PHASE',
  phaseId: 'PH-NOT-IN-PROJECT',
};
assert.throws(
  () => postProjectAssignment(projectWithPreviewAssignment(invalidPhaseAssignment), { ...previewPostInput, assignmentId: invalidPhaseAssignment.id }),
  /phase .* does not belong/,
  'Posting must reject an assignment whose phase does not belong to the Project.',
);
for (const invalidActualHours of [Number.NaN, Number.POSITIVE_INFINITY, -0.25]) {
  const invalidAssignment = {
    ...previewGeneralServiceAssignment,
    id: `ASG-INVALID-ACTUAL-${String(invalidActualHours)}`,
    actualHours: invalidActualHours,
  };
  assert.throws(
    () => postProjectAssignment(projectWithPreviewAssignment(invalidAssignment), { ...previewPostInput, assignmentId: invalidAssignment.id }),
    /actual hours must be a finite non-negative number/,
    `Posting must reject invalid actual hours ${String(invalidActualHours)}.`,
  );
}
for (const invalidUnitsCompleted of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5]) {
  const invalidAssignment = {
    ...previewGeneralServiceAssignment,
    id: `ASG-INVALID-UNITS-${String(invalidUnitsCompleted)}`,
    unitsCompleted: invalidUnitsCompleted,
  };
  assert.throws(
    () => postProjectAssignment(projectWithPreviewAssignment(invalidAssignment), { ...previewPostInput, assignmentId: invalidAssignment.id }),
    /units completed must be a non-negative whole number/,
    `Posting must reject invalid completed units ${String(invalidUnitsCompleted)}.`,
  );
}
for (const invalidPostedAt of ['', 'not-a-date', '2026-02-30T16:00:00.000Z']) {
  assert.throws(
    () => postProjectAssignment(previewGeneralServiceWork, { ...previewPostInput, postedAt: invalidPostedAt }),
    /postedAt must be a valid ISO UTC timestamp/,
    `Posting must reject invalid postedAt value ${JSON.stringify(invalidPostedAt)}.`,
  );
}
const validMaterialLine = { item: 'Copper Pipe', quantity: 1, unit: 'm', unitCost: 12 };
for (const invalidMaterialLine of [
  { ...validMaterialLine, item: '' },
  { ...validMaterialLine, item: '   ' },
]) {
  assert.throws(
    () => postProjectAssignment(previewGeneralServiceWork, { ...previewPostInput, materialLines: [invalidMaterialLine] }),
    /material line 1 item is required/,
    'Posting must reject a material line with an empty item.',
  );
}
for (const invalidMaterialLine of [
  { ...validMaterialLine, unit: '' },
  { ...validMaterialLine, unit: '   ' },
]) {
  assert.throws(
    () => postProjectAssignment(previewGeneralServiceWork, { ...previewPostInput, materialLines: [invalidMaterialLine] }),
    /material line 1 unit is required/,
    'Posting must reject a material line with an empty unit.',
  );
}
for (const invalidQuantity of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
  assert.throws(
    () => postProjectAssignment(previewGeneralServiceWork, { ...previewPostInput, materialLines: [{ ...validMaterialLine, quantity: invalidQuantity }] }),
    /quantity must be a finite number greater than zero/,
    `Posting must reject invalid material quantity ${String(invalidQuantity)}.`,
  );
}
for (const invalidUnitCost of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
  assert.throws(
    () => postProjectAssignment(previewGeneralServiceWork, { ...previewPostInput, materialLines: [{ ...validMaterialLine, unitCost: invalidUnitCost }] }),
    /unit cost must be a finite non-negative number/,
    `Posting must reject invalid material unit cost ${String(invalidUnitCost)}.`,
  );
}
const postedGeneralServiceWork = postProjectAssignment(previewGeneralServiceWork, {
  ...previewPostInput,
});
assert.equal(postedGeneralServiceWork.phases.length, 0, 'Posting general Service work must not invent a Project phase.');
assert.equal(postedGeneralServiceWork.scheduledFutureHours, 0, 'Posting general Service work must release its scheduled future hours.');
assert.equal(postedGeneralServiceWork.actualLaborHours, 1.5, 'Posting general Service work must record actual technician labor.');
assert.equal(postedGeneralServiceWork.costEntries.some((entry) => entry.sourceId === `${previewGeneralServiceAssignment.id}-WORKLOG`), false, 'Posting must not invent a labor cost entry when the Project has no recorded labor rate.');
assert.equal(
  postedGeneralServiceWork.assignments.find((assignment) => assignment.id === previewGeneralServiceAssignment.id)?.status,
  'Completed',
  'The technician completion must close a general phase-less Project assignment.',
);
const unpricedMaterialPost = postProjectAssignment(previewGeneralServiceWork, {
  ...previewPostInput,
  materialLines: [validMaterialLine],
});
const unpricedMaterialUsage = unpricedMaterialPost.materials.find((usage) => usage.assignmentId === previewGeneralServiceAssignment.id);
assert.equal(unpricedMaterialUsage?.date, 'Sep 2', 'Posted material date must derive from postedAt in UTC.');
assert.equal(unpricedMaterialUsage?.technician, 'Unassigned', 'Material posting must not invent a technician when no technician ID is assigned.');
assert.equal(unpricedMaterialPost.costEntries.filter((entry) => entry.sourceId === `${previewGeneralServiceAssignment.id}-WORKLOG`).length, 0, 'An unpriced Project must still omit an invented labor entry when material is posted.');
assert.strictEqual(
  postProjectAssignment(postedGeneralServiceWork, {
    assignmentId: previewGeneralServiceAssignment.id,
    materialLines: [],
    postedAt: '2026-09-02T16:00:00.000Z',
  }),
  postedGeneralServiceWork,
  'Replaying technician completion for general Project work must not post labor twice.',
);
assert.throws(
  () => linkProjectSchedulingAssignment(draftServiceState, { ...serviceSchedulingInput, phaseId: 'PH-NOT-AVAILABLE' }),
  /does not belong/,
  'A phase-less Service Project must reject an invented phase instead of silently treating it as general work.',
);
assert.throws(
  () => linkProjectSchedulingAssignment(state, { ...schedulingLinkInput, phaseId: 'PH-UNKNOWN' }),
  /does not belong/,
  'A canonical booking must not link to a phase outside the selected Project.',
);
assert.throws(
  () => linkProjectSchedulingAssignment(state, { ...schedulingLinkInput, phaseId: 'PH-01' }),
  /is completed and cannot accept new Scheduling work/,
  'The exported reducer must reject new Scheduling work against a completed Project phase.',
);
assert.throws(
  () => linkProjectSchedulingAssignment(state, { ...schedulingLinkInput, phaseId: '' }),
  /Project phase id is required/,
  'A Project with explicit phases must not fall back to general work when its phase selection is empty.',
);
assert.throws(
  () => linkProjectSchedulingAssignment(linkedSchedulingState, { ...schedulingLinkInput, scheduledSlots: 5 }),
  /conflicts with its existing Project assignment/,
  'A canonical Work Order ID must not be replayed with a conflicting labor allocation.',
);
const nearlyAllocatedProject: BrowserProject = { ...project, scheduledFutureHours: project.estimatedLaborHours - project.actualLaborHours - 0.5 };
const nearlyAllocatedState = { ...state, projects: state.projects.map((row) => row.id === project.id ? nearlyAllocatedProject : row) };
assert.throws(
  () => linkProjectSchedulingAssignment(nearlyAllocatedState, { ...schedulingLinkInput, scheduledSlots: 1 }),
  /0.5 project labor hours remain unscheduled/,
  'The reducer must reject a new canonical booking that exceeds remaining labor capacity.',
);

const seededMetrics = projectMetrics(project);
assertNear(seededMetrics.physicalCompletion, 7 / 12 * 100, 'Physical completion must derive from completed versus planned units.');
assertNear(seededMetrics.laborConsumption, 66 / 120 * 100, 'Labor consumption must derive from actual versus estimated labor.');
assertNear(seededMetrics.materialConsumption ?? Number.NaN, 5450 / 7000 * 100, 'Material consumption must derive from actual versus budgeted material cost.');
assertNear(seededMetrics.remainingUnscheduledHours, 120 - 66 - 24, 'Remaining labor must exclude both posted actuals and separately scheduled future work.');
assert.equal(seededMetrics.materialRemaining, 1550, 'Material remaining must equal budget less actual material cost.');
assert.equal(seededMetrics.health, 'On Track', 'The canonical seed must remain on track below labor and material risk thresholds.');
for (const portfolioProject of state.projects) {
  assert.equal(portfolioProject.estimatedSlots, portfolioProject.estimatedWorkDays * portfolioProject.slotsPerWorkDay, `${portfolioProject.projectNumber} must retain an auditable work-day-to-slot budget snapshot.`);
  assert.equal(portfolioProject.estimatedLaborHours, portfolioProject.estimatedSlots * portfolioProject.slotDurationMinutes / 60, `${portfolioProject.projectNumber} labor hours must derive from its slot snapshot.`);
}
const serviceWithoutMaterialBudget: BrowserProject = { ...project, type: 'Service Project', materialBudget: null, materialActual: 500 };
const serviceMetrics = projectMetrics(serviceWithoutMaterialBudget);
assert.equal(serviceMetrics.materialBudgetSet, false, 'A service project without a material baseline must preserve the absence of a budget.');
assert.equal(serviceMetrics.materialConsumption, null, 'Actual service material cost without a baseline must not manufacture a consumption percentage.');
assert.equal(serviceMetrics.materialRemaining, null, 'Actual service material cost without a baseline must not manufacture a negative remaining budget.');
assert.equal(serviceMetrics.health, 'On Track', 'Material actuals without an optional baseline must not create a false budget alert.');

const seededCost = actualProjectCost(project);
const scheduleOnlyAssignment: ProjectAssignment = {
  id: 'ASG-SCHEDULE-ONLY',
  projectId: project.id,
  phaseId: 'PH-05',
  vanId: 'VAN-3',
  technicianIds: ['DEMO-EMP-SCHEDULED'],
  scheduledHours: 8,
  actualHours: 0,
  unitsPlanned: 2,
  unitsCompleted: 0,
  status: 'Scheduled',
};
const scheduleOnlyProject = scheduleProjectAssignment(project, scheduleOnlyAssignment);
assert.equal(scheduleOnlyProject.assignments.length, project.assignments.length + 1, 'Scheduling must append the Project Assignment once.');
assert.equal(scheduleOnlyProject.scheduledFutureHours, project.scheduledFutureHours + scheduleOnlyAssignment.scheduledHours, 'Scheduling must reserve future hours through the domain helper.');
assert.equal(scheduleOnlyProject.actualLaborHours, project.actualLaborHours, 'Scheduling work must not post actual labor hours.');
assert.equal(scheduleOnlyProject.materialActual, project.materialActual, 'Scheduling a Van assignment must not post material consumption.');
assert.equal(actualProjectCost(scheduleOnlyProject), seededCost, 'Scheduling work must not create an actual financial cost.');
assertNear(projectMetrics(scheduleOnlyProject).laborConsumption, seededMetrics.laborConsumption, 'Scheduled hours must not inflate actual labor consumption.');
assertNear(projectMetrics(scheduleOnlyProject).remainingUnscheduledHours, seededMetrics.remainingUnscheduledHours - 8, 'Scheduled hours may reserve remaining capacity without becoming actual work.');
assert.strictEqual(scheduleProjectAssignment(scheduleOnlyProject, scheduleOnlyAssignment), scheduleOnlyProject, 'Retrying the same schedule command must not duplicate its assignment or reserved hours.');

const transferOnlyAssignment: ProjectAssignment = {
  ...scheduleOnlyAssignment,
  id: 'ASG-TRANSFER-ONLY',
  vanId: 'VAN-6',
  scheduledHours: 0,
  status: 'In Progress',
};
const transferOnlyProject: BrowserProject = {
  ...project,
  assignedVans: [...project.assignedVans, transferOnlyAssignment.vanId],
  assignments: [...project.assignments, transferOnlyAssignment],
};
assert.equal(transferOnlyProject.materialActual, project.materialActual, 'Assigning a Van as the inventory source is a transfer/context event, not consumption.');
assert.equal(
  transferOnlyProject.costEntries.filter((entry) => entry.sourceId === transferOnlyAssignment.id).length,
  0,
  'A source-Van assignment must not create a material usage financial entry before consumption is posted.',
);

const assignment = project.assignments.find((row) => row.id === 'ASG-1052');
assert.ok(assignment, 'The seeded preview technician assignment must be present.');
assert.equal(projectAssignmentUsesCanonicalLifecycle(assignment), false, 'The seeded technician workflow must remain explicitly preview-only without canonical Appointment or Work Order identity.');
const seededPhaseUnitTotal = project.phases.reduce((sum, row) => sum + row.unitsCompleted, 0);
assert.equal(seededPhaseUnitTotal, project.completedUnits, 'Seeded project completion must equal the phase completion rollup.');
const assignmentPhase = project.phases.find((row) => row.id === assignment.phaseId);
assert.ok(assignmentPhase, 'The seeded preview technician assignment must reference a valid phase.');
const acceptedUnitDelta = Math.min(
  assignment.unitsCompleted,
  project.totalUnits - project.completedUnits,
  assignmentPhase.unitsPlanned - assignmentPhase.unitsCompleted,
);
const postedMaterialLines = [
  { item: 'Copper Pipe 3/8”', quantity: 28, unit: 'm', unitCost: 12 },
  { item: 'Electrical Cable 4×1.5mm²', quantity: 42, unit: 'm', unitCost: 4.25 },
];
const postedMaterialAmount = postedMaterialLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
const posted = postProjectAssignment(project, {
  assignmentId: assignment.id,
  materialLines: postedMaterialLines,
  postedAt: '2026-09-02T12:00:00.000Z',
});

assert.equal(posted.actualLaborHours, project.actualLaborHours + assignment.actualHours, 'Completing an assignment must post its measured actual labor exactly once.');
assert.equal(posted.materialActual, project.materialActual + postedMaterialAmount, 'Completing an assignment must post only the explicitly consumed material lines.');
assert.equal(posted.completedUnits, project.completedUnits + acceptedUnitDelta, 'Completing an assignment must apply only the unit delta accepted by project and phase capacity.');
assert.equal(posted.phases.reduce((sum, row) => sum + row.unitsCompleted, 0), posted.completedUnits, 'Project and phase unit completion must remain the same after posting.');
assert.equal(posted.assignments.find((row) => row.id === assignment.id)?.unitsCompleted, acceptedUnitDelta, 'The posted assignment must retain the accepted unit delta.');
assert.equal(posted.scheduledFutureHours, project.scheduledFutureHours - assignment.scheduledHours, 'Completing an assignment must release its scheduled future hours.');
assert.equal(posted.materials.length, project.materials.length + postedMaterialLines.length, 'Each consumed material line must create one usage record.');
assert.equal(posted.costEntries.length, project.costEntries.length + 1 + postedMaterialLines.length, 'Completion must create one labor entry and one entry per consumed material line.');
assert.equal(posted.costEntries.filter((entry) => entry.sourceId === `${assignment.id}-WORKLOG`).length, 1, 'Assignment completion must create exactly one labor financial entry.');
const postedLaborEntry = posted.costEntries.find((entry) => entry.sourceId === `${assignment.id}-WORKLOG`);
assert.equal(postedLaborEntry?.date, 'Sep 2', 'Labor posting date must derive from postedAt in UTC.');
assert.equal(postedLaborEntry?.vendorOrEmployee, assignment.technicianIds.join(' + '), 'Labor posting must identify the assignment technician IDs without invented names.');
assert.equal(postedLaborEntry?.amount, assignment.actualHours * (project.laborRate ?? 0), 'Labor cost must use the Project labor rate that was actually recorded.');
assert.equal(posted.costEntries.filter((entry) => entry.sourceType === 'Material Usage' && entry.sourceId.startsWith(`${assignment.id}-MU-`)).length, postedMaterialLines.length, 'Assignment completion must create exactly one financial entry for each consumed material line.');
assert.ok(posted.assignments.find((row) => row.id === assignment.id)?.postedAt, 'A completed assignment must retain its posting marker for idempotency.');

const postedAgain = postProjectAssignment(posted, {
  assignmentId: assignment.id,
  materialLines: postedMaterialLines,
  postedAt: '2026-09-02T12:01:00.000Z',
});
assert.strictEqual(postedAgain, posted, 'Repeating an already posted completion must be an idempotent no-op.');
assert.equal(postedAgain.actualLaborHours, posted.actualLaborHours, 'Repeated completion must not double-count labor.');
assert.equal(postedAgain.materialActual, posted.materialActual, 'Repeated completion must not double-count material consumption.');
assert.equal(postedAgain.costEntries.length, posted.costEntries.length, 'Repeated completion must not duplicate financial entries.');
assert.equal(postedAgain.scheduledFutureHours, posted.scheduledFutureHours, 'Repeated completion must not release scheduled hours twice.');

const postedMetrics = projectMetrics(posted);
assertNear(postedMetrics.remainingUnscheduledHours, Math.max(0, 120 - posted.actualLaborHours - posted.scheduledFutureHours), 'Remaining labor must use the released future schedule after actual work posts.');
assertNear(postedMetrics.materialRemaining ?? Number.NaN, 7000 - posted.materialActual, 'Material remaining must stay consistent after consumption posts.');
assert.equal(postedMetrics.health, 'At Risk', 'Material consumption at or above 80% must move project health to At Risk.');

const pendingExpenseId = 'EXP-1088';
const pendingExpense = project.expenses.find((expense) => expense.id === pendingExpenseId);
assert.ok(pendingExpense, 'The canonical AI-reviewed expense must exist.');
assert.equal(pendingExpense.status, 'Pending Review', 'The canonical AI-reviewed expense must begin pending.');
for (const approvedExpense of project.expenses.filter((expense) => expense.status === 'Approved')) {
  assert.equal(
    project.costEntries.filter((entry) => entry.sourceType === 'Expense' && entry.sourceId === approvedExpense.id).length,
    1,
    `Approved seed expense ${approvedExpense.id} must have exactly one source-linked Project Cost Entry.`,
  );
}
const linked = linkProjectExpense(project, pendingExpenseId);
assert.equal(linked.expenses.find((expense) => expense.id === pendingExpenseId)?.status, 'Approved', 'Confirming the pending expense must approve and link it.');
assert.equal(linked.costEntries.length, project.costEntries.length + 1, 'Confirming an expense must create exactly one financial entry.');
assert.equal(linked.costEntries.filter((entry) => entry.sourceType === 'Expense' && entry.sourceId === pendingExpenseId).length, 1, 'The linked expense must have exactly one source-addressable financial entry.');
assert.equal(linked.materialActual, project.materialActual + pendingExpense.amount, 'A purchased-material expense must update the material actual dimension once.');
assert.equal(actualProjectCost(linked), seededCost + pendingExpense.amount, 'The same approved expense must update total actual project cost once.');

const linkedAgain = linkProjectExpense(linked, pendingExpenseId);
assert.strictEqual(linkedAgain, linked, 'Repeating confirmation of an approved expense must be an idempotent no-op.');
assert.equal(linkedAgain.costEntries.length, linked.costEntries.length, 'Repeated expense confirmation must not duplicate the financial entry.');
assert.equal(linkedAgain.materialActual, linked.materialActual, 'Repeated expense confirmation must not double-count material actuals.');
assert.equal(actualProjectCost(linkedAgain), actualProjectCost(linked), 'Repeated expense confirmation must not double-count total actual cost.');

const approvedButUnlinked: BrowserProject = {
  ...project,
  expenses: project.expenses.map((expense) => expense.id === pendingExpenseId ? { ...expense, status: 'Approved' } : expense),
};
const recoveredApprovedLink = linkProjectExpense(approvedButUnlinked, pendingExpenseId);
assert.equal(recoveredApprovedLink.costEntries.length, approvedButUnlinked.costEntries.length + 1, 'An approved but unlinked expense must still create its missing source-linked cost entry.');
assert.equal(recoveredApprovedLink.materialActual, approvedButUnlinked.materialActual + pendingExpense.amount, 'Recovering an approved purchased-material link must update material actual once.');

const pendingButAlreadyLinked: BrowserProject = {
  ...linked,
  expenses: linked.expenses.map((expense) => expense.id === pendingExpenseId ? { ...expense, status: 'Pending Review' } : expense),
};
const reconciledPendingStatus = linkProjectExpense(pendingButAlreadyLinked, pendingExpenseId);
assert.equal(reconciledPendingStatus.expenses.find((expense) => expense.id === pendingExpenseId)?.status, 'Approved', 'A pending expense with an existing source-linked entry must reconcile to Approved.');
assert.equal(reconciledPendingStatus.costEntries.length, pendingButAlreadyLinked.costEntries.length, 'Reconciling pending status must not duplicate the existing cost entry.');
assert.equal(reconciledPendingStatus.materialActual, pendingButAlreadyLinked.materialActual, 'Reconciling pending status must not apply purchased-material cost twice.');

async function verifyPreviewTransactions() {
  const transactionProject = project!;
  const transactionLinkedProject = linkedSchedulingProject!;
  let storedState = linkedSchedulingState;
  let exclusiveCalls = 0;
  const committedState = await commitBrowserProjectsPreviewMutation(state, (latest) => reduceProjectInState(latest, transactionProject.id, (latestProject) => ({
    ...latestProject,
    priority: 'Critical',
  })), {
    read: () => storedState,
    write: (next) => {
      storedState = next;
      return true;
    },
    runExclusive: async (operation) => {
      exclusiveCalls += 1;
      return operation();
    },
  });
  const committedProject = committedState.projects.find((row) => row.id === transactionProject.id);
  assert.ok(committedProject, 'A successful transaction must return the committed Project.');
  assert.equal(exclusiveCalls, 1, 'A preview transaction must execute inside the supplied exclusive lock.');
  assert.equal(committedProject.priority, 'Critical', 'A transaction must apply its mutation to the latest stored Project.');
  assert.equal(committedProject.scheduledFutureHours, transactionLinkedProject.scheduledFutureHours, 'A stale UI fallback must not overwrite newer Scheduling capacity.');
  assert.deepEqual(committedProject.assignments.map((row) => row.id), transactionLinkedProject.assignments.map((row) => row.id), 'A stale UI fallback must not drop newer canonical assignments.');
  assert.strictEqual(storedState, committedState, 'The transaction must expose exactly the state whose persistence was confirmed.');

  let failedWriteCalls = 0;
  await assert.rejects(
    commitBrowserProjectsPreviewMutation(committedState, (latest) => reduceProjectInState(latest, transactionProject.id, (latestProject) => ({ ...latestProject, priority: 'Low' })), {
      read: () => committedState,
      write: () => {
        failedWriteCalls += 1;
        return false;
      },
      runExclusive: async (operation) => operation(),
    }),
    /could not be saved/,
    'A failed browser write must reject instead of reporting a successful Project mutation.',
  );
  assert.equal(failedWriteCalls, 1, 'A failed persistence attempt must be detected exactly once.');
  assert.equal(committedState.projects.find((row) => row.id === transactionProject.id)?.priority, 'Critical', 'A failed write must leave the previously committed state unchanged.');

  let unauthorizedReads = 0;
  let unauthorizedWrites = 0;
  await assert.rejects(
    commitBrowserProjectsPreviewMutation(committedState, (latest) => latest, {
      authorize: () => { throw new Error('permission revoked'); },
      read: () => {
        unauthorizedReads += 1;
        return committedState;
      },
      write: () => {
        unauthorizedWrites += 1;
        return true;
      },
      runExclusive: async (operation) => operation(),
    }),
    /permission revoked/,
    'Permission must be revalidated after acquiring the lock.',
  );
  assert.equal(unauthorizedReads, 0, 'A revoked Project permission must fail before preview data is read.');
  assert.equal(unauthorizedWrites, 0, 'A revoked Project permission must fail before preview data is written.');
}

void verifyPreviewTransactions()
  .then(() => console.log('Projects preview acceptance passed: editing, canonical metrics, safe transactions, migration, handoffs, assignment posting, financial linking, idempotency, health and remaining balances verified.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
