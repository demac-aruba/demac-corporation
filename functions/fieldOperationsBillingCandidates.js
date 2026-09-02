'use strict';

const crypto = require('node:crypto');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');
const { fieldError } = require('./fieldOperationsAuthorityCore');

const FIELD_BILLING_CANDIDATE_COLLECTION = 'fieldBillingCandidates';
const FIELD_BILLING_CANDIDATE_STORAGE_VERSION = 1;
const BILLING_CANDIDATE_STATUSES = new Set(['ready_for_billing_review', 'needs_pricing_review']);
const BILLING_SOURCE_TYPES = new Set(['intervention', 'sale_line']);

function text(value, limit = 1000) { return String(value ?? '').trim().slice(0, limit); }
function deterministicId(prefix, value) { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`; }
function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || Math.round(amount * 100) !== amount * 100) {
    throw fieldError('invalid_billing_candidate_money', 'Billing candidate money is invalid.', 409);
  }
  return amount;
}
function quantity(value) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0 || result > 10000 || Math.round(result * 1000) !== result * 1000) {
    throw fieldError('invalid_billing_candidate_quantity', 'Billing candidate quantity is invalid.', 409);
  }
  return result;
}

function billingCandidateDocumentId(reviewId, revisionId) {
  const normalizedReviewId = text(reviewId, 180);
  const normalizedRevisionId = text(revisionId, 180);
  if (!normalizedReviewId || !normalizedRevisionId) throw fieldError('billing_candidate_identity_required', 'Office Review and revision identity are required for Billing candidate.', 400);
  return deterministicId('FBC', `${normalizedReviewId}:${normalizedRevisionId}`);
}

function projectBillingCandidate(record, expected = {}) {
  if (record?.fieldAuthorityVersion !== FIELD_BILLING_CANDIDATE_STORAGE_VERSION) throw fieldError('invalid_billing_candidate_schema', 'Persisted Billing candidate schema is invalid.', 409);
  const lines = Array.isArray(record?.lines) ? record.lines.map((line) => ({
    sourceType: text(line?.sourceType, 40),
    sourceId: text(line?.sourceId, 180),
    catalogItemId: text(line?.catalogItemId, 180),
    description: text(line?.description, 500),
    quantity: quantity(line?.quantity),
    unitPrice: money(line?.unitPrice),
    currency: text(line?.currency, 20),
    lineTotal: money(line?.lineTotal),
  })) : [];
  const blockers = Array.isArray(record?.blockers) ? record.blockers.map((blocker) => ({
    code: text(blocker?.code, 120), message: text(blocker?.message, 500),
    sourceType: text(blocker?.sourceType, 40) || undefined, sourceId: text(blocker?.sourceId, 180) || undefined,
  })) : [];
  const projected = {
    id: text(record?.id, 180), officeReviewId: text(record?.officeReviewId, 180), officeReviewRevisionId: text(record?.officeReviewRevisionId, 180),
    revisionNumber: record?.revisionNumber, workOrderId: text(record?.workOrderId, 180), appointmentId: text(record?.appointmentId, 180),
    customerId: text(record?.clientId || record?.customerId, 180), propertyId: text(record?.propertyId, 180), visitId: text(record?.visitId, 180),
    status: text(record?.status, 80), lines, blockers,
    invoiceLineIds: Array.isArray(record?.invoiceLineIds) ? record.invoiceLineIds.map((value) => text(value, 180)).filter(Boolean) : [],
    sourceDecisionRequestId: text(record?.sourceDecisionRequestId, 240), createdAt: text(record?.createdAt, 80),
    createdBy: text(record?.createdByUserId || record?.createdBy, 180), version: record?.version,
  };
  if (!projected.id || !projected.officeReviewId || !projected.officeReviewRevisionId || !Number.isSafeInteger(projected.revisionNumber)
    || projected.revisionNumber < 1 || !projected.workOrderId || !projected.appointmentId || !projected.customerId || !projected.propertyId
    || !projected.visitId || !BILLING_CANDIDATE_STATUSES.has(projected.status) || !projected.sourceDecisionRequestId
    || !projected.createdBy || !projected.createdAt || Number.isNaN(Date.parse(projected.createdAt)) || projected.version !== 1
    || (!projected.lines.length && !projected.blockers.length)) throw fieldError('invalid_billing_candidate_schema', 'Persisted Billing candidate identity or state is invalid.', 409);
  const sourceKeys = projected.lines.map((line) => `${line.sourceType}:${line.sourceId}`);
  if (new Set(sourceKeys).size !== sourceKeys.length || projected.lines.some((line) => !BILLING_SOURCE_TYPES.has(line.sourceType)
    || !line.sourceId || !line.catalogItemId || !line.description || !line.currency
    || Math.abs(line.lineTotal - Number((line.quantity * line.unitPrice).toFixed(2))) > 0.001)) {
    throw fieldError('invalid_billing_candidate_schema', 'Persisted Billing candidate lines are invalid or duplicated.', 409);
  }
  if (projected.blockers.some((blocker) => !blocker.code || !blocker.message || (blocker.sourceType && !BILLING_SOURCE_TYPES.has(blocker.sourceType)))
    || projected.invoiceLineIds.length) throw fieldError('invalid_billing_candidate_schema', 'Persisted Billing candidate blockers or invoice references are invalid.', 409);
  const ready = projected.status === 'ready_for_billing_review';
  if ((ready && (!projected.lines.length || projected.blockers.length || new Set(projected.lines.map((line) => line.currency)).size !== 1))
    || (!ready && !projected.blockers.length)) {
    throw fieldError('invalid_billing_candidate_state', 'Persisted Billing readiness contradicts its lines or blockers.', 409);
  }
  for (const field of ['officeReviewId', 'officeReviewRevisionId', 'workOrderId', 'appointmentId', 'customerId', 'propertyId', 'visitId']) {
    const wanted = text(expected?.[field], 180);
    if (wanted && projected[field] !== wanted) throw fieldError('billing_candidate_identity_conflict', `Billing candidate ${field} does not match Office Review.`, 409);
  }
  return projected;
}

function pricedLine(sourceType, source, catalogItemId, description, lineQuantity) {
  const price = source.priceSnapshot;
  if (!price) return null;
  return {
    sourceType, sourceId: text(source.id, 180), catalogItemId: text(catalogItemId, 180), description: text(description, 500),
    quantity: quantity(lineQuantity), unitPrice: money(price.unitPrice), currency: text(price.currency, 20), lineTotal: money(price.lineTotal),
  };
}

function buildBillingCandidate({ review, revision, identity, requestId, occurredAt }) {
  const lines = [];
  const blockers = [];
  for (const intervention of revision?.snapshot?.interventions || []) {
    if (intervention?.status !== 'completed') continue;
    const line = pricedLine('intervention', intervention, intervention.serviceCatalogItemId, intervention.interventionType, 1);
    if (line) lines.push(line);
    else blockers.push({ code: 'completed_intervention_price_required', message: `Completed intervention ${text(intervention?.id, 180)} requires governed Billing pricing.`, sourceType: 'intervention', sourceId: text(intervention?.id, 180) });
  }
  for (const saleLine of revision?.snapshot?.fieldSaleLines || []) {
    if (saleLine?.status === 'sold' && saleLine?.nonCatalog === false) {
      const line = pricedLine('sale_line', saleLine, saleLine.catalogItemId, saleLine.descriptionSnapshot, saleLine.quantity);
      if (line) lines.push(line);
      else blockers.push({ code: 'sold_sale_line_price_required', message: `Sold Field Sale Line ${text(saleLine?.id, 180)} requires governed Billing pricing.`, sourceType: 'sale_line', sourceId: text(saleLine?.id, 180) });
    } else if (saleLine?.nonCatalog === true && !['declined', 'voided'].includes(saleLine?.status)) {
      blockers.push({ code: 'non_catalog_sale_price_required', message: `Non-catalog Field Sale Line ${text(saleLine?.id, 180)} requires Office pricing before Billing.`, sourceType: 'sale_line', sourceId: text(saleLine?.id, 180) });
    }
  }
  if (new Set(lines.map((line) => line.currency)).size > 1) blockers.push({ code: 'mixed_billing_currency', message: 'Billing candidate contains multiple currencies and requires Finance review.' });
  if (!lines.length && !blockers.length) return null;
  const id = billingCandidateDocumentId(review.id, revision.id);
  return fieldFirestoreData({
    id, fieldAuthorityVersion: FIELD_BILLING_CANDIDATE_STORAGE_VERSION, officeReviewId: review.id, officeReviewRevisionId: revision.id,
    revisionNumber: revision.revisionNumber, workOrderId: review.workOrderId, appointmentId: review.appointmentId,
    clientId: review.customerId, propertyId: review.propertyId, visitId: review.visitId,
    status: blockers.length ? 'needs_pricing_review' : 'ready_for_billing_review', lines, blockers, invoiceLineIds: [],
    sourceDecisionRequestId: text(requestId, 240), createdAt: text(occurredAt, 80), createdByUserId: text(identity?.uid, 180),
    createdByStaffId: text(identity?.staffId, 180) || undefined, version: 1,
  }, 'fieldBillingCandidate');
}

function expectedIdentity(review) { return { officeReviewId: review.id, officeReviewRevisionId: review.currentRevisionId, workOrderId: review.workOrderId, appointmentId: review.appointmentId, customerId: review.customerId, propertyId: review.propertyId, visitId: review.visitId }; }

async function prepareBillingCandidateInTransaction({ db, transaction, review, revision, identity, requestId, occurredAt }) {
  const candidate = buildBillingCandidate({ review, revision, identity, requestId, occurredAt });
  if (!candidate) return { candidate: null, create: null };
  const ref = db.collection(FIELD_BILLING_CANDIDATE_COLLECTION).doc(candidate.id);
  const snapshot = await transaction.get(ref);
  if (snapshot.exists) return { candidate: projectBillingCandidate(fieldSnapshotRecord(snapshot), expectedIdentity(review)), create: null };
  return { candidate: projectBillingCandidate(candidate, expectedIdentity(review)), create: { ref, value: candidate } };
}

async function ensureBillingCandidateInTransaction(args) {
  const prepared = await prepareBillingCandidateInTransaction(args);
  if (prepared.create) args.transaction.create(prepared.create.ref, prepared.create.value);
  return prepared.candidate;
}

async function loadBillingCandidateInTransaction({ db, transaction, review }) {
  const id = billingCandidateDocumentId(review.id, review.currentRevisionId);
  const snapshot = await transaction.get(db.collection(FIELD_BILLING_CANDIDATE_COLLECTION).doc(id));
  return snapshot.exists ? projectBillingCandidate(fieldSnapshotRecord(snapshot), expectedIdentity(review)) : null;
}

module.exports = { BILLING_CANDIDATE_STATUSES, FIELD_BILLING_CANDIDATE_COLLECTION, FIELD_BILLING_CANDIDATE_STORAGE_VERSION, billingCandidateDocumentId, buildBillingCandidate, ensureBillingCandidateInTransaction, loadBillingCandidateInTransaction, prepareBillingCandidateInTransaction, projectBillingCandidate };
