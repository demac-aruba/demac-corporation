'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { attachFieldHistoriesToJob } = require('./fieldOperationsHistories');

function snapshot(id, value) { return { id, exists: true, data: () => structuredClone(value) }; }
function createDb(seed) {
  const collections = new Map(Object.entries(seed).map(([name, values]) => [name, values]));
  return { collection(name) { return { where(field, operator, expected) { assert.equal(operator, '=='); return { async get() { return { docs: (collections.get(name) || []).filter((record) => record[field] === expected).map((record) => snapshot(record.id, record)) }; } }; } }; } };
}

function visit(id, overrides = {}) {
  return {
    id, fieldAuthorityVersion: 1, appointmentId: `APT-${id}`, workOrderId: `WO-${id}`, clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: { appointmentId: `APT-${id}`, capturedAt: '2026-08-20T10:00:00.000Z', estimatedUnitCount: 1, workLines: [] },
    status: 'completed', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
    createdAt: '2026-08-20T10:00:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-20T11:00:00.000Z', updatedByUserId: 'uid-1', version: 4,
    ...overrides,
  };
}

function intervention(id, visitRecord, overrides = {}) {
  return {
    id, fieldAuthorityVersion: 1, visitId: visitRecord.id, workOrderId: visitRecord.workOrderId, clientId: visitRecord.clientId,
    propertyId: visitRecord.propertyId, visitAssetId: `VA-${id}`, assetId: 'AC-1', plannedWorkLineId: `LINE-${id}`,
    serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service', origin: 'planned', requestedBy: 'office', status: 'completed',
    performedByStaffIds: ['staff-1'], resultCode: 'ok', resultNotes: 'Cooling restored.', startedAt: '2026-08-20T10:20:00.000Z', completedAt: '2026-08-20T10:50:00.000Z',
    createdAt: '2026-08-20T10:10:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-20T10:50:00.000Z', updatedByUserId: 'uid-1', version: 3,
    ...overrides,
  };
}

function saleLine(visitRecord, overrides = {}) {
  return {
    id: 'FSL-1', fieldAuthorityVersion: 1, visitId: visitRecord.id, workOrderId: visitRecord.workOrderId, clientId: visitRecord.clientId,
    propertyId: visitRecord.propertyId, assetId: 'AC-1', catalogItemId: 'product-switch', descriptionSnapshot: '220V Switch', quantity: 1, unit: 'ea',
    priceSnapshot: { currency: 'AWG', unitPrice: 75, lineTotal: 75, sourceCatalogItemId: 'product-switch', pricingVersion: 'service-catalog:product-switch:fixed', capturedAt: '2026-08-20T10:30:00.000Z' },
    status: 'sold', soldByStaffId: 'staff-1', requiresCustomerApproval: true, customerApprovalId: 'FA-1', nonCatalog: false, officeReviewRequired: false,
    createdAt: '2026-08-20T10:30:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-20T10:55:00.000Z', updatedByUserId: 'uid-1', version: 4,
    ...overrides,
  };
}

