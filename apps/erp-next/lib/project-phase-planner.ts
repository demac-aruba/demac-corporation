import {
  GENERAL_PROJECT_WORK_PHASE_ID,
  postProjectAssignment,
  projectMetrics,
  type BrowserProject,
  type BrowserProjectsPreviewState,
  type ProjectAssignment,
  type ProjectPhase,
} from './browser-projects';

export type PhaseProgressMethod = 'units' | 'checklist' | 'hours' | 'approval';
export type PhaseWorkflowStatus =
  | 'Draft'
  | 'Ready to Schedule'
  | 'In Progress'
  | 'Blocked'
  | 'On Hold'
  | 'Near Completion'
  | 'Completed'
  | 'Cancelled';
export type PhasePriority = 'Low' | 'Normal' | 'High' | 'Critical';

export type PhaseChecklistItem = {
  id: string;
  label: string;
  required: boolean;
  done: boolean;
};

export type PhaseFieldReport = {
  id: string;
  assignmentId: string;
  technician: string;
  note: string;
  actualHours: number;
  unitsCompleted: number;
  evidenceCount: number;
  checklistCompletedIds: string[];
  createdAt: string;
};

export type PlannedProjectPhase = ProjectPhase & {
  sequence: number;
  objective: string;
  scopeOfWork: string;
  outOfScope?: string;
  technicianInstructions?: string;
  completionCriteria: string;
  dependencies: string[];
  priority: PhasePriority;
  responsibleManager: string;
  progressMethod: PhaseProgressMethod;
  checklist: PhaseChecklistItem[];
  workflowStatus: PhaseWorkflowStatus;
  fieldReports: PhaseFieldReport[];
  createdAt?: string;
  updatedAt?: string;
};

export type PhaseDraftInput = {
  phaseId?: string;
  name: string;
  sequence: number;
  objective: string;
  scopeOfWork: string;
  outOfScope?: string;
  plannedHours: number;
  progressMethod: PhaseProgressMethod;
  plannedUnits: number;
  checklistText?: string;
  startsOn: string;
  endsOn: string;
  dependencies: string[];
  technicianInstructions?: string;
  completionCriteria: string;
  priority: PhasePriority;
  responsibleManager: string;
  workflowStatus?: PhaseWorkflowStatus;
};

export type PhaseTemplateItem = {
  name: string;
  weight: number;
  objective: string;
  scopeOfWork: string;
  completionCriteria: string;
  technicianInstructions: string;
  progressMethod: PhaseProgressMethod;
  plannedUnits?: number;
  checklist: string[];
  priority: PhasePriority;
  dependsOnPrevious?: boolean;
};

export type PhaseTemplate = {
  id: string;
  name: string;
  description: string;
  projectTypes: string[];
  source: 'Suggested' | 'Company';
  phases: PhaseTemplateItem[];
  createdAt?: string;
};

export type PhaseCapacitySummary = {
  total: number;
  allocated: number;
  unallocated: number;
  scheduled: number;
  actual: number;
  committed: number;
  allocationPercent: number;
};

export type PreviewPhaseAssignmentInput = {
  phaseId: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledSlots: number;
  vanId: string;
  technicianIds: string[];
  unitsPlanned: number;
};

export type PreviewPhaseCompletionInput = {
  assignmentId: string;
  actualHours: number;
  unitsCompleted: number;
  note: string;
  evidenceCount: number;
  checklistCompletedIds: string[];
  postedAt: string;
  technicianName?: string;
};

const DEFAULT_OBJECTIVE = 'Execute the approved phase scope safely and document the outcome.';
const DEFAULT_COMPLETION = 'Approved scope is complete, evidence is recorded, and no blocking work remains.';

function trim(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function assertDate(value: string, label: string) {
  const normalized = trim(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) throw new Error(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${normalized}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${label} must be a valid date.`);
  }
  return normalized;
}

function finiteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a valid non-negative number.`);
  return value;
}

function wholeNonNegative(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative whole number.`);
  return value;
}

function positiveWhole(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive whole number.`);
  return value;
}

function stableChecklistId(label: string, index: number) {
  const slug = label.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `CHK-${index + 1}-${slug || 'item'}`;
}

export function parseChecklistText(value: string | undefined, current: PhaseChecklistItem[] = []): PhaseChecklistItem[] {
  const existing = new Map(current.map((item) => [item.label.toLocaleLowerCase('en'), item]));
  return (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\s]+/, '').trim())
    .filter(Boolean)
    .filter((line, index, lines) => lines.findIndex((candidate) => candidate.toLocaleLowerCase('en') === line.toLocaleLowerCase('en')) === index)
    .map((label, index) => {
      const previous = existing.get(label.toLocaleLowerCase('en'));
      return previous ? { ...previous, label } : { id: stableChecklistId(label, index), label, required: true, done: false };
    });
}

function legacyProgressMethod(phase: ProjectPhase): PhaseProgressMethod {
  if (phase.unitsPlanned > 0) return 'units';
  if (phase.progress > 0) return 'hours';
  return 'approval';
}

function workflowFromBase(phase: ProjectPhase): PhaseWorkflowStatus {
  if (phase.status === 'Completed') return 'Completed';
  if (phase.status === 'Delayed') return 'Blocked';
  if (phase.status === 'In Progress') return phase.progress >= 85 ? 'Near Completion' : 'In Progress';
  return 'Ready to Schedule';
}

function baseFromWorkflow(status: PhaseWorkflowStatus): ProjectPhase['status'] {
  if (status === 'Completed' || status === 'Cancelled') return 'Completed';
  if (status === 'Blocked') return 'Delayed';
  if (status === 'In Progress' || status === 'On Hold' || status === 'Near Completion') return 'In Progress';
  return 'Planned';
}

export function plannedPhase(phase: ProjectPhase, index = 0): PlannedProjectPhase {
  const candidate = phase as PlannedProjectPhase;
  const progressMethod = candidate.progressMethod ?? legacyProgressMethod(phase);
  const checklist = Array.isArray(candidate.checklist) ? candidate.checklist : [];
  return {
    ...phase,
    sequence: Number.isFinite(candidate.sequence) ? candidate.sequence : (index + 1) * 10,
    objective: trim(candidate.objective) || DEFAULT_OBJECTIVE,
    scopeOfWork: trim(candidate.scopeOfWork) || phase.name,
    outOfScope: trim(candidate.outOfScope) || undefined,
    technicianInstructions: trim(candidate.technicianInstructions) || undefined,
    completionCriteria: trim(candidate.completionCriteria) || DEFAULT_COMPLETION,
    dependencies: Array.isArray(candidate.dependencies) ? candidate.dependencies.filter((value) => typeof value === 'string') : [],
    priority: candidate.priority ?? 'Normal',
    responsibleManager: trim(candidate.responsibleManager) || 'Not assigned',
    progressMethod,
    checklist,
    workflowStatus: candidate.workflowStatus ?? workflowFromBase(phase),
    fieldReports: Array.isArray(candidate.fieldReports) ? candidate.fieldReports : [],
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

export function projectPhases(project: BrowserProject): PlannedProjectPhase[] {
  return project.phases
    .map((phase, index) => plannedPhase(phase, index))
    .sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name));
}

export function phaseAssignments(project: BrowserProject, phaseId: string): ProjectAssignment[] {
  return project.assignments.filter((assignment) => assignment.phaseId === phaseId);
}

export function phaseScheduledHours(project: BrowserProject, phaseId: string): number {
  return phaseAssignments(project, phaseId)
    .filter((assignment) => !assignment.postedAt && assignment.status !== 'Completed')
    .reduce((sum, assignment) => sum + Math.max(0, assignment.scheduledHours), 0);
}

export function phaseRemainingHours(project: BrowserProject, phase: ProjectPhase): number {
  return Math.max(0, phase.estimatedLaborHours - phase.actualLaborHours - phaseScheduledHours(project, phase.id));
}

export function phaseCapacitySummary(project: BrowserProject): PhaseCapacitySummary {
  const phases = projectPhases(project).filter((phase) => phase.workflowStatus !== 'Cancelled');
  const allocated = phases.reduce((sum, phase) => sum + Math.max(0, phase.estimatedLaborHours), 0);
  const scheduled = phases.reduce((sum, phase) => sum + phaseScheduledHours(project, phase.id), 0);
  const actual = phases.reduce((sum, phase) => sum + Math.max(0, phase.actualLaborHours), 0);
  return {
    total: project.estimatedLaborHours,
    allocated,
    unallocated: Math.max(0, project.estimatedLaborHours - allocated),
    scheduled,
    actual,
    committed: scheduled + actual,
    allocationPercent: project.estimatedLaborHours > 0 ? allocated / project.estimatedLaborHours * 100 : 0,
  };
}

export function phaseProgressPercent(phaseInput: ProjectPhase): number {
  const phase = plannedPhase(phaseInput);
  if (phase.workflowStatus === 'Completed') return 100;
  if (phase.workflowStatus === 'Cancelled') return 0;
  if (phase.progressMethod === 'units') {
    return phase.unitsPlanned > 0 ? Math.min(100, phase.unitsCompleted / phase.unitsPlanned * 100) : 0;
  }
  if (phase.progressMethod === 'checklist') {
    const required = phase.checklist.filter((item) => item.required);
    const basis = required.length ? required : phase.checklist;
    return basis.length ? Math.min(100, basis.filter((item) => item.done).length / basis.length * 100) : 0;
  }
  if (phase.progressMethod === 'hours') {
    return phase.estimatedLaborHours > 0 ? Math.min(100, phase.actualLaborHours / phase.estimatedLaborHours * 100) : 0;
  }
  return Math.max(0, Math.min(100, phase.progress));
}

export function phaseStatusAfterProgress(phaseInput: ProjectPhase): PhaseWorkflowStatus {
  const phase = plannedPhase(phaseInput);
  if (phase.workflowStatus === 'Cancelled' || phase.workflowStatus === 'Blocked' || phase.workflowStatus === 'On Hold') return phase.workflowStatus;
  const progress = phaseProgressPercent(phase);
  if (progress >= 100) return phase.progressMethod === 'approval' ? 'Near Completion' : 'Completed';
  if (progress >= 85) return 'Near Completion';
  if (phase.actualLaborHours > 0 || progress > 0) return 'In Progress';
  return phase.workflowStatus === 'Draft' ? 'Draft' : 'Ready to Schedule';
}

export function phaseRisk(project: BrowserProject, phaseInput: ProjectPhase): 'On Track' | 'At Risk' | 'Over Budget' | 'Blocked' {
  const phase = plannedPhase(phaseInput);
  if (phase.workflowStatus === 'Blocked') return 'Blocked';
  const scheduled = phaseScheduledHours(project, phase.id);
  const committed = phase.actualLaborHours + scheduled;
  if (phase.actualLaborHours > phase.estimatedLaborHours) return 'Over Budget';
  if (phase.estimatedLaborHours > 0 && committed / phase.estimatedLaborHours >= 0.85 && phaseProgressPercent(phase) < 70) return 'At Risk';
  return 'On Track';
}

function normalizeDraft(project: BrowserProject, input: PhaseDraftInput, existing?: PlannedProjectPhase) {
  const name = trim(input.name);
  if (!name) throw new Error('Phase name is required.');
  if (name.length > 160) throw new Error('Phase name must be 160 characters or fewer.');
  const objective = trim(input.objective);
  if (!objective) throw new Error('Objective / reason is required.');
  const scopeOfWork = trim(input.scopeOfWork);
  if (!scopeOfWork) throw new Error('Scope of work is required.');
  const completionCriteria = trim(input.completionCriteria);
  if (!completionCriteria) throw new Error('Completion criteria are required.');
  const sequence = positiveWhole(input.sequence, 'Sequence');
  const plannedHours = positiveWhole(input.plannedHours, 'Planned capacity');
  const plannedUnits = input.progressMethod === 'units' ? positiveWhole(input.plannedUnits, 'Planned units') : wholeNonNegative(input.plannedUnits, 'Planned units');
  const startsOn = assertDate(input.startsOn, 'Planned start date');
  const endsOn = assertDate(input.endsOn, 'Target completion date');
  if (endsOn < startsOn) throw new Error('Target completion cannot be earlier than planned start.');
  const phaseIds = new Set(project.phases.map((phase) => phase.id));
  const dependencies = [...new Set(input.dependencies.map(trim).filter(Boolean))];
  for (const dependency of dependencies) {
    if (dependency === existing?.id) throw new Error('A phase cannot depend on itself.');
    if (!phaseIds.has(dependency)) throw new Error(`Dependency ${dependency} is not part of this Project.`);
  }
  const checklist = input.progressMethod === 'checklist'
    ? parseChecklistText(input.checklistText, existing?.checklist)
    : existing?.checklist ?? [];
  if (input.progressMethod === 'checklist' && checklist.length === 0) {
    throw new Error('Add at least one checklist item for checklist-based progress.');
  }
  const allocatedWithoutCurrent = project.phases.reduce((sum, phase) => sum + (phase.id === existing?.id ? 0 : Math.max(0, phase.estimatedLaborHours)), 0);
  if (allocatedWithoutCurrent + plannedHours > project.estimatedLaborHours) {
    throw new Error(`This phase would allocate ${allocatedWithoutCurrent + plannedHours}h, but the Project budget is ${project.estimatedLaborHours}h.`);
  }
  if (existing) {
    const committed = existing.actualLaborHours + phaseScheduledHours(project, existing.id);
    if (plannedHours < committed) {
      throw new Error(`Planned capacity cannot be below ${committed} committed hours (${existing.actualLaborHours} actual + ${phaseScheduledHours(project, existing.id)} scheduled).`);
    }
  }
  return {
    name,
    sequence,
    objective,
    scopeOfWork,
    outOfScope: trim(input.outOfScope) || undefined,
    plannedHours,
    progressMethod: input.progressMethod,
    plannedUnits,
    checklist,
    startsOn,
    endsOn,
    dependencies,
    technicianInstructions: trim(input.technicianInstructions) || undefined,
    completionCriteria,
    priority: input.priority,
    responsibleManager: trim(input.responsibleManager) || 'Not assigned',
    workflowStatus: input.workflowStatus ?? existing?.workflowStatus ?? 'Draft',
  };
}

function phaseId(now: string, name: string) {
  const stamp = new Date(now).getTime().toString(36).toUpperCase();
  const slug = name.toLocaleUpperCase('en').replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18) || 'PHASE';
  return `PH-${stamp}-${slug}`;
}

export function createProjectPhase(project: BrowserProject, input: PhaseDraftInput, now = new Date().toISOString()): BrowserProject {
  const normalized = normalizeDraft(project, input);
  const status = normalized.workflowStatus;
  const phase: PlannedProjectPhase = {
    id: phaseId(now, normalized.name),
    name: normalized.name,
    status: baseFromWorkflow(status),
    estimatedLaborHours: normalized.plannedHours,
    actualLaborHours: 0,
    estimatedMaterialCost: 0,
    actualMaterialCost: 0,
    unitsPlanned: normalized.plannedUnits,
    unitsCompleted: 0,
    progress: 0,
    startsOn: normalized.startsOn,
    endsOn: normalized.endsOn,
    sequence: normalized.sequence,
    objective: normalized.objective,
    scopeOfWork: normalized.scopeOfWork,
    outOfScope: normalized.outOfScope,
    technicianInstructions: normalized.technicianInstructions,
    completionCriteria: normalized.completionCriteria,
    dependencies: normalized.dependencies,
    priority: normalized.priority,
    responsibleManager: normalized.responsibleManager,
    progressMethod: normalized.progressMethod,
    checklist: normalized.checklist,
    workflowStatus: status,
    fieldReports: [],
    createdAt: now,
    updatedAt: now,
  };
  return { ...project, phases: [...project.phases, phase] };
}

export function editProjectPhase(project: BrowserProject, input: PhaseDraftInput, now = new Date().toISOString()): BrowserProject {
  const id = trim(input.phaseId);
  const index = project.phases.findIndex((phase) => phase.id === id);
  if (index < 0) throw new Error(`Phase ${id || '(missing id)'} does not exist in ${project.projectNumber}.`);
  const existing = plannedPhase(project.phases[index], index);
  const normalized = normalizeDraft(project, input, existing);
  const next: PlannedProjectPhase = {
    ...existing,
    name: normalized.name,
    status: baseFromWorkflow(normalized.workflowStatus),
    estimatedLaborHours: normalized.plannedHours,
    unitsPlanned: normalized.plannedUnits,
    startsOn: normalized.startsOn,
    endsOn: normalized.endsOn,
    sequence: normalized.sequence,
    objective: normalized.objective,
    scopeOfWork: normalized.scopeOfWork,
    outOfScope: normalized.outOfScope,
    technicianInstructions: normalized.technicianInstructions,
    completionCriteria: normalized.completionCriteria,
    dependencies: normalized.dependencies,
    priority: normalized.priority,
    responsibleManager: normalized.responsibleManager,
    progressMethod: normalized.progressMethod,
    checklist: normalized.checklist,
    workflowStatus: normalized.workflowStatus,
    progress: phaseProgressPercent({ ...existing, progressMethod: normalized.progressMethod, checklist: normalized.checklist, unitsPlanned: normalized.plannedUnits } as PlannedProjectPhase),
    updatedAt: now,
  };
  return { ...project, phases: project.phases.map((phase, phaseIndex) => phaseIndex === index ? next : phase) };
}

export function deleteProjectPhase(project: BrowserProject, phaseIdValue: string): BrowserProject {
  const id = trim(phaseIdValue);
  const phase = project.phases.find((candidate) => candidate.id === id);
  if (!phase) return project;
  const assignments = phaseAssignments(project, id);
  const hasActivity = phase.actualLaborHours > 0 || phase.actualMaterialCost > 0 || phase.unitsCompleted > 0 || assignments.length > 0;
  if (hasActivity) throw new Error('A phase with scheduled or actual activity cannot be deleted. Cancel it or complete it instead.');
  const phases = project.phases
    .filter((candidate) => candidate.id !== id)
    .map((candidate) => {
      const planned = plannedPhase(candidate);
      return planned.dependencies.includes(id)
        ? { ...planned, dependencies: planned.dependencies.filter((dependency) => dependency !== id) }
        : candidate;
    });
  return { ...project, phases };
}

export function reorderProjectPhases(project: BrowserProject, orderedIds: string[]): BrowserProject {
  const expected = new Set(project.phases.map((phase) => phase.id));
  if (orderedIds.length !== expected.size || orderedIds.some((id) => !expected.has(id))) {
    throw new Error('The phase order must contain every Project phase exactly once.');
  }
  const order = new Map(orderedIds.map((id, index) => [id, (index + 1) * 10]));
  return {
    ...project,
    phases: project.phases.map((phase, index) => ({ ...plannedPhase(phase, index), sequence: order.get(phase.id)! })),
  };
}

function dateRange(project: BrowserProject, index: number, count: number) {
  const start = new Date(`${project.startsOn}T12:00:00Z`);
  const end = new Date(`${project.estimatedCompletionOn}T12:00:00Z`);
  const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start;
  if (!valid) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + index * 2);
    const target = new Date(fallback);
    target.setUTCDate(target.getUTCDate() + 1);
    return [fallback.toISOString().slice(0, 10), target.toISOString().slice(0, 10)] as const;
  }
  const totalDays = Math.max(count, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const phaseStartOffset = Math.floor(index * totalDays / count);
  const phaseEndOffset = Math.max(phaseStartOffset, Math.floor((index + 1) * totalDays / count) - 1);
  const phaseStart = new Date(start);
  phaseStart.setUTCDate(start.getUTCDate() + phaseStartOffset);
  const phaseEnd = new Date(start);
  phaseEnd.setUTCDate(start.getUTCDate() + phaseEndOffset);
  return [phaseStart.toISOString().slice(0, 10), phaseEnd.toISOString().slice(0, 10)] as const;
}

export function allocateTemplateHours(totalHours: number, phases: PhaseTemplateItem[]): number[] {
  positiveWhole(totalHours, 'Template capacity');
  if (!phases.length) return [];
  if (totalHours < phases.length) throw new Error('Available capacity must provide at least one hour per template phase.');
  const weights = phases.map((phase) => Math.max(0, phase.weight));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error('Template phase weights must add to more than zero.');
  const base = weights.map((weight) => Math.max(1, Math.floor(totalHours * weight / totalWeight)));
  let allocated = base.reduce((sum, value) => sum + value, 0);
  while (allocated > totalHours) {
    const index = base.reduce((best, value, candidate) => value > base[best] && value > 1 ? candidate : best, 0);
    if (base[index] <= 1) throw new Error('Template capacity cannot be distributed safely.');
    base[index] -= 1;
    allocated -= 1;
  }
  const fractions = weights.map((weight, index) => ({ index, value: totalHours * weight / totalWeight - Math.floor(totalHours * weight / totalWeight) }))
    .sort((left, right) => right.value - left.value || left.index - right.index);
  let cursor = 0;
  while (allocated < totalHours) {
    base[fractions[cursor % fractions.length].index] += 1;
    allocated += 1;
    cursor += 1;
  }
  return base;
}

export function applyPhaseTemplate(project: BrowserProject, template: PhaseTemplate, now = new Date().toISOString()): BrowserProject {
  const summary = phaseCapacitySummary(project);
  if (summary.unallocated < template.phases.length) {
    throw new Error(`This template needs at least ${template.phases.length} unallocated hours; ${summary.unallocated}h remain.`);
  }
  const hours = allocateTemplateHours(summary.unallocated, template.phases);
  const existingSequences = projectPhases(project).map((phase) => phase.sequence);
  const firstSequence = existingSequences.length ? Math.max(...existingSequences) + 10 : 10;
  const createdIds: string[] = [];
  let nextProject = project;
  template.phases.forEach((templatePhase, index) => {
    const [startsOn, endsOn] = dateRange(project, index, template.phases.length);
    const dependency = templatePhase.dependsOnPrevious && createdIds.length ? [createdIds[createdIds.length - 1]] : [];
    const input: PhaseDraftInput = {
      name: templatePhase.name,
      sequence: firstSequence + index * 10,
      objective: templatePhase.objective,
      scopeOfWork: templatePhase.scopeOfWork,
      plannedHours: hours[index],
      progressMethod: templatePhase.progressMethod,
      plannedUnits: templatePhase.plannedUnits ?? (templatePhase.progressMethod === 'units' ? Math.max(1, project.totalUnits) : 0),
      checklistText: templatePhase.checklist.join('\n'),
      startsOn,
      endsOn,
      dependencies: dependency,
      technicianInstructions: templatePhase.technicianInstructions,
      completionCriteria: templatePhase.completionCriteria,
      priority: templatePhase.priority,
      responsibleManager: project.managerName || 'Not assigned',
      workflowStatus: 'Ready to Schedule',
    };
    const beforeIds = new Set(nextProject.phases.map((phase) => phase.id));
    nextProject = createProjectPhase(nextProject, input, new Date(new Date(now).getTime() + index).toISOString());
    const created = nextProject.phases.find((phase) => !beforeIds.has(phase.id));
    if (created) createdIds.push(created.id);
  });
  return nextProject;
}

