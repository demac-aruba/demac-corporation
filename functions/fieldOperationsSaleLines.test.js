'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachFieldSaleLinesToJob,
  createDecideFieldSaleLineCommand,
  createFieldSaleLineCommand,
  createTransitionFieldSaleLineCommand,
  projectFieldSaleLine,
} = require('./fieldOperationsSaleLines');

function snapshot(id, value) { return { id, exists: Boolean(value), data: () => value && structuredClone(value) }; }

function createDb(initial = {}) {
  const collections = new Map(Object.entries(initial).map(([name, values]) => [name, new Map(values.map((value) => [value.id, structuredClone(value)]))]));
  const ensure = (name) => { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name); };
  const ref = (collectionName, id) => ({ collectionName, id, async get() { return snapshot(id, ensure(collectionName).get(id)); } });
  const query = (collectionName, field, value) => ({ collectionName, field, value, async get() {
    return { docs: [...ensure(collectionName)].filter(([, item]) => item[field] === value).map(([id, item]) => snapshot(id, item)) };
  } });
  const db = {
    collection(name) {
      return {
        doc: (id) => ref(name, id),
        where: (field, operator, value) => { assert.equal(operator, '=='); return query(name, field, value); },
        async get() { return { docs: [...ensure(name)].map(([id, item]) => snapshot(id, item)) }; },
      };
    },
    async runTransaction(callback) {
      const staged = [];
      const transaction = {
        async get(target) { return target.get(); },
        create(target, value) { if (ensure(target.collectionName).has(target.id) || staged.some((item) => item.target.id === target.id && item.target.collectionName === target.collectionName)) throw new Error('already exists'); staged.push({ kind: 'create', target, value }); },
        update(target, patch) { if (!ensure(target.collectionName).has(target.id)) throw new Error('missing'); staged.push({ kind: 'update', target, value: patch }); },
      };
      const result = await callback(transaction);
      for (const item of staged) {
        const collection = ensure(item.target.collectionName);
        if (item.kind === 'create') collection.set(item.target.id, structuredClone(item.value));
        else collection.set(item.target.id, { ...collection.get(item.target.id), ...structuredClone(item.value) });
      }
      return result;
    },
  };
  return { db, all: (name) => [...ensure(name).values()].map((value) => structuredClone(value)), get: (name, id) => structuredClone(ensure(name).get(id)) };
}

