const crypto = require('node:crypto');
const { fieldFirestoreData } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const {
  FIELD_WORK_VISIT_STORAGE_VERSION,
  projectCanonicalWorkVisit,
  stableRequestId,
  storageStatusFromCanonical,
} = require('./fieldOperationsAuthorityWorkVisit');
const { projectActivatedVisit } = require('./fieldOperationsVisitActions');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function unique(values) {
  return [...new Set(values.map((value) => text(value, 180)).filter(Boolean))];
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function returnVisitDocumentId(previousVisitId, requestId) {
  const previous = text(previousVisitId, 180);
  if (!previous) throw fieldError('visit_required', 'The previous Work Visit id is required.', 400);
  return deterministicId('visit-return', `${previous}:${stableRequestId(requestId)}`);
}

function buildReturnVisit({ previousVisit, scheduledScopeSnapshot, identity, assignment, occurredAt, requestId }) {
  return {
    id: returnVisitDocumentId(previousVisit.id, requestId),
    fieldAuthorityVersion: FIELD_WORK_VISIT_STORAGE_VERSION,
    workOrderId: previousVisit.workOrderId,
    appointmentId: previousVisit.appointmentId,
    clientId: previousVisit.customerId,
    propertyId: previousVisit.propertyId,
    scheduledScopeSnapshot: scheduledScopeSnapshot || previousVisit.scheduledScopeSnapshot,
    status: storageStatusFromCanonical('scheduled'),
    leadTechnicianStaffId: text(assignment?.leadTechnicianStaffId || previousVisit.leadTechnicianStaffId, 180) || undefined,
    participatingStaffIds: unique([
      identity?.staffId,
      assignment?.leadTechnicianStaffId,
      ...(Array.isArray(assignment?.participatingStaffIds) ? assignment.participatingStaffIds : []),
    ]),
    requiresSecondVisit: false,
    previousVisitId: previousVisit.id,
    previousVisitVersion: previousVisit.version,
    returnVisitRequestId: requestId,
    createdAt: occurredAt,
    createdByUserId: text(identity?.uid, 180),
    createdByStaffId: text(identity?.staffId, 180) || undefined,
    createdByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    updatedAt: occurredAt,
    updatedByUserId: text(identity?.uid, 180),
    updatedByStaffId: text(identity?.staffId, 180) || undefined,
    updatedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    version: 1,
  };
}

function returnVisitAuditEvent({ requestId, previousVisit, visit, identity, occurredAt }) {
  return {
    id: deterministicId('FE', `${requestId}:work_visit_return_created:${visit.id}`),
    type: 'work_visit_return_created',
    entityType: 'WorkVisit',
    entityId: visit.id,
    visitId: visit.id,
    previousVisitId: previousVisit.id,
    workOrderId: visit.workOrderId,
    appointmentId: visit.appointmentId,
    customerId: visit.clientId,
    propertyId: visit.propertyId,
    requestId,
    occurredAt,
    performedByUserId: text(identity?.uid, 180),
    performedByStaffId: text(identity?.staffId, 180) || undefined,
    performedByName: text(identity?.name, 180) || text(identity?.email, 180) || text(identity?.uid, 180),
    before: {
      visitId: previousVisit.id,
      status: previousVisit.status,
      version: previousVisit.version,
      secondVisitReason: previousVisit.secondVisitReason,
    },
    after: { visitId: visit.id, status: 'scheduled', version: 1, previousVisitId: previousVisit.id },
  };
}

function createReturnWorkVisitCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') throw new Error('appendAuditInTransaction is required.');

  return async function createReturnWorkVisit({ identity, previousVisitId, expectedVersion, requestId } = {}) {
    const previousId = text(previousVisitId, 180);
    if (!previousId) throw fieldError('visit_required', 'The previous Work Visit id is required.', 400);
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw fieldError('expected_version_required', 'A positive safe-integer expectedVersion is required.', 400);
    }
    const stable = stableRequestId(requestId);
    const returnVisitId = returnVisitDocumentId(previousId, stable);
    let result;

    await db.runTransaction(async (transaction) => {
      const returnVisitRef = db.collection('workVisits').doc(returnVisitId);
      const existingSnapshot = await transaction.get(returnVisitRef);
      if (existingSnapshot.exists) {
        const context = await loadCurrentVisitMutationContext({
          db, transaction, identity, visitId: returnVisitId, resolveAssignment, action: 'execute', requireCurrent: false,
          deniedMessage: 'This assignment cannot create a return Work Visit.',
        });
        if (text(context.storedVisit.previousVisitId, 180) !== previousId
          || text(context.storedVisit.returnVisitRequestId, 240) !== stable
          || context.storedVisit.previousVisitVersion !== expectedVersion) {
          throw fieldError('return_visit_conflict', 'The return Work Visit identity conflicts with this request.', 409);
        }
        result = {
          success: true,
          replayed: true,
          visit: projectActivatedVisit(context.canonicalVisit, context.allowedActions),
          allowedActions: context.allowedActions,
        };
        return;
      }

      const context = await loadCurrentVisitMutationContext({
        db, transaction, identity, visitId: previousId, resolveAssignment, action: 'execute',
        deniedMessage: 'This assignment cannot create a return Work Visit.',
      });
      const previousVisit = context.canonicalVisit;
      if (previousVisit.version !== expectedVersion) {
        throw fieldError('version_conflict', 'This Work Visit changed on another device. Refresh before trying again.', 409, {
          expectedVersion,
          actualVersion: previousVisit.version,
        });
      }
      if (previousVisit.status !== 'requires_return_visit'
        || previousVisit.requiresSecondVisit !== true
        || !text(previousVisit.secondVisitReason, 1000)) {
        throw fieldError('return_visit_not_required', 'The current Work Visit is not ready to create a physical return visit.', 409);
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const visit = buildReturnVisit({
        previousVisit,
        scheduledScopeSnapshot: context.storedVisit.scheduledScopeSnapshot,
        identity,
        assignment: context.assignment,
        occurredAt,
        requestId: stable,
      });
      const event = returnVisitAuditEvent({ requestId: stable, previousVisit, visit, identity, occurredAt });
      transaction.create(returnVisitRef, fieldFirestoreData(visit, 'workVisit'));
      await appendAuditInTransaction({ transaction, event, visit, identity });
      result = {
        success: true,
        replayed: false,
        visit: projectActivatedVisit(projectCanonicalWorkVisit(visit), context.allowedActions),
        allowedActions: context.allowedActions,
        auditEventId: event.id,
      };
    });

    return result;
  };
}

module.exports = { buildReturnVisit, createReturnWorkVisitCommand, returnVisitAuditEvent, returnVisitDocumentId };