function saleApproval(visitRecord, overrides = {}) {
  return {
    id: 'FA-1', fieldAuthorityVersion: 1, visitId: visitRecord.id, workOrderId: visitRecord.workOrderId, clientId: visitRecord.clientId,
    propertyId: visitRecord.propertyId, status: 'approved', method: 'verbal', affected: [{ type: 'sale_line', id: 'FSL-1' }],
    receiverName: 'Maria Client', decidedAt: '2026-08-20T10:35:00.000Z', technicianStaffId: 'staff-1',
    createdAt: '2026-08-20T10:35:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-20T10:35:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function finding(visitRecord, interventionRecord, overrides = {}) {
  return {
    id: 'FIND-1', fieldAuthorityVersion: 1, visitId: visitRecord.id, workOrderId: visitRecord.workOrderId, clientId: visitRecord.clientId,
    propertyId: visitRecord.propertyId, visitAssetId: interventionRecord.visitAssetId, assetId: interventionRecord.assetId,
    interventionId: interventionRecord.id, sectionId: 'findings', summary: 'Drain restriction', details: 'Standing water observed.', recommendation: 'Flush drain.',
    technicianStaffId: 'staff-1', observedAt: '2026-08-20T10:40:00.000Z', createdAt: '2026-08-20T10:40:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-20T10:40:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const firstVisit = visit('VISIT-1');
  const secondVisit = visit('VISIT-2', { propertyId: 'PROPERTY-2', updatedAt: '2026-08-25T11:00:00.000Z' });
  const firstIntervention = intervention('WI-1', firstVisit);
  const secondIntervention = intervention('WI-2', secondVisit, { assetId: 'AC-2', completedAt: '2026-08-25T10:50:00.000Z', updatedAt: '2026-08-25T10:50:00.000Z' });
  const seed = {
    workVisits: [firstVisit, secondVisit, visit('VISIT-OTHER', { clientId: 'CLIENT-OTHER' })],
    workInterventions: [firstIntervention, secondIntervention],
    fieldSaleLines: [saleLine(firstVisit)],
    fieldApprovals: [saleApproval(firstVisit)],
    fieldFindings: [finding(firstVisit, firstIntervention)],
    ...overrides,
  };
  const job = { customerId: 'CLIENT-1', knownEquipment: [{ id: 'AC-1', locationLabel: 'Sala', active: true }, { id: 'AC-3', locationLabel: 'Office', active: true }], visitAssets: [{ assetId: 'AC-2', locationLabel: 'Bedroom' }] };
  return { db: createDb(seed), job, seed };
}

test('Customer history projects canonical visits, individual interventions, sales and findings across Work Orders', async () => {
  const { db, job } = fixture();
  const result = await attachFieldHistoriesToJob(db, job);
  assert.equal(result.customerFieldHistory.source, 'canonical_field_truth');
  assert.deepEqual(result.customerFieldHistory.visits.map((record) => record.id), ['VISIT-2', 'VISIT-1']);
  assert.deepEqual(result.customerFieldHistory.interventions.map((record) => record.id), ['WI-2', 'WI-1']);
  assert.equal(result.customerFieldHistory.saleLines[0].priceSnapshot.lineTotal, 75);
  assert.equal(result.customerFieldHistory.findings[0].interventionId, 'WI-1');
});

test('Equipment history references only records attached to each exact canonical asset', async () => {
  const { db, job } = fixture();
  const result = await attachFieldHistoriesToJob(db, job);
  const byAsset = new Map(result.equipmentFieldHistories.map((record) => [record.assetId, record]));
  assert.deepEqual(byAsset.get('AC-1').interventionIds, ['WI-1']);
  assert.deepEqual(byAsset.get('AC-1').findingIds, ['FIND-1']);
  assert.deepEqual(byAsset.get('AC-1').saleLineIds, ['FSL-1']);
  assert.deepEqual(byAsset.get('AC-2').interventionIds, ['WI-2']);
  assert.deepEqual(byAsset.get('AC-3').interventionIds, []);
});

test('history projection fails closed when a canonical child cannot resolve to its Work Visit or Intervention', async () => {
  const current = fixture();
  const brokenVisit = fixture({ workInterventions: [intervention('WI-X', current.seed.workVisits[0], { visitId: 'VISIT-MISSING' })] });
  await assert.rejects(() => attachFieldHistoriesToJob(brokenVisit.db, brokenVisit.job), (error) => error?.code === 'field_history_identity_conflict');
  const brokenFinding = fixture({ fieldFindings: [finding(current.seed.workVisits[0], current.seed.workInterventions[0], { interventionId: 'WI-MISSING' })] });
  await assert.rejects(() => attachFieldHistoriesToJob(brokenFinding.db, brokenFinding.job), (error) => error?.code === 'field_history_identity_conflict');
  const missingSaleApproval = fixture({ fieldApprovals: [] });
  await assert.rejects(() => attachFieldHistoriesToJob(missingSaleApproval.db, missingSaleApproval.job), (error) => error?.code === 'field_history_identity_conflict');
});

test('history projection is read-only and excludes records belonging to another Customer', async () => {
  const { db, job } = fixture();
  const result = await attachFieldHistoriesToJob(db, job);
  assert.equal(result.customerFieldHistory.visits.some((record) => record.id === 'VISIT-OTHER'), false);
  assert.equal(typeof db.runTransaction, 'undefined');
});