const identity = { uid: 'uid-1', staffId: 'staff-1', role: 'technician', operations: false };
const resolveAssignment = async () => ({ assigned: true, responsibility: 'lead', source: 'direct_staff', readOnly: false, leadTechnicianStaffId: 'staff-1', participatingStaffIds: ['staff-1'] });
function visit(overrides = {}) { return { id: 'visit-WO-1', fieldAuthorityVersion: 1, workOrderId: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', scheduledScopeSnapshot: { appointmentId: 'APT-1', capturedAt: '2026-08-27T10:00:00.000Z', estimatedUnitCount: 1, workLines: [{ id: 'line-1', label: 'Service', quantity: 1 }] }, status: 'in_progress', leadTechnicianStaffId: 'staff-1', participatingStaffIds: ['staff-1'], requiresSecondVisit: false, createdAt: '2026-08-27T10:00:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-27T10:10:00.000Z', updatedByUserId: 'uid-1', version: 2, ...overrides }; }
function order() { return { id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'En proceso', date: '2026-08-27', technicianIds: ['staff-1'] }; }
function product(overrides = {}) { return { id: 'product-switch', active: true, itemType: 'Producto', name: '220V Switch', description: 'Outdoor disconnect switch.', unit: 'ea', basePrice: 75, pricingDefinition: { mode: 'fixed', currency: 'AWG' }, ...overrides }; }
function visitAsset() { return { id: 'VA-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', assetId: 'AC-1', sequence: 1, locationLabel: 'Sala', source: 'existing_asset', status: 'identified', addedOnSite: true, createdAt: '2026-08-27T10:00:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-27T10:00:00.000Z', updatedByUserId: 'uid-1', version: 1 }; }

function fixture(options = {}) {
  const store = createDb({ workOrders: [order()], workVisits: [options.visit || visit()], visitAssets: options.visitAssets || [], workInterventions: options.interventions || [], services: options.services || [product(), product({ id: 'service-not-product', itemType: 'Servicio', name: 'Service' }), product({ id: 'quote-product', name: 'Quote product', pricingDefinition: { mode: 'quote', currency: 'AWG' } })], fieldSaleLines: options.lines || [], fieldApprovals: [] });
  const events = [];
  const appendAuditInTransaction = options.appendAuditInTransaction || (async ({ event }) => events.push(event));
  const dependencies = { db: store.db, resolveAssignment: options.resolveAssignment || resolveAssignment, appendAuditInTransaction, now: () => '2026-08-27T10:30:00.000Z' };
  return { store, events, create: createFieldSaleLineCommand(dependencies), decide: createDecideFieldSaleLineCommand(dependencies), transition: createTransitionFieldSaleLineCommand(dependencies) };
}

const createInput = { identity, visitId: 'visit-WO-1', catalogItemId: 'product-switch', quantity: 2, requestId: 'field-sale-create-001' };

test('read model exposes only active priced Products and server-owned sale capabilities', async () => {
  const { store } = fixture();
  const job = await attachFieldSaleLinesToJob(store.db, { workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', allowedActions: ['read', 'execute'], fieldVisit: { id: 'visit-WO-1', status: 'in_progress' } }, () => '2026-08-27T10:20:00.000Z');
  assert.deepEqual(job.fieldSaleCatalogOptions.map((item) => item.catalogItemId), ['product-switch']);
  assert.equal(job.fieldSaleCatalogOptions[0].priceSnapshot.unitPrice, 75);
  assert.equal(job.canAddFieldSaleLine, true);
  assert.equal(job.canAddNonCatalogFieldSaleLine, true);
});

test('Switch, Armaflex and arbitrary active catalog Products remain searchable governed sale options', async () => {
  const services = [
    product(),
    product({ id: 'product-armaflex', name: 'Armaflex 3/4', description: 'Insulation material.', unit: 'ft', basePrice: 12 }),
    product({ id: 'product-drain-pump', name: 'Condensate drain pump', description: 'Arbitrary active catalog material.', unit: 'ea', basePrice: 185 }),
    product({ id: 'inactive-product', name: 'Inactive product', active: false }),
  ];
  const { store, create } = fixture({ services });
  const job = await attachFieldSaleLinesToJob(store.db, { workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', allowedActions: ['read', 'execute'], fieldVisit: { id: 'visit-WO-1', status: 'in_progress' } }, () => '2026-08-27T10:20:00.000Z');
  assert.deepEqual(job.fieldSaleCatalogOptions.map((item) => item.catalogItemId), ['product-switch', 'product-armaflex', 'product-drain-pump']);
  for (const [index, catalogItemId] of ['product-switch', 'product-armaflex', 'product-drain-pump'].entries()) {
    const result = await create({ identity, visitId: 'visit-WO-1', catalogItemId, quantity: 1, requestId: `field-sale-catalog-material-${index + 1}` });
    assert.equal(result.fieldSaleLine.catalogItemId, catalogItemId);
    assert.equal(result.fieldSaleLine.priceSnapshot.sourceCatalogItemId, catalogItemId);
  }
});

test('catalog line snapshots canonical identity and price, then exact retry creates no duplicate', async () => {
  const { store, events, create } = fixture({ visitAssets: [visitAsset()] });
  const first = await create({ ...createInput, description: 'Attacker label', unit: 'kg', assetId: 'AC-1', notes: 'Installed by request.' });
  const replay = await create({ ...createInput, description: 'Different ignored label', unit: 'lb', assetId: 'AC-1', notes: 'Installed by request.' });
  assert.equal(first.fieldSaleLine.descriptionSnapshot, '220V Switch');
  assert.equal(first.fieldSaleLine.unit, 'ea');
  assert.equal(first.fieldSaleLine.assetId, 'AC-1');
  assert.equal(first.fieldSaleLine.priceSnapshot.unitPrice, 75);
  assert.equal(first.fieldSaleLine.priceSnapshot.lineTotal, 150);
  assert.equal(first.fieldSaleLine.status, 'proposed');
  assert.equal(replay.replayed, true);
  assert.equal(store.all('fieldSaleLines').length, 1);
  assert.equal(events.length, 1);
});

test('non-catalog draft remains unpriced, Office-review-required and cannot masquerade as an approved sale', async () => {
  const { create, decide, transition } = fixture();
  const draft = await create({ identity, visitId: 'visit-WO-1', description: 'Custom bracket modification', quantity: 1, unit: 'ea', notes: 'Office must quote.', requestId: 'field-sale-custom-001' });
  assert.equal(draft.fieldSaleLine.nonCatalog, true);
  assert.equal(draft.fieldSaleLine.officeReviewRequired, true);
  assert.equal(draft.fieldSaleLine.priceSnapshot, undefined);
  await assert.rejects(() => decide({ identity, visitId: 'visit-WO-1', saleLineId: draft.fieldSaleLine.id, decision: 'approved', receiverName: 'Maria', expectedVersion: 1, requestId: 'field-sale-custom-approve' }), (error) => error?.code === 'field_sale_non_catalog_decision_not_allowed');
  await assert.rejects(() => transition({ identity, visitId: 'visit-WO-1', saleLineId: draft.fieldSaleLine.id, to: 'sold', expectedVersion: 1, requestId: 'field-sale-custom-sold' }), (error) => error?.code === 'field_sale_transition_not_allowed');
  const voided = await transition({ identity, visitId: 'visit-WO-1', saleLineId: draft.fieldSaleLine.id, to: 'voided', note: 'Customer changed scope.', expectedVersion: 1, requestId: 'field-sale-custom-void' });
  assert.equal(voided.fieldSaleLine.status, 'voided');
  assert.equal((await transition({ identity, visitId: 'visit-WO-1', saleLineId: draft.fieldSaleLine.id, to: 'voided', note: 'Customer changed scope.', expectedVersion: 1, requestId: 'field-sale-custom-void' })).replayed, true);
  await assert.rejects(() => transition({ identity, visitId: 'visit-WO-1', saleLineId: draft.fieldSaleLine.id, to: 'voided', note: 'Different retry reason.', expectedVersion: 1, requestId: 'field-sale-custom-void' }), (error) => error?.code === 'field_sale_request_conflict');
});

test('request ids reject changed custom draft identity and changed customer decision evidence', async () => {
  const { create, decide } = fixture();
  const customInput = { identity, visitId: 'visit-WO-1', description: 'Custom bracket modification', quantity: 1, unit: 'ea', requestId: 'field-sale-custom-conflict' };
  await create(customInput);
  await assert.rejects(() => create({ ...customInput, description: 'Different custom bracket' }), (error) => error?.code === 'field_sale_request_conflict');

  const created = await create(createInput);
  const approvalInput = { identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, decision: 'approved', receiverName: 'Maria Client', note: 'Approved on site.', expectedVersion: 1, requestId: 'field-sale-evidence-conflict' };
  await decide(approvalInput);
  await assert.rejects(() => decide({ ...approvalInput, receiverName: 'Another receiver' }), (error) => error?.code === 'field_sale_request_conflict');
});

test('customer approval is immutable evidence linked to the sale line and exact retry is idempotent', async () => {
  const { store, create, decide } = fixture();
  const created = await create(createInput);
  const input = { identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, decision: 'approved', receiverName: 'Maria Client', note: 'Approved on site.', expectedVersion: 1, requestId: 'field-sale-approve-001' };
  const approved = await decide(input);
  const replay = await decide(input);
  assert.equal(approved.fieldSaleLine.status, 'customer_approved');
  assert.equal(approved.approval.status, 'approved');
  assert.deepEqual(approved.approval.affected, [{ type: 'sale_line', id: created.fieldSaleLine.id }]);
  assert.equal(replay.replayed, true);
  assert.equal(store.all('fieldApprovals').length, 1);
});

test('declined add-on remains historical and cannot transition into a sold line', async () => {
  const { create, decide, transition } = fixture();
  const created = await create(createInput);
  const declined = await decide({ identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, decision: 'rejected', receiverName: 'Maria Client', expectedVersion: 1, requestId: 'field-sale-decline-001' });
  assert.equal(declined.fieldSaleLine.status, 'declined');
  await assert.rejects(() => transition({ identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, to: 'sold', expectedVersion: 2, requestId: 'field-sale-sold-invalid' }), (error) => error?.code === 'field_sale_transition_not_allowed');
});

test('approved catalog line follows installed/delivered before sold and preserves price snapshot', async () => {
  const { create, decide, transition } = fixture();
  const created = await create(createInput);
  const approved = await decide({ identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, decision: 'approved', receiverName: 'Maria Client', expectedVersion: 1, requestId: 'field-sale-approve-001' });
  await assert.rejects(() => transition({ identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, to: 'sold', expectedVersion: 2, requestId: 'field-sale-sold-too-soon' }), (error) => error?.code === 'field_sale_transition_not_allowed');
  const installed = await transition({ identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, to: 'installed', expectedVersion: approved.fieldSaleLine.version, requestId: 'field-sale-installed-001' });
  const sold = await transition({ identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, to: 'sold', expectedVersion: installed.fieldSaleLine.version, requestId: 'field-sale-sold-001' });
  assert.equal(sold.fieldSaleLine.status, 'sold');
  assert.equal(sold.fieldSaleLine.priceSnapshot.lineTotal, 150);
  assert.equal(sold.fieldSaleLine.inventoryMovementId, undefined);
  assert.equal(sold.fieldSaleLine.invoiceLineId, undefined);
});

test('stale version, helper authority and inactive visit fail closed', async () => {
  const current = fixture();
  const created = await current.create(createInput);
  await assert.rejects(() => current.decide({ identity, visitId: 'visit-WO-1', saleLineId: created.fieldSaleLine.id, decision: 'approved', receiverName: 'Maria', expectedVersion: 99, requestId: 'field-sale-stale-001' }), (error) => error?.code === 'version_conflict');
  const helper = fixture({ resolveAssignment: async () => ({ assigned: true, responsibility: 'helper', source: 'crew', readOnly: true }) });
  await assert.rejects(() => helper.create(createInput), (error) => error?.code === 'permission_denied');
  const inactive = fixture({ visit: visit({ status: 'pending' }) });
  await assert.rejects(() => inactive.create(createInput), (error) => error?.code === 'field_sale_not_allowed');
  await assert.rejects(() => current.create({ ...createInput, requestId: 'field-sale-invalid-asset', assetId: 'AC-OTHER' }), (error) => error?.code === 'field_sale_asset_not_found');
});

test('audit failure rolls back sale creation and malformed persisted state is rejected', async () => {
  const current = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
  await assert.rejects(() => current.create(createInput), /audit unavailable/);
  assert.equal(current.store.all('fieldSaleLines').length, 0);
  assert.throws(() => projectFieldSaleLine({ id: 'FSL-X', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', descriptionSnapshot: 'Fake', quantity: 1, unit: 'ea', status: 'sold', soldByStaffId: 'staff-1', requiresCustomerApproval: true, nonCatalog: false, officeReviewRequired: false, createdAt: '2026-08-27T10:00:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-27T10:00:00.000Z', updatedByUserId: 'uid-1', version: 1 }), (error) => error?.code === 'invalid_field_sale_line_state');
});
