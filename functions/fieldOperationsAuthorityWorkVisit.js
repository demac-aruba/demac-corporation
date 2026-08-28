const crypto = require('node:crypto');
const { fieldFirestoreData } = require('./fieldOperationsFirestoreData');
const {
  activeWorkOrder,
  fieldError,
  plannedWorkItems,
} = require('./fieldOperationsAuthorityCore');
const { requireMutationExecution } = require('./fieldOperationsMutationAssignment');

const FIELD_WORK_VISIT_STORAGE_VERSION = 1;
const INITIAL_VISIT_WORK_ORDER_STATUSES = new Set(['Confirmada', 'Asignada']);

const CANONICAL_TO_STORAGE_STATUS = Object.freeze({
  scheduled: 'not_started',
  en_route: 'on_the_way',
  on_site: 'on_site',
  in_progress: 'in_progress',
  pending: 'pending',
  requires_return_visit: 'requires_return_visit',
  ready_for_office_review: 'ready_for_office_review',
  completed: 'completed',
  no_access: 'no_access',
  cancelled: 'cancelled',
});
const STORAGE_TO_CANONICAL_STATUS = Object.freeze(
  Object.fromEntries(Object.entries(CANONICAL_TO_STORAGE_STATUS).map(([canonical, storage]) => [storage, canonical])),
);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function unique(values) {
  return [...new Set(values.map((value) => text(value, 180)).filter(Boolean))];
}

function stableRequestId(value) {
  const result = text(value, 240);
  if (result.length < 8) {
    throw fieldError('invalid_request', 'A stable requestId of at least 8 characters is required.', 400, { field: 'requestId' });
  }
  return result;
}

function deterministicId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

/**
 * Compatibility identity for the first WorkVisit created from a Work Order.
 * It intentionally matches active Legacy `idPart()` behavior. Return visits must use a
 * distinct physical-visit identity in their own later command; never reuse this helper for them.
 */
function initialVisitDocumentId(workOrderId) {
  const safe = text(workOrderId, 180)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  if (!safe) throw fieldError('work_order_required', 'A Work Order id is required.');
  return `visit-${safe}`;
}

function storageStatusFromCanonical(value) {
  const canonicalStatus = text(value, 80);
  const storageStatus = CANONICAL_TO_STORAGE_STATUS[canonicalStatus];
  if (!storageStatus) {
    throw fieldError(
      'invalid_visit_status',
      `Unknown canonical Work Visit status: ${canonicalStatus || 'missing'}.`,
      400,
      { canonicalStatus },
    );
  }
  return storageStatus;
}

function canonicalStatusFromStorage(value) {
  const storageStatus = text(value, 80);
  const canonicalStatus = STORAGE_TO_CANONICAL_STATUS[storageStatus];
  if (!canonicalStatus) {
    throw fieldError('invalid_visit_status', `Unknown persisted Work Visit status: ${storageStatus || 'missing'}.`, 409, { storageStatus });
  }
  return canonicalStatus;
}

function workOrderAllowsInitialVisitPreparation(order) {
  return INITIAL_VISIT_WORK_ORDER_STATUSES.has(text(order?.status, 80));
}

function storageStatusFromWorkOrder(order) {
  const workOrderStatus = text(order?.status, 80);
  if (!workOrderAllowsInitialVisitPreparation(order)) {
    throw fieldError(
      'invalid_work_order_status',
      `Unsupported Work Order status for initial Field preparation: ${workOrderStatus || 'missing'}.`,
      409,
      { workOrderStatus },
    );
  }
  return storageStatusFromCanonical('scheduled');
}

function canonicalVisitVersion(value) {
  // Active Legacy visits may predate versioning entirely. Only true field absence receives the
  // compatibility default; an explicitly persisted null/string/fractional value is corruption.
  if (value === undefined) return 1;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw fieldError('invalid_visit_version', 'Persisted Work Visit version is invalid.', 409, { version: text(value, 80) });
  }
  return value;
}

