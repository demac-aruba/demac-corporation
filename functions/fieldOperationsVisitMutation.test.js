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
  assert.deepEqual(result.visit.availableTransitions, ['on_site', 'pending', 'no_access']);
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
  assert.deepEqual(inProgress.visit.availableTransitions, ['pending']);
  assert.equal(store.get('workVisits', 'visit-WO-1').version, 4);
});

test('in-progress visit pauses with a required reason, optional next action and auditable canonical fields', async () => {
  const visit = baseVisit({
    status: 'in_progress',
    departedAt: '2026-08-24T12:00:00.000Z',
    arrivedAt: '2026-08-24T12:15:00.000Z',
    startedAt: '2026-08-24T12:20:00.000Z',
    version: 4,
  });
  const { store, auditEvents, transition } = fixture({ visit });
  const result = await transition({
    identity: identity(),
    visitId: 'visit-WO-1',
    to: 'pending',
    expectedVersion: 4,
    pendingReason: ' Replacement control board required. ',
    pendingAction: 'Office should source the compatible board.',
    requestId: 'transition-pending-001',
  });

  assert.equal(result.visit.status, 'pending');
  assert.equal(result.visit.pendingReason, 'Replacement control board required.');
  assert.equal(result.visit.pendingAction, 'Office should source the compatible board.');
  assert.equal(result.visit.pendingAt, '2026-08-24T12:30:00.000Z');
  assert.deepEqual(result.visit.availableTransitions, ['in_progress']);
  assert.equal(store.get('workVisits', 'visit-WO-1').pendingRequestId, 'transition-pending-001');
  assert.deepEqual(auditEvents[0].after, {
    status: 'pending',
    version: 5,
    pendingReason: 'Replacement control board required.',
    pendingAction: 'Office should source the compatible board.',
  });
});

test('pending transition requires a reason and exact retry payload', async () => {
  const visit = baseVisit({ status: 'in_progress', startedAt: '2026-08-24T12:20:00.000Z', version: 4 });
  const { store, auditEvents, transition } = fixture({ visit });
  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'pending', expectedVersion: 4, requestId: 'transition-pending-empty' }),
    (error) => error?.code === 'pending_reason_required' && error?.status === 400,
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'in_progress');

  const input = {
    identity: identity(), visitId: 'visit-WO-1', to: 'pending', expectedVersion: 4,
    pendingReason: 'Awaiting part', pendingAction: 'Order part', requestId: 'transition-pending-exact',
  };
  await transition(input);
  const replay = await transition(input);
  assert.equal(replay.replayed, true);
  assert.equal(auditEvents.length, 1);
  await assert.rejects(
    () => transition({ ...input, pendingReason: 'Different reason' }),
    (error) => error?.code === 'pending_transition_conflict' && error?.status === 409,
  );
});

test('pending visit resumes without erasing the recorded pending context', async () => {
  const visit = baseVisit({
    status: 'pending',
    startedAt: '2026-08-24T12:20:00.000Z',
    pendingAt: '2026-08-24T12:30:00.000Z',
    pendingReason: 'Awaiting access approval',
    pendingAction: 'Customer will call DEMAC',
    pendingRequestId: 'transition-pending-001',
    version: 5,
  });
  const { store, transition } = fixture({ visit, times: ['2026-08-25T13:00:00.000Z'] });
  const result = await transition({
    identity: identity(), visitId: 'visit-WO-1', to: 'in_progress', expectedVersion: 5, requestId: 'transition-resume-001',
  });
  assert.equal(result.visit.status, 'in_progress');
  assert.equal(result.visit.resumedAt, '2026-08-25T13:00:00.000Z');
  assert.equal(result.visit.pendingReason, 'Awaiting access approval');
  assert.equal(result.visit.pendingAction, 'Customer will call DEMAC');
  assert.deepEqual(result.visit.availableTransitions, ['pending']);
  assert.equal(store.get('workVisits', 'visit-WO-1').version, 6);
});

