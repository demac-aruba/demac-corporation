'use strict';

// Read-only diagnostic, NOT an assignment writer or a source of field/labor truth.
const CANCELLED_ORDER_STATUSES = new Set(['Cancelada', 'Cancelado', 'cancelled']);
const KNOWN_ORDER_STATUSES = new Set(['Confirmada', 'Asignada', 'En proceso', 'En progreso', 'Completada', 'Completado', 'Finalizada', 'Reserva temporal', ...CANCELLED_ORDER_STATUSES]);
const KNOWN_VISIT_STATUSES = new Set(['not_started', 'on_the_way', 'on_site', 'in_progress', 'pending', 'requires_return_visit', 'ready_for_office_review', 'completed', 'no_access', 'cancelled']);
const STARTED_VISIT_STATUSES = new Set(['in_progress', 'pending', 'requires_return_visit', 'ready_for_office_review', 'completed']);

function fail(code, message) { return Object.assign(new Error(message), { code }); }
function identifier(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    && value.length <= 180 && !/[\x00-\x1f/]/.test(value) && value !== '.' && value !== '..';
}
function assertProjectScope(project) {
  if (!project || !identifier(project.id) || !identifier(project.customerId) || !identifier(project.siteId)
      || !Array.isArray(project.assignments) || !Array.isArray(project.phases)) {
    throw fail('invalid_project_scope', 'A Project with canonical Customer/Property IDs and local links is required.');
  }
  if (project.assignments.length > 250 || project.phases.length > 200) throw fail('scope_limit', 'Split the reconciliation into a smaller reviewed scope.');
  for (const row of project.assignments) {
    if (!row || typeof row !== 'object') throw fail('invalid_local_link', 'Invalid local assignment.');
    for (const field of ['workOrderId', 'appointmentId', 'phaseId']) {
      if (row[field] !== undefined && row[field] !== '' && !identifier(row[field])) {
        throw fail('invalid_local_link', 'Invalid local assignment reference.');
      }
    }
  }
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function uniqueRecords(records, label, issues) {
  const byId = new Map();
  for (const row of records) {
    if (!row || !identifier(row.id)) { issues.push({ severity: 'blocking', code: 'invalid_source_id', source: label }); continue; }
    if (byId.has(row.id) && stableJson(byId.get(row.id)) !== stableJson(row)) {
      issues.push({ severity: 'blocking', code: 'conflicting_source_versions', source: label, sourceId: row.id });
    } else byId.set(row.id, row);
  }
  return [...byId.values()];
}
function identityMatches(row, project) {
  const customer = row.clientId ?? row.customerId;
  return customer === project.customerId && row.propertyId === project.siteId
    && (row.clientId === undefined || row.clientId === project.customerId)
    && (row.customerId === undefined || row.customerId === project.customerId);
}
function safeQuantity(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }

function reconcileProjectEvidence(project, evidence) {
  assertProjectScope(project);
  if (!evidence || !Array.isArray(evidence.workOrders) || !Array.isArray(evidence.workVisits)
      || evidence.workOrders.length > 100 || evidence.workVisits.length > 1000) {
    throw fail('invalid_evidence', 'Bounded Work Order and Work Visit evidence is required.');
  }
  const issues = [{ severity: 'review', code: 'local_links_require_confirmation' }, { severity: 'review', code: 'actual_time_not_integrated' }];
  if (evidence.complete !== true) issues.push({ severity: 'blocking', code: 'incomplete_source_read' });
  const orders = uniqueRecords(evidence.workOrders, 'workOrders', issues);
  const visits = uniqueRecords(evidence.workVisits, 'workVisits', issues);
  const explicit = new Map();
  const appointmentIds = new Set();
  const phaseIds = new Set(project.phases.map((phase) => phase?.id));
  for (const link of project.assignments) {
    if (link.projectId !== undefined && link.projectId !== project.id) {
      issues.push({ severity: 'blocking', code: 'local_project_identity_conflict' }); continue;
    }
    if (link.appointmentId) appointmentIds.add(link.appointmentId);
    if (!link.workOrderId) { issues.push({ severity: 'review', code: 'local_assignment_without_work_order' }); continue; }
    const prior = explicit.get(link.workOrderId);
    if (prior && (prior.appointmentId !== link.appointmentId || prior.phaseId !== link.phaseId)) {
      issues.push({ severity: 'blocking', code: 'conflicting_local_links', sourceId: link.workOrderId });
    } else explicit.set(link.workOrderId, link);
  }
  const rows = [];
  const found = new Set();
  for (const order of orders) {
    const localLink = explicit.get(order.id);
    if (!localLink && !appointmentIds.has(order.appointmentId)) continue;
    if (localLink) found.add(order.id);
    if (!identityMatches(order, project)
        || (localLink?.appointmentId && localLink.appointmentId !== order.appointmentId)) {
      issues.push({ severity: 'blocking', code: 'work_order_identity_conflict', sourceId: order.id }); continue;
    }
    const match = localLink ? 'explicit_local_link' : 'related_appointment_candidate';
    if (!localLink) issues.push({ severity: 'review', code: 'related_order_needs_confirmation', sourceId: order.id });
    const phaseId = localLink?.phaseId || 'GENERAL-PROJECT-WORK';
    if (localLink && phaseId !== 'GENERAL-PROJECT-WORK' && !phaseIds.has(phaseId)) {
      issues.push({ severity: 'blocking', code: 'unknown_project_phase', sourceId: order.id });
    }
    const linkedVisits = [];
    for (const visit of visits.filter((candidate) => candidate.workOrderId === order.id)) {
      const appointmentId = visit.appointmentId || visit.scheduledScopeSnapshot?.appointmentId;
      if (!identityMatches(visit, project) || appointmentId !== order.appointmentId) {
        issues.push({ severity: 'blocking', code: 'work_visit_identity_conflict', sourceId: visit.id }); continue;
      }
      const validStartedAt = typeof visit.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(visit.startedAt) && Number.isFinite(Date.parse(visit.startedAt));
      if (!KNOWN_VISIT_STATUSES.has(visit.status) || (visit.startedAt != null && !validStartedAt)) {
        issues.push({ severity: 'blocking', code: 'unresolved_field_evidence', sourceId: visit.id });
      }
      linkedVisits.push({
        id: visit.id,
        status: typeof visit.status === 'string' ? visit.status : 'unknown',
        hasExecutionEvidence: KNOWN_VISIT_STATUSES.has(visit.status) && (STARTED_VISIT_STATUSES.has(visit.status) || validStartedAt),
        source: `workVisits/${visit.id}`,
      });
    }
    if (localLink && !linkedVisits.length) issues.push({ severity: 'review', code: 'no_work_visit_found', sourceId: order.id });
    const cancelled = CANCELLED_ORDER_STATUSES.has(order.status);
    const knownStatus = KNOWN_ORDER_STATUSES.has(order.status);
    const plannedMinutes = safeQuantity(order.appointmentDurationMinutes);
    const slots = Number.isSafeInteger(order.scheduledSlots) && order.scheduledSlots >= 0 ? order.scheduledSlots : null;
    if (localLink && !cancelled && (!knownStatus || plannedMinutes === null || slots === null)) {
      issues.push({ severity: 'blocking', code: 'unresolved_scheduling_evidence', sourceId: order.id });
    }
    rows.push({
      workOrderId: order.id, appointmentId: order.appointmentId, match,
      phaseId: localLink ? phaseId : null, vanId: order.vanId || null,
      date: order.date || null, status: order.status || 'unknown',
      plannedMinutes, scheduledSlots: slots, cancelled, visits: linkedVisits,
      source: `workOrders/${order.id}`,
    });
  }
  for (const id of explicit.keys()) if (!found.has(id)) issues.push({ severity: 'blocking', code: 'linked_work_order_missing', sourceId: id });
  const matched = rows.filter((row) => row.match === 'explicit_local_link');
  const countable = matched.filter((row) => !row.cancelled);
  const blocked = issues.some((issue) => issue.severity === 'blocking');
  return {
    mode: 'read_only_reconciliation', projectId: project.id,
    status: blocked ? 'blocked' : 'review_required', canApply: false,
    sourceReadComplete: evidence.complete === true,
    planningFromBrowser: { estimatedLaborHours: safeQuantity(project.estimatedLaborHours) },
    allocationEvidence: {
      // Historical allocation evidence, NOT future available capacity or hours worked.
      recordedPlannedMinutes: blocked ? null : countable.reduce((sum, row) => sum + row.plannedMinutes, 0),
      recordedSlots: blocked ? null : countable.reduce((sum, row) => sum + row.scheduledSlots, 0),
      matchedWorkOrders: matched.length,
      relatedCandidateOrders: rows.length - matched.length,
      excludedCancelledOrders: matched.length - countable.length,
      matchedWorkVisits: matched.reduce((sum, row) => sum + row.visits.length, 0),
      visitsWithExecutionEvidence: matched.reduce((sum, row) => sum + row.visits.filter((visit) => visit.hasExecutionEvidence).length, 0),
    },
    actualLaborHours: null,
    physicalCompletionPercent: null,
    issues,
    workOrders: rows.sort((a, b) => a.workOrderId.localeCompare(b.workOrderId)),
  };
}
module.exports = { assertProjectScope, reconcileProjectEvidence };
