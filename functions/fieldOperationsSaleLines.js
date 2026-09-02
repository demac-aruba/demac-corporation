'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');
const { stableRequestId } = require('./fieldOperationsAuthorityWorkVisit');
const { loadCurrentVisitMutationContext } = require('./fieldOperationsVisitMutationContext');
const { projectFieldApproval } = require('./fieldOperationsApprovals');
const { projectFieldPriceSnapshot } = require('./fieldOperationsPriceSnapshots');
const { projectVisitAsset } = require('./fieldOperationsVisitAssets');
const { WORK_INTERVENTION_COLLECTION, projectWorkIntervention } = require('./fieldOperationsVisitInterventions');
const { resolveServicePriceSnapshot } = require('./servicePricingAuthority');

const FIELD_SALE_LINE_COLLECTION = 'fieldSaleLines';
const FIELD_SALE_LINE_STORAGE_VERSION = 1;
const FIELD_SALE_LINE_STATUSES = new Set(['proposed', 'customer_approved', 'installed', 'delivered', 'sold', 'declined', 'voided']);
const FIELD_SALE_ACTIVE_VISIT_STATUSES = new Set(['on_site', 'in_progress']);
const FIELD_SALE_TRANSITIONS = Object.freeze({
  proposed: Object.freeze(['customer_approved', 'declined', 'voided']),
  customer_approved: Object.freeze(['installed', 'delivered', 'voided']),
  installed: Object.freeze(['sold']),
  delivered: Object.freeze(['sold']),
  sold: Object.freeze([]),
  declined: Object.freeze([]),
  voided: Object.freeze([]),
});

