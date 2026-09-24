import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editBrowserProject, projectHasOperationalActivity, type BrowserProject } from '../lib/browser-projects';
import {
  allocateTemplateHours,
  applyPhaseTemplate,
  completePreviewPhaseAssignment,
  companyTemplateFromProject,
  createProjectPhase,
  deleteProjectPhase,
  editProjectPhase,
  markProjectPhaseComplete,
  phaseCapacitySummary,
  phaseCompletionBlockers,
  phaseProgressPercent,
  phaseRemainingHours,
  projectPhases,
  reorderProjectPhases,
  schedulePreviewPhaseAssignment,
  suggestedPhaseTemplates,
} from '../lib/project-phase-planner';
import { KNOWN_PROJECT_SAMPLE_IDS, sanitizeProjectsState } from '../lib/project-record-sanitizer';

function projectFixture(): BrowserProject {
  return {
    id: 'PHASE-TEST-PROJECT', projectNumber: 'PRJ-PHASE-TEST', name: 'Phase Planner Acceptance',
    customerId: 'CUSTOMER-1', customerName: 'Customer', siteId: 'PROPERTY-1', location: 'Aruba', contactPerson: 'Customer',
    type: 'VRF Project', description: 'Acceptance fixture', technicianInstructions: 'Protect finished surfaces.', status: 'Draft', priority: 'High',
    managerId: 'MANAGER-1', managerName: 'Project Manager', startsOn: '2026-09-11', estimatedCompletionOn: '2026-10-16',
    totalUnits: 11, completedUnits: 0, unitType: 'Units', estimatedWorkDays: 11, slotsPerWorkDay: 6, slotDurationMinutes: 60,
    estimatedSlots: 66, estimatedLaborHours: 66, scheduledFutureHours: 0, actualLaborHours: 0, materialBudget: 9000, materialActual: 0,
    assignedVans: [], phases: [], materials: [], expenses: [], costEntries: [], assignments: [],
  };
}