test('scheduled visit closes as no access with required canonical reason, terminal projection and audit', async () => {
  const { store, auditEvents, transition } = fixture();
  const result = await transition({
    identity: identity(),
    visitId: 'visit-WO-1',
    to: 'no_access',
    expectedVersion: 1,
    noAccessReason: ' Customer did not provide site access. ',
    requestId: 'transition-no-access-001',
  });

  assert.equal(result.visit.status, 'no_access');
  assert.equal(result.visit.version, 2);
  assert.equal(result.visit.noAccessAt, '2026-08-24T12:30:00.000Z');
  assert.equal(result.visit.noAccessReason, 'Customer did not provide site access.');
  assert.deepEqual(result.visit.availableTransitions, []);
  assert.equal(store.get('workVisits', 'visit-WO-1').noAccessRequestId, 'transition-no-access-001');
  assert.deepEqual(auditEvents[0].after, {
    status: 'no_access',
    version: 2,
    noAccessReason: 'Customer did not provide site access.',
  });
});

test('no-access transition requires a reason and exact retry payload', async () => {
  const { store, auditEvents, transition } = fixture();
  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'no_access', expectedVersion: 1, requestId: 'transition-no-access-empty' }),
    (error) => error?.code === 'no_access_reason_required' && error?.status === 400,
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');

  const input = {
    identity: identity(), visitId: 'visit-WO-1', to: 'no_access', expectedVersion: 1,
    noAccessReason: 'Locked property', requestId: 'transition-no-access-exact',
  };
  await transition(input);
  const replay = await transition(input);
  assert.equal(replay.replayed, true);
  assert.equal(auditEvents.length, 1);
  await assert.rejects(
    () => transition({ ...input, noAccessReason: 'Different reason' }),
    (error) => error?.code === 'no_access_transition_conflict' && error?.status === 409,
  );
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
  const { store, transition } = fixture({ visit: baseVisit({ clientId: 'CLIENT-OTHER' }) });
  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-identity-conflict' }),
    (error) => error?.code === 'visit_identity_conflict' && error?.status === 409,
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
});

test('conflicting identity aliases and immutable snapshot identity fail closed', async () => {
  for (const visit of [
    baseVisit({ customerId: 'CLIENT-OTHER' }),
    baseVisit({ siteId: 'PROPERTY-OTHER' }),
    baseVisit({ scheduledScopeSnapshot: { appointmentId: 'APT-OTHER', capturedAt: '2026-08-24T12:00:00.000Z', estimatedUnitCount: 1, workLines: [] } }),
  ]) {
    const { store, transition } = fixture({ visit });
    await assert.rejects(
      () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-alias-conflict' }),
      (error) => error?.code === 'visit_identity_conflict' && error?.status === 409,
    );
    assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
  }
});

test('an older physical WorkVisit cannot be transitioned after a return visit exists', async () => {
  const initial = baseVisit({ id: 'visit-initial' });
  const current = baseVisit({ id: 'visit-return', previousVisitId: 'visit-initial', status: 'on_site', arrivedAt: '2026-08-24T12:45:00.000Z' });
  const { store, transition } = fixture({ visits: [initial, current] });

  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-initial', to: 'en_route', expectedVersion: 1, requestId: 'transition-old-visit' }),
    (error) => error?.code === 'visit_not_current' && error?.status === 409,
  );
  assert.equal(store.get('workVisits', 'visit-initial').status, 'not_started');
  assert.equal(store.get('workVisits', 'visit-return').status, 'on_site');
});

test('an identity-conflicting ancestor blocks mutation of an otherwise valid current return visit', async () => {
  const initial = baseVisit({ id: 'visit-initial', clientId: 'CLIENT-OTHER' });
  const current = baseVisit({ id: 'visit-return', previousVisitId: 'visit-initial', status: 'on_site', arrivedAt: '2026-08-24T12:45:00.000Z' });
  const { store, transition } = fixture({ visits: [initial, current] });

  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-return', to: 'in_progress', expectedVersion: 1, requestId: 'transition-bad-ancestor' }),
    (error) => error?.code === 'visit_identity_conflict' && error?.status === 409,
  );
  assert.equal(store.get('workVisits', 'visit-return').status, 'on_site');
});

