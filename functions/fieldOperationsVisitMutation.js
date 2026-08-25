const crypto = require('node:crypto');
const { allowedActionsForAssignment, fieldError } = require('./fieldOperationsAuthorityCore');
const { canonicalStatusFromStorage, projectCanonicalWorkVisit, stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { transitionCanonicalWorkVisit } = require('./fieldOperationsAuthorityTransitions');

const ACTIVE_VISIT_TARGETS = new Set(['en_route', 'on_site', 'in_progress']);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicEventId(requestId, visitId, target) {
  return `FE-${crypto.createHash('sha256').update(`${requestId}:work_visit_transition:${visitId}:${target}`).digest('hex').slice(0, 24)}`;
}

function storageStatusForActiveTarget(target) {
  if (target === 'en_route') return 'on_the_way';
  if (target === 'on_site') return 'on_site';
  if (target === 'in_progress') return 'in_progress';
  throw fieldError('transition_not_activated', `Work Visit transition is not activated in this slice: ${target || 'missing'}.`, 400);
}

function activeTransitionPatch({ storedVisit, transitionedVisit, target, identity, occurredAt }) {
  const patch = {
    status: storageStatusForActiveTarget(target),
    updatedAt: occurredAt,
    updatedByUserId: text(identity.uid, 180),
    updatedByStaffId: text(identity.staffId, 180) || undefined,
    updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    version: Math.max(1, Number(storedVisit.version) || 1) + 1,
  };
  if (transitionedVisit.departedAt && !storedVisit.departedAt) patch.departedAt = transitionedVisit.departedAt;
  if (transitionedVisit.arrivedAt && !storedVisit.arrivedAt) patch.arrivedAt = transitionedVisit.arrivedAt;
  if (transitionedVisit.startedAt && !storedVisit.startedAt) patch.startedAt = transitionedVisit.startedAt;
  return patch;
}

function transitionAuditEvent({ requestId, visit, previousStatus, nextStatus, identity, occurredAt, nextVersion }) {
  return {
    id: deterministicEventId(requestId, visit.id, nextStatus),
    type: 'work_visit_status_changed',
    entityType: 'WorkVisit',
    entityId: visit.id,
    visitId: visit.id,
    workOrderId: visit.workOrderId,
    appointmentId: visit.appointmentId,
    customerId: visit.customerId,
    propertyId: visit.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity.uid, 180),
    performedByStaffId: text(identity.staffId, 180) || undefined,
    performedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    before: { status: previousStatus, version: visit.version },
    after: { status: nextStatus, version: nextVersion },
  };
}

function requireExecuteAssignment(identity, assignment) {
  if (!assignment?.assigned) throw fieldError('permission_denied', 'You are not assigned to this Work Visit.', 403);
  const allowedActions = allowedActionsForAssignment(identity, assignment);
  if (!allowedActions.includes('execute')) {
    throw fieldError('permission_denied', 'This assignment cannot change active Work Visit status.', 403, {
      responsibility: assignment.responsibility || null,
      source: assignment.source || null,
    });
  }
  return allowedActions;
}

function createTransitionWorkVisitCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function transitionWorkVisit({ identity, visitId, to, expectedVersion, requestId } = {}) {
    const normalizedVisitId = text(visitId, 180);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    const target = text(to, 80);
    if (!ACTIVE_VISIT_TARGETS.has(target)) {
      throw fieldError('transition_not_activated', `Work Visit transition is not activated in this slice: ${target || 'missing'}.`, 400);
    }
    const stable = stableRequestId(requestId);
    const expected = Number(expectedVersion);
    if (!Number.isInteger(expected) || expected < 1) throw fieldError('expected_version_required', 'A positive expectedVersion is required.', 400);

    let result;
    await db.runTransaction(async (transaction) => {
      const visitRef = db.collection('workVisits').doc(normalizedVisitId);
      const visitSnapshot = await transaction.get(visitRef);
      if (!visitSnapshot.exists) throw fieldError('visit_not_found', 'The requested Work Visit is not available.', 404);
      const storedVisit = { id: visitSnapshot.id, ...visitSnapshot.data() };
      const canonicalVisit = projectCanonicalWorkVisit(storedVisit);

      const workOrderRef = db.collection('workOrders').doc(canonicalVisit.workOrderId);
      const workOrderSnapshot = await transaction.get(workOrderRef);
      if (!workOrderSnapshot.exists) throw fieldError('work_order_not_found', 'The Work Order for this visit is not available.', 404);
      const order = { id: workOrderSnapshot.id, ...workOrderSnapshot.data() };
      const assignment = await resolveAssignment({ transaction, identity, order });
      const allowedActions = requireExecuteAssignment(identity, assignment);

      const currentStatus = canonicalStatusFromStorage(storedVisit.status);
      if (currentStatus === target) {
        // Retry after a successful transaction is a no-op even if the caller still holds the
        // pre-transition version. The first transition and audit event already committed atomically.
        result = { success: true, replayed: true, visit: canonicalVisit, allowedActions };
        return;
      }

      if (canonicalVisit.version !== expected) {
        throw fieldError('version_conflict', 'This Work Visit changed on another device. Refresh before trying again.', 409, {
          expectedVersion: expected,
          actualVersion: canonicalVisit.version,
        });
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const transition = transitionCanonicalWorkVisit({ visit: canonicalVisit, to: target, at: occurredAt });
      const patch = activeTransitionPatch({ storedVisit, transitionedVisit: transition.next, target, identity, occurredAt });
      const nextStoredVisit = { ...storedVisit, ...patch };
      const nextVisit = projectCanonicalWorkVisit(nextStoredVisit);
      const event = transitionAuditEvent({
        requestId: stable,
        visit: canonicalVisit,
        previousStatus: transition.previousStatus,
        nextStatus: target,
        identity,
        occurredAt,
        nextVersion: patch.version,
      });

      transaction.update(visitRef, patch);
      await appendAuditInTransaction({ transaction, event, visit: nextStoredVisit, identity });
      result = { success: true, replayed: false, visit: nextVisit, allowedActions, auditEventId: event.id };
    });

    return result;
  };
}

module.exports.ACTIVE_VISIT_TARGETS = ACTIVE_VISIT_TARGETS;
module.exports.activeTransitionPatch = activeTransitionPatch;
module.exports.createTransitionWorkVisitCommand = createTransitionWorkVisitCommand;
module.exports.storageStatusForActiveTarget = storageStatusForActiveTarget;
module.exports.transitionAuditEvent = transitionAuditEvent;
