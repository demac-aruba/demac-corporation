'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildInventoryHandoff,
  ensureInventoryHandoffInTransaction,
  inventoryHandoffDocumentId,
  projectInventoryHandoff,
} = require('./fieldOperationsInventoryHandoffs');

const review = {
  id: 'FOR-WO-1', currentRevisionId: 'FORR-WO-1-1', currentRevisionNumber: 1,
  workOrderId: 'WO-1', appointmentId: 'APT-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitId: 'visit-WO-1',
};
const revision = {
  id: 'FORR-WO-1-1', revisionNumber: 1,
  snapshot: { fieldSaleLines: [{
    id: 'FSL-1', status: 'sold', nonCatalog: false, catalogItemId: 'product-switch',
    descriptionSnapshot: '220V Switch', quantity: 2, unit: 'ea',
  }] },
};
const identity = { uid: 'office-1', staffId: 'office-staff-1' };

function build(overrides = {}) {
  return buildInventoryHandoff({
    review, revision, order: { id: 'WO-1', vanId: 'VAN-1' }, identity,
    requestId: 'office-review-approve-001', occurredAt: '2026-08-25T11:20:00.000Z', ...overrides,
  });
}

test('approved sold catalog Product projects an immutable Inventory Authority-ready handoff without movements', () => {
  const handoff = projectInventoryHandoff(build());
  assert.equal(handoff.id, inventoryHandoffDocumentId(review.id, revision.id));
  assert.equal(handoff.status, 'ready_for_inventory_authority');
  assert.equal(handoff.sourceLocationId, 'VAN-1');
  assert.deepEqual(handoff.lines, [{
    sourceSaleLineId: 'FSL-1', itemKind: 'product', itemId: 'product-switch',
    descriptionSnapshot: '220V Switch', quantity: 2, unit: 'ea',
  }]);
  assert.deepEqual(handoff.blockers, []);
  assert.deepEqual(handoff.inventoryMovementIds, []);
});

test('no sold catalog Product produces no Inventory handoff or shadow item', () => {
  for (const line of [
    { ...revision.snapshot.fieldSaleLines[0], status: 'declined' },
    { ...revision.snapshot.fieldSaleLines[0], nonCatalog: true, catalogItemId: undefined, status: 'proposed' },
  ]) {
    assert.equal(build({ revision: { ...revision, snapshot: { fieldSaleLines: [line] } } }), null);
  }
});

test('missing source location and fractional Product quantity remain explicit Inventory review blockers', () => {
  const handoff = projectInventoryHandoff(build({
    order: { id: 'WO-1' },
    revision: { ...revision, snapshot: { fieldSaleLines: [{ ...revision.snapshot.fieldSaleLines[0], quantity: 1.5 }] } },
  }));
  assert.equal(handoff.status, 'needs_inventory_review');
  assert.equal(handoff.sourceLocationId, undefined);
  assert.deepEqual(handoff.blockers.map((item) => item.code), [
    'inventory_source_location_required',
    'inventory_product_whole_quantity_required',
  ]);
});

test('Inventory handoff projection fails closed on identity, line, status and movement contradictions', () => {
  const valid = build();
  assert.throws(() => projectInventoryHandoff({ ...valid, fieldAuthorityVersion: 2 }), /schema is invalid/);
  assert.throws(() => projectInventoryHandoff({ ...valid, workOrderId: '' }), /identity or state is invalid/);
  assert.throws(() => projectInventoryHandoff({ ...valid, lines: [...valid.lines, valid.lines[0]] }), /invalid or duplicated/);
  assert.throws(() => projectInventoryHandoff({ ...valid, status: 'needs_inventory_review' }), /contradicts its blockers/);
  assert.throws(() => projectInventoryHandoff({ ...valid, inventoryMovementIds: ['IM-1'] }), /contradicts its blockers/);
  assert.throws(() => projectInventoryHandoff(valid, { customerId: 'CLIENT-OTHER' }), /does not match Office Review/);
});

test('transactional handoff creation is deterministic and exact replay never duplicates a candidate', async () => {
  const records = new Map();
  const writes = [];
  const db = { collection: (name) => ({ doc: (id) => ({ name, id }) }) };
  const transaction = {
    async get(ref) { const value = records.get(`${ref.name}/${ref.id}`); return { id: ref.id, exists: Boolean(value), data: () => value }; },
    create(ref, value) { writes.push({ ref, value }); records.set(`${ref.name}/${ref.id}`, value); },
  };
  const input = {
    db, transaction, review, revision, order: { vanId: 'VAN-1' }, identity,
    requestId: 'office-review-approve-001', occurredAt: '2026-08-25T11:20:00.000Z',
  };
  const first = await ensureInventoryHandoffInTransaction(input);
  const replay = await ensureInventoryHandoffInTransaction(input);
  assert.equal(first.id, replay.id);
  assert.equal(writes.length, 1);
});
