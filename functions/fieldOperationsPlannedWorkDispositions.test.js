const assert = require('node:assert/strict');
const test = require('node:test');
const {
  dispositionOptions,
  projectPlannedWorkDisposition,
  reconcilePlannedWorkProgress,
} = require('./fieldOperationsPlannedWorkDispositions');

function disposition(overrides = {}) {
  return {
    id: 'PWD-1', fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    plannedWorkLineId: 'line-standard', quantity: 1, reasonCode: 'customer_cancelled', note: '',
    createdAt: '2026-08-26T17:00:00.000Z', createdByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

const expected = { visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1' };

test('planned two actual one plus one explicit disposition reconciles to zero without rewriting planned quantity', () => {
  const progress = reconcilePlannedWorkProgress([
    { id: 'line-standard', plannedQuantity: 2, linkedActualQuantity: 1, remainingQuantity: 1 },
  ], [projectPlannedWorkDisposition(disposition(), expected)]);
  assert.deepEqual(progress, [{
    id: 'line-standard', plannedQuantity: 2, linkedActualQuantity: 1, disposedQuantity: 1, remainingQuantity: 0,
  }]);
});

test('dispositions cannot exceed canonical unreconciled planned quantity', () => {
  assert.throws(() => reconcilePlannedWorkProgress([
    { id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 1, remainingQuantity: 0 },
  ], [projectPlannedWorkDisposition(disposition(), expected)]), (error) => error?.code === 'planned_work_disposition_state_conflict');
});

test('server options require active visit, completion authority and expose only remaining quantity', () => {
  const progress = [
    { id: 'line-standard', plannedQuantity: 2, linkedActualQuantity: 1, disposedQuantity: 0, remainingQuantity: 1 },
    { id: 'line-done', plannedQuantity: 1, linkedActualQuantity: 1, disposedQuantity: 0, remainingQuantity: 0 },
  ];
  assert.deepEqual(dispositionOptions({ fieldVisit: { status: 'in_progress' }, allowedActions: ['intervention.complete'] }, progress), [
    { plannedWorkLineId: 'line-standard', maxQuantity: 1 },
  ]);
  assert.deepEqual(dispositionOptions({ fieldVisit: { status: 'in_progress' }, allowedActions: ['read'] }, progress), []);
  assert.deepEqual(dispositionOptions({ fieldVisit: { status: 'completed' }, allowedActions: ['intervention.complete'] }, progress), []);
});

test('persisted disposition fails closed on identity, quantity, reason and immutable version drift', () => {
  assert.equal(projectPlannedWorkDisposition(disposition(), expected).reasonCode, 'customer_cancelled');
  for (const patch of [
    { fieldAuthorityVersion: 2 }, { visitId: 'other' }, { quantity: 0 }, { quantity: 1.5 },
    { reasonCode: 'invented' }, { reasonCode: 'other', note: '' }, { version: 2 }, { createdByUserId: '' },
  ]) assert.throws(() => projectPlannedWorkDisposition(disposition(patch), expected));
});

test('canonical reason vocabulary accepts operational non-performance cases', () => {
  for (const reasonCode of ['customer_cancelled', 'inaccessible', 'unsafe', 'deferred', 'equipment_unavailable']) {
    assert.equal(projectPlannedWorkDisposition(disposition({ reasonCode }), expected).reasonCode, reasonCode);
  }
  assert.equal(projectPlannedWorkDisposition(disposition({ reasonCode: 'other', note: 'Unit removed before arrival.' }), expected).reasonCode, 'other');
});
