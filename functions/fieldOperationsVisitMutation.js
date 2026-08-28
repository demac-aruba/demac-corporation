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

function pendingDetails({ target, pendingReason, pendingAction }) {
  if (target !== 'pending') return {};
  const reason = text(pendingReason, 1000);
  if (!reason) {
    throw fieldError('pending_reason_required', 'A reason is required before leaving a Work Visit pending.', 400);
  }
  return {
    pendingReason: reason,
    pendingAction: text(pendingAction, 1500) || undefined,
  };
}

function noAccessDetails({ target, noAccessReason }) {
  if (target !== 'no_access') return {};
  const reason = text(noAccessReason, 1000);
  if (!reason) {
    throw fieldError('no_access_reason_required', 'A reason is required before closing a Work Visit as no access.', 400);
  }
  return { noAccessReason: reason };
}

function cancellationDetails({ target, cancellationReason }) {
  if (target !== 'cancelled') return {};
  const reason = text(cancellationReason, 1000);
  if (!reason) {
    throw fieldError('cancellation_reason_required', 'A reason is required before cancelling a Work Visit.', 400);
  }
  return { cancellationReason: reason };
}

function returnVisitDetails({ target, secondVisitReason }) {
  if (target !== 'requires_return_visit') return {};
  const reason = text(secondVisitReason, 1000);
  if (!reason) {
    throw fieldError('second_visit_reason_required', 'A reason is required before marking a Work Visit for return.', 400);
  }
  return { secondVisitReason: reason };
}

function activeTransitionPatch({ storedVisit, transitionedVisit, target, identity, occurredAt, pendingReason, pendingAction, noAccessReason, cancellationReason, secondVisitReason, requestId }) {
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
    ...pendingDetails({ target, pendingReason, pendingAction }),
    ...noAccessDetails({ target, noAccessReason }),
    ...cancellationDetails({ target, cancellationReason }),
    ...returnVisitDetails({ target, secondVisitReason }),
  };
  if (transitionedVisit.departedAt && !storedVisit.departedAt) patch.departedAt = transitionedVisit.departedAt;
  if (transitionedVisit.arrivedAt && !storedVisit.arrivedAt) patch.arrivedAt = transitionedVisit.arrivedAt;
  if (transitionedVisit.startedAt && !storedVisit.startedAt) patch.startedAt = transitionedVisit.startedAt;
  if (target === 'pending') {
    patch.pendingAt = occurredAt;
    patch.pendingRequestId = requestId;
  }
  if (target === 'in_progress' && canonicalStatusFromStorage(storedVisit.status) === 'pending') {
    patch.resumedAt = occurredAt;
  }
  if (target === 'no_access') {
    patch.noAccessAt = occurredAt;
    patch.noAccessRequestId = requestId;
  }
  if (target === 'cancelled') {
    patch.cancelledAt = occurredAt;
    patch.cancelledRequestId = requestId;
  }
  if (target === 'requires_return_visit') {
    patch.requiresSecondVisit = true;
    patch.secondVisitRequiredAt = occurredAt;
    patch.secondVisitRequestId = requestId;
  }
  return fieldFirestoreData(patch, 'workVisitTransition');
}

function transitionAuditEvent({ requestId, visit, previousStatus, nextStatus, identity, occurredAt, nextVersion, pendingReason, pendingAction, noAccessReason, cancellationReason, secondVisitReason }) {
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
    after: {
      status: nextStatus,
      version: nextVersion,
      ...(nextStatus === 'pending' ? {
        pendingReason: text(pendingReason, 1000),
        pendingAction: text(pendingAction, 1500) || undefined,
      } : {}),
      ...(nextStatus === 'no_access' ? {
        noAccessReason: text(noAccessReason, 1000),
      } : {}),
      ...(nextStatus === 'cancelled' ? {
        cancellationReason: text(cancellationReason, 1000),
      } : {}),
      ...(nextStatus === 'requires_return_visit' ? {
        requiresSecondVisit: true,
        secondVisitReason: text(secondVisitReason, 1000),
      } : {}),
    },
  };
}

function createTransitionWorkVisitCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function transitionWorkVisit({ identity, visitId, to, expectedVersion, pendingReason, pendingAction, noAccessReason, cancellationReason, secondVisitReason, requestId } = {}) {
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
        if (target === 'pending') {
          const requested = pendingDetails({ target, pendingReason, pendingAction });
          if (text(storedVisit.pendingRequestId, 240) !== stable
            || text(storedVisit.pendingReason, 1000) !== requested.pendingReason
            || text(storedVisit.pendingAction, 1500) !== text(requested.pendingAction, 1500)) {
            throw fieldError('pending_transition_conflict', 'This Work Visit is already pending with different details. Refresh before trying again.', 409);
          }
        }
        if (target === 'no_access') {
          const requested = noAccessDetails({ target, noAccessReason });
          if (text(storedVisit.noAccessRequestId, 240) !== stable
            || text(storedVisit.noAccessReason, 1000) !== requested.noAccessReason) {
            throw fieldError('no_access_transition_conflict', 'This Work Visit is already closed as no access with different details.', 409);
          }
        }
        if (target === 'cancelled') {
          const requested = cancellationDetails({ target, cancellationReason });
          if (text(storedVisit.cancelledRequestId, 240) !== stable
            || text(storedVisit.cancellationReason, 1000) !== requested.cancellationReason) {
            throw fieldError('cancelled_transition_conflict', 'This Work Visit is already cancelled with different details.', 409);
          }
        }
        if (target === 'requires_return_visit') {
          const requested = returnVisitDetails({ target, secondVisitReason });
          if (text(storedVisit.secondVisitRequestId, 240) !== stable
            || text(storedVisit.secondVisitReason, 1000) !== requested.secondVisitReason) {
            throw fieldError('return_visit_transition_conflict', 'This Work Visit already requires a return with different details.', 409);
          }
        }
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
      const patch = activeTransitionPatch({
        storedVisit,
        transitionedVisit: transition.next,
        target,
        identity,
        occurredAt,
        pendingReason,
        pendingAction,
        noAccessReason,
        cancellationReason,
        secondVisitReason,
        requestId: stable,
      });
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
        pendingReason,
        pendingAction,
        noAccessReason,
        cancellationReason,
        secondVisitReason,
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
