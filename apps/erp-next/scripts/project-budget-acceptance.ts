import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createProjectsPreviewState, planProjectScheduling, projectMetrics,
  linkProjectSchedulingAssignment, postProjectAssignment,
  commitBrowserProjectsPreviewMutation, type BrowserProject, type BrowserProjectsPreviewState,
} from '../lib/browser-projects';
import { calculateProjectLaborBudget } from '../lib/project-labor-budget';
import { createProjectPhase, projectPhases, schedulePreviewPhaseAssignment } from '../lib/project-phase-planner';

let passed = 0;
function check(name: string, run: () => void) { run(); passed += 1; console.log(`PASS: ${name}`); }
function fixture(): BrowserProject {
  return {
    ...createProjectsPreviewState().projects[0], id: 'BUDGET-TEST-PROJECT', projectNumber: 'PRJ-BUDGET-TEST',
    name: 'Synthetic budget test', customerId: 'BUDGET-TEST-CUSTOMER', siteId: 'BUDGET-TEST-PROPERTY',
    status: 'Planned', estimatedWorkDays: 11, slotsPerWorkDay: 6, slotDurationMinutes: 60,
    estimatedSlots: 66, estimatedLaborHours: 66, actualLaborHours: 0, scheduledFutureHours: 63,
    totalUnits: 10, completedUnits: 0, materialActual: 0, assignedVans: [],
    phases: [], assignments: [], materials: [], expenses: [], costEntries: [],
  };
}
function state(project = fixture()): BrowserProjectsPreviewState { return { version: 1, selectedProjectId: project.id, projects: [project] }; }
function linkInput(project = fixture()) {
  return {
    projectId: project.id, customerId: project.customerId, siteId: project.siteId, phaseId: '',
    appointmentId: 'BUDGET-TEST-APT', workOrderId: 'BUDGET-TEST-WO', bookingStatus: 'confirmed' as const,
    vanId: 'VAN-TEST', scheduledSlots: 6, scheduledDate: '2026-09-01', scheduledStart: '08:30', scheduledEnd: '15:30',
  };
}

