const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FIELD_OPERATION_EVENT_COLLECTION,
  FIELD_OPERATION_EVENT_VERSION,
  createFieldAuditAppender,
  normalizeFieldOperationEvent,
} = require('./fieldOperationsAudit');

function createDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]),
  );

  function ensure(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  const db = {
    collection(name) {
      return { doc(id) { return { collectionName: name, id }; } };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        create(ref, value) {
          const values = ensure(ref.collectionName);
          if (values.has(ref.id) || writes.some((write) => write.ref.collectionName === ref.collectionName && write.ref.id === ref.id)) {
            throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          }
          writes.push({ ref, value: structuredClone(value) });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) ensure(write.ref.collectionName).set(write.ref.id, structuredClone(write.value));
      return result;
    },
  };

  return {
    db,
    all(name) { return [...ensure(name).values()]; },
    get(name, id) { return ensure(name).get(id); },
  };
}

function event(overrides = {}) {
  return {
    id: 'FE-prepare-001',
    type: 'work_visit_prepared',
    entityType: 'WorkVisit',
    entityId: 'visit-WO-1',
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    customerId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    requestId: 'prepare-WO-1-001',
    occurredAt: '2026-08-24T18:30:00.000-04:00',
    performedByUserId: 'uid-tech-1',
    performedByStaffId: 'staff-tech-1',
    performedByName: 'Technician One',
    after: { status: 'scheduled', version: 1 },
    ...overrides,
  };
}

test('normalizes the canonical append-only Field event contract', () => {
  const normalized = normalizeFieldOperationEvent(event());
  assert.equal(normalized.fieldEventVersion, FIELD_OPERATION_EVENT_VERSION);
  assert.equal(normalized.type, 'work_visit_prepared');
  assert.equal(normalized.entityId, 'visit-WO-1');
  assert.equal(normalized.workOrderId, 'WO-1');
  assert.equal(normalized.performedByUserId, 'uid-tech-1');
  assert.deepEqual(normalized.after, { status: 'scheduled', version: 1 });
});

test('rejects incomplete or malformed Field audit events before persistence', () => {
  assert.throws(() => normalizeFieldOperationEvent(null), /event object is required/);
  assert.throws(() => normalizeFieldOperationEvent(event({ id: '' })), /requires id/);
  assert.throws(() => normalizeFieldOperationEvent(event({ type: '' })), /requires type/);
  assert.throws(() => normalizeFieldOperationEvent(event({ workOrderId: '' })), /requires workOrderId/);
  assert.throws(() => normalizeFieldOperationEvent(event({ requestId: 'short' })), /at least 8 characters/);
  assert.throws(() => normalizeFieldOperationEvent(event({ occurredAt: 'not-a-date' })), /valid occurredAt/);
  assert.throws(() => normalizeFieldOperationEvent(event({ performedByUserId: '' })), /performedByUserId/);
  assert.throws(() => normalizeFieldOperationEvent(event({ after: [] })), /after must be an object/);
});

test('persists a Field event exactly once with deterministic create semantics', async () => {
  const store = createDb();
  const append = createFieldAuditAppender({ db: store.db });

  await store.db.runTransaction(async (transaction) => {
    await append({ transaction, event: event() });
  });

  assert.equal(store.all(FIELD_OPERATION_EVENT_COLLECTION).length, 1);
  const stored = store.get(FIELD_OPERATION_EVENT_COLLECTION, 'FE-prepare-001');
  assert.equal(stored.fieldEventVersion, 1);
  assert.equal(stored.entityId, 'visit-WO-1');
  assert.equal(stored.requestId, 'prepare-WO-1-001');
});

test('duplicate event identity fails instead of overwriting immutable history', async () => {
  const store = createDb();
  const append = createFieldAuditAppender({ db: store.db });

  await store.db.runTransaction(async (transaction) => append({ transaction, event: event() }));
  await assert.rejects(
    () => store.db.runTransaction(async (transaction) => append({ transaction, event: event({ after: { status: 'in_progress' } }) })),
    /Document already exists/,
  );

  assert.equal(store.all(FIELD_OPERATION_EVENT_COLLECTION).length, 1);
  assert.equal(store.get(FIELD_OPERATION_EVENT_COLLECTION, 'FE-prepare-001').after.status, 'scheduled');
});

test('audit validation failure aborts the surrounding transaction writes', async () => {
  const store = createDb();
  const append = createFieldAuditAppender({ db: store.db });

  await assert.rejects(
    () => store.db.runTransaction(async (transaction) => {
      transaction.create(store.db.collection('workVisits').doc('visit-WO-1'), { id: 'visit-WO-1' });
      await append({ transaction, event: event({ occurredAt: '' }) });
    }),
    /valid occurredAt/,
  );

  assert.equal(store.all('workVisits').length, 0);
  assert.equal(store.all(FIELD_OPERATION_EVENT_COLLECTION).length, 0);
});
