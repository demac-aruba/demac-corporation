const assert = require('node:assert/strict');
const test = require('node:test');
const { createTransitionWorkVisitCommand } = require('./fieldOperationsVisitMutation');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]),
  );
  const commits = [];

  function ensure(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  function documentRef(name, id) {
    return { kind: 'document', collectionName: name, id };
  }

  function queryRef(name, filters = []) {
    return {
      kind: 'query',
      collectionName: name,
      filters,
      where(field, op, expected) {
        return queryRef(name, [...filters, { field, op, expected }]);
      },
    };
  }

  function matches(value, filter) {
    if (filter.op === '==') return value?.[filter.field] === filter.expected;
    throw new Error(`Unsupported fake query operator ${filter.op}`);
  }

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
                .filter(([, value]) => target.filters.every((filter) => matches(value, filter)))
                .map(([id, value]) => snapshot(id, value)),
            };
          }
          return snapshot(target.id, values.get(target.id));
        },
        update(ref, patch) {
          if (!ensure(ref.collectionName).has(ref.id)) throw new Error(`Missing document: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'update', ref, patch: { ...patch } });
        },
        create(ref, value) {
          if (ensure(ref.collectionName).has(ref.id)) throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'create', ref, value: { ...value } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === 'update') {
          const current = ensure(write.ref.collectionName).get(write.ref.id);
          ensure(write.ref.collectionName).set(write.ref.id, { ...current, ...write.patch });
        } else {
          ensure(write.ref.collectionName).set(write.ref.id, { ...write.value });
        }
      }
      commits.push(writes);
      return result;
    },
  };

  return {
    db,
    commits,
    get(name, id) { return ensure(name).get(id); },
  };
}

function baseVisit(overrides = {}) {
  return {
    id: 'visit-WO-1',
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
    status: 'not_started',
    participatingStaffIds: ['staff-1'],
    requiresSecondVisit: false,
    createdAt: '2026-08-24T12:00:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-24T12:00:00.000Z',
    updatedByUserId: 'uid-1',
    version: 1,
    ...overrides,
  };
}

function baseOrder(overrides = {}) {
  return {
    id: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'Confirmada',
    date: '2026-08-24',
    technicianIds: ['staff-1'],
    ...overrides,
  };
}

function identity(overrides = {}) {
  return {
    uid: 'uid-1',
    staffId: 'staff-1',
    name: 'Tech One',
    email: 'tech@example.invalid',
    role: 'technician',
    operations: false,
    ...overrides,
  };
}

function assignment(overrides = {}) {
  return {
    assigned: true,
    responsibility: 'technician',
    source: 'direct_staff',
    readOnly: false,
    ...overrides,
  };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: options.visits || [options.visit || baseVisit()],
    workOrders: [options.order || baseOrder()],
  });
  const auditEvents = [];
  let clockIndex = 0;
  const times = options.times || [
    '2026-08-24T12:30:00.000Z',
    '2026-08-24T12:45:00.000Z',
    '2026-08-24T13:00:00.000Z',
  ];
  const resolveCalls = [];
  const transition = createTransitionWorkVisitCommand({
    db: store.db,
    now: () => times[Math.min(clockIndex++, times.length - 1)],
    resolveAssignment: options.resolveAssignment || (async (input) => { resolveCalls.push(input); return assignment(); }),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { auditEvents.push(event); }),
  });
  return { store, auditEvents, resolveCalls, transition };
}

test('scheduled visit transitions to en route atomically with first timestamp, version and audit', async () => {
  const { store, auditEvents, transition } = fixture();
  const result = await transition({
    identity: identity(),
    visitId: 'visit-WO-1',
    to: 'en_route',
    expectedVersion: 1,
    requestId: 'transition-en-route-001',
  });

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.visit.status, 'en_route');
  assert.equal(result.visit.version, 2);
  assert.equal(result.visit.departedAt, '2026-08-24T12:30:00.000Z');
  assert.deepEqual(result.visit.availableTransitions, ['on_site']);
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'on_the_way');
  assert.equal(store.get('workVisits', 'visit-WO-1').version, 2);
  assert.equal(auditEvents.length, 1);
  assert.deepEqual(auditEvents[0].before, { status: 'scheduled', version: 1 });
  assert.deepEqual(auditEvents[0].after, { status: 'en_route', version: 2 });
});

test('visit progresses en route -> on site -> in progress without overwriting first timestamps', async () => {
  const { store, transition } = fixture();
  await transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-route-001' });
  const onSite = await transition({ identity: identity(), visitId: 'visit-WO-1', to: 'on_site', expectedVersion: 2, requestId: 'transition-site-001' });
  const inProgress = await transition({ identity: identity(), visitId: 'visit-WO-1', to: 'in_progress', expectedVersion: 3, requestId: 'transition-work-001' });

  assert.equal(onSite.visit.arrivedAt, '2026-08-24T12:45:00.000Z');
  assert.equal(inProgress.visit.startedAt, '2026-08-24T13:00:00.000Z');
  assert.equal(inProgress.visit.departedAt, '2026-08-24T12:30:00.000Z');
  assert.equal(inProgress.visit.arrivedAt, '2026-08-24T12:45:00.000Z');
  assert.deepEqual(inProgress.visit.availableTransitions, []);
  assert.equal(store.get('workVisits', 'visit-WO-1').version, 4);
});

test('retrying an already committed target is an idempotent no-op even with the stale prior version', async () => {
  const { store, auditEvents, transition } = fixture();
  await transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-route-first' });
  const replay = await transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-route-retry' });

  assert.equal(replay.replayed, true);
  assert.equal(replay.visit.version, 2);
  assert.equal(store.commits[1].length, 0);
  assert.equal(auditEvents.length, 1);
});

test('two-device stale expectedVersion fails closed before changing visit state', async () => {
  const { store, transition } = fixture();
  await transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-device-a' });

  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'on_site', expectedVersion: 1, requestId: 'transition-device-b' }),
    (error) => error?.code === 'version_conflict' && error?.status === 409,
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'on_the_way');
  assert.equal(store.get('workVisits', 'visit-WO-1').version, 2);
});

test('helper, read-only fallback and unassigned principals cannot transition active visit state', async () => {
  for (const denied of [
    assignment({ responsibility: 'helper' }),
    assignment({ readOnly: true, source: 'profile_van_fallback' }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned' }),
  ]) {
    const { store, transition } = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(
      () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: `transition-denied-${denied.source}` }),
      (error) => error?.code === 'permission_denied' && error?.status === 403,
    );
    assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
  }
});

test('current Work Order lifecycle is revalidated inside the same transaction before transition', async () => {
  let assignmentCalled = false;
  const { store, transition } = fixture({
    order: baseOrder({ status: 'Cancelada' }),
    resolveAssignment: async () => { assignmentCalled = true; return assignment(); },
  });

  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-cancelled-order' }),
    (error) => error?.code === 'work_order_not_available' && error?.status === 409,
  );
  assert.equal(assignmentCalled, false);
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
});

test('transition revalidates WorkVisit identity against the current Work Order before mutation', async () => {
  const { store, transition } = fixture({
    visit: baseVisit({ clientId: 'CLIENT-OTHER' }),
  });

  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-identity-conflict' }),
    (error) => error?.code === 'visit_identity_conflict' && error?.status === 409,
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
});

test('an older physical WorkVisit cannot be transitioned after a return visit exists', async () => {
  const initial = baseVisit({ id: 'visit-initial' });
  const current = baseVisit({
    id: 'visit-return',
    previousVisitId: 'visit-initial',
    status: 'on_site',
    arrivedAt: '2026-08-24T12:45:00.000Z',
  });
  const { store, transition } = fixture({ visits: [initial, current] });

  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-initial', to: 'en_route', expectedVersion: 1, requestId: 'transition-old-visit' }),
    (error) => error?.code === 'visit_not_current' && error?.status === 409,
  );
  assert.equal(store.get('workVisits', 'visit-initial').status, 'not_started');
  assert.equal(store.get('workVisits', 'visit-return').status, 'on_site');
});

test('malformed persisted concurrency version fails closed instead of being normalized into a writable visit', async () => {
  const { store, transition } = fixture({ visit: baseVisit({ version: 1.5 }) });

  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-bad-stored-version' }),
    (error) => error?.code === 'invalid_visit_version' && error?.status === 409,
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
  assert.equal(store.get('workVisits', 'visit-WO-1').version, 1.5);
});

test('audit failure aborts the surrounding transaction and leaves WorkVisit unchanged', async () => {
  const { store, transition } = fixture({
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });

  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-audit-failure' }),
    /audit unavailable/,
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
  assert.equal(store.get('workVisits', 'visit-WO-1').version, 1);
});

test('non-activated branch targets and malformed expectedVersion fail before persistence', async () => {
  const { store, transition } = fixture();
  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'pending', expectedVersion: 1, requestId: 'transition-pending-001' }),
    (error) => error?.code === 'transition_not_activated',
  );
  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 0, requestId: 'transition-bad-version' }),
    (error) => error?.code === 'expected_version_required',
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
});