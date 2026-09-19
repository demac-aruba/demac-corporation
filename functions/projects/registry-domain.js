'use strict';
// Planning owns scope and estimates only. Scheduling and Field own operational truth.
const crypto = require('node:crypto');
const SCHEMA_VERSION = 1;
const MAX_PHASES = 100;
const MAX_COMMAND_BYTES = 128 * 1024;
const READ_ROLES = new Set(['super_admin', 'operations', 'project_manager', 'finance']);
const WRITE_ROLES = new Set(['super_admin', 'operations', 'project_manager']);
const PROJECT_TYPES = new Set(['VRF Project', 'Installation Project', 'Service Project', 'Maintenance Contract', 'Other Project']);

function fault(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function plain(value, label = 'payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fault('invalid_payload', `${label} must be an object.`);
  return value;
}
function allowedKeys(value, allowed, required = allowed) {
  plain(value);
  if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    throw fault('invalid_fields', 'Unexpected or missing fields. Operational actuals and identity cannot be written through a planning command.');
  }
}
function text(value, name, max = 200, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (!optional && !value.trim())) throw fault('invalid_text', `${name} is invalid.`);
  return value.trim();
}
function id(value, name = 'id') {
  const result = text(value, name, 180);
  if (result !== value || /[\/\x00-\x1f]/.test(result) || result === '.' || result === '..' || result.startsWith('__')) throw fault('invalid_id', `${name} is invalid.`);
  return result;
}
function integer(value, name, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fault('invalid_number', `${name} must be a whole number between ${min} and ${max}.`);
  return value;
}
function date(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw fault('invalid_date', `${name} must be a valid date.`);
  return value;
}
function stamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw fault('invalid_clock', 'Invalid service clock.', 500);
  return value;
}
function enumValue(value, options, name) {
  if (!options.has(value)) throw fault('invalid_value', `${name} is not supported.`);
  return value;
}
function canonical(value, depth = 0) {
  if (depth > 12) throw fault('payload_too_deep', 'Project command exceeds the nesting limit.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
  plain(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
}
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex'); }
function role(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['owner', 'admin', 'superadmin', 'super_admin'].includes(raw)) return 'super_admin';
  if (['operation', 'operations', 'manager', 'supervisor'].includes(raw)) return 'operations';
  if (['project_manager', 'projects'].includes(raw)) return 'project_manager';
  if (['finance', 'accounting'].includes(raw)) return 'finance';
  return null;
}
function actor(uid, profile, write = false) {
  const normalizedRole = role(profile?.role);
  if (profile?.active !== true || !(write ? WRITE_ROLES : READ_ROLES).has(normalizedRole)) throw fault('forbidden', 'This account is not authorized for this Projects operation.', 403);
  return { uid: id(uid, 'user'), role: normalizedRole };
}
const PRIORITIES = new Set(['Low', 'Normal', 'High', 'Critical']);
function normalizeDetails(value, phase = false) {
  const keys = phase
    ? ['sequence', 'objective', 'outOfScope', 'technicianInstructions', 'startsOn', 'endsOn', 'priority', 'responsibleManagerSnapshot']
    : ['priority', 'totalUnits', 'unitType', 'contactPersonSnapshot', 'managerSnapshot', 'scheduleEstimate', 'materialBudget'];
  allowedKeys(value, keys, []);
  const result = {};
  for (const key of ['objective', 'outOfScope', 'technicianInstructions']) {
    if (Object.hasOwn(value, key)) result[key] = text(value[key], key, 2000, true);
  }
  for (const key of ['unitType', 'contactPersonSnapshot', 'responsibleManagerSnapshot']) {
    if (Object.hasOwn(value, key)) result[key] = text(value[key], key, 200, true);
  }
  if (Object.hasOwn(value, 'priority')) result.priority = enumValue(value.priority, PRIORITIES, 'priority');
  if (Object.hasOwn(value, 'sequence')) result.sequence = integer(value.sequence, 'sequence', 1);
  if (Object.hasOwn(value, 'totalUnits')) result.totalUnits = integer(value.totalUnits, 'planned units');
  if (Object.hasOwn(value, 'startsOn')) result.startsOn = date(value.startsOn, 'phase start');
  if (Object.hasOwn(value, 'endsOn')) result.endsOn = date(value.endsOn, 'phase end');
  if (result.startsOn && result.endsOn && result.endsOn < result.startsOn) throw fault('invalid_date_range', 'Phase end cannot precede phase start.');
  if (Object.hasOwn(value, 'managerSnapshot')) {
    allowedKeys(value.managerSnapshot, ['sourceId', 'name']);
    result.managerSnapshot = {
      sourceId: value.managerSnapshot.sourceId === '' ? '' : id(value.managerSnapshot.sourceId, 'historical manager reference'),
      name: text(value.managerSnapshot.name, 'historical manager name', 200, true),
    };
  }
  if (Object.hasOwn(value, 'scheduleEstimate')) {
    const v = value.scheduleEstimate;
    allowedKeys(v, ['workDays', 'slotsPerDay', 'slotMinutes', 'estimatedSlots']);
    result.scheduleEstimate = {
      workDays: integer(v.workDays, 'estimated work days', 1, 100000),
      slotsPerDay: integer(v.slotsPerDay, 'planning slots per day', 1, 48),
      slotMinutes: integer(v.slotMinutes, 'planning slot duration', 1, 1440),
      estimatedSlots: integer(v.estimatedSlots, 'estimated slots', 1),
    };
    if (v.workDays * v.slotsPerDay !== v.estimatedSlots) throw fault('inconsistent_plan_units', 'Planning work days and slots do not reconcile.');
  }
  if (Object.hasOwn(value, 'materialBudget')) {
    if (value.materialBudget === null) result.materialBudget = null;
    else {
      allowedKeys(value.materialBudget, ['currency', 'amountMinor']);
      if (value.materialBudget.currency !== 'AWG') throw fault('unsupported_currency', 'Existing Projects material budgets use AWG.');
      result.materialBudget = { currency: 'AWG', amountMinor: integer(value.materialBudget.amountMinor, 'material budget in cents', 1, Number.MAX_SAFE_INTEGER) };
    }
  }
  return result;
}
function normalizePhases(value) {
  if (!Array.isArray(value) || value.length > MAX_PHASES) throw fault('invalid_phases', 'A project may contain at most 100 planning phases.');
  const phases = value.map((phase) => {
    allowedKeys(phase, ['id', 'name', 'scopeOfWork', 'completionCriteria', 'plannedVanMinutes', 'dependencies', 'progressMethod', 'unitsPlanned', 'checklist', 'details'], ['id', 'name', 'scopeOfWork', 'completionCriteria', 'plannedVanMinutes', 'dependencies', 'progressMethod', 'unitsPlanned', 'checklist']);
    if (!Array.isArray(phase.dependencies) || phase.dependencies.length > MAX_PHASES) throw fault('invalid_dependencies', 'Invalid phase dependencies.');
    if (!Array.isArray(phase.checklist) || phase.checklist.length > 100) throw fault('invalid_checklist', 'Invalid phase checklist.');
    return {
      id: id(phase.id, 'phaseId'), name: text(phase.name, 'phase name', 160),
      scopeOfWork: text(phase.scopeOfWork, 'phase scope', 2000), completionCriteria: text(phase.completionCriteria, 'completion criteria', 2000),
      plannedVanMinutes: integer(phase.plannedVanMinutes, 'phase estimate', 1),
      dependencies: phase.dependencies.map((dependency) => id(dependency, 'dependency')),
      progressMethod: enumValue(phase.progressMethod, new Set(['units', 'checklist', 'hours', 'approval']), 'progress method'),
      unitsPlanned: integer(phase.unitsPlanned, 'planned units'),
      checklist: phase.checklist.map((item) => {
        allowedKeys(item, ['id', 'label', 'required'], ['id', 'label']);
        if (Object.hasOwn(item, 'required') && typeof item.required !== 'boolean') throw fault('invalid_checklist', 'Checklist requirement must be a boolean.');
        return { id: id(item.id, 'checklist id'), label: text(item.label, 'checklist label', 500), ...(Object.hasOwn(item, 'required') ? { required: item.required } : {}) };
      }),
      ...(Object.hasOwn(phase, 'details') ? { details: normalizeDetails(phase.details, true) } : {}),
    };
  });
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  if (byId.size !== phases.length) throw fault('duplicate_phase', 'Phase IDs must be unique.');
  const visited = new Set(); const visiting = new Set();
  function visit(phaseId) {
    if (visiting.has(phaseId)) throw fault('dependency_cycle', 'Phases cannot have cyclic dependencies.');
    if (visited.has(phaseId)) return;
    const phase = byId.get(phaseId);
    if (!phase) throw fault('unknown_dependency', 'Every dependency must belong to this project.');
    if (new Set(phase.dependencies).size !== phase.dependencies.length) throw fault('duplicate_dependency', 'Duplicate phase dependency.');
    if (new Set(phase.checklist.map((item) => item.id)).size !== phase.checklist.length) throw fault('duplicate_checklist', 'Checklist IDs must be unique per phase.');
    if (phase.progressMethod === 'units' && phase.unitsPlanned < 1) throw fault('invalid_phase_units', 'Units-based phases require planned units.');
    if (phase.progressMethod === 'checklist' && !phase.checklist.length) throw fault('empty_checklist', 'Checklist-based phases require checklist items.');
    visiting.add(phaseId); phase.dependencies.forEach(visit); visiting.delete(phaseId); visited.add(phaseId);
  }
  phases.forEach((phase) => visit(phase.id));
  return phases;
}
const META_KEYS = ['name', 'type', 'description', 'technicianInstructions', 'startsOn', 'estimatedCompletionOn', 'details'];
function metadata(value) {
  return {
    name: text(value.name, 'project name', 160), type: enumValue(value.type, PROJECT_TYPES, 'project type'),
    description: text(value.description, 'description', 3000, true), technicianInstructions: text(value.technicianInstructions, 'technician instructions', 2000, true),
    startsOn: date(value.startsOn, 'start'), estimatedCompletionOn: date(value.estimatedCompletionOn, 'completion'),
    ...(Object.hasOwn(value, 'details') ? { details: normalizeDetails(value.details) } : {}),
  };
}
function normalizePlanInput(value) {
  allowedKeys(value, [...META_KEYS, 'customerId', 'propertyId', 'budgetedVanMinutes', 'phases'], ['name', 'type', 'customerId', 'propertyId', 'startsOn', 'estimatedCompletionOn', 'budgetedVanMinutes', 'phases']);
  const plan = {
    ...metadata(value), customerId: id(value.customerId, 'customer'), propertyId: id(value.propertyId, 'property'),
    budgetedVanMinutes: integer(value.budgetedVanMinutes, 'project estimate', 1), phases: normalizePhases(value.phases),
  };
  if (plan.estimatedCompletionOn < plan.startsOn) throw fault('invalid_date_range', 'Completion cannot precede project start.');
  if (plan.details?.scheduleEstimate && plan.details.scheduleEstimate.estimatedSlots * plan.details.scheduleEstimate.slotMinutes !== plan.budgetedVanMinutes) throw fault('inconsistent_plan_units', 'Initial estimate must match its originating slot snapshot.');
  // Phase budgeting remains a planning rule; booking beyond those estimates is always advisory.
  if (plan.phases.reduce((sum, phase) => sum + phase.plannedVanMinutes, 0) > plan.budgetedVanMinutes) throw fault('phase_budget_allocation', 'Phase estimates exceed the project planning baseline.');
  return plan;
}
function applyMetadata(plan, patch) {
  allowedKeys(patch, META_KEYS, []);
  if (!Object.keys(patch).length) throw fault('empty_patch', 'Provide at least one planning field.');
  // Metadata patches preserve other recorded details; the planning unit snapshot is not editable here.
  if (patch.details && Object.hasOwn(patch.details, 'scheduleEstimate')) throw fault('estimate_revision_required', 'Revise the estimate explicitly; metadata must not rewrite its unit snapshot.');
  const next = metadata({ ...plan, ...patch, ...(patch.details ? { details: { ...plan.details, ...patch.details } } : {}) });
  if (next.estimatedCompletionOn < next.startsOn) throw fault('invalid_date_range', 'Completion cannot precede project start.');
  return next;
}
function requireRecord(record) {
  if (!record) throw fault('project_not_found', 'Project not found.', 404);
  if (record.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(record.version) || record.version < 1 || record.version >= Number.MAX_SAFE_INTEGER || record.budget?.unit !== 'van_minutes' || !['Draft', 'Planned', 'On Hold', 'Cancelled'].includes(record.planningStatus)) throw fault('project_schema_conflict', 'Project data requires reconciliation.', 409);
  id(record.id); id(record.customerId); id(record.propertyId);
  integer(record.budget.originalMinutes, 'original estimate', 1); integer(record.budget.currentMinutes, 'current estimate', 1);
  integer(record.budget.revision, 'budget revision', 1, Number.MAX_SAFE_INTEGER - 1);
  normalizePhases(record.phases);
  if (Object.hasOwn(record, 'details')) normalizeDetails(record.details);
  if (record.details?.scheduleEstimate && record.details.scheduleEstimate.estimatedSlots * record.details.scheduleEstimate.slotMinutes !== record.budget.originalMinutes) throw fault('project_schema_conflict', 'Captured planning units disagree with the originating baseline.', 409);
  return record;
}
function requireVersion(record, expected) {
  integer(expected, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER - 1);
  if (record.version !== expected) throw fault('version_conflict', 'Another operator changed this project. Refresh before retrying.', 409);
}
function forecast(budgetMinutes, plannedMinutes) {
  integer(budgetMinutes, 'budgeted Van minutes', 1); integer(plannedMinutes, 'planned Van minutes');
  return { unit: 'van_minutes', budgetMinutes, plannedMinutes, remainingMinutes: Math.max(0, budgetMinutes - plannedMinutes), overBudgetMinutes: Math.max(0, plannedMinutes - budgetMinutes), blocksBooking: false };
}
module.exports = { SCHEMA_VERSION, MAX_COMMAND_BYTES, META_KEYS, fault, plain, allowedKeys, text, id, integer, date, stamp, digest, canonical, role, actor, normalizePhases, normalizePlanInput, applyMetadata, requireRecord, requireVersion, forecast, normalizeDetails };