export function companyTemplateFromProject(project: BrowserProject, name: string, now = new Date().toISOString()): PhaseTemplate {
  const phases = projectPhases(project).filter((phase) => phase.workflowStatus !== 'Cancelled');
  if (!phases.length) throw new Error('Create at least one phase before saving a company template.');
  const total = phases.reduce((sum, phase) => sum + Math.max(1, phase.estimatedLaborHours), 0);
  const templateName = trim(name);
  if (!templateName) throw new Error('Template name is required.');
  return {
    id: `TPL-COMPANY-${new Date(now).getTime().toString(36).toUpperCase()}`,
    name: templateName,
    description: `Company template created from ${project.projectNumber} · ${project.name}.`,
    projectTypes: [project.type],
    source: 'Company',
    createdAt: now,
    phases: phases.map((phase, index) => ({
      name: phase.name,
      weight: Math.max(1, phase.estimatedLaborHours) / total,
      objective: phase.objective,
      scopeOfWork: phase.scopeOfWork,
      completionCriteria: phase.completionCriteria,
      technicianInstructions: phase.technicianInstructions ?? '',
      progressMethod: phase.progressMethod,
      plannedUnits: phase.progressMethod === 'units' ? phase.unitsPlanned : undefined,
      checklist: phase.checklist.map((item) => item.label),
      priority: phase.priority,
      dependsOnPrevious: index > 0 && phase.dependencies.length > 0,
    })),
  };
}