const workspaceSource = readFileSync('components/projects/projects-phase-workspace-v2.tsx', 'utf8');
assert.match(workspaceSource, /loadBookingMasterReferenceData/, 'Create Project must load canonical CRM customer and Property references.');
assert.match(workspaceSource, /role="combobox"/, 'Customer entry must remain an accessible autocomplete combobox.');
assert.match(workspaceSource, /matchingCustomers\(references, customerQuery\)/, 'Typing a customer name must render canonical CRM matches.');
assert.match(workspaceSource, /createOfficeCustomer/, 'An explicit no-match selection must retain canonical customer creation.');
assert.match(workspaceSource, /Property \/ service location/, 'The selected CRM customer must expose its canonical Service Properties.');
assert.match(workspaceSource, /if \(!createCustomer\) throw new Error\('Select an existing CRM customer/, 'Free-text customer names must not silently create or link Projects.');
assert.match(workspaceSource, /<CanonicalEditProjectDialog/, 'The active Projects screen must open its Edit Project dialog.');
assert.match(workspaceSource, /onClick=\{\(\) => setEditProjectOpen\(true\)\}/, 'The active Project header must expose Edit Project.');
assert.match(workspaceSource, /editBrowserProject\(/, 'Edits must use the governed Project edit reducer.');
assert.match(workspaceSource, /commitSharedProjects\(/, 'Edits must persist through the shared Project save path.');
assert.match(workspaceSource, /name="technicianInstructions"/, 'The editor must expose default instructions for future technician visits.');
assert.doesNotMatch(workspaceSource, /FEATURE PREVIEW|isolated (feature )?branch/, 'The active Projects screen must not display a stale feature-preview banner or isolated-branch copy.');

const fixture = projectFixture();
const propertyFreeSharedDraft = { ...fixture, siteId: '', location: 'Property to be confirmed', serverVersion: 1 };
const sharedDraftState = { version: 1 as const, selectedProjectId: fixture.id, projects: [propertyFreeSharedDraft] };
const baseEdit = {
  projectId: fixture.id, name: fixture.name, description: fixture.description,
  type: fixture.type, siteId: fixture.siteId, location: fixture.location,
  status: fixture.status, priority: fixture.priority, totalUnits: fixture.totalUnits,
  materialBudget: fixture.materialBudget, startsOn: fixture.startsOn,
  estimatedCompletionOn: fixture.estimatedCompletionOn, estimatedWorkDays: fixture.estimatedWorkDays,
  technicianInstructions: fixture.technicianInstructions,
};
const attached = editBrowserProject(sharedDraftState, {
  ...baseEdit, description: 'Revised project scope', technicianInstructions: 'Enter through the west gate.',
}).projects[0];
assert.equal(attached.siteId, fixture.siteId, 'A published Draft without activity may attach its first canonical Property.');
assert.equal(attached.technicianInstructions, 'Enter through the west gate.', 'Project edits must persist technician instructions.');
assert.equal(attached.description, 'Revised project scope', 'Project edits must persist revised scope.');
assert.equal(attached.customerId, fixture.customerId, 'Project editing must preserve canonical customer identity.');
assert.throws(() => editBrowserProject({ ...sharedDraftState, projects: [attached] }, { ...baseEdit, siteId: 'PROPERTY-2' }), /shared Project is locked/, 'A published Project Property cannot be switched after its first link.');
assert.throws(() => editBrowserProject({ ...sharedDraftState, projects: [attached] }, { ...baseEdit, estimatedWorkDays: 10 }), /Reducing a shared Project slot budget/, 'The editor must fail closed on a published budget decrease until canonical Scheduling verifies it.');
assert.equal(editBrowserProject({ ...sharedDraftState, projects: [attached] }, { ...baseEdit, estimatedWorkDays: 12 }).projects[0].estimatedSlots, 72, 'Published work-day increases must recalculate the one-hour slot plan.');
const exactSeed = { ...fixture, id: 'DEMO-PRJ-VRF-001', projectNumber: 'PRJ-1007', name: 'Seeded sample' };
const userCreatedLegacyId = { ...fixture, id: 'DEMO-PRJ-1788364800000', projectNumber: 'PRJ-1013', name: 'User-created project' };
const sanitized = sanitizeProjectsState({
  version: 1,
  selectedProjectId: exactSeed.id,
  projects: [exactSeed, userCreatedLegacyId],
});
assert.equal(KNOWN_PROJECT_SAMPLE_IDS.has(exactSeed.id), true, 'The exact historical sample ID must be recognized.');
assert.deepEqual(sanitized.removedIds, [exactSeed.id], 'Only the exact seeded sample record must be removed.');
assert.deepEqual(sanitized.state.projects.map((project) => project.id), [userCreatedLegacyId.id], 'A user-created timestamp Project must be preserved even when its legacy ID begins with DEMO-PRJ.');
assert.equal(sanitized.state.selectedProjectId, userCreatedLegacyId.id, 'Selection must move safely to the preserved user Project.');

assert.deepEqual(allocateTemplateHours(10, [
  { name: 'A', weight: 1, objective: '', scopeOfWork: '', completionCriteria: '', technicianInstructions: '', progressMethod: 'hours', checklist: [], priority: 'Normal' },
  { name: 'B', weight: 1, objective: '', scopeOfWork: '', completionCriteria: '', technicianInstructions: '', progressMethod: 'hours', checklist: [], priority: 'Normal' },
  { name: 'C', weight: 1, objective: '', scopeOfWork: '', completionCriteria: '', technicianInstructions: '', progressMethod: 'hours', checklist: [], priority: 'Normal' },
]), [4, 3, 3], 'Template allocation must preserve the exact available capacity.');

const custom = createProjectPhase(fixture, {
  name: 'Custom Piping Phase', sequence: 10, objective: 'Complete the approved piping network.',
  scopeOfWork: 'Install copper, insulation, supports, and drainage.', plannedHours: 18, progressMethod: 'checklist', plannedUnits: 0,
  checklistText: 'Copper installed\nDrainage installed\nEvidence uploaded', startsOn: '2026-09-11', endsOn: '2026-09-18', dependencies: [],
  technicianInstructions: 'Photograph concealed work.', completionCriteria: 'All checklist items are complete.', priority: 'Critical',
  responsibleManager: 'Project Manager', workflowStatus: 'Ready to Schedule',
}, '2026-09-03T20:00:00.000Z');
const customPhase = projectPhases(custom)[0];
const quietPhase = { ...customPhase, status: 'Planned' as const, workflowStatus: 'Ready to Schedule' as const, progress: 0, fieldReports: [], actualLaborHours: 0, actualMaterialCost: 0, unitsCompleted: 0 };
assert.equal(projectHasOperationalActivity({ ...fixture, phases: [quietPhase] }), false, 'An unexecuted planned phase must not lock Project structure.');
assert.equal(projectHasOperationalActivity({ ...fixture, phases: [{ ...quietPhase, progress: 1 }] }), true, 'Recorded phase progress must lock Project structure.');
assert.equal(projectHasOperationalActivity({ ...fixture, phases: [{ ...quietPhase, fieldReports: [{}] }] }), true, 'A phase field report must lock Project structure.');
assert.equal(projectHasOperationalActivity({ ...fixture, phases: [{ ...quietPhase, workflowStatus: 'In Progress' }] }), true, 'An active phase workflow must lock Project structure.');
assert.throws(() => editBrowserProject({ version: 1, selectedProjectId: fixture.id, projects: [{ ...fixture, phases: [{ ...quietPhase, progress: 1 }] }] }, { ...baseEdit, siteId: 'PROPERTY-2', location: 'New location' }), /cannot change after Scheduling work or actual cost exists/, 'Generic editing must not move a Project Property after phase progress was recorded.');
assert.equal(phaseCapacitySummary(custom).allocated, 18, 'Custom phase must reserve only its approved capacity.');
assert.equal(phaseCapacitySummary(custom).unallocated, 48, 'Unallocated Project capacity must remain available.');
assert.equal(customPhase.checklist.length, 3, 'Checklist progress must retain each custom item.');

assert.throws(() => createProjectPhase(custom, {
  name: 'Over-allocation', sequence: 20, objective: 'Invalid', scopeOfWork: 'Invalid', plannedHours: 49, progressMethod: 'hours', plannedUnits: 0,
  startsOn: '2026-09-19', endsOn: '2026-09-20', dependencies: [], completionCriteria: 'Invalid', priority: 'Normal', responsibleManager: 'Project Manager',
}), /Project budget is 66h/, 'Phase allocation must never exceed the Project labor budget.');

const scheduled = schedulePreviewPhaseAssignment(custom, {
  phaseId: customPhase.id, scheduledDate: '2026-09-12', scheduledStart: '08:00', scheduledSlots: 4,
  vanId: 'VAN-2', technicianIds: ['TECH-1', 'TECH-2'], unitsPlanned: 0,
}, '2026-09-03T21:00:00.000Z');
const assignment = scheduled.assignments[0];
assert.equal(scheduled.scheduledFutureHours, 4, 'Scheduling must reserve Project future capacity.');
assert.equal(phaseRemainingHours(scheduled, customPhase), 14, 'Phase remaining capacity must exclude scheduled work.');

assert.throws(() => editProjectPhase(scheduled, {
  phaseId: customPhase.id, name: customPhase.name, sequence: customPhase.sequence, objective: customPhase.objective, scopeOfWork: customPhase.scopeOfWork,
  plannedHours: 3, progressMethod: customPhase.progressMethod, plannedUnits: customPhase.unitsPlanned,
  checklistText: customPhase.checklist.map((item) => item.label).join('\n'), startsOn: customPhase.startsOn, endsOn: customPhase.endsOn,
  dependencies: customPhase.dependencies, technicianInstructions: customPhase.technicianInstructions, completionCriteria: customPhase.completionCriteria,
  priority: customPhase.priority, responsibleManager: customPhase.responsibleManager, workflowStatus: customPhase.workflowStatus,
}), /cannot be below 4 committed hours/, 'A phase budget cannot be reduced below scheduled plus actual hours.');

const posted = completePreviewPhaseAssignment(scheduled, {
  assignmentId: assignment.id, actualHours: 3.5, unitsCompleted: 0, note: 'Piping and drainage completed in the assigned area.', evidenceCount: 6,
  checklistCompletedIds: customPhase.checklist.map((item) => item.id), postedAt: '2026-09-03T22:00:00.000Z', technicianName: 'Technician',
});
const postedPhase = projectPhases(posted)[0];
assert.equal(posted.actualLaborHours, 3.5, 'Field completion must post actual Project labor once.');
assert.equal(posted.scheduledFutureHours, 0, 'Posting must release the assignment future reservation.');
assert.equal(postedPhase.fieldReports.length, 1, 'Field completion must append one phase report.');
assert.equal(phaseProgressPercent(postedPhase), 100, 'Completing the required checklist must produce full scope progress.');
assert.equal(posted.assignments[0].postedAt, '2026-09-03T22:00:00.000Z', 'Assignment posting must retain its idempotency marker.');
assert.strictEqual(completePreviewPhaseAssignment(posted, {
  assignmentId: assignment.id, actualHours: 3.5, unitsCompleted: 0, note: 'Retry', evidenceCount: 6,
  checklistCompletedIds: customPhase.checklist.map((item) => item.id), postedAt: '2026-09-03T22:01:00.000Z',
}), posted, 'Repeating field completion must remain an idempotent no-op.');

assert.deepEqual(phaseCompletionBlockers(posted, postedPhase.id), [], 'A fully posted checklist phase must be eligible for manager completion.');
const completed = markProjectPhaseComplete(posted, postedPhase.id, '2026-09-03T23:00:00.000Z');
assert.equal(projectPhases(completed)[0].workflowStatus, 'Completed', 'Manager completion must close the phase without manufacturing actuals.');
assert.throws(() => deleteProjectPhase(completed, postedPhase.id), /cannot be deleted/, 'A phase with operational history must remain auditable.');

const templated = applyPhaseTemplate(fixture, suggestedPhaseTemplates[0], '2026-09-03T20:00:00.000Z');
const templatePhases = projectPhases(templated);
assert.equal(templatePhases.length, suggestedPhaseTemplates[0].phases.length, 'Suggested templates must create every editable phase.');
assert.equal(phaseCapacitySummary(templated).allocated, 66, 'A template applied to an empty Project must allocate the available capacity exactly.');
assert.ok(templatePhases.slice(1).every((phase) => phase.dependencies.length === 1), 'Sequential template phases must preserve dependencies.');

const companyTemplate = companyTemplateFromProject(templated, 'DEMAC VRF Standard', '2026-09-03T23:30:00.000Z');
assert.equal(companyTemplate.source, 'Company', 'Owner-created templates must remain distinguishable from suggestions.');
assert.equal(companyTemplate.phases.length, templatePhases.length, 'Company templates must preserve the complete custom phase structure.');

const reordered = reorderProjectPhases(templated, templatePhases.map((phase) => phase.id).reverse());
assert.deepEqual(projectPhases(reordered).map((phase) => phase.id), templatePhases.map((phase) => phase.id).reverse(), 'Phase reordering must be stable and explicit.');

console.log('Project Phase Planner acceptance passed: canonical CRM customer search, shared Edit Project and technician instructions, one-time Property attachment, published budget-decrease guard, exact sample removal, user-project preservation, custom phases, capacity, templates, Scheduling preview, technician actuals, idempotency, completion, deletion protection, and reorder verified.');