test('Legacy visit may use validated Work Order fallback for missing structural ids during transition', async () => {
  const legacySnapshot = { capturedAt: '2026-08-24T12:00:00.000Z', estimatedUnitCount: 1, workLines: [] };
  const { store, auditEvents, transition } = fixture({
    visit: baseVisit({ appointmentId: undefined, propertyId: undefined, scheduledScopeSnapshot: legacySnapshot }),
  });
  const result = await transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-legacy-fallback' });

  assert.equal(result.visit.appointmentId, 'APT-1');
  assert.equal(result.visit.propertyId, 'PROPERTY-1');
  assert.equal(result.visit.scheduledScopeSnapshot.appointmentId, 'APT-1');
  assert.equal(store.get('workVisits', 'visit-WO-1').appointmentId, undefined, 'compatibility projection must not rewrite Legacy structural history');
  assert.equal(auditEvents[0].appointmentId, 'APT-1');
  assert.equal(auditEvents[0].propertyId, 'PROPERTY-1');
});

test('missing WorkVisit Work Order identity and incomplete Work Order identity both fail closed', async () => {
  const missingVisitIdentity = fixture({ visit: baseVisit({ workOrderId: '' }) });
  await assert.rejects(
    () => missingVisitIdentity.transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-no-work-order' }),
    (error) => error?.code === 'visit_identity_conflict' && error?.status === 409,
  );
  assert.equal(missingVisitIdentity.store.get('workVisits', 'visit-WO-1').status, 'not_started');

  const missingOrderIdentity = fixture({ order: baseOrder({ propertyId: '' }) });
  await assert.rejects(
    () => missingOrderIdentity.transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-incomplete-order' }),
    (error) => error?.code === 'work_order_identity_incomplete' && error?.status === 409,
  );
  assert.equal(missingOrderIdentity.store.get('workVisits', 'visit-WO-1').status, 'not_started');
});

test('malformed persisted concurrency version fails closed instead of being normalized into a writable visit', async () => {
  for (const version of [1.5, 0, null, '', '1']) {
    const { store, transition } = fixture({ visit: baseVisit({ version }) });
    await assert.rejects(
      () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 1, requestId: 'transition-bad-stored-version' }),
      (error) => error?.code === 'invalid_visit_version' && error?.status === 409,
    );
    assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
  }
});

test('expectedVersion must be a numeric safe integer and cannot overflow the next persisted version', async () => {
  const normal = fixture();
  await assert.rejects(
    () => normal.transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: '1', requestId: 'transition-string-version' }),
    (error) => error?.code === 'expected_version_required' && error?.status === 400,
  );
  assert.equal(normal.store.get('workVisits', 'visit-WO-1').status, 'not_started');

  const exhausted = fixture({ visit: baseVisit({ version: Number.MAX_SAFE_INTEGER }) });
  await assert.rejects(
    () => exhausted.transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: Number.MAX_SAFE_INTEGER, requestId: 'transition-version-exhausted' }),
    (error) => error?.code === 'visit_version_exhausted' && error?.status === 409,
  );
  assert.equal(exhausted.store.get('workVisits', 'visit-WO-1').status, 'not_started');
});

test('audit failure aborts the surrounding transaction and leaves WorkVisit unchanged', async () => {
  const { store, transition } = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
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
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'cancelled', expectedVersion: 1, requestId: 'transition-cancelled-001' }),
    (error) => error?.code === 'transition_not_activated',
  );
  await assert.rejects(
    () => transition({ identity: identity(), visitId: 'visit-WO-1', to: 'en_route', expectedVersion: 0, requestId: 'transition-bad-version' }),
    (error) => error?.code === 'expected_version_required',
  );
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'not_started');
});