export const suggestedPhaseTemplates: PhaseTemplate[] = [
  {
    id: 'TPL-VRF-INSTALLATION',
    name: 'VRF Installation',
    description: 'Engineering, site readiness, piping, indoor/outdoor installation, controls, testing, and handover.',
    projectTypes: ['VRF Project', 'Installation Project'],
    source: 'Suggested',
    phases: [
      { name: 'Site Survey & Engineering', weight: 6, objective: 'Confirm design assumptions and installation routes before mobilization.', scopeOfWork: 'Survey the property, validate loads, equipment locations, piping routes, electrical requirements, access, and approved drawings.', completionCriteria: 'Survey and design decisions are documented and approved for execution.', technicianInstructions: 'Photograph all equipment locations, proposed penetrations, electrical sources, and access restrictions.', progressMethod: 'checklist', checklist: ['Load calculation confirmed', 'Equipment locations confirmed', 'Piping routes approved', 'Electrical requirements confirmed', 'Site access documented'], priority: 'High' },
      { name: 'Material & Site Readiness', weight: 9, objective: 'Verify that the site and required equipment are ready before installation.', scopeOfWork: 'Confirm equipment, materials, permits, access, lifting requirements, protection, and staging areas.', completionCriteria: 'Required materials are available and the work area is ready for safe execution.', technicianInstructions: 'Report missing or damaged equipment before starting installation work.', progressMethod: 'checklist', checklist: ['Equipment verified', 'Materials staged', 'Access confirmed', 'Work area protected', 'Safety review completed'], priority: 'High', dependsOnPrevious: true },
      { name: 'Refrigerant Piping & Drainage', weight: 22, objective: 'Install the complete refrigerant and condensate network to approved standards.', scopeOfWork: 'Install copper piping, branch components, insulation, supports, brazed connections, condensate drainage, and required pressure-test preparation.', completionCriteria: 'All planned routes are installed, labeled, supported, photographed, and ready for pressure testing.', technicianInstructions: 'Use nitrogen while brazing, seal open pipe ends, label both ends, and photograph concealed work before closure.', progressMethod: 'checklist', checklist: ['Copper routes installed', 'Drainage installed', 'Supports completed', 'Insulation completed', 'Concealed work photographed'], priority: 'Critical', dependsOnPrevious: true },
      { name: 'Indoor Unit Installation', weight: 18, objective: 'Install and connect every approved indoor unit.', scopeOfWork: 'Mount indoor units, connect refrigerant piping, drainage, communication wiring, and verify level, support, clearances, and access.', completionCriteria: 'All planned indoor units are installed and pass the installation checklist.', technicianInstructions: 'Record each unit location and serial number, protect finishes, and upload before/after photos.', progressMethod: 'units', plannedUnits: 1, checklist: [], priority: 'High', dependsOnPrevious: true },
      { name: 'Outdoor VRF Installation', weight: 10, objective: 'Install outdoor equipment securely and prepare it for connection and startup.', scopeOfWork: 'Position, anchor, level, protect, and connect outdoor VRF equipment, including required service clearances and anti-corrosion measures.', completionCriteria: 'Outdoor equipment is secured, documented, and ready for electrical and refrigerant commissioning.', technicianInstructions: 'Verify lifting safety, anchoring, clearances, drainage, and anti-corrosive protection.', progressMethod: 'units', plannedUnits: 1, checklist: [], priority: 'Critical', dependsOnPrevious: true },
      { name: 'Electrical & Controls', weight: 13, objective: 'Complete safe power, communication, controls, and addressing.', scopeOfWork: 'Install disconnects, power wiring, communication wiring, controls, addressing, grounding, labeling, and electrical protection checks.', completionCriteria: 'Electrical and controls checklist is complete with measurements and labeling evidence.', technicianInstructions: 'Lock out power before work and record voltage, protection, grounding, and communication polarity.', progressMethod: 'checklist', checklist: ['Power wiring complete', 'Disconnects labeled', 'Grounding verified', 'Communication verified', 'Addressing completed'], priority: 'Critical', dependsOnPrevious: true },
      { name: 'Pressure Test, Vacuum & Commissioning', weight: 14, objective: 'Prove system integrity and complete controlled startup.', scopeOfWork: 'Perform pressure testing, leak inspection, vacuum, charge verification, startup, addressing checks, performance readings, and fault review.', completionCriteria: 'Testing records are complete and the system operates within approved parameters.', technicianInstructions: 'Do not release pressure or start equipment without recording readings and obtaining the required approval.', progressMethod: 'checklist', checklist: ['Pressure test passed', 'Leak inspection passed', 'Vacuum target achieved', 'Charge verified', 'Startup readings recorded'], priority: 'Critical', dependsOnPrevious: true },
      { name: 'Handover & Closeout', weight: 8, objective: 'Deliver the completed installation with documentation and customer orientation.', scopeOfWork: 'Complete punch-list corrections, final cleaning, customer training, documentation, warranty handover, and final acceptance.', completionCriteria: 'Closeout documents and customer acceptance are recorded with no unresolved critical blocker.', technicianInstructions: 'Confirm all labels, covers, drains, controls, manuals, photos, and customer guidance before requesting sign-off.', progressMethod: 'approval', checklist: ['Punch list closed', 'Customer training completed', 'Documents delivered', 'Final photos uploaded', 'Acceptance recorded'], priority: 'High', dependsOnPrevious: true },
    ],
  },
  {
    id: 'TPL-MULTI-SPLIT-INSTALLATION',
    name: 'Multi-Split / Apartment Installation',
    description: 'A flexible installation workflow for apartments, villas, and multi-unit residential projects.',
    projectTypes: ['Installation Project', 'VRF Project'],
    source: 'Suggested',
    phases: [
      { name: 'Survey & Layout Approval', weight: 10, objective: 'Confirm unit locations, routes, power, access, and customer constraints.', scopeOfWork: 'Survey every installation area and approve the final layout.', completionCriteria: 'Every planned unit has an approved installation location and route.', technicianInstructions: 'Document each room and outdoor-unit location.', progressMethod: 'units', plannedUnits: 1, checklist: [], priority: 'High' },
      { name: 'Preinstallation & Rough-In', weight: 25, objective: 'Prepare piping, drainage, electrical, sleeves, and supports.', scopeOfWork: 'Complete concealed or preparatory work before equipment installation.', completionCriteria: 'Rough-in is complete and documented for every planned unit.', technicianInstructions: 'Photograph all concealed work before walls or ceilings close.', progressMethod: 'units', plannedUnits: 1, checklist: [], priority: 'High', dependsOnPrevious: true },
      { name: 'Indoor & Outdoor Equipment Installation', weight: 35, objective: 'Install and connect all approved equipment.', scopeOfWork: 'Mount, connect, secure, label, and protect indoor and outdoor units.', completionCriteria: 'All planned equipment is installed and checked.', technicianInstructions: 'Record model, serial, location, and installation photos.', progressMethod: 'units', plannedUnits: 1, checklist: [], priority: 'Critical', dependsOnPrevious: true },
      { name: 'Electrical, Vacuum & Startup', weight: 20, objective: 'Complete electrical safety checks and controlled system startup.', scopeOfWork: 'Finish power, signal, leak checks, vacuum, charge verification, and startup readings.', completionCriteria: 'Every system passes commissioning checks.', technicianInstructions: 'Record electrical and refrigeration readings before completion.', progressMethod: 'units', plannedUnits: 1, checklist: [], priority: 'Critical', dependsOnPrevious: true },
      { name: 'Punch List & Handover', weight: 10, objective: 'Resolve final details and deliver the installation.', scopeOfWork: 'Close defects, clean work areas, train the customer, and capture acceptance.', completionCriteria: 'Punch list and customer handover are complete.', technicianInstructions: 'Do not request sign-off until all covers, drains, controls, and finishes are verified.', progressMethod: 'approval', checklist: ['Punch list closed', 'Final cleaning complete', 'Customer guidance complete', 'Acceptance recorded'], priority: 'High', dependsOnPrevious: true },
    ],
  },
  {
    id: 'TPL-PREVENTIVE-MAINTENANCE',
    name: 'Preventive Maintenance Program',
    description: 'Planning, execution, findings, corrective recommendations, and customer reporting for a multi-unit maintenance project.',
    projectTypes: ['Service Project', 'Maintenance Contract'],
    source: 'Suggested',
    phases: [
      { name: 'Asset Verification & Route Planning', weight: 10, objective: 'Confirm the equipment list, locations, access, and service sequence.', scopeOfWork: 'Verify assets and organize the service route by area or property.', completionCriteria: 'The service inventory and access plan are confirmed.', technicianInstructions: 'Report missing, relocated, or unregistered equipment.', progressMethod: 'units', plannedUnits: 1, checklist: [], priority: 'High' },
      { name: 'Preventive Service Execution', weight: 55, objective: 'Complete the approved preventive-maintenance scope on every planned unit.', scopeOfWork: 'Clean, inspect, test, document, and restore each assigned unit.', completionCriteria: 'All planned units have a completed intervention and evidence.', technicianInstructions: 'Record measurements, findings, photos, and sold add-ons for each unit.', progressMethod: 'units', plannedUnits: 1, checklist: [], priority: 'High', dependsOnPrevious: true },
      { name: 'Findings & Corrective Review', weight: 20, objective: 'Review technical findings and prioritize corrective actions.', scopeOfWork: 'Validate findings, quotations, safety concerns, replacement recommendations, and client decisions.', completionCriteria: 'All material findings have a documented disposition.', technicianInstructions: 'Escalate urgent electrical, refrigerant, drainage, or replacement risks immediately.', progressMethod: 'checklist', checklist: ['Critical findings reviewed', 'Corrective recommendations prepared', 'Customer decisions recorded'], priority: 'Critical', dependsOnPrevious: true },
      { name: 'Report & Handover', weight: 15, objective: 'Deliver the final service report and close the maintenance round.', scopeOfWork: 'Compile service evidence, findings, recommendations, and completion summary.', completionCriteria: 'Final report is approved and delivered.', technicianInstructions: 'Verify that every serviced unit has complete evidence before closeout.', progressMethod: 'approval', checklist: ['Service records complete', 'Findings summarized', 'Report approved', 'Customer delivery recorded'], priority: 'High', dependsOnPrevious: true },
    ],
  },
];