function text(value, limit = 1000) { return String(value ?? '').trim().slice(0, limit); }
function deterministicId(prefix, value) { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`; }
function snapshotRecords(snapshot) { return (snapshot?.docs || []).map(fieldSnapshotRecord); }
function money(value) { return Math.round(Number(value) * 100) / 100; }

function canonicalQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000 || Math.round(quantity * 1000) !== quantity * 1000) {
    throw fieldError('invalid_field_sale_quantity', 'Field Sale Line quantity must be positive with at most three decimals.', 400);
  }
  return quantity;
}

function isSellableProduct(record) {
  return record?.active !== false && text(record?.itemType, 80).toLowerCase() === 'producto';
}

function productUnit(record) { return text(record?.unit || record?.unitOfMeasure, 40) || 'ea'; }

function projectFieldSaleLine(record, expected = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_SALE_LINE_STORAGE_VERSION) {
    throw fieldError('invalid_field_sale_line_schema', 'Persisted Field Sale Line schema is invalid.', 409);
  }
  const projected = {
    id: text(record?.id, 180),
    visitId: text(record?.visitId, 180),
    workOrderId: text(record?.workOrderId, 180),
    customerId: text(record?.clientId || record?.customerId, 180),
    propertyId: text(record?.propertyId, 180),
    interventionId: text(record?.interventionId, 180) || undefined,
    assetId: text(record?.assetId, 180) || undefined,
    catalogItemId: text(record?.catalogItemId, 180) || undefined,
    descriptionSnapshot: text(record?.descriptionSnapshot, 500),
    quantity: canonicalQuantity(record?.quantity),
    unit: text(record?.unit, 40),
    priceSnapshot: record?.priceSnapshot ? projectFieldPriceSnapshot(record.priceSnapshot, text(record?.catalogItemId, 180)) : undefined,
    status: text(record?.status, 80),
    soldByStaffId: text(record?.soldByStaffId, 180),
    requiresCustomerApproval: record?.requiresCustomerApproval,
    customerApprovalId: text(record?.customerApprovalId, 180) || undefined,
    inventoryMovementId: text(record?.inventoryMovementId, 180) || undefined,
    invoiceLineId: text(record?.invoiceLineId, 180) || undefined,
    nonCatalog: record?.nonCatalog,
    officeReviewRequired: record?.officeReviewRequired,
    notes: text(record?.notes, 1500) || undefined,
    createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180),
    updatedAt: text(record?.updatedAt, 80),
    updatedBy: text(record?.updatedByUserId || record?.updatedBy, 180),
    version: record?.version,
  };
  if (!projected.id || !projected.visitId || !projected.workOrderId || !projected.customerId || !projected.propertyId
    || !projected.descriptionSnapshot || !projected.unit || !projected.soldByStaffId || !projected.createdBy
    || !projected.createdAt || Number.isNaN(Date.parse(projected.createdAt))
    || !projected.updatedAt || Number.isNaN(Date.parse(projected.updatedAt))) {
    throw fieldError('field_sale_line_identity_conflict', 'Persisted Field Sale Line identity or audit metadata is incomplete.', 409);
  }
  if (!FIELD_SALE_LINE_STATUSES.has(projected.status) || !Number.isSafeInteger(projected.version) || projected.version < 1
    || typeof projected.nonCatalog !== 'boolean' || typeof projected.officeReviewRequired !== 'boolean'
    || typeof projected.requiresCustomerApproval !== 'boolean') {
    throw fieldError('invalid_field_sale_line_state', 'Persisted Field Sale Line state is invalid.', 409);
  }
  if (projected.nonCatalog) {
    if (projected.catalogItemId || projected.priceSnapshot || !projected.officeReviewRequired || projected.requiresCustomerApproval
      || !['proposed', 'voided'].includes(projected.status)) {
      throw fieldError('invalid_field_sale_line_state', 'Non-catalog Field Sale Line must remain an unpriced Office Review draft or be voided.', 409);
    }
  } else if (!projected.catalogItemId || !projected.priceSnapshot || !projected.requiresCustomerApproval || projected.officeReviewRequired) {
    throw fieldError('invalid_field_sale_line_state', 'Catalog Field Sale Line is missing its governed product price or approval policy.', 409);
  }
  const approvedStatuses = new Set(['customer_approved', 'installed', 'delivered', 'sold']);
  if ((approvedStatuses.has(projected.status) || projected.status === 'declined') && !projected.customerApprovalId) {
    throw fieldError('invalid_field_sale_line_state', 'Decided Field Sale Line is missing customer approval evidence.', 409);
  }
  for (const field of ['visitId', 'workOrderId', 'customerId', 'propertyId']) {
    const wanted = text(expected?.[field], 180);
    if (wanted && projected[field] !== wanted) throw fieldError('field_sale_line_identity_conflict', `Field Sale Line ${field} does not match the authorized visit.`, 409);
  }
  return projected;
}

function fieldSaleLineOptions(line) {
  return {
    saleLineId: line.id,
    allowedTargets: [...(FIELD_SALE_TRANSITIONS[line.status] || [])]
      .filter((target) => !['customer_approved', 'declined'].includes(target)),
  };
}

function baseEligible(job) {
  return Boolean(job?.fieldVisit && FIELD_SALE_ACTIVE_VISIT_STATUSES.has(text(job.fieldVisit.status, 80))
    && Array.isArray(job.allowedActions) && job.allowedActions.includes('execute'));
}

function catalogOption(record, capturedAt) {
  if (!isSellableProduct(record)) return null;
  try {
    const priceSnapshot = resolveServicePriceSnapshot({ service: record, capturedAt });
    return {
      catalogItemId: text(record.id, 180),
      label: text(record.name, 240),
      description: text(record.description, 1000) || undefined,
      unit: productUnit(record),
      priceSnapshot: { ...priceSnapshot, lineTotal: priceSnapshot.unitPrice },
    };
  } catch {
    return null;
  }
}

async function attachFieldSaleLinesToJob(db, job, now = () => new Date().toISOString()) {
  const visitId = text(job?.fieldVisit?.id, 180);
  if (!visitId) return { ...job, fieldSaleLines: [], fieldSaleCatalogOptions: [], fieldSaleDecisionLineIds: [], fieldSaleTransitionOptions: [], canAddFieldSaleLine: false, canAddNonCatalogFieldSaleLine: false, canRecordFieldSaleDecision: false };
  const [lineSnapshot, catalogSnapshot] = await Promise.all([
    db.collection(FIELD_SALE_LINE_COLLECTION).where('visitId', '==', visitId).get(),
    db.collection('services').get(),
  ]);
  const expected = { visitId, workOrderId: job.workOrderId, customerId: job.customerId, propertyId: job.propertyId };
  const fieldSaleLines = snapshotRecords(lineSnapshot).map((record) => projectFieldSaleLine(record, expected))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const eligible = baseEligible(job);
  const capturedAt = text(now(), 80);
  const fieldSaleCatalogOptions = eligible
    ? snapshotRecords(catalogSnapshot).map((record) => catalogOption(record, capturedAt)).filter(Boolean)
      .sort((left, right) => left.label.localeCompare(right.label))
    : [];
  return {
    ...job,
    fieldSaleLines,
    fieldSaleCatalogOptions,
    fieldSaleDecisionLineIds: eligible ? fieldSaleLines.filter((line) => !line.nonCatalog && line.status === 'proposed').map((line) => line.id) : [],
    fieldSaleTransitionOptions: eligible ? fieldSaleLines.map(fieldSaleLineOptions).filter((item) => item.allowedTargets.length) : [],
    canAddFieldSaleLine: eligible && fieldSaleCatalogOptions.length > 0,
    canAddNonCatalogFieldSaleLine: eligible,
    canRecordFieldSaleDecision: eligible && fieldSaleLines.some((line) => !line.nonCatalog && line.status === 'proposed'),
  };
}

function actor(identity, occurredAt, version = 1) {
  return {
    createdAt: occurredAt,
    createdByUserId: text(identity.uid, 180),
    createdByStaffId: text(identity.staffId, 180) || undefined,
    updatedAt: occurredAt,
    updatedByUserId: text(identity.uid, 180),
    updatedByStaffId: text(identity.staffId, 180) || undefined,
    version,
  };
}

function createFieldSaleLineCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function' || typeof appendAuditInTransaction !== 'function') throw new Error('Field Sale Line authority dependencies are required.');
  return async function createFieldSaleLine({ identity, visitId, catalogItemId, description, quantity, unit, interventionId, assetId, notes, requestId } = {}) {
    const normalizedVisitId = text(visitId, 180);
    const normalizedCatalogItemId = text(catalogItemId, 180);
    const normalizedDescription = text(description, 500);
    const normalizedUnit = text(unit, 40);
    const normalizedInterventionId = text(interventionId, 180);
    const normalizedAssetId = text(assetId, 180);
    const normalizedQuantity = canonicalQuantity(quantity);
    if (!normalizedVisitId) throw fieldError('visit_required', 'A Work Visit id is required.', 400);
    if (!normalizedCatalogItemId && (normalizedDescription.length < 3 || !normalizedUnit)) {
      throw fieldError('field_sale_non_catalog_details_required', 'Non-catalog Field Sale draft requires description and unit.', 400);
    }
    const stable = stableRequestId(requestId);
    const lineId = deterministicId('FSL', `${normalizedVisitId}:${stable}`);
    let result;
    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({ db, transaction, identity, visitId: normalizedVisitId, resolveAssignment, action: 'execute', deniedMessage: 'This assignment cannot create Field Sale Lines.' });
      if (!FIELD_SALE_ACTIVE_VISIT_STATUSES.has(context.canonicalVisit.status)) throw fieldError('field_sale_not_allowed', 'Field Sale Lines require an on-site or in-progress Work Visit.', 409);
      const lineRef = db.collection(FIELD_SALE_LINE_COLLECTION).doc(lineId);
      const existingSnapshot = await transaction.get(lineRef);
      if (existingSnapshot.exists) {
        const existing = projectFieldSaleLine(fieldSnapshotRecord(existingSnapshot), {
          visitId: normalizedVisitId, workOrderId: context.workOrderId,
          customerId: context.customerId, propertyId: context.propertyId,
        });
        if (text(existingSnapshot.data()?.requestId, 240) === stable && existing.quantity === normalizedQuantity
          && text(existing.catalogItemId, 180) === normalizedCatalogItemId
          && text(existing.interventionId, 180) === normalizedInterventionId
          && text(existing.assetId, 180) === normalizedAssetId
          && text(existing.notes, 1500) === text(notes, 1500)
          && (normalizedCatalogItemId || (existing.descriptionSnapshot === normalizedDescription && existing.unit === normalizedUnit))) {
          result = { success: true, replayed: true, fieldSaleLine: existing };
          return;
        }
        throw fieldError('field_sale_request_conflict', 'Field Sale Line request id was already used with different input.', 409);
      }
      const occurredAt = text(now(), 80);
      if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) throw new Error('Clock returned an invalid timestamp.');
      let catalogRecord = null;
      let priceSnapshot;
      if (normalizedCatalogItemId) {
        const catalogSnapshot = await transaction.get(db.collection('services').doc(normalizedCatalogItemId));
        catalogRecord = catalogSnapshot.exists ? fieldSnapshotRecord(catalogSnapshot) : null;
        if (!catalogRecord || !isSellableProduct(catalogRecord)) throw fieldError('field_sale_catalog_item_not_sellable', 'Selected catalog item is not an active sellable Product.', 409);
        try {
          const price = resolveServicePriceSnapshot({ service: catalogRecord, capturedAt: occurredAt });
          priceSnapshot = { ...price, lineTotal: money(price.unitPrice * normalizedQuantity) };
        } catch (cause) {
          throw fieldError(cause?.code || 'field_sale_price_not_available', cause?.message || 'Catalog price is not available.', 409);
        }
      }
      const expectedContext = {
        visitId: normalizedVisitId, workOrderId: context.workOrderId,
        customerId: context.customerId, propertyId: context.propertyId,
      };
      if (normalizedInterventionId) {
        const interventionSnapshot = await transaction.get(db.collection(WORK_INTERVENTION_COLLECTION).doc(normalizedInterventionId));
        if (!interventionSnapshot.exists) throw fieldError('field_sale_intervention_not_found', 'Selected Work Intervention is not available on this visit.', 409);
        projectWorkIntervention(fieldSnapshotRecord(interventionSnapshot), expectedContext);
      }
      if (normalizedAssetId) {
        const visitAssetSnapshot = await transaction.get(db.collection('visitAssets').where('visitId', '==', normalizedVisitId));
        const matches = snapshotRecords(visitAssetSnapshot)
          .map((record) => projectVisitAsset(record, expectedContext))
          .filter((visitAsset) => visitAsset.assetId === normalizedAssetId);
        if (matches.length !== 1) throw fieldError('field_sale_asset_not_found', 'Selected equipment is not available on this visit.', 409);
      }
      const stored = fieldFirestoreData({
        id: lineId, fieldAuthorityVersion: FIELD_SALE_LINE_STORAGE_VERSION,
        visitId: normalizedVisitId, workOrderId: context.workOrderId, appointmentId: context.appointmentId,
        clientId: context.customerId, propertyId: context.propertyId,
        interventionId: normalizedInterventionId || undefined, assetId: normalizedAssetId || undefined,
        catalogItemId: normalizedCatalogItemId || undefined,
        descriptionSnapshot: catalogRecord ? text(catalogRecord.name, 500) : normalizedDescription,
        quantity: normalizedQuantity, unit: catalogRecord ? productUnit(catalogRecord) : normalizedUnit,
        priceSnapshot, status: 'proposed', soldByStaffId: text(identity.staffId, 180),
        requiresCustomerApproval: Boolean(catalogRecord), nonCatalog: !catalogRecord,
        officeReviewRequired: !catalogRecord, notes: text(notes, 1500) || undefined,
        requestId: stable, lastAction: 'created', ...actor(identity, occurredAt),
      }, 'fieldSaleLine');
      transaction.create(lineRef, stored);
      const projected = projectFieldSaleLine(stored);
      await appendAuditInTransaction({ transaction, visit: context.storedVisit, identity, event: {
        id: deterministicId('FE', `${stable}:field_sale_line_created:${lineId}`), type: 'field_sale_line_created', entityType: 'FieldSaleLine', entityId: lineId,
        visitId: normalizedVisitId, workOrderId: context.workOrderId, appointmentId: context.appointmentId, customerId: context.customerId, propertyId: context.propertyId,
        requestId: stable, occurredAt, performedByUserId: text(identity.uid, 180), performedByStaffId: text(identity.staffId, 180) || undefined,
        before: null, after: { status: 'proposed', catalogItemId: projected.catalogItemId, quantity: projected.quantity, unit: projected.unit, priceSnapshot: projected.priceSnapshot, officeReviewRequired: projected.officeReviewRequired },
      } });
      result = { success: true, replayed: false, fieldSaleLine: projected };
    });
    return result;
  };
}

function createDecideFieldSaleLineCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function' || typeof appendAuditInTransaction !== 'function') throw new Error('Field Sale Line authority dependencies are required.');
  return async function decideFieldSaleLine({ identity, visitId, saleLineId, decision, receiverName, note, expectedVersion, requestId } = {}) {
    const target = text(decision, 40) === 'approved' ? 'customer_approved' : text(decision, 40) === 'rejected' ? 'declined' : '';
    if (!target) throw fieldError('invalid_customer_decision', 'Field Sale decision must be approved or rejected.', 400);
    const normalizedReceiverName = text(receiverName, 180);
    const normalizedNote = text(note, 1000);
    if (normalizedReceiverName.length < 2) throw fieldError('approval_receiver_required', 'Customer representative name is required.', 400);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw fieldError('expected_version_required', 'A positive expectedVersion is required.', 400);
    const stable = stableRequestId(requestId);
    let result;
    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({ db, transaction, identity, visitId, resolveAssignment, action: 'execute', deniedMessage: 'This assignment cannot record Field Sale customer decisions.' });
      const lineRef = db.collection(FIELD_SALE_LINE_COLLECTION).doc(text(saleLineId, 180));
      const lineSnapshot = await transaction.get(lineRef);
      if (!lineSnapshot.exists) throw fieldError('field_sale_line_not_found', 'Field Sale Line is not available.', 404);
      const line = projectFieldSaleLine(fieldSnapshotRecord(lineSnapshot), { visitId: text(visitId, 180), workOrderId: context.workOrderId, customerId: context.customerId, propertyId: context.propertyId });
      if (line.nonCatalog) throw fieldError('field_sale_non_catalog_decision_not_allowed', 'Non-catalog drafts require Office Review and cannot be customer-approved as priced sales.', 409);
      if (line.status === target && text(lineSnapshot.data()?.lastRequestId, 240) === stable) {
        const approvalSnapshot = await transaction.get(db.collection('fieldApprovals').doc(line.customerApprovalId));
        if (!approvalSnapshot.exists) throw fieldError('field_sale_approval_missing', 'Field Sale customer decision evidence is missing.', 409);
        const existingApproval = projectFieldApproval(fieldSnapshotRecord(approvalSnapshot));
        const expectedApprovalStatus = target === 'customer_approved' ? 'approved' : 'rejected';
        if (existingApproval.status !== expectedApprovalStatus || existingApproval.method !== 'verbal'
          || existingApproval.receiverName !== normalizedReceiverName || (existingApproval.note || '') !== normalizedNote
          || existingApproval.affected.length !== 1 || existingApproval.affected[0]?.type !== 'sale_line'
          || existingApproval.affected[0]?.id !== line.id) {
          throw fieldError('field_sale_request_conflict', 'Field Sale decision request id was already used with different input.', 409);
        }
        result = { success: true, replayed: true, fieldSaleLine: line, approval: existingApproval };
        return;
      }
      if (line.status !== 'proposed') throw fieldError('field_sale_transition_not_allowed', `Field Sale Line ${line.status} cannot receive a customer decision.`, 409);
      if (line.version !== expectedVersion) throw fieldError('version_conflict', 'Field Sale Line changed on another device.', 409, { expectedVersion, actualVersion: line.version });
      const occurredAt = text(now(), 80);
      const approvalId = deterministicId('FA', `field_sale:${line.id}`);
      const approval = fieldFirestoreData({
        id: approvalId, fieldAuthorityVersion: 1, visitId: line.visitId, workOrderId: line.workOrderId, clientId: line.customerId, propertyId: line.propertyId,
        status: target === 'customer_approved' ? 'approved' : 'rejected', method: 'verbal', affected: [{ type: 'sale_line', id: line.id }],
        receiverName: normalizedReceiverName, decidedAt: occurredAt, technicianStaffId: text(identity.staffId, 180), note: normalizedNote || undefined,
        ...actor(identity, occurredAt),
      }, 'fieldSaleApproval');
      const patch = fieldFirestoreData({ status: target, customerApprovalId: approvalId, updatedAt: occurredAt, updatedByUserId: text(identity.uid, 180), updatedByStaffId: text(identity.staffId, 180), version: line.version + 1, lastRequestId: stable, lastAction: target }, 'fieldSaleDecision');
      transaction.create(db.collection('fieldApprovals').doc(approvalId), approval);
      transaction.update(lineRef, patch);
      await appendAuditInTransaction({ transaction, visit: context.storedVisit, identity, event: {
        id: deterministicId('FE', `${stable}:field_sale_customer_decision:${line.id}`), type: 'field_sale_customer_decision_recorded', entityType: 'FieldSaleLine', entityId: line.id,
        visitId: line.visitId, workOrderId: line.workOrderId, appointmentId: context.appointmentId, customerId: line.customerId, propertyId: line.propertyId,
        requestId: stable, occurredAt, performedByUserId: text(identity.uid, 180), performedByStaffId: text(identity.staffId, 180), before: { status: line.status }, after: { status: target, approvalId, receiverName: approval.receiverName },
      } });
      result = { success: true, replayed: false, fieldSaleLine: projectFieldSaleLine({ ...lineSnapshot.data(), ...patch, id: line.id }), approval: projectFieldApproval(approval) };
    });
    return result;
  };
}

function createTransitionFieldSaleLineCommand({ db, resolveAssignment, appendAuditInTransaction, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('A transaction-capable Firestore db is required.');
  if (typeof resolveAssignment !== 'function' || typeof appendAuditInTransaction !== 'function') throw new Error('Field Sale Line authority dependencies are required.');
  return async function transitionFieldSaleLine({ identity, visitId, saleLineId, to, note, expectedVersion, requestId } = {}) {
    const target = text(to, 80);
    if (!FIELD_SALE_LINE_STATUSES.has(target) || ['customer_approved', 'declined'].includes(target)) throw fieldError('invalid_field_sale_target', 'Field Sale transition target is invalid.', 400);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw fieldError('expected_version_required', 'A positive expectedVersion is required.', 400);
    if (target === 'voided' && text(note, 1000).length < 3) throw fieldError('field_sale_void_note_required', 'Voiding a Field Sale Line requires a reason.', 400);
    const stable = stableRequestId(requestId);
    let result;
    await db.runTransaction(async (transaction) => {
      const context = await loadCurrentVisitMutationContext({ db, transaction, identity, visitId, resolveAssignment, action: 'execute', deniedMessage: 'This assignment cannot transition Field Sale Lines.' });
      const lineRef = db.collection(FIELD_SALE_LINE_COLLECTION).doc(text(saleLineId, 180));
      const lineSnapshot = await transaction.get(lineRef);
      if (!lineSnapshot.exists) throw fieldError('field_sale_line_not_found', 'Field Sale Line is not available.', 404);
      const line = projectFieldSaleLine(fieldSnapshotRecord(lineSnapshot), { visitId: text(visitId, 180), workOrderId: context.workOrderId });
      if (line.status === target && text(lineSnapshot.data()?.lastRequestId, 240) === stable) {
        if (target === 'voided' && text(line.notes, 1500) !== text(note, 1500)) {
          throw fieldError('field_sale_request_conflict', 'Field Sale transition request id was already used with different input.', 409);
        }
        result = { success: true, replayed: true, fieldSaleLine: line };
        return;
      }
      if (!(FIELD_SALE_TRANSITIONS[line.status] || []).includes(target) || ['customer_approved', 'declined'].includes(target)) throw fieldError('field_sale_transition_not_allowed', `Field Sale Line cannot transition ${line.status} -> ${target}.`, 409);
      if (line.nonCatalog && target !== 'voided') throw fieldError('field_sale_non_catalog_transition_not_allowed', 'Non-catalog draft may only remain for Office Review or be voided.', 409);
      if (line.version !== expectedVersion) throw fieldError('version_conflict', 'Field Sale Line changed on another device.', 409, { expectedVersion, actualVersion: line.version });
      const occurredAt = text(now(), 80);
      const patch = fieldFirestoreData({ status: target, notes: target === 'voided' ? text(note, 1500) : line.notes, updatedAt: occurredAt, updatedByUserId: text(identity.uid, 180), updatedByStaffId: text(identity.staffId, 180), version: line.version + 1, lastRequestId: stable, lastAction: target }, 'fieldSaleTransition');
      transaction.update(lineRef, patch);
      await appendAuditInTransaction({ transaction, visit: context.storedVisit, identity, event: {
        id: deterministicId('FE', `${stable}:field_sale_transition:${line.id}:${target}`), type: 'field_sale_line_status_changed', entityType: 'FieldSaleLine', entityId: line.id,
        visitId: line.visitId, workOrderId: line.workOrderId, appointmentId: context.appointmentId, customerId: line.customerId, propertyId: line.propertyId,
        requestId: stable, occurredAt, performedByUserId: text(identity.uid, 180), performedByStaffId: text(identity.staffId, 180), before: { status: line.status }, after: { status: target, note: text(note, 1000) || undefined },
      } });
      result = { success: true, replayed: false, fieldSaleLine: projectFieldSaleLine({ ...lineSnapshot.data(), ...patch, id: line.id }) };
    });
    return result;
  };
}

module.exports = {
  FIELD_SALE_ACTIVE_VISIT_STATUSES,
  FIELD_SALE_LINE_COLLECTION,
  FIELD_SALE_LINE_STATUSES,
  FIELD_SALE_LINE_STORAGE_VERSION,
  FIELD_SALE_TRANSITIONS,
  attachFieldSaleLinesToJob,
  createDecideFieldSaleLineCommand,
  createFieldSaleLineCommand,
  createTransitionFieldSaleLineCommand,
  isSellableProduct,
  projectFieldSaleLine,
};
