const assert = require('node:assert/strict');
const test = require('node:test');
const {
  priceSnapshotRequiredForOrigin,
  projectFieldPriceSnapshot,
} = require('./fieldOperationsPriceSnapshots');
const { projectWorkIntervention } = require('./fieldOperationsVisitInterventions');

function snapshot(overrides = {}) {
  return {
    currency: 'AWG',
    unitPrice: 125,
    sourceCatalogItemId: 'service-standard',
    pricingVersion: 'company-service-pricing-rules:v7:standard_service:12000',
    capturedAt: '2026-08-25T17:40:00.000Z',
    ...overrides,
  };
}

function additionalIntervention(overrides = {}) {
  return {
    id: 'WI-1',
    fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1',
    assetId: 'AC-1',
    serviceCatalogItemId: 'service-standard',
    interventionType: '12K Standard Service',
    origin: 'added_on_site_client_request',
    requestedBy: 'client',
    status: 'pending_authorization',
    priceSnapshot: snapshot(),
    scopeChangeId: 'SC-1',
    performedByStaffIds: [],
    createdAt: '2026-08-25T17:40:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T17:40:00.000Z',
    updatedByUserId: 'uid-1',
    version: 1,
    ...overrides,
  };
}

test('projects immutable Field price snapshots and normalizes money without inventing optional totals', () => {
  const result = projectFieldPriceSnapshot(snapshot({ unitPrice: 125.005 }), 'service-standard');
  assert.equal(result.currency, 'AWG');
  assert.equal(result.unitPrice, 125.01);
  assert.equal(result.sourceCatalogItemId, 'service-standard');
  assert.equal(result.lineTotal, undefined);
});

test('current on-site additional-work origins require a price snapshot while planned work does not', () => {
  assert.equal(priceSnapshotRequiredForOrigin('added_on_site_client_request'), true);
  assert.equal(priceSnapshotRequiredForOrigin('added_on_site_technician_discovery'), true);
  assert.equal(priceSnapshotRequiredForOrigin('planned'), false);
  assert.equal(priceSnapshotRequiredForOrigin('office_added'), false);
});

test('WorkIntervention projection retains governed price and fails closed if current additional work has none', () => {
  const projected = projectWorkIntervention(additionalIntervention());
  assert.equal(projected.priceSnapshot.unitPrice, 125);
  assert.throws(
    () => projectWorkIntervention(additionalIntervention({ priceSnapshot: undefined })),
    (error) => error?.code === 'work_intervention_price_snapshot_required' && error?.status === 409,
  );
});

test('WorkIntervention projection rejects a price snapshot for another canonical Service', () => {
  assert.throws(
    () => projectWorkIntervention(additionalIntervention({ priceSnapshot: snapshot({ sourceCatalogItemId: 'service-other' }) })),
    (error) => error?.code === 'work_intervention_price_identity_conflict' && error?.status === 409,
  );
});

test('price snapshot fails closed when canonical Service identity drifts', () => {
  assert.throws(
    () => projectFieldPriceSnapshot(snapshot({ sourceCatalogItemId: 'service-other' }), 'service-standard'),
    (error) => error?.code === 'work_intervention_price_identity_conflict' && error?.status === 409,
  );
});

test('price snapshot rejects malformed currency, money, version and timestamp evidence', () => {
  for (const candidate of [
    snapshot({ currency: '' }),
    snapshot({ unitPrice: -1 }),
    snapshot({ pricingVersion: '' }),
    snapshot({ capturedAt: 'not-time' }),
    snapshot({ sourceCatalogItemId: '' }),
  ]) {
    assert.throws(
      () => projectFieldPriceSnapshot(candidate, candidate.sourceCatalogItemId || ''),
      (error) => error?.code === 'invalid_field_price_snapshot' && error?.status === 409,
    );
  }
});

test('optional discount, tax and line total must remain finite non-negative money when present', () => {
  const result = projectFieldPriceSnapshot(snapshot({
    discountAmount: 5,
    taxAmount: 0,
    lineTotal: 120,
  }), 'service-standard');
  assert.equal(result.discountAmount, 5);
  assert.equal(result.taxAmount, 0);
  assert.equal(result.lineTotal, 120);
  assert.throws(
    () => projectFieldPriceSnapshot(snapshot({ taxAmount: Number.NaN }), 'service-standard'),
    (error) => error?.code === 'invalid_field_price_snapshot',
  );
});