export function schedulePreviewPhaseAssignment(project: BrowserProject, input: PreviewPhaseAssignmentInput, now = new Date().toISOString()): BrowserProject {
  const phase = projectPhases(project).find((candidate) => candidate.id === input.phaseId);
  if (!phase) throw new Error('Select a valid Project phase.');
  if (phase.workflowStatus === 'Completed' || phase.workflowStatus === 'Cancelled') throw new Error('Completed or cancelled phases cannot accept new work.');
  for (const dependencyId of phase.dependencies) {
    const dependency = projectPhases(project).find((candidate) => candidate.id === dependencyId);
    if (dependency && dependency.workflowStatus !== 'Completed') {
      throw new Error(`${phase.name} is blocked until ${dependency.name} is completed.`);
    }
  }
  const slots = positiveWhole(input.scheduledSlots, 'Scheduled slots');
  if (slots > project.slotsPerWorkDay) throw new Error(`A single Van assignment cannot exceed ${project.slotsPerWorkDay} slots.`);
  const hours = slots * project.slotDurationMinutes / 60;
  if (hours > phaseRemainingHours(project, phase)) throw new Error(`${phase.name} has only ${phaseRemainingHours(project, phase)} uncommitted hours.`);
  if (hours > projectMetrics(project).remainingUnscheduledHours) throw new Error(`The Project has only ${projectMetrics(project).remainingUnscheduledHours} uncommitted hours.`);
  const scheduledDate = assertDate(input.scheduledDate, 'Scheduled date');
  const start = trim(input.scheduledStart);
  if (!/^\d{2}:\d{2}$/.test(start)) throw new Error('Scheduled start must use HH:MM.');
  const [hour, minute] = start.split(':').map(Number);
  const endMinutes = hour * 60 + minute + hours * 60;
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  const vanId = trim(input.vanId);
  if (!vanId) throw new Error('Assigned Van is required.');
  const technicians = [...new Set(input.technicianIds.map(trim).filter(Boolean))];
  const unitsPlanned = wholeNonNegative(input.unitsPlanned, 'Units planned');
  const id = `ASG-PH-${new Date(now).getTime().toString(36).toUpperCase()}`;
  const assignment: ProjectAssignment = {
    id,
    projectId: project.id,
    phaseId: phase.id,
    vanId,
    technicianIds: technicians,
    scheduledHours: hours,
    scheduledSlots: slots,
    scheduledDate,
    scheduledStart: start,
    scheduledEnd: end,
    actualHours: 0,
    unitsPlanned,
    unitsCompleted: 0,
    status: 'Scheduled',
  };
  return {
    ...project,
    status: project.status === 'Draft' ? 'Planned' : project.status,
    scheduledFutureHours: project.scheduledFutureHours + hours,
    assignedVans: project.assignedVans.includes(vanId) ? project.assignedVans : [...project.assignedVans, vanId],
    assignments: [...project.assignments, assignment],
    phases: project.phases.map((candidate) => candidate.id === phase.id
      ? { ...phase, status: phase.status === 'Planned' ? 'In Progress' : phase.status, workflowStatus: phase.workflowStatus === 'Draft' || phase.workflowStatus === 'Ready to Schedule' ? 'In Progress' : phase.workflowStatus, updatedAt: now }
      : candidate),
  };
}

export function updatePreviewAssignmentStatus(project: BrowserProject, assignmentId: string, status: ProjectAssignment['status']): BrowserProject {
  const assignment = project.assignments.find((candidate) => candidate.id === assignmentId);
  if (!assignment || assignment.postedAt) return project;
  return { ...project, assignments: project.assignments.map((candidate) => candidate.id === assignmentId ? { ...candidate, status } : candidate) };
}

