const FIELD_OPERATION_EVENT_COLLECTION = 'fieldOperationEvents';
const FIELD_OPERATION_EVENT_VERSION = 1;

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function requiredText(value, field, limit) {
  const result = text(value, limit);
  if (!result) throw new Error(`Field audit event requires ${field}.`);
  return result;
}

function validTimestamp(value) {
  const result = text(value, 80);
  if (!result || !Number.isFinite(Date.parse(result))) {
    throw new Error('Field audit event requires a valid occurredAt timestamp.');
  }
  return result;
}

function optionalObject(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Field audit event ${field} must be an object when provided.`);
  }
  return value;
}

function normalizeFieldOperationEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('A Field audit event object is required.');
  }

  const requestId = requiredText(event.requestId, 'requestId', 240);
  if (requestId.length < 8) throw new Error('Field audit event requestId must contain at least 8 characters.');

  const normalized = {
    id: requiredText(event.id, 'id', 180),
    fieldEventVersion: FIELD_OPERATION_EVENT_VERSION,
    type: requiredText(event.type, 'type', 120),
    entityType: requiredText(event.entityType, 'entityType', 80),
    entityId: requiredText(event.entityId, 'entityId', 180),
    workOrderId: requiredText(event.workOrderId, 'workOrderId', 180),
    requestId,
    occurredAt: validTimestamp(event.occurredAt),
    performedByUserId: requiredText(event.performedByUserId, 'performedByUserId', 180),
  };

  const optionalTextFields = [
    ['appointmentId', 180],
    ['customerId', 180],
    ['propertyId', 180],
    ['visitId', 180],
    ['interventionId', 180],
    ['assetId', 180],
    ['performedByStaffId', 180],
    ['performedByName', 180],
    ['sourceAuthority', 120],
    ['correlationId', 240],
  ];
  for (const [field, limit] of optionalTextFields) {
    const value = text(event[field], limit);
    if (value) normalized[field] = value;
  }

  const before = optionalObject(event.before, 'before');
  const after = optionalObject(event.after, 'after');
  const metadata = optionalObject(event.metadata, 'metadata');
  if (before) normalized.before = before;
  if (after) normalized.after = after;
  if (metadata) normalized.metadata = metadata;

  return normalized;
}

function createFieldAuditAppender({ db, collectionName = FIELD_OPERATION_EVENT_COLLECTION } = {}) {
  if (!db || typeof db.collection !== 'function') throw new Error('A Firestore-compatible db is required for Field audit persistence.');
  const normalizedCollectionName = requiredText(collectionName, 'collectionName', 180);

  return async function appendAuditInTransaction({ transaction, event } = {}) {
    if (!transaction || typeof transaction.create !== 'function') {
      throw new Error('A Firestore transaction with create() is required for Field audit persistence.');
    }
    const normalizedEvent = normalizeFieldOperationEvent(event);
    const eventRef = db.collection(normalizedCollectionName).doc(normalizedEvent.id);

    // Append-only by construction. Deterministic event IDs make an accidental duplicate create
    // fail the surrounding transaction instead of silently overwriting historical truth.
    transaction.create(eventRef, normalizedEvent);
    return normalizedEvent;
  };
}

module.exports.FIELD_OPERATION_EVENT_COLLECTION = FIELD_OPERATION_EVENT_COLLECTION;
module.exports.FIELD_OPERATION_EVENT_VERSION = FIELD_OPERATION_EVENT_VERSION;
module.exports.createFieldAuditAppender = createFieldAuditAppender;
module.exports.normalizeFieldOperationEvent = normalizeFieldOperationEvent;
