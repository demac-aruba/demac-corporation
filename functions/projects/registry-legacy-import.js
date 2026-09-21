'use strict';
// Deterministic conversion only. No Firebase initialization, network, mutations or live actuals.
const d = require('./registry-domain');
const SOURCE_KEY = 'demac.erp-next.projects.preview.v1';
const KNOWN_SAMPLES = new Set(['DEMO-PRJ-VRF-001', 'DEMO-PRJ-SVC-002', 'DEMO-PRJ-INSTALL-003', 'DEMO-PRJ-SVC-004', 'DEMO-PRJ-MAINT-005']);
const LEGACY_STATUSES = new Set(['Draft', 'Planned', 'Active', 'On Hold', 'Near Completion', 'Completed', 'Cancelled']);
const KNOWN_FIELDS = new Set(['id','projectNumber','name','customerId','customerName','siteId','location','contactPerson','type','description','technicianInstructions','status','priority','managerId','managerName','contractValue','laborRate','otherEstimatedCosts','startsOn','estimatedCompletionOn','totalUnits','completedUnits','unitType','estimatedWorkDays','slotsPerWorkDay','slotDurationMinutes','estimatedSlots','estimatedLaborHours','scheduledFutureHours','actualLaborHours','materialBudget','materialActual','assignedVans','phases','materials','expenses','costEntries','assignments']);
const PHASE_FIELDS = new Set(['id','name','status','estimatedLaborHours','actualLaborHours','estimatedMaterialCost','actualMaterialCost','unitsPlanned','unitsCompleted','progress','startsOn','endsOn','sequence','objective','scopeOfWork','outOfScope','technicianInstructions','completionCriteria','dependencies','priority','responsibleManager','progressMethod','checklist','workflowStatus','fieldReports','createdAt','updatedAt']);
const PHASE_DETAIL_NAMES = { sequence:'sequence', objective:'objective', outOfScope:'outOfScope', technicianInstructions:'technicianInstructions', startsOn:'startsOn', endsOn:'endsOn', priority:'priority', responsibleManager:'responsibleManagerSnapshot' };
function hash(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw d.fault('invalid_source_hash', `${name} must be a SHA-256 digest.`);
  return value;
}
function origin(value) {
  if (typeof value !== 'string' || value.length > 300) throw d.fault('invalid_source_origin', 'Invalid backup origin.');
  let parsed; try { parsed = new URL(value); } catch { throw d.fault('invalid_source_origin', 'Invalid backup origin.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value) throw d.fault('invalid_source_origin', 'Backup origin must not contain a path, credentials or query.');
  return value;
}
function quantity(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000) throw d.fault('invalid_legacy_quantity', `${name} requires source reconciliation.`);
  return value;
}
function scaledInteger(value, factor, name, minimum = 0) {
  const scaled = quantity(value, name) * factor;
  const result = Math.round(scaled);
  if (Math.abs(result - scaled) > 0.000001) throw d.fault('legacy_precision_conflict', `${name} cannot be represented without rounding source data.`);
  return d.integer(result, name, minimum);
}
function list(value, name, limit) {
  if (!Array.isArray(value) || value.length > limit) throw d.fault('invalid_legacy_array', `${name} is missing or exceeds this reviewed import scope.`);
  return value;
}
function numberKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw d.fault('invalid_project_number', 'Project number requires reconciliation; it will not be renumbered.');
  return value.toUpperCase();
}
function prepareLegacyImport(candidate) {
  d.allowedKeys(candidate, ['source', 'rawProjectJson']);
  d.allowedKeys(candidate.source, ['storageKey', 'origin', 'capturedAt', 'backupDigest', 'projectDigest']);
  if (candidate.source.storageKey !== SOURCE_KEY) throw d.fault('invalid_source_key', 'Only a Projects backup may be imported.');
  origin(candidate.source.origin); hash(candidate.source.backupDigest, 'backup digest'); hash(candidate.source.projectDigest, 'project digest');
  try { d.stamp(candidate.source.capturedAt); } catch { throw d.fault('invalid_capture_time', 'Invalid backup capture time.'); }
  if (typeof candidate.rawProjectJson !== 'string' || Buffer.byteLength(candidate.rawProjectJson, 'utf8') > 96 * 1024) throw d.fault('legacy_payload_too_large', 'Import one reviewed Project of at most 96 KiB per command.', 413);
  if (d.digest(candidate.rawProjectJson) !== candidate.source.projectDigest) throw d.fault('source_checksum_mismatch', 'The selected Project differs from its checked backup.');
  let raw; try { raw = JSON.parse(candidate.rawProjectJson); } catch { throw d.fault('invalid_legacy_json', 'The selected Project is not valid JSON.'); }
  // Validate bounded plain JSON, including unknown fields that will be preserved in the archive.
  d.plain(raw, 'legacy project'); d.canonical(raw);
  const projectId = d.id(raw.id, 'original projectId');
  if (KNOWN_SAMPLES.has(projectId)) throw d.fault('sample_import_forbidden', 'Known seeded samples cannot become operational projects.');
  const projectNumberKey = numberKey(raw.projectNumber);
  if (!LEGACY_STATUSES.has(raw.status)) throw d.fault('legacy_status_conflict', 'Unknown legacy lifecycle state requires review.');
  const originalMinutes = scaledInteger(raw.estimatedLaborHours, 60, 'captured labor estimate', 1);
  const scheduleEstimate = { workDays: raw.estimatedWorkDays, slotsPerDay: raw.slotsPerWorkDay, slotMinutes: raw.slotDurationMinutes, estimatedSlots: raw.estimatedSlots };
  d.normalizeDetails({ scheduleEstimate });
  if (scheduleEstimate.estimatedSlots * scheduleEstimate.slotMinutes !== originalMinutes) throw d.fault('legacy_budget_inconsistent', 'The recorded work days, slots and hours disagree. No baseline was chosen automatically.');
  const warnings = new Set(['browser_source_requires_owner_review', 'captured_baseline_not_original_revision_history']);
  const legacyPhases = list(raw.phases, 'phases', 100);
  const assignments = list(raw.assignments, 'assignments', 250);
  const materials = list(raw.materials, 'materials', 1000);
  const expenses = list(raw.expenses, 'expenses', 1000);
  const costEntries = list(raw.costEntries, 'cost entries', 2000);
  quantity(raw.actualLaborHours, 'legacy actual hours'); quantity(raw.scheduledFutureHours, 'legacy scheduled hours');
  quantity(raw.completedUnits, 'legacy completed units'); quantity(raw.materialActual, 'legacy material actual');
  if (raw.actualLaborHours > 0 || raw.completedUnits > 0 || ['Active','Near Completion','Completed'].includes(raw.status)) warnings.add('execution_requires_canonical_reconciliation');
  if (assignments.length || raw.scheduledFutureHours > 0) warnings.add('scheduling_links_require_canonical_reconciliation');
  if (materials.length || expenses.length || costEntries.length || raw.materialActual > 0 || raw.contractValue !== undefined || raw.laborRate !== undefined || raw.otherEstimatedCosts !== undefined) warnings.add('financial_history_archived_not_posted');
  if (Object.keys(raw).some((key) => !KNOWN_FIELDS.has(key))) warnings.add('unknown_fields_preserved_in_archive');
  if (raw.managerId) warnings.add('manager_reference_not_an_authorization');
  const phases = legacyPhases.map((phase) => {
    d.plain(phase, 'legacy phase');
    if (Object.keys(phase).some((key) => !PHASE_FIELDS.has(key))) warnings.add('unknown_fields_preserved_in_archive');
    if (phase.actualLaborHours > 0 || phase.unitsCompleted > 0 || phase.progress > 0 || (Array.isArray(phase.fieldReports) && phase.fieldReports.length)
        || ['Completed','In Progress'].includes(phase.status)) warnings.add('execution_requires_canonical_reconciliation');
    const details = {};
    for (const [oldKey, key] of Object.entries(PHASE_DETAIL_NAMES)) if (Object.hasOwn(phase, oldKey)) details[key] = phase[oldKey];
    const checklist = list(phase.checklist ?? [], 'phase checklist', 100).map((item) => {
      d.plain(item);
      if (Object.keys(item).some((key) => !['id','label','required','done'].includes(key))) warnings.add('unknown_fields_preserved_in_archive');
      if (item.done === true) warnings.add('execution_requires_canonical_reconciliation');
      return { id: item.id, label: item.label, ...(Object.hasOwn(item, 'required') ? { required: item.required } : {}) };
    });
    return {
      id: phase.id, name: phase.name, scopeOfWork: phase.scopeOfWork, completionCriteria: phase.completionCriteria,
      plannedVanMinutes: scaledInteger(phase.estimatedLaborHours, 60, 'phase estimate', 1),
      dependencies: phase.dependencies ?? [], progressMethod: phase.progressMethod, unitsPlanned: phase.unitsPlanned,
      checklist, ...(Object.keys(details).length ? { details } : {}),
    };
  });
  const details = {
    priority: raw.priority, totalUnits: raw.totalUnits, unitType: raw.unitType,
    contactPersonSnapshot: raw.contactPerson,
    managerSnapshot: { sourceId: raw.managerId, name: raw.managerName },
    scheduleEstimate,
    materialBudget: raw.materialBudget === null || raw.materialBudget === 0 ? null
      : { currency: 'AWG', amountMinor: scaledInteger(raw.materialBudget, 100, 'material estimate', 1) },
  };
  const plan = d.normalizePlanInput({
    name: raw.name, type: raw.type, customerId: raw.customerId, propertyId: raw.siteId,
    description: raw.description, ...(Object.hasOwn(raw, 'technicianInstructions') ? { technicianInstructions: raw.technicianInstructions } : {}),
    startsOn: raw.startsOn, estimatedCompletionOn: raw.estimatedCompletionOn, budgetedVanMinutes: originalMinutes,
    phases, details,
  });
  return {
    projectId, projectNumber: raw.projectNumber, projectNumberKey, plan,
    // The original browser lifecycle is retained as evidence, not certified as Field completion.
    planningStatus: ['Draft','Planned','On Hold','Cancelled'].includes(raw.status) ? raw.status : 'Planned',
    sourceDeclaredStatus: raw.status,
    warnings: [...warnings].sort(),
    source: { ...candidate.source }, rawProjectJson: candidate.rawProjectJson,
    sourceDigest: d.digest(candidate),
    retainedCounts: { phases: legacyPhases.length, localAssignments: assignments.length, materialRecords: materials.length, expenseRecords: expenses.length, costRecords: costEntries.length },
  };
}
function publicImportPreview(prepared) {
  return {
    projectId: prepared.projectId, projectNumber: prepared.projectNumber, plan: prepared.plan,
    sourceDeclaredStatus: prepared.sourceDeclaredStatus, planningStatus: prepared.planningStatus,
    warnings: prepared.warnings, retainedCounts: prepared.retainedCounts, source: prepared.source,
    actualLabor: null, physicalProgress: null, operationalLinksApplied: 0,
  };
}
module.exports = { prepareLegacyImport, publicImportPreview, numberKey };
