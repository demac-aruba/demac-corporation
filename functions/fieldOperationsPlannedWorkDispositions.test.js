const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachPlannedWorkDispositionsToJob,
  createRecordPlannedWorkDispositionCommand,
  dispositionOptions,
  projectPlannedWorkDisposition,
  reconcilePlannedWorkProgress,
} = require('./fieldOperationsPlannedWorkDispositions');

function projectionDb(seed = {}) {
  return {
    collection(name) {
      return {
        where(field, op, expectedValue) {
          assert.equal(op, '==');
          return {
            async get() {
              return {
                docs: (seed[name] || [])
                  .filter((item) => item[field] === expectedValue)
                  .map((item) => ({ id: item.id, data: () => ({ ...item }) })),
              };
            },
          };
        },
      };
    },
  };
}

function mutationDb(seed = {}) {
  const collections = new Map(Object.entries(seed).map(([name, values]) => [
    name,
    new Map(values.map((item) => [item.id, { ...item }])),
  ]));
  const ensure = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const query = (name, filters = []) => ({
    kind: 'query', collectionName: name, filters,
    where(field, op, expectedValue) {
      assert.equal(op, '==');
      return query(name, [...filters, { field, expectedValue }]);
    },
  });
  const db = {
    collection(name) {
      return {
        doc(id) { return { kind: 'document', collectionName: name, id }; },
        where(field, op, expectedValue) {
          assert.equal(op, '==');
          return query(name, [{ field, expectedValue }]);
        },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(target) {
          if (target.kind === 'query') {
            return {
              docs: [...ensure(target.collectionName).entries()]
                .filter(([, item]) => target.filters.every((filter) => item[filter.field] === filter.expectedValue))
                .map(([id, item]) => ({ id, exists: true, data: () => ({ ...item }) })),
            };
          }
          const item = ensure(target.collectionName).get(target.id);
          return { id: target.id, exists: item !== undefined, data: () => item && ({ ...item }) };
        },
        create(ref, value) { writes.push({ ref, value: { ...value } }); },
      };
      const result = await callback(transaction);
      for (const write of writes) ensure(write.ref.collectionName).set(write.ref.id, write.value);
      return result;
    },
  };
  return { db, all: (name) => [...ensure(name).values()] };
}

function workVisit(id, overrides = {}) {
  return {
    id, fieldAuthorityVersion: 1, workOrderId: 'WO-1', appointmentId: 'APT-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1', capturedAt: '2026-08-26T10:00:00.000Z', estimatedUnitCount: 1,
      workLines: [{ id: 'line-standard', presetId: 'standard_service', label: 'Standard Service', quantity: 1, durationMinutes: 60 }],
    },
    status: 'on_site', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
    createdAt: '2026-08-26T10:00:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-26T10:00:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

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

test('a disposition from an earlier physical visit consumes return-visit capacity and is not offered again', async () => {
  const result = await attachPlannedWorkDispositionsToJob(projectionDb({
    plannedWorkDispositions: [disposition({ visitId: 'visit-initial' })],
  }), {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    fieldVisit: { id: 'visit-return', status: 'on_site' },
    _fieldVisitChainIds: ['visit-initial', 'visit-return'],
    allowedActions: ['intervention.complete'],
    plannedWork: [{ id: 'line-standard', quantity: 1 }],
    plannedWorkProgress: [{ id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 0, remainingQuantity: 1 }],
    plannedInterventionOptions: [{ visitAssetId: 'VA-RETURN', plannedWorkLineIds: ['line-standard'] }],
    canAddPlannedIntervention: true,
  });

  assert.equal(result.plannedWorkDispositions.length, 1);
  assert.deepEqual(result.plannedWorkProgress[0], {
    id: 'line-standard', plannedQuantity: 1, linkedActualQuantity: 0, disposedQuantity: 1, remainingQuantity: 0,
  });
  assert.deepEqual(result.plannedInterventionOptions, []);
  assert.equal(result.canAddPlannedIntervention, false);
  assert.deepEqual(result.plannedWorkDispositionOptions, []);
});

test('transaction boundary rejects a new return-visit disposition when an earlier visit already disposed the planned unit', async () => {
  const store = mutationDb({
    workVisits: [
      workVisit('visit-initial', { status: 'requires_return_visit', requiresSecondVisit: true, secondVisitReason: 'Return required.' }),
      workVisit('visit-return', { previousVisitId: 'visit-initial' }),
    ],
    workOrders: [{
      id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
      status: 'En el sitio', date: '2026-08-26', technicianIds: ['staff-1'],
    }],
    workInterventions: [],
    plannedWorkDispositions: [disposition({ visitId: 'visit-initial' })],
  });
  const record = createRecordPlannedWorkDispositionCommand({
    db: store.db,
    resolveAssignment: async () => ({ assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false }),
    appendAuditInTransaction: async () => {},
    now: () => '2026-08-26T18:00:00.000Z',
  });

  await assert.rejects(() => record({
    identity: { uid: 'uid-1', staffId: 'staff-1', role: 'technician', operations: false },
    visitId: 'visit-return', plannedWorkLineId: 'line-standard', quantity: 1,
    reasonCode: 'deferred', note: '', requestId: 'return-disposition-001',
  }), (error) => error?.code === 'planned_work_disposition_exceeds_remaining' && error?.status === 409);
  assert.equal(store.all('plannedWorkDispositions').length, 1);
});
