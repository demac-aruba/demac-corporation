'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildBillingCandidate, ensureBillingCandidateInTransaction, projectBillingCandidate } = require('./fieldOperationsBillingCandidates');

const review = { id: 'FOR-1', currentRevisionId: 'FORR-1', currentRevisionNumber: 1, workOrderId: 'WO-1', appointmentId: 'APT-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitId: 'visit-WO-1' };
const price = (itemId, unitPrice, lineTotal = unitPrice) => ({ currency: 'AWG', unitPrice, lineTotal, sourceCatalogItemId: itemId, pricingVersion: `catalog:${itemId}`, capturedAt: '2026-08-25T10:00:00.000Z' });
const revision = { id: 'FORR-1', revisionNumber: 1, snapshot: {
  interventions: [{ id: 'WI-1', status: 'completed', serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service', priceSnapshot: price('service-standard', 150) }],
  fieldSaleLines: [{ id: 'FSL-1', status: 'sold', nonCatalog: false, catalogItemId: 'product-switch', descriptionSnapshot: '220V Switch', quantity: 2, priceSnapshot: price('product-switch', 75, 150) }],
} };
const base = { review, revision, identity: { uid: 'office-1', staffId: 'staff-office' }, requestId: 'review-approve-billing-001', occurredAt: '2026-08-25T11:20:00.000Z' };

test('approved actual priced work projects a Billing-review candidate without invoices', () => {
  const candidate = projectBillingCandidate(buildBillingCandidate(base));
  assert.equal(candidate.status, 'ready_for_billing_review');
  assert.deepEqual(candidate.lines.map((line) => [line.sourceType, line.sourceId, line.lineTotal]), [['intervention', 'WI-1', 150], ['sale_line', 'FSL-1', 150]]);
  assert.deepEqual(candidate.invoiceLineIds, []);
  assert.deepEqual(candidate.blockers, []);
});

test('unpriced completed work and non-catalog sales remain explicit pricing blockers', () => {
  const candidate = projectBillingCandidate(buildBillingCandidate({ ...base, revision: { ...revision, snapshot: {
    interventions: [{ ...revision.snapshot.interventions[0], priceSnapshot: undefined }],
    fieldSaleLines: [{ ...revision.snapshot.fieldSaleLines[0], id: 'FSL-CUSTOM', nonCatalog: true, catalogItemId: undefined, status: 'proposed', priceSnapshot: undefined }],
  } } }));
  assert.equal(candidate.status, 'needs_pricing_review');
  assert.deepEqual(candidate.blockers.map((item) => item.code), ['completed_intervention_price_required', 'non_catalog_sale_price_required']);
  assert.deepEqual(candidate.invoiceLineIds, []);
});

test('declined and voided field lines never become Billing lines', () => {
  const candidate = buildBillingCandidate({ ...base, revision: { ...revision, snapshot: { interventions: [], fieldSaleLines: [
    { ...revision.snapshot.fieldSaleLines[0], status: 'declined' },
    { ...revision.snapshot.fieldSaleLines[0], id: 'FSL-2', status: 'voided' },
    { ...revision.snapshot.fieldSaleLines[0], id: 'FSL-3', nonCatalog: true, catalogItemId: undefined, priceSnapshot: undefined, status: 'declined' },
  ] } } });
  assert.equal(candidate, null);
});

test('Billing projection rejects fabricated invoices, duplicates and identity drift', () => {
  const valid = buildBillingCandidate(base);
  assert.throws(() => projectBillingCandidate({ ...valid, invoiceLineIds: ['INV-LINE-1'] }), /invoice references are invalid/);
  assert.throws(() => projectBillingCandidate({ ...valid, lines: [...valid.lines, valid.lines[0]] }), /invalid or duplicated/);
  assert.throws(() => projectBillingCandidate({ ...valid, lines: [{ ...valid.lines[0], lineTotal: valid.lines[0].lineTotal + 1 }, ...valid.lines.slice(1)] }), /invalid or duplicated/);
  assert.throws(() => projectBillingCandidate(valid, { customerId: 'CLIENT-OTHER' }), /does not match Office Review/);
});

test('transactional Billing candidate creation is deterministic and replay-safe', async () => {
  const records = new Map(); const writes = [];
  const db = { collection: (name) => ({ doc: (id) => ({ name, id }) }) };
  const transaction = { async get(ref) { const value = records.get(`${ref.name}/${ref.id}`); return { id: ref.id, exists: Boolean(value), data: () => value }; }, create(ref, value) { writes.push(value); records.set(`${ref.name}/${ref.id}`, value); } };
  const first = await ensureBillingCandidateInTransaction({ db, transaction, ...base });
  const replayed = await ensureBillingCandidateInTransaction({ db, transaction, ...base });
  assert.equal(first.id, replayed.id); assert.equal(writes.length, 1);
});
