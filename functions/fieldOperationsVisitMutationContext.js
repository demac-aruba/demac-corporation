const { activeWorkOrder, fieldError } = require('./fieldOperationsAuthorityCore');
const {
  assertExistingVisitCompatible,
  projectCanonicalWorkVisit,
} = require('./fieldOperationsAuthorityWorkVisit');
const { requireMutationAction } = require('./fieldOperationsMutationAssignment');
const { orderedWorkVisitChain, workVisitScopeSignature } = require('./fieldOperationsVisitRead');

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map((document) => ({ id: document.id, ...document.data() }));
}

/**
 * Shared transaction-scoped boundary for mutations against the current physical WorkVisit.
 *
 * It intentionally centralizes the high-risk invariants every child/visit mutation needs:
 * current WorkOrder release, current dated assignment, exact action authorization, immutable
 * Customer/Property/Appointment identity, and current physical-visit chain resolution.
 */
async function loadCurrentVisitMutationContext({
  db,
  transaction,
  identity,
  visitId,
  resolveAssignment,
  action,
  deniedMessage,
  requireCurrent = true,
} = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('A Firestore-compatible db is required.');
  if (!transaction || typeof transaction.get !== 'function') throw new Error('A Firestore transaction is required.');
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');

  const normalizedVisitId = text(visitId, 180);
  if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);

  const visitRef = db.collection('workVisits').doc(normalizedVisitId);
  const visitSnapshot = await transaction.get(visitRef);
  if (!visitSnapshot.exists) throw fieldError('visit_not_found', 'The requested Work Visit is not available.', 404);
  const storedVisit = { id: visitSnapshot.id, ...visitSnapshot.data() };
  const initialProjection = projectCanonicalWorkVisit(storedVisit);
  const workOrderId = text(initialProjection.workOrderId, 180);
  if (!workOrderId) throw fieldError('visit_identity_conflict', 'The Work Visit is missing its Work Order identity.', 409);

  const workOrderRef = db.collection('workOrders').doc(workOrderId);
  const workOrderSnapshot = await transaction.get(workOrderRef);
  if (!workOrderSnapshot.exists) throw fieldError('work_order_not_found', 'The Work Order for this visit is not available.', 404);
  const order = { id: workOrderSnapshot.id, ...workOrderSnapshot.data() };
  if (!activeWorkOrder(order)) {
    throw fieldError('work_order_not_available', 'This Work Order is no longer released for active Field execution.', 409);
  }

  const assignment = await resolveAssignment({ transaction, identity, order });
  const allowedActions = requireMutationAction(
    identity,
    assignment,
    action,
    deniedMessage,
  );

  const appointmentId = text(order.appointmentId, 180);
  const customerId = text(order.clientId, 180);
  const propertyId = text(order.propertyId, 180);
  if (!appointmentId || !customerId || !propertyId) {
    throw fieldError('work_order_identity_incomplete', 'The Work Order is missing required Field identity references.', 409, {
      appointmentId: appointmentId || null,
      customerId: customerId || null,
      propertyId: propertyId || null,
    });
  }

  const historySnapshot = await transaction.get(
    db.collection('workVisits').where('workOrderId', '==', workOrderId),
  );
  const historyRecords = snapshotRecords(historySnapshot);
  for (const record of historyRecords) assertExistingVisitCompatible(record, order);
  const orderedHistoryRecords = orderedWorkVisitChain(historyRecords, workOrderId);
  const projectedHistory = orderedHistoryRecords.map((record) => (
    projectCanonicalWorkVisit(record, { appointmentId, propertyId })
  ));
  const rootScopeSignature = projectedHistory.length > 0 ? workVisitScopeSignature(projectedHistory[0]) : '';
  if (projectedHistory.some((visit) => workVisitScopeSignature(visit) !== rootScopeSignature)) {
    throw fieldError(
      'visit_scope_conflict',
      'The physical Work Visit chain does not share one immutable scheduled scope.',
      409,
    );
  }
  const currentRecord = orderedHistoryRecords.length > 0
    ? orderedHistoryRecords[orderedHistoryRecords.length - 1]
    : null;
  if (requireCurrent && (!currentRecord || text(currentRecord.id, 180) !== normalizedVisitId)) {
    throw fieldError('visit_not_current', 'Only the current physical Work Visit may be changed.', 409, {
      currentVisitId: text(currentRecord?.id, 180) || null,
    });
  }

  return {
    allowedActions,
    appointmentId,
    assignment,
    canonicalVisit: projectCanonicalWorkVisit(storedVisit, { appointmentId, propertyId }),
    customerId,
    historyRecords: orderedHistoryRecords,
    order,
    propertyId,
    storedVisit,
    visitRef,
    workOrderId,
    currentVisitId: text(currentRecord?.id, 180) || undefined,
  };
}

module.exports.loadCurrentVisitMutationContext = loadCurrentVisitMutationContext;
module.exports.snapshotRecords = snapshotRecords;