function nonNegativeQuantity(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function buildScheduledScopeSnapshot(order, appointment, capturedAt) {
  const workLines = plannedWorkItems(order, appointment);
  const customerFacingDescription = text(order.customerFacingDescription || order.problem, 1500);
  const technicianInstructions = text(order.technicianInstructions || order.officeNotes, 1500);
  const primary = workLines[0] || {};
  return {
    appointmentId: text(order.appointmentId, 180),
    capturedAt,
    estimatedUnitCount: nonNegativeQuantity(order.airConditionerCount),
    workLines,
    customerFacingDescription,
    technicianInstructions,
    // Legacy compatibility aliases are derived from the same immutable snapshot.
    serviceId: text(order.serviceId || primary.serviceId, 180),
    serviceName: text(order.serviceName || primary.label, 240),
    problemDescription: customerFacingDescription,
  };
}

function actorFields(identity, now) {
  return {
    createdAt: now,
    createdByUserId: text(identity.uid, 180),
    createdByStaffId: text(identity.staffId, 180) || undefined,
    createdByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    updatedAt: now,
    updatedByUserId: text(identity.uid, 180),
    updatedByStaffId: text(identity.staffId, 180) || undefined,
    updatedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    version: 1,
  };
}

function buildLegacyCompatibleWorkVisit({ order, appointment, identity, assignment, now }) {
  const workOrderId = text(order.id, 180);
  const appointmentId = text(order.appointmentId, 180);
  const clientId = text(order.clientId, 180);
  const propertyId = text(order.propertyId, 180);
  if (!workOrderId) throw fieldError('work_order_required', 'A Work Order id is required.');
  if (!appointmentId) throw fieldError('appointment_required', 'The Work Order is missing its Appointment reference.', 409);
  if (!clientId) throw fieldError('customer_required', 'The Work Order is missing its Customer reference.', 409);
  if (!propertyId) throw fieldError('property_required', 'The Work Order is missing its Property reference.', 409);

  // Canonical participatingStaffIds contains staff-profile IDs only. Work Order technicianIds
  // is a compatibility field that may historically contain a Firebase uid, so it is not copied.
  const participatingStaffIds = unique([
    identity.staffId,
    assignment?.leadTechnicianStaffId,
    ...(Array.isArray(assignment?.participatingStaffIds) ? assignment.participatingStaffIds : []),
  ]);

  return {
    id: initialVisitDocumentId(workOrderId),
    fieldAuthorityVersion: FIELD_WORK_VISIT_STORAGE_VERSION,
    workOrderId,
    appointmentId,
    clientId,
    propertyId,
    scheduledScopeSnapshot: buildScheduledScopeSnapshot(order, appointment, now),
    status: storageStatusFromWorkOrder(order),
    leadTechnicianStaffId: text(assignment?.leadTechnicianStaffId, 180) || undefined,
    participatingStaffIds,
    requiresSecondVisit: false,
    ...actorFields(identity, now),
  };
}

function projectCanonicalWorkVisit(record, identityFallback = {}) {
  const snapshot = record?.scheduledScopeSnapshot || {};
  const appointmentId = text(record?.appointmentId || snapshot.appointmentId || identityFallback.appointmentId, 180);
  const propertyId = text(record?.propertyId || identityFallback.propertyId, 180);
  return {
    id: text(record?.id, 180),
    appointmentId,
    workOrderId: text(record?.workOrderId, 180),
    customerId: text(record?.clientId || record?.customerId, 180),
    propertyId,
    scheduledScopeSnapshot: {
      // Active Legacy snapshots predate appointmentId/workLines. Fill only structural identity
      // from the already-validated Work Order; never invent historical planned work lines.
      appointmentId,
      capturedAt: text(snapshot.capturedAt || record?.createdAt, 80),
      estimatedUnitCount: nonNegativeQuantity(snapshot.estimatedUnitCount),
      workLines: Array.isArray(snapshot.workLines) ? snapshot.workLines : [],
      customerFacingDescription: text(snapshot.customerFacingDescription || snapshot.problemDescription, 1500),
      technicianInstructions: text(snapshot.technicianInstructions, 1500),
    },
    status: canonicalStatusFromStorage(record?.status),
    leadTechnicianStaffId: text(record?.leadTechnicianStaffId, 180) || undefined,
    participatingStaffIds: unique(Array.isArray(record?.participatingStaffIds) ? record.participatingStaffIds : []),
    departedAt: text(record?.departedAt, 80) || undefined,
    arrivedAt: text(record?.arrivedAt, 80) || undefined,
    startedAt: text(record?.startedAt, 80) || undefined,
    pendingAt: text(record?.pendingAt, 80) || undefined,
    pendingReason: text(record?.pendingReason, 1000) || undefined,
    pendingAction: text(record?.pendingAction, 1500) || undefined,
    resumedAt: text(record?.resumedAt, 80) || undefined,
    noAccessAt: text(record?.noAccessAt, 80) || undefined,
    noAccessReason: text(record?.noAccessReason, 1000) || undefined,
    cancelledAt: text(record?.cancelledAt, 80) || undefined,
    cancellationReason: text(record?.cancellationReason, 1000) || undefined,
    submittedAt: text(record?.submittedAt, 80) || undefined,
    completedAt: text(record?.completedAt, 80) || undefined,
    requiresSecondVisit: record?.requiresSecondVisit === true,
    secondVisitRequiredAt: text(record?.secondVisitRequiredAt, 80) || undefined,
    secondVisitReason: text(record?.secondVisitReason, 1000) || undefined,
    previousVisitId: text(record?.previousVisitId, 180) || undefined,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version: canonicalVisitVersion(record?.version),
  };
}

function assertReferenceMatches(record, expectedId, fields, code, label) {
  for (const field of fields) {
    const actual = text(record?.[field], 180);
    if (actual && actual !== expectedId) {
      throw fieldError(code, `${label} does not belong to this Work Order.`, 409, { field, expectedId, actual });
    }
  }
}

function assertExistingVisitCompatible(existing, order) {
  const expectedWorkOrderId = text(order.id, 180);
  const expectedCustomerId = text(order.clientId, 180);
  const expectedPropertyId = text(order.propertyId, 180);
  const expectedAppointmentId = text(order.appointmentId, 180);
  if (text(existing.workOrderId, 180) !== expectedWorkOrderId) {
    throw fieldError('visit_identity_conflict', 'The existing Work Visit belongs to a different Work Order.', 409);
  }

  const customerReferences = [
    ['clientId', existing.clientId],
    ['customerId', existing.customerId],
  ];
  const presentCustomers = customerReferences.map(([field, value]) => [field, text(value, 180)]).filter(([, value]) => value);
  if (!presentCustomers.length || presentCustomers.some(([, value]) => value !== expectedCustomerId)) {
    throw fieldError('visit_identity_conflict', 'The existing Work Visit belongs to a different Customer.', 409, {
      expectedCustomerId,
      references: Object.fromEntries(presentCustomers),
    });
  }

  const optionalReferences = [
    ['propertyId', existing.propertyId, expectedPropertyId, 'Property'],
    ['siteId', existing.siteId, expectedPropertyId, 'Property'],
    ['appointmentId', existing.appointmentId, expectedAppointmentId, 'Appointment'],
    ['scheduledScopeSnapshot.appointmentId', existing.scheduledScopeSnapshot?.appointmentId, expectedAppointmentId, 'Appointment'],
  ];
  for (const [field, rawValue, expectedId, label] of optionalReferences) {
    const actual = text(rawValue, 180);
    if (actual && actual !== expectedId) {
      throw fieldError('visit_identity_conflict', `The existing Work Visit belongs to a different ${label}.`, 409, {
        field,
        expectedId,
        actual,
      });
    }
  }
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map((document) => ({ id: document.id, ...document.data() }));
}

async function findLegacyInitialVisit({ db, transaction, order, expectedVisitId, expectedInitialExists = false }) {
  const query = db.collection('workVisits').where('workOrderId', '==', text(order.id, 180));
  const records = snapshotRecords(await transaction.get(query)).filter((record) => record.id !== expectedVisitId);
  const initialCandidates = records.filter((record) => !text(record.previousVisitId, 180));

  if (expectedInitialExists) {
    if (initialCandidates.length) {
      throw fieldError(
        'legacy_visit_identity_ambiguous',
        'Existing Work Visit history contains more than one possible initial visit.',
        409,
        { workOrderId: text(order.id, 180), visitIds: [expectedVisitId, ...initialCandidates.map((record) => record.id)] },
      );
    }
    return null;
  }

  if (!records.length) return null;
  if (initialCandidates.length !== 1) {
    throw fieldError(
      'legacy_visit_identity_ambiguous',
      'Existing Work Visit history for this Work Order cannot be resolved to one unambiguous initial visit.',
      409,
      { workOrderId: text(order.id, 180), visitIds: records.map((record) => record.id) },
    );
  }

  const existing = initialCandidates[0];
  assertExistingVisitCompatible(existing, order);
  return existing;
}

function visitAuditEvent({ requestId, visit, identity, now }) {
  return {
    id: deterministicId('FE', `${requestId}:work_visit_prepared:${visit.id}`),
    type: 'work_visit_prepared',
    entityType: 'WorkVisit',
    entityId: visit.id,
    workOrderId: visit.workOrderId,
    appointmentId: visit.appointmentId,
    customerId: visit.clientId,
    propertyId: visit.propertyId,
    requestId,
    occurredAt: now,
    performedByUserId: text(identity.uid, 180),
    performedByStaffId: text(identity.staffId, 180) || undefined,
    performedByName: text(identity.name, 180) || text(identity.email, 180) || text(identity.uid, 180),
    after: {
      status: canonicalStatusFromStorage(visit.status),
      version: visit.version,
      estimatedUnitCount: visit.scheduledScopeSnapshot?.estimatedUnitCount ?? 0,
    },
  };
}

function createPrepareWorkVisitCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A transaction-capable Firestore db is required.');
  }
  if (typeof resolveAssignment !== 'function') throw new Error('resolveAssignment is required.');
  if (typeof appendAuditInTransaction !== 'function') {
    throw new Error('appendAuditInTransaction is required before canonical Field mutations may be enabled.');
  }

  return async function prepareWorkVisit({ identity, workOrderId, requestId }) {
    const normalizedWorkOrderId = text(workOrderId, 180);
    if (!normalizedWorkOrderId) throw fieldError('work_order_required', 'A Work Order id is required.');
    const stable = stableRequestId(requestId);
    let result;

    await db.runTransaction(async (transaction) => {
      const workOrderRef = db.collection('workOrders').doc(normalizedWorkOrderId);
      const workOrderSnapshot = await transaction.get(workOrderRef);
      if (!workOrderSnapshot.exists) throw fieldError('work_order_not_found', 'The requested Work Order is not available.', 404);
      const order = { id: workOrderSnapshot.id, ...workOrderSnapshot.data() };
      if (!activeWorkOrder(order)) throw fieldError('work_order_not_available', 'This Work Order is not released for active Field execution.', 409);

      const appointmentId = text(order.appointmentId, 180);
      const clientId = text(order.clientId, 180);
      const propertyId = text(order.propertyId, 180);
      if (!appointmentId) throw fieldError('appointment_required', 'The Work Order is missing its Appointment reference.', 409);
      if (!clientId) throw fieldError('customer_required', 'The Work Order is missing its Customer reference.', 409);
      if (!propertyId) throw fieldError('property_required', 'The Work Order is missing its Property reference.', 409);

      const [appointmentSnapshot, customerSnapshot, propertySnapshot] = await Promise.all([
        transaction.get(db.collection('appointments').doc(appointmentId)),
        transaction.get(db.collection('clients').doc(clientId)),
        transaction.get(db.collection('properties').doc(propertyId)),
      ]);
      if (!appointmentSnapshot.exists) throw fieldError('appointment_not_found', 'The Work Order Appointment no longer exists.', 409);
      if (!customerSnapshot.exists) throw fieldError('customer_not_found', 'The Work Order Customer no longer exists.', 409);
      if (!propertySnapshot.exists) throw fieldError('property_not_found', 'The Work Order Property no longer exists.', 409);

      const appointment = { id: appointmentSnapshot.id, ...appointmentSnapshot.data() };
      const customer = { id: customerSnapshot.id, ...customerSnapshot.data() };
      const property = { id: propertySnapshot.id, ...propertySnapshot.data() };
      assertReferenceMatches(appointment, clientId, ['clientId', 'customerId'], 'appointment_customer_mismatch', 'Appointment');
      assertReferenceMatches(appointment, propertyId, ['propertyId', 'siteId'], 'appointment_property_mismatch', 'Appointment');
      assertReferenceMatches(property, clientId, ['clientId', 'customerId'], 'property_customer_mismatch', 'Property');
      if (text(customer.id, 180) !== clientId) throw fieldError('customer_identity_mismatch', 'Customer identity mismatch.', 409);

      const assignment = await resolveAssignment({ transaction, identity, order });
      const allowedActions = requireMutationExecution(
        identity,
        assignment,
        'This assignment may view the Work Order but cannot prepare a Work Visit.',
      );
      const visitId = initialVisitDocumentId(normalizedWorkOrderId);
      const visitRef = db.collection('workVisits').doc(visitId);
      const existingSnapshot = await transaction.get(visitRef);
      if (existingSnapshot.exists) {
        const existing = { id: existingSnapshot.id, ...existingSnapshot.data() };
        assertExistingVisitCompatible(existing, order);
        await findLegacyInitialVisit({ db, transaction, order, expectedVisitId: visitId, expectedInitialExists: true });
        result = {
          replayed: true,
          source: existing.fieldAuthorityVersion ? 'field_authority' : 'legacy_existing',
          visit: projectCanonicalWorkVisit(existing, { appointmentId, propertyId }),
          allowedActions,
        };
        return;
      }

      // Active Legacy resolves existing visits by workOrderId, not only by deterministic id.
      // Adopt one unambiguous historical initial visit even when valid return visits also exist;
      // return-only or duplicate-initial history fails closed rather than creating/guessing truth.
      const legacyExisting = await findLegacyInitialVisit({ db, transaction, order, expectedVisitId: visitId });
      if (legacyExisting) {
        result = {
          replayed: true,
          source: legacyExisting.fieldAuthorityVersion ? 'field_authority' : 'legacy_existing',
          visit: projectCanonicalWorkVisit(legacyExisting, { appointmentId, propertyId }),
          allowedActions,
        };
        return;
      }

      // Never manufacture physical history from an already in-flight WorkOrder status. A new
      // canonical WorkVisit may only begin from not-started planning/release state. Existing
      // Legacy in-flight records require explicit reconciliation instead of silent conversion.
      if (!workOrderAllowsInitialVisitPreparation(order)) {
        throw fieldError(
          'work_visit_preparation_not_allowed',
          'A new Work Visit can only be prepared from a not-started Work Order.',
          409,
          { workOrderStatus: text(order.status, 80) },
        );
      }

      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      const visit = buildLegacyCompatibleWorkVisit({ order, appointment, identity, assignment, now: occurredAt });
      const event = visitAuditEvent({ requestId: stable, visit, identity, now: occurredAt });

      transaction.create(visitRef, fieldFirestoreData(visit, 'workVisit'));
      await appendAuditInTransaction({ transaction, event, visit, identity });
      result = {
        replayed: false,
        source: 'field_authority',
        visit: projectCanonicalWorkVisit(visit),
        allowedActions,
        auditEventId: event.id,
      };
    });

    return { success: true, ...result };
  };
}

module.exports = {
  FIELD_WORK_VISIT_STORAGE_VERSION,
  assertExistingVisitCompatible,
  buildLegacyCompatibleWorkVisit,
  buildScheduledScopeSnapshot,
  canonicalStatusFromStorage,
  canonicalVisitVersion,
  createPrepareWorkVisitCommand,
  initialVisitDocumentId,
  projectCanonicalWorkVisit,
  stableRequestId,
  storageStatusFromCanonical,
  storageStatusFromWorkOrder,
  visitAuditEvent,
  workOrderAllowsInitialVisitPreparation,
};
