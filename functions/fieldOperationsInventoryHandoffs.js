'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');

const FIELD_INVENTORY_HANDOFF_COLLECTION = 'fieldInventoryHandoffs';
const FIELD_INVENTORY_HANDOFF_STORAGE_VERSION = 1;
const INVENTORY_HANDOFF_STATUSES = new Set(['ready_for_inventory_authority', 'needs_inventory_review']);

function text(value, limit = 1000) { return String(value ?? '').trim().slice(0, limit); }
function deterministicId(prefix, value) { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`; }

function inventoryHandoffDocumentId(reviewId, revisionId) {
  const normalizedReviewId = text(reviewId, 180);
  const normalizedRevisionId = text(revisionId, 180);
  if (!normalizedReviewId || !normalizedRevisionId) throw fieldError('inventory_handoff_identity_required', 'Office Review and revision identity are required for Inventory handoff.', 400);
  return deterministicId('FIH', `${normalizedReviewId}:${normalizedRevisionId}`);
}

function canonicalQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000 || Math.round(quantity * 1000) !== quantity * 1000) {
    throw fieldError('invalid_inventory_handoff_quantity', 'Inventory handoff quantity is invalid.', 409);
  }
  return quantity;
}

function projectInventoryHandoff(record, expected = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_INVENTORY_HANDOFF_STORAGE_VERSION) {
    throw fieldError('invalid_inventory_handoff_schema', 'Persisted Inventory handoff schema is invalid.', 409);
  }
  const lines = Array.isArray(record?.lines) ? record.lines.map((line) => ({
    sourceSaleLineId: text(line?.sourceSaleLineId, 180),
    itemKind: text(line?.itemKind, 40),
    itemId: text(line?.itemId, 180),
    descriptionSnapshot: text(line?.descriptionSnapshot, 500),
    quantity: canonicalQuantity(line?.quantity),
    unit: text(line?.unit, 40),
  })) : [];
  const blockers = Array.isArray(record?.blockers) ? record.blockers.map((blocker) => ({
    code: text(blocker?.code, 120),
    message: text(blocker?.message, 500),
    sourceSaleLineId: text(blocker?.sourceSaleLineId, 180) || undefined,
  })) : [];
  const projected = {
    id: text(record?.id, 180),
    officeReviewId: text(record?.officeReviewId, 180),
    officeReviewRevisionId: text(record?.officeReviewRevisionId, 180),
    revisionNumber: record?.revisionNumber,
    workOrderId: text(record?.workOrderId, 180),
    appointmentId: text(record?.appointmentId, 180),
    customerId: text(record?.clientId || record?.customerId, 180),
    propertyId: text(record?.propertyId, 180),
    visitId: text(record?.visitId, 180),
    sourceLocationId: text(record?.sourceLocationId, 160) || undefined,
    status: text(record?.status, 80),
    lines,
    blockers,
    inventoryMovementIds: Array.isArray(record?.inventoryMovementIds)
      ? record.inventoryMovementIds.map((value) => text(value, 180)).filter(Boolean)
      : [],
    sourceDecisionRequestId: text(record?.sourceDecisionRequestId, 240),
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    version: record?.version,
  };
  if (!projected.id || !projected.officeReviewId || !projected.officeReviewRevisionId
    || !Number.isSafeInteger(projected.revisionNumber) || projected.revisionNumber < 1
    || !projected.workOrderId || !projected.appointmentId || !projected.customerId || !projected.propertyId
    || !projected.visitId || !projected.sourceDecisionRequestId || !projected.createdBy
    || !projected.createdAt || Number.isNaN(Date.parse(projected.createdAt))
    || projected.version !== 1 || !INVENTORY_HANDOFF_STATUSES.has(projected.status) || !projected.lines.length) {
    throw fieldError('invalid_inventory_handoff_schema', 'Persisted Inventory handoff identity or state is invalid.', 409);
  }
  if (new Set(projected.lines.map((line) => line.sourceSaleLineId)).size !== projected.lines.length
    || projected.lines.some((line) => !line.sourceSaleLineId || line.itemKind !== 'product' || !line.itemId || !line.descriptionSnapshot || !line.unit)) {
    throw fieldError('invalid_inventory_handoff_schema', 'Persisted Inventory handoff lines are invalid or duplicated.', 409);
  }
  if (projected.blockers.some((blocker) => !blocker.code || !blocker.message)
    || new Set(projected.inventoryMovementIds).size !== projected.inventoryMovementIds.length) {
    throw fieldError('invalid_inventory_handoff_schema', 'Persisted Inventory handoff blockers or movement references are invalid.', 409);
  }
  const ready = projected.status === 'ready_for_inventory_authority';
  if ((ready && (!projected.sourceLocationId || projected.blockers.length || projected.inventoryMovementIds.length))
    || (!ready && !projected.blockers.length)) {
    throw fieldError('invalid_inventory_handoff_state', 'Persisted Inventory handoff readiness contradicts its blockers or movement state.', 409);
  }
  for (const field of ['officeReviewId', 'officeReviewRevisionId', 'workOrderId', 'appointmentId', 'customerId', 'propertyId', 'visitId']) {
    const wanted = text(expected?.[field], 180);
    if (wanted && projected[field] !== wanted) throw fieldError('inventory_handoff_identity_conflict', `Inventory handoff ${field} does not match Office Review.`, 409);
  }
  return projected;
}

function buildInventoryHandoff({ review, revision, order, identity, requestId, occurredAt }) {
  const lines = (revision?.snapshot?.fieldSaleLines || [])
    .filter((line) => line?.status === 'sold' && line?.nonCatalog === false && text(line?.catalogItemId, 180))
    .map((line) => ({
      sourceSaleLineId: text(line.id, 180),
      itemKind: 'product',
      itemId: text(line.catalogItemId, 180),
      descriptionSnapshot: text(line.descriptionSnapshot, 500),
      quantity: canonicalQuantity(line.quantity),
      unit: text(line.unit, 40),
    }));
  if (!lines.length) return null;

  const sourceLocationId = text(order?.vanId, 160);
  const blockers = [];
  if (!sourceLocationId) blockers.push({ code: 'inventory_source_location_required', message: 'Work Order has no canonical source Inventory location.' });
  for (const line of lines) {
    if (!Number.isInteger(line.quantity)) blockers.push({
      code: 'inventory_product_whole_quantity_required',
      message: `Inventory Authority requires a whole Product quantity for ${line.sourceSaleLineId}.`,
      sourceSaleLineId: line.sourceSaleLineId,
    });
  }
  const id = inventoryHandoffDocumentId(review.id, revision.id);
  return fieldFirestoreData({
    id,
    fieldAuthorityVersion: FIELD_INVENTORY_HANDOFF_STORAGE_VERSION,
    officeReviewId: review.id,
    officeReviewRevisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    workOrderId: review.workOrderId,
    appointmentId: review.appointmentId,
    clientId: review.customerId,
    propertyId: review.propertyId,
    visitId: review.visitId,
    sourceLocationId: sourceLocationId || undefined,
    status: blockers.length ? 'needs_inventory_review' : 'ready_for_inventory_authority',
    lines,
    blockers,
    inventoryMovementIds: [],
    sourceDecisionRequestId: text(requestId, 240),
    createdAt: text(occurredAt, 80),
    createdByUserId: text(identity?.uid, 180),
    createdByStaffId: text(identity?.staffId, 180) || undefined,
    version: 1,
  }, 'fieldInventoryHandoff');
}

async function prepareInventoryHandoffInTransaction({ db, transaction, review, revision, order, identity, requestId, occurredAt }) {
  const candidate = buildInventoryHandoff({ review, revision, order, identity, requestId, occurredAt });
  if (!candidate) return { handoff: null, create: null };
  const ref = db.collection(FIELD_INVENTORY_HANDOFF_COLLECTION).doc(candidate.id);
  const snapshot = await transaction.get(ref);
  const expected = {
    officeReviewId: review.id,
    officeReviewRevisionId: revision.id,
    workOrderId: review.workOrderId,
    appointmentId: review.appointmentId,
    customerId: review.customerId,
    propertyId: review.propertyId,
    visitId: review.visitId,
  };
  if (snapshot.exists) return { handoff: projectInventoryHandoff(fieldSnapshotRecord(snapshot), expected), create: null };
  return { handoff: projectInventoryHandoff(candidate, expected), create: { ref, value: candidate } };
}

async function ensureInventoryHandoffInTransaction(args) {
  const prepared = await prepareInventoryHandoffInTransaction(args);
  if (prepared.create) args.transaction.create(prepared.create.ref, prepared.create.value);
  return prepared.handoff;
}

async function loadInventoryHandoffInTransaction({ db, transaction, review }) {
  const id = inventoryHandoffDocumentId(review.id, review.currentRevisionId);
  const snapshot = await transaction.get(db.collection(FIELD_INVENTORY_HANDOFF_COLLECTION).doc(id));
  if (!snapshot.exists) return null;
  return projectInventoryHandoff(fieldSnapshotRecord(snapshot), {
    officeReviewId: review.id,
    officeReviewRevisionId: review.currentRevisionId,
    workOrderId: review.workOrderId,
    appointmentId: review.appointmentId,
    customerId: review.customerId,
    propertyId: review.propertyId,
    visitId: review.visitId,
  });
}

module.exports = {
  FIELD_INVENTORY_HANDOFF_COLLECTION,
  FIELD_INVENTORY_HANDOFF_STORAGE_VERSION,
  INVENTORY_HANDOFF_STATUSES,
  buildInventoryHandoff,
  ensureInventoryHandoffInTransaction,
  inventoryHandoffDocumentId,
  loadInventoryHandoffInTransaction,
  prepareInventoryHandoffInTransaction,
  projectInventoryHandoff,
};
