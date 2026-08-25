const crypto = require('node:crypto');
const { fieldFirestoreData } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const {
  canonicalStatusFromStorage,
  projectCanonicalWorkVisit,
  stableRequestId,
  storageStatusFromCanonical,
} = require('./fieldOperationsAuthorityWorkVisit');
const { transitionCanonicalWorkVisit } = require('./fieldOperationsAuthorityTransitions');
const { ACTIVE_VISIT_TARGETS, projectActivatedVisit } = require('./fieldOperationsVisitActions');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');

const ACTIVE_VISIT_TARGET_SET = new Set(ACTIVE_VISIT_TARGETS);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function deterministicEventId(requestId, visitId, target) {
  return `FE-${crypto.createHash('sha256').update(`${requestId}:work_visit_transition:${visitId}:${target}`).digest('hex').slice(0, 24)}`;
}

function activeTransitionPatch({ storedVisit, transitionedVisit, target, identity, occurredAt }) {
  if (!Number.isSafeInteger(transitionedVisit.version) || transitionedVisit.version < 1 || transitionedVisit.version >= Number.MAX_SAFE_INTEGER) {
    throw fieldError('visit_version_exhausted', 'Work Visit version cannot be advanced safely.', 409, { version: transitionedVisit.version });
  }
  const patch = {
    status: storageStatusFromCanonical(target),
    updatedAt: occurredAt,
    updatedByUserId: text(identity.uid, 180),
    updatedByStaffId: text(identity.staffId, 180) || undefined,
    updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    version: transitionedVisit.version + 1,
  };
  if (transitionedVisit.departedAt && !storedVisit.departedAt) patch.departedAt = transitionedVisit.departedAt;
  if (transitionedVisit.arrivedAt && !storedVisit.arrivedAt) patch.arrivedAt = transitionedVisit.arrivedAt;
  if (transitionedVisit.startedAt && !storedVisit.startedAt) patch.startedAt = transitionedVisit.startedAt;
  return fieldFirestoreData(patch, 'workVisitTransition');
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

function createTransitionWorkVisitCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function transitionWorkVisit({ identity, visitId, to, expectedVersion, requestId } = {}) {
    const normalizedVisitId = text(visitId, 180);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    const target = text(to, 80);
    if (!ACTIVE_VISIT_TARGET_SET.has(target)) {
      throw fieldError('transition_not_activated', `Work Visit transition is not activated in this slice: ${target || 'missing'}.`, 400);
    }
    const stable = stableRequestId(requestId);
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw fieldError('expected_version_required', 'A positive safe-integer expectedVersion is required.', 400);
    }
    const expected = expectedVersion;

    let result;
    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({
        db,
        transaction,
        identity,
        visitId: normalizedVisitId,
        resolveAssignment,
        action: 'execute',
        deniedMessage: 'This assignment cannot change active Work Visit status.',
      });
      const {
        allowedActions,
        appointmentId,
        canonicalVisit,
        propertyId,
        storedVisit,
        visitRef,
      } = context;

      const currentStatus = canonicalStatusFromStorage(storedVisit.status);
      if (currentStatus === target) {
        // Retry after a successful transaction is a no-op even if the caller still holds the
        // pre-transition version. The first transition and audit event already committed atomically.
        result = {
          success: true,
          replayed: true,
          visit: projectActivatedVisit(canonicalVisit, allowedActions),
          allowedActions,
        };
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
      const nextVisit = projectCanonicalWorkVisit(nextStoredVisit, { appointmentId, propertyId });
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
      result = {
        success: true,
        replayed: false,
        visit: projectActivatedVisit(nextVisit, allowedActions),
        allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

module.exports.ACTIVE_VISIT_TARGETS = ACTIVE_VISIT_TARGETS;
module.exports.activeTransitionPatch = activeTransitionPatch;
module.exports.createTransitionWorkVisitCommand = createTransitionWorkVisitCommand;
module.exports.transitionAuditEvent = transitionAuditEvent;