export function completePreviewPhaseAssignment(project: BrowserProject, input: PreviewPhaseCompletionInput): BrowserProject {
  const assignment = project.assignments.find((candidate) => candidate.id === input.assignmentId);
  if (!assignment) throw new Error('The selected phase assignment is no longer available.');
  if (assignment.postedAt) return project;
  const phase = projectPhases(project).find((candidate) => candidate.id === assignment.phaseId);
  if (!phase) throw new Error('The assignment phase is no longer available.');
  const actualHours = finiteNonNegative(input.actualHours, 'Actual hours');
  const unitsCompleted = wholeNonNegative(input.unitsCompleted, 'Units completed');
  if (unitsCompleted > assignment.unitsPlanned) throw new Error('Completed units cannot exceed the units planned for this assignment.');
  const evidenceCount = wholeNonNegative(input.evidenceCount, 'Evidence count');
  const postedAt = new Date(input.postedAt);
  if (Number.isNaN(postedAt.getTime()) || postedAt.toISOString() !== input.postedAt) throw new Error('Posted time must be a valid ISO timestamp.');
  const completedChecklistIds = new Set(input.checklistCompletedIds);
  const nextChecklist = phase.checklist.map((item) => completedChecklistIds.has(item.id) ? { ...item, done: true } : item);
  const technician = trim(input.technicianName) || assignment.technicianIds.join(' + ') || 'Assigned Van crew';
  const report: PhaseFieldReport = {
    id: `PFR-${new Date(input.postedAt).getTime().toString(36).toUpperCase()}`,
    assignmentId: assignment.id,
    technician,
    note: trim(input.note),
    actualHours,
    unitsCompleted,
    evidenceCount,
    checklistCompletedIds: [...completedChecklistIds],
    createdAt: input.postedAt,
  };
  const prepared: BrowserProject = {
    ...project,
    assignments: project.assignments.map((candidate) => candidate.id === assignment.id
      ? { ...candidate, actualHours, unitsCompleted }
      : candidate),
    phases: project.phases.map((candidate) => candidate.id === phase.id
      ? { ...phase, checklist: nextChecklist, fieldReports: [...phase.fieldReports, report], updatedAt: input.postedAt }
      : candidate),
  };
  const posted = postProjectAssignment(prepared, { assignmentId: assignment.id, materialLines: [], postedAt: input.postedAt });
  return {
    ...posted,
    phases: posted.phases.map((candidate) => {
      if (candidate.id !== phase.id) return candidate;
      const normalized = plannedPhase(candidate);
      const progress = phaseProgressPercent(normalized);
      const workflowStatus = phaseStatusAfterProgress({ ...normalized, progress } as PlannedProjectPhase);
      return { ...normalized, progress, workflowStatus, status: baseFromWorkflow(workflowStatus), updatedAt: input.postedAt };
    }),
  };
}

export function phaseCompletionBlockers(project: BrowserProject, phaseIdValue: string): string[] {
  const phase = projectPhases(project).find((candidate) => candidate.id === phaseIdValue);
  if (!phase) return ['phase is unavailable'];
  const blockers: string[] = [];
  if (phaseAssignments(project, phase.id).some((assignment) => !assignment.postedAt)) blockers.push('scheduled or unposted assignments remain');
  const incompleteDependencies = phase.dependencies
    .map((id) => projectPhases(project).find((candidate) => candidate.id === id))
    .filter((dependency): dependency is PlannedProjectPhase => Boolean(dependency && dependency.workflowStatus !== 'Completed'));
  if (incompleteDependencies.length) blockers.push(incompleteDependencies.length === 1 ? '1 dependency is incomplete' : `${incompleteDependencies.length} dependencies are incomplete`);
  if (phase.progressMethod === 'units' && phase.unitsCompleted < phase.unitsPlanned) blockers.push(`${phase.unitsCompleted} of ${phase.unitsPlanned} units are complete`);
  if (phase.progressMethod === 'checklist') {
    const requiredOpen = phase.checklist.filter((item) => item.required && !item.done).length;
    if (requiredOpen) blockers.push(`${requiredOpen} required checklist item${requiredOpen === 1 ? ' is' : 's are'} incomplete`);
  }
  if (!phase.completionCriteria.trim()) blockers.push('completion criteria are missing');
  return blockers;
}

export function markProjectPhaseComplete(project: BrowserProject, phaseIdValue: string, now = new Date().toISOString()): BrowserProject {
  const blockers = phaseCompletionBlockers(project, phaseIdValue);
  if (blockers.length) throw new Error(`Phase cannot be completed: ${blockers.join('; ')}.`);
  return {
    ...project,
    phases: project.phases.map((candidate) => candidate.id === phaseIdValue
      ? { ...plannedPhase(candidate), progress: 100, workflowStatus: 'Completed', status: 'Completed', updatedAt: now }
      : candidate),
  };
}

export function replaceProjectInState(state: BrowserProjectsPreviewState, project: BrowserProject): BrowserProjectsPreviewState {
  if (!state.projects.some((candidate) => candidate.id === project.id)) throw new Error('Project is no longer available in preview state.');
  return { ...state, selectedProjectId: project.id, projects: state.projects.map((candidate) => candidate.id === project.id ? project : candidate) };
}

export function phaseBriefing(project: BrowserProject, phaseInput: ProjectPhase) {
  const phase = plannedPhase(phaseInput);
  return [
    `PROJECT\n${project.projectNumber} · ${project.name}`,
    project.technicianInstructions?.trim() ? `PROJECT INSTRUCTIONS\n${project.technicianInstructions.trim()}` : '',
    `PHASE\n${phase.name}`,
    `PHASE OBJECTIVE\n${phase.objective}`,
    `PHASE SCOPE\n${phase.scopeOfWork}`,
    phase.outOfScope ? `OUT OF SCOPE\n${phase.outOfScope}` : '',
    phase.technicianInstructions ? `PHASE TECHNICIAN INSTRUCTIONS\n${phase.technicianInstructions}` : '',
    `COMPLETION CRITERIA\n${phase.completionCriteria}`,
  ].filter(Boolean).join('\n\n');
}

export const GENERAL_PHASE_ID = GENERAL_PROJECT_WORK_PHASE_ID;
