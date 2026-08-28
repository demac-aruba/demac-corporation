const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createReturnWorkVisitCommand,
  returnVisitDocumentId,
} = require('./fieldOperationsReturnVisits');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]),
  );
  const commits = [];
  const ensure = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const documentRef = (collectionName, id) => ({ kind: 'document', collectionName, id });
  const queryRef = (collectionName, filters = []) => ({
    kind: 'query', collectionName, filters,
    where(field, op, expected) { return queryRef(collectionName, [...filters, { field, op, expected }]); },
  });

  const db = {
    collection(name) {
      return {
        doc(id) { return documentRef(name, id); },
        where(field, op, expected) { return queryRef(name, [{ field, op, expected }]); },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(target) {
          const values = ensure(target.collectionName);
          if (target.kind === 'query') {
            return {
              docs: [...values.entries()]
                .filter(([, value]) => target.filters.every((filter) => {
                  if (filter.op !== '==') throw new Error(`Unsupported fake query operator ${filter.op}`);
                  return value?.[filter.field] === filter.expected;
                }))
                .map(([id, value]) => snapshot(id, value)),
            };
          }
          return snapshot(target.id, values.get(target.id));
        },
        create(ref, value) {
          if (ensure(ref.collectionName).has(ref.id)) throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          writes.push({ ref, value: { ...value } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) ensure(write.ref.collectionName).set(write.ref.id, write.value);
      commits.push(writes);
      return result;
    },
  };

  return {
    db,
    commits,
    values(name) { return [...ensure(name).values()]; },
    get(name, id) { return ensure(name).get(id); },
  };
}

function previousVisit(overrides = {}) {
  return {
    id: 'visit-WO-1',
    fieldAuthorityVersion: 1,
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1',
      capturedAt: '2026-08-24T12:00:00.000Z',
      estimatedUnitCount: 1,
      workLines: [{ id: 'line-1', label: 'Standard Service', quantity: 1 }],
    },
    status: 'requires_return_visit',
    leadTechnicianStaffId: 'staff-1',
    participatingStaffIds: ['staff-1'],
    requiresSecondVisit: true,
    secondVisitRequiredAt: '2026-08-24T14:00:00.000Z',
    secondVisitReason: 'Return with replacement board.',
    createdAt: '2026-08-24T12:00:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-24T14:00:00.000Z',
    updatedByUserId: 'uid-1',
    version: 5,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    status: 'Confirmada', date: '2026-08-24', technicianIds: ['staff-1'], ...overrides,
  };
}

const identity = {
  uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', email: 'tech@example.invalid', role: 'technician', operations: false,
};

function fixture(options = {}) {
  const store = createDb({
    workVisits: options.visits || [options.visit || previousVisit()],
    workOrders: [options.order || order()],
  });
  const auditEvents = [];
  const resolveCalls = [];
  const createReturnVisit = createReturnWorkVisitCommand({
    db: store.db,
    now: () => '2026-08-25T09:00:00.000Z',
    resolveAssignment: options.resolveAssignment || (async (input) => {
      resolveCalls.push(input);
      return {
        assigned: true,
        responsibility: 'technician',
        source: 'direct_staff',
        readOnly: false,
        leadTechnicianStaffId: 'staff-1',
        participatingStaffIds: ['staff-1', 'staff-2'],
      };
    }),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => auditEvents.push(event)),
  });
  return { store, auditEvents, resolveCalls, createReturnVisit };
}

const input = {
  identity,
  previousVisitId: 'visit-WO-1',
  expectedVersion: 5,
  requestId: 'return-visit-request-001',
};

test('creates one distinct scheduled physical WorkVisit while preserving the prior visit and immutable scope', async () => {
  const { store, auditEvents, createReturnVisit } = fixture();
  const result = await createReturnVisit(input);
  const expectedId = returnVisitDocumentId(input.previousVisitId, input.requestId);
  const stored = store.get('workVisits', expectedId);

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.visit.id, expectedId);
  assert.equal(result.visit.status, 'scheduled');
  assert.equal(result.visit.previousVisitId, 'visit-WO-1');
  assert.equal(result.visit.version, 1);
  assert.deepEqual(result.visit.availableTransitions, ['en_route', 'no_access', 'cancelled']);
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'requires_return_visit');
  assert.equal(stored.status, 'not_started');
  assert.equal(stored.returnVisitRequestId, input.requestId);
  assert.equal(stored.previousVisitVersion, 5);
  assert.deepEqual(stored.scheduledScopeSnapshot, previousVisit().scheduledScopeSnapshot);
  assert.deepEqual(stored.participatingStaffIds, ['staff-1', 'staff-2']);
  assert.equal(store.get('workOrders', 'WO-1').status, 'Confirmada');
  assert.equal(auditEvents.length, 1);
  await assert.rejects(
    () => createReturnVisit({ ...input, expectedVersion: 4 }),
    (error) => error?.code === 'return_visit_conflict' && error?.status === 409,
  );
  assert.equal(auditEvents[0].type, 'work_visit_return_created');
  assert.equal(auditEvents[0].previousVisitId, 'visit-WO-1');
  assert.equal(auditEvents[0].visitId, expectedId);
});

test('an exact retry replays the deterministic visit without a second write or audit', async () => {
  const { store, auditEvents, createReturnVisit } = fixture();
  const first = await createReturnVisit(input);
  const replay = await createReturnVisit(input);

  assert.equal(replay.replayed, true);
  assert.equal(replay.visit.id, first.visit.id);
  assert.equal(store.values('workVisits').length, 2);
  assert.equal(store.commits[1].length, 0);
  assert.equal(auditEvents.length, 1);
});

test('a second request cannot branch history after the first return visit becomes current', async () => {
  const { store, createReturnVisit } = fixture();
  await createReturnVisit(input);
  await assert.rejects(
    () => createReturnVisit({ ...input, requestId: 'return-visit-request-002' }),
    (error) => error?.code === 'visit_not_current' && error?.details?.currentVisitId === returnVisitDocumentId(input.previousVisitId, input.requestId),
  );
  assert.equal(store.values('workVisits').length, 2);
});

test('fails closed for stale version, invalid canonical outcome, incomplete reason and read-only helper authority', async () => {
  const stale = fixture();
  await assert.rejects(() => stale.createReturnVisit({ ...input, expectedVersion: 4 }), (error) => error?.code === 'version_conflict');

  for (const visit of [
    previousVisit({ status: 'in_progress' }),
    previousVisit({ requiresSecondVisit: false }),
    previousVisit({ secondVisitReason: '' }),
  ]) {
    const current = fixture({ visit });
    await assert.rejects(() => current.createReturnVisit(input), (error) => error?.code === 'return_visit_not_required');
  }

  const helper = fixture({ resolveAssignment: async () => ({ assigned: true, responsibility: 'helper', source: 'crew', readOnly: true }) });
  await assert.rejects(() => helper.createReturnVisit(input), (error) => error?.code === 'permission_denied' && error?.status === 403);
});

test('audit failure rolls the new WorkVisit back atomically', async () => {
  const { store, createReturnVisit } = fixture({
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });
  await assert.rejects(() => createReturnVisit(input), /audit unavailable/);
  assert.equal(store.values('workVisits').length, 1);
  assert.equal(store.commits.length, 0);
});