check('66 estimate, 63 committed, six new slots: allowed with a three-hour forecast warning', () => {
  const project = fixture(); const original = structuredClone(project);
  const plan = planProjectScheduling(project, 6);
  assert.equal(plan.scheduledSlots, 6); assert.equal(plan.scheduledHours, 6);
  assert.equal(plan.remainingHoursBefore, 3); assert.equal(plan.remainingHoursAfter, 0);
  assert.equal(plan.laborBudget.committedHoursAfter, 69);
  assert.equal(plan.laborBudget.overBudgetHoursAfter, 3);
  assert.equal(plan.laborBudget.additionalOverBudgetHours, 3);
  assert.deepEqual(project, original);
});
check('exact budget boundary has no false warning', () => {
  const result = planProjectScheduling(fixture(), 3);
  assert.equal(result.laborBudget.committedHoursAfter, 66); assert.equal(result.laborBudget.overBudgetHoursAfter, 0);
});
check('zero remaining budget still accepts valid further work', () => {
  const result = planProjectScheduling({ ...fixture(), scheduledFutureHours: 66 }, 6);
  assert.equal(result.laborBudget.overBudgetHoursAfter, 6); assert.equal(result.scheduledHours, 6);
});
check('already-over-budget projects report the full overrun, not only the new visit', () => {
  const result = planProjectScheduling({ ...fixture(), scheduledFutureHours: 69 }, 6);
  assert.equal(result.laborBudget.committedHoursAfter, 75);
  assert.equal(result.laborBudget.overBudgetHoursBefore, 3);
  assert.equal(result.laborBudget.overBudgetHoursAfter, 9);
  assert.equal(result.laborBudget.additionalOverBudgetHours, 6);
});
check('recorded actuals of 70 against 66 show four actual over-budget hours, separately from allocation', () => {
  const result = calculateProjectLaborBudget({ ...fixture(), actualLaborHours: 70, scheduledFutureHours: 0 });
  assert.equal(result.actualOverBudgetHours, 4); assert.equal(result.overBudgetHoursAfter, 4);
  assert.equal(result.requestedHours, 0);
});
check('forecast overrun flags review without manufacturing actuals, cost or lifecycle completion', () => {
  const project = { ...fixture(), scheduledFutureHours: 70 };
  const before = structuredClone(project); const metrics = projectMetrics(project);
  assert.equal(metrics.health, 'At Risk'); assert.equal(metrics.laborBudget.overBudgetHoursAfter, 4);
  assert.equal(metrics.laborConsumption, 0); assert.equal(metrics.physicalCompletion, 0);
  assert.deepEqual(project, before);
});
check('whole-slot, positive-slot and per-van daily limits remain mandatory', () => {
  for (const slots of [0, -1, 0.5, 6.5, 7, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => planProjectScheduling(fixture(), slots), /whole number between 1 and 6/);
  }
});
check('cancelled, completed and on-hold projects are not reopened by an advisory budget', () => {
  for (const status of ['Completed', 'Cancelled', 'On Hold'] as const) {
    assert.throws(() => planProjectScheduling({ ...fixture(), status }, 6), /not available for Scheduling/);
  }
});
check('configured slot duration is preserved; a spot is not assumed to be one worked hour', () => {
  const plan = planProjectScheduling({ ...fixture(), slotDurationMinutes: 30 }, 6);
  assert.equal(plan.scheduledHours, 3); assert.equal(plan.laborBudget.overBudgetHoursAfter, 0);
});
check('invalid source quantities never become silently valid availability', () => {
  for (const field of ['estimatedLaborHours', 'actualLaborHours', 'scheduledFutureHours'] as const) {
    for (const value of [Number.NaN, Infinity, -1, null as unknown as number]) {
      assert.throws(() => calculateProjectLaborBudget({ ...fixture(), [field]: value }), /finite non-negative/);
    }
  }
  assert.throws(() => calculateProjectLaborBudget(fixture(), -1), /finite non-negative/);
});
check('fractional-hour arithmetic does not produce a floating-point-only overrun', () => {
  const plan = calculateProjectLaborBudget({ estimatedLaborHours: 0.3, actualLaborHours: 0.1, scheduledFutureHours: 0.2 });
  assert.equal(plan.overBudgetHoursAfter, 0);
});
check('new over-budget link preserves original estimates and records its scheduling snapshot', () => {
  const before = state(); const result = linkProjectSchedulingAssignment(before, linkInput());
  const project = result.projects[0]; const assignment = project.assignments[0];
  assert.equal(project.scheduledFutureHours, 69); assert.equal(project.estimatedLaborHours, 66);
  assert.equal(project.estimatedSlots, 66); assert.equal(project.estimatedWorkDays, 11);
  assert.equal(project.actualLaborHours, 0); assert.equal(project.completedUnits, 0); assert.equal(project.materialActual, 0);
  assert.equal(project.status, 'Planned'); assert.deepEqual(project.costEntries, []);
  assert.equal(assignment.laborBudgetAtScheduling?.overBudgetHoursAfter, 3);
  assert.equal(assignment.workOrderId, linkInput().workOrderId);
  assert.equal(before.projects[0].scheduledFutureHours, 63);
});
check('exact retry adds neither hours, warnings nor a duplicate Project assignment', () => {
  const first = linkProjectSchedulingAssignment(state(), linkInput());
  assert.strictEqual(linkProjectSchedulingAssignment(first, linkInput()), first);
  assert.equal(first.projects[0].assignments.length, 1);
});
check('promoting a held booking preserves its original budget evidence without double counting', () => {
  const input = { ...linkInput(), bookingStatus: 'temporary_hold' as const };
  const held = linkProjectSchedulingAssignment(state(), input);
  const confirmed = linkProjectSchedulingAssignment(held, { ...input, bookingStatus: 'confirmed' });
  assert.equal(confirmed.projects[0].scheduledFutureHours, 69);
  assert.strictEqual(confirmed.projects[0].assignments[0].laborBudgetAtScheduling, held.projects[0].assignments[0].laborBudgetAtScheduling);
});
check('customer, property, phase and reused Work Order mismatches still fail safely', () => {
  assert.throws(() => linkProjectSchedulingAssignment(state(), { ...linkInput(), customerId: 'WRONG' }), /not linked/);
  assert.throws(() => linkProjectSchedulingAssignment(state(), { ...linkInput(), siteId: 'WRONG' }), /must use canonical/);
  assert.throws(() => linkProjectSchedulingAssignment(state(), { ...linkInput(), phaseId: 'WRONG' }), /does not belong/);
  const first = linkProjectSchedulingAssignment(state(), linkInput());
  assert.throws(() => linkProjectSchedulingAssignment(first, { ...linkInput(), scheduledSlots: 5 }), /conflicts/);
});
check('over-budget canonical work cannot be posted as fake actuals from Projects preview', () => {
  const project = linkProjectSchedulingAssignment(state(), linkInput()).projects[0];
  assert.throws(() => postProjectAssignment(project, { assignmentId: project.assignments[0].id, materialLines: [], postedAt: '2026-09-01T17:00:00.000Z' }), /canonical Appointment and Work Order lifecycle/);
});
function phased() {
  return createProjectPhase({ ...fixture(), scheduledFutureHours: 0 }, {
    name: 'Synthetic phase', sequence: 1, objective: 'Test scope', scopeOfWork: 'Test scope', plannedHours: 3,
    plannedUnits: 1, progressMethod: 'units', startsOn: '2026-09-01', endsOn: '2026-09-02', dependencies: [],
    completionCriteria: 'Approved scope complete', priority: 'Normal', responsibleManager: 'Test manager', workflowStatus: 'Ready to Schedule',
  }, '2026-09-01T10:00:00.000Z');
}
check('phase budget excess warns while whole project budget remains available', () => {
  const project = phased(); const phase = projectPhases(project)[0];
  const plan = planProjectScheduling(project, 6, phase.id);
  assert.equal(plan.laborBudget.overBudgetHoursAfter, 0); assert.equal(plan.phaseLaborBudget?.overBudgetHoursAfter, 3);
  const result = schedulePreviewPhaseAssignment(project, { phaseId: phase.id, scheduledDate: '2026-09-01', scheduledStart: '08:30', scheduledSlots: 6, vanId: 'VAN-TEST', technicianIds: [], unitsPlanned: 0 }, '2026-09-01T11:00:00.000Z');
  assert.equal(result.phases[0].estimatedLaborHours, 3); assert.equal(result.scheduledFutureHours, 6);
  assert.equal(result.assignments[0].phaseLaborBudgetAtScheduling?.overBudgetHoursAfter, 3);
});
check('closed phases and incomplete dependencies are not overridden by a budget warning', () => {
  const project = phased(); const phase = projectPhases(project)[0];
  const input = { phaseId: phase.id, scheduledDate: '2026-09-01', scheduledStart: '08:30', scheduledSlots: 6, vanId: 'VAN-TEST', technicianIds: [], unitsPlanned: 0 };
  assert.throws(() => schedulePreviewPhaseAssignment({ ...project, phases: [{ ...phase, workflowStatus: 'Completed' } as typeof phase] }, input), /cannot accept new work/);
  const dependent = { ...phase, id: 'DEPENDENT', dependencies: [phase.id] };
  assert.throws(() => schedulePreviewPhaseAssignment({ ...project, phases: [...project.phases, dependent] }, { ...input, phaseId: dependent.id }), /blocked until/);
});
check('UI leaves authorization and real availability gates in place and does not mark a forecast invalid', () => {
  const drawer = readFileSync('components/scheduling/live-appointment-create-drawer.tsx', 'utf8');
  const dialog = readFileSync('components/projects/project-phase-planner-dialogs.tsx', 'utf8');
  assert.match(drawer, /<ProjectLaborBudgetWarning budget=\{projectPlan\.laborBudget\}/);
  assert.match(drawer, /aria-invalid=\{Boolean\(projectPlanState\.error\)\}/);
  assert.match(drawer, /if \(!activeValidation \|\| !selectedValidatedOption\) return/);
  assert.match(drawer, /await confirmOfficeAppointment\(/);
  assert.match(drawer, /projectAccessRef\.current\.canManage/);
  assert.doesNotMatch(dialog, /disabled=\{busy \|\| hours > remaining \|\| hours > projectRemaining\}/);
});

async function main() {
  let current = state(); let writes = 0;
  const options = {
    read: () => current,
    write: (next: BrowserProjectsPreviewState) => { current = next; writes += 1; return true; },
    authorize: () => {},
    runExclusive: async (operation: () => BrowserProjectsPreviewState) => operation(),
  };
  const stale = current;
  await commitBrowserProjectsPreviewMutation(stale, (latest) => linkProjectSchedulingAssignment(latest, linkInput()), options);
  await commitBrowserProjectsPreviewMutation(stale, (latest) => linkProjectSchedulingAssignment(latest, { ...linkInput(), appointmentId: 'BUDGET-TEST-APT-2', workOrderId: 'BUDGET-TEST-WO-2' }), options);
  check('local mutation derives the new forecast from the latest record, not the stale form', () => {
    assert.equal(current.projects[0].scheduledFutureHours, 75); assert.equal(writes, 2);
    assert.equal(current.projects[0].assignments[1].laborBudgetAtScheduling?.overBudgetHoursAfter, 9);
  });
  console.log(`Project budget acceptance: ${passed} scenarios passed. Synthetic/local tests only; no live booking was made.`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
