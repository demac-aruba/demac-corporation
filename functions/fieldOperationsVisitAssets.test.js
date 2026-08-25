const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachVisitAssetsToJob,
  createAttachExistingVisitAssetCommand,
  projectVisitAsset,
} = require('./fieldOperationsVisitAssets');

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
      async get() {
        return {
          docs: [...ensure(name).entries()]
            .filter(([, value]) => filters.every((filter) => matches(value, filter)))
            .map(([id, value]) => snapshot(id, value)),
        };
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
        create(ref, value) {
          if (ensure(ref.collectionName).has(ref.id)) throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'create', ref, value: { ...value } });
        },
        update(ref, patch) {
          if (!ensure(ref.collectionName).has(ref.id)) throw new Error(`Missing document: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'update', ref, patch: { ...patch } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === 'create') {
          ensure(write.ref.collectionName).set(write.ref.id, { ...write.value });
        } else {
          const current = ensure(write.ref.collectionName).get(write.ref.id);
          ensure(write.ref.collectionName).set(write.ref.id, { ...current, ...write.patch });
        }
      }
      commits.push(writes);
      return result;
    },
  };

  return {
    db,
    commits,
    all(name) { return [...ensure(name).values()]; },
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
      capturedAt: '2026-08-25T10:00:00.000Z',
      estimatedUnitCount: 1,
      workLines: [{ id: 'line-1', label: 'Standard Service', quantity: 1 }],
    },
    status: 'on_site',
    participatingStaffIds: ['staff-1'],
    requiresSecondVisit: false,
    arrivedAt: '2026-08-25T10:15:00.000Z',
    createdAt: '2026-08-25T10:00:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:15:00.000Z',
    updatedByUserId: 'uid-1',
    version: 3,
    ...overrides,
  };
}

function baseOrder(overrides = {}) {
  return {
    id: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'En el sitio',
    date: '2026-08-25',
    technicianIds: ['staff-1'],
    appointmentWorkItems: [{ id: 'line-1', label: 'Standard Service', quantity: 1 }],
    airConditionerCount: 1,
    ...overrides,
  };
}

function equipment(id = 'AC-1', overrides = {}) {
  return {
    id,
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    active: true,
    locationLabel: id === 'AC-1' ? 'Sala' : 'Habitación',
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

function visitAsset(id = 'VA-1', overrides = {}) {
  return {
    id,
    fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    assetId: 'AC-1',
    sequence: 1,
    locationLabel: 'Sala',
    source: 'existing_asset',
    status: 'identified',
    addedOnSite: true,
    createdAt: '2026-08-25T10:30:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z',
    updatedByUserId: 'uid-1',
    version: 1,
    ...overrides,
  };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: options.visits || [options.visit || baseVisit()],
    workOrders: [options.order || baseOrder()],
    equipmentSystems: options.equipment || [equipment('AC-1'), equipment('AC-2')],
    visitAssets: options.visitAssets || [],
  });
  const auditEvents = [];
  const resolveCalls = [];
  const attach = createAttachExistingVisitAssetCommand({
    db: store.db,
    now: () => '2026-08-25T10:30:00.000Z',
    resolveAssignment: options.resolveAssignment || (async (input) => {
      resolveCalls.push(input);
      return assignment();
    }),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => {
      auditEvents.push(event);
    }),
  });
  return { store, auditEvents, resolveCalls, attach };
}

test('attaching a canonical existing A/C creates additive VisitAsset truth and audit without rewriting planned scope', async () => {
  const { store, auditEvents, attach } = fixture();
  const beforeVisit = structuredClone(store.get('workVisits', 'visit-WO-1'));
  const beforeOrder = structuredClone(store.get('workOrders', 'WO-1'));

  const result = await attach({
    identity: identity(),
    visitId: 'visit-WO-1',
    assetId: 'AC-1',
    requestId: 'attach-existing-ac-001',
  });

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.visitAsset.assetId, 'AC-1');
  assert.equal(result.visitAsset.visitId, 'visit-WO-1');
  assert.equal(result.visitAsset.sequence, 1);
  assert.equal(result.visitAsset.locationLabel, 'Sala');
  assert.equal(result.visitAsset.source, 'existing_asset');
  assert.equal(result.visitAsset.status, 'identified');
  assert.equal(result.visitAsset.addedOnSite, true);
  assert.ok(result.allowedActions.includes('asset.add'));
  assert.equal(store.all('visitAssets').length, 1);
  assert.deepEqual(store.get('workVisits', 'visit-WO-1'), beforeVisit, 'VisitAsset creation must not rewrite WorkVisit planned snapshot/version');
  assert.deepEqual(store.get('workOrders', 'WO-1'), beforeOrder, 'actual equipment count must not rewrite WorkOrder planned intent');
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].type, 'visit_asset_attached');
  assert.equal(auditEvents[0].assetId, 'AC-1');
});

test('planned one A/C may discover and attach two actual A/C assets with stable visit-local sequence', async () => {
  const { store, attach } = fixture();
  await attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-1', requestId: 'attach-ac-one-001' });
  const second = await attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-2', requestId: 'attach-ac-two-001' });

  assert.equal(second.visitAsset.sequence, 2);
  assert.equal(store.all('visitAssets').length, 2);
  assert.equal(store.get('workOrders', 'WO-1').airConditionerCount, 1);
  assert.equal(store.get('workVisits', 'visit-WO-1').scheduledScopeSnapshot.estimatedUnitCount, 1);
});

test('retrying the same visit + canonical Asset is idempotent and does not append duplicate audit', async () => {
  const { store, auditEvents, attach } = fixture();
  const first = await attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-1', requestId: 'attach-ac-first-001' });
  const replay = await attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-1', requestId: 'attach-ac-retry-001' });

  assert.equal(replay.replayed, true);
  assert.equal(replay.visitAsset.id, first.visitAsset.id);
  assert.equal(store.all('visitAssets').length, 1);
  assert.equal(auditEvents.length, 1);
  assert.equal(store.commits[1].length, 0);
});

test('same-customer different-property, foreign-customer and inactive assets are denied without leaking ownership', async () => {
  for (const badEquipment of [
    equipment('AC-BAD', { propertyId: 'PROPERTY-OTHER' }),
    equipment('AC-BAD', { clientId: 'CLIENT-OTHER' }),
    equipment('AC-BAD', { active: false }),
  ]) {
    const { store, attach } = fixture({ equipment: [badEquipment] });
    await assert.rejects(
      () => attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-BAD', requestId: 'attach-bad-asset-001' }),
      (error) => ['asset_not_available_for_visit'].includes(error?.code) && [404, 409].includes(error?.status),
    );
    assert.equal(store.all('visitAssets').length, 0);
  }
});

test('conflicting legacy identity aliases on equipment fail closed', async () => {
  const { store, attach } = fixture({
    equipment: [equipment('AC-CONFLICT', { customerId: 'CLIENT-OTHER', siteId: 'PROPERTY-OTHER' })],
  });
  await assert.rejects(
    () => attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-CONFLICT', requestId: 'attach-conflict-001' }),
    (error) => error?.code === 'asset_not_available_for_visit' && error?.status === 409,
  );
  assert.equal(store.all('visitAssets').length, 0);
});

test('asset attachment is unavailable before arrival or after the activated work window', async () => {
  for (const status of ['not_started', 'on_the_way', 'pending', 'completed', 'cancelled']) {
    const { store, attach } = fixture({ visit: baseVisit({ status }) });
    await assert.rejects(
      () => attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-1', requestId: `attach-status-${status}-001` }),
      (error) => error?.code === 'visit_asset_add_not_allowed' && error?.status === 409,
    );
    assert.equal(store.all('visitAssets').length, 0);
  }
});

test('helper, read-only fallback and unassigned principals cannot add VisitAssets', async () => {
  for (const denied of [
    assignment({ responsibility: 'helper' }),
    assignment({ readOnly: true, source: 'profile_van_fallback' }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  ]) {
    const { store, attach } = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(
      () => attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-1', requestId: `attach-denied-${denied.source}-001` }),
      (error) => error?.code === 'permission_denied' && error?.status === 403,
    );
    assert.equal(store.all('visitAssets').length, 0);
  }
});

test('current Work Order lifecycle and current physical visit are revalidated inside the mutation transaction', async () => {
  const cancelled = fixture({ order: baseOrder({ status: 'Cancelada' }) });
  await assert.rejects(
    () => cancelled.attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-1', requestId: 'attach-cancelled-order-001' }),
    (error) => error?.code === 'work_order_not_available' && error?.status === 409,
  );

  const initial = baseVisit({ id: 'visit-initial' });
  const current = baseVisit({ id: 'visit-return', previousVisitId: 'visit-initial' });
  const oldVisit = fixture({ visits: [initial, current] });
  await assert.rejects(
    () => oldVisit.attach({ identity: identity(), visitId: 'visit-initial', assetId: 'AC-1', requestId: 'attach-old-visit-001' }),
    (error) => error?.code === 'visit_not_current' && error?.status === 409,
  );
});

test('audit failure aborts VisitAsset persistence atomically', async () => {
  const { store, attach } = fixture({
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });

  await assert.rejects(
    () => attach({ identity: identity(), visitId: 'visit-WO-1', assetId: 'AC-1', requestId: 'attach-audit-fail-001' }),
    /audit unavailable/,
  );
  assert.equal(store.all('visitAssets').length, 0);
});

test('VisitAsset projection fails closed on corrupted schema, identity, vocabulary, sequence, version and boolean state', () => {
  const valid = visitAsset();
  assert.equal(projectVisitAsset(valid).assetId, 'AC-1');
  assert.throws(() => projectVisitAsset({ ...valid, fieldAuthorityVersion: 2 }), /Unsupported Visit Asset storage version/);
  assert.throws(() => projectVisitAsset({ ...valid, source: 'unknown' }), /Unknown persisted Visit Asset source/);
  assert.throws(() => projectVisitAsset({ ...valid, status: 'unknown' }), /Unknown persisted Visit Asset status/);
  assert.throws(() => projectVisitAsset({ ...valid, sequence: 0 }), /sequence is invalid/);
  assert.throws(() => projectVisitAsset({ ...valid, version: undefined }), /version is invalid/);
  assert.throws(() => projectVisitAsset({ ...valid, addedOnSite: 'yes' }), /addedOnSite flag is invalid/);
  assert.throws(() => projectVisitAsset({ ...valid, assetId: '' }), /Asset identity is missing or conflicting/);
  assert.throws(() => projectVisitAsset({ ...valid, clientId: 'CLIENT-1', customerId: 'CLIENT-OTHER' }), /Customer identity is missing or conflicting/);
  assert.throws(() => projectVisitAsset({ ...valid, propertyId: 'PROPERTY-1', siteId: 'PROPERTY-OTHER' }), /Property identity is missing or conflicting/);
});

test('VisitAsset read validates denormalized WorkOrder, Customer and Property identity against the authorized job context', async () => {
  for (const corrupted of [
    visitAsset('VA-WO', { workOrderId: 'WO-OTHER' }),
    visitAsset('VA-CUSTOMER', { clientId: 'CLIENT-OTHER' }),
    visitAsset('VA-PROPERTY', { propertyId: 'PROPERTY-OTHER' }),
  ]) {
    const store = createDb({ visitAssets: [corrupted] });
    await assert.rejects(
      () => attachVisitAssetsToJob(store.db, {
        workOrderId: 'WO-1',
        customerId: 'CLIENT-1',
        propertyId: 'PROPERTY-1',
        fieldVisit: { id: 'visit-WO-1', status: 'on_site' },
        allowedActions: ['read', 'asset.add'],
      }),
      (error) => error?.code === 'visit_asset_identity_conflict' && error?.status === 409,
    );
  }
});

test('corrupted deterministic VisitAsset cannot be accepted as an idempotent replay', async () => {
  const firstFixture = fixture();
  const first = await firstFixture.attach({
    identity: identity(),
    visitId: 'visit-WO-1',
    assetId: 'AC-1',
    requestId: 'seed-deterministic-asset-001',
  });
  assert.ok(first.visitAsset.id.startsWith('VA-'));

  const corrupted = visitAsset(first.visitAsset.id, { propertyId: 'PROPERTY-OTHER' });
  const replayFixture = fixture({ visitAssets: [corrupted] });
  await assert.rejects(
    () => replayFixture.attach({
      identity: identity(),
      visitId: 'visit-WO-1',
      assetId: 'AC-1',
      requestId: 'replay-corrupted-asset-001',
    }),
    (error) => error?.code === 'visit_asset_identity_conflict' && error?.status === 409,
  );
});

test('job read projection exposes VisitAssets and server-derived add eligibility only in active on-site states', async () => {
  const store = createDb({ visitAssets: [visitAsset()] });
  const baseJob = {
    workOrderId: 'WO-1',
    customerId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
  };

  const active = await attachVisitAssetsToJob(store.db, {
    ...baseJob,
    fieldVisit: { id: 'visit-WO-1', status: 'on_site' },
    allowedActions: ['read', 'asset.add'],
  });
  assert.equal(active.canAddExistingAsset, true);
  assert.equal(active.visitAssets.length, 1);

  const helper = await attachVisitAssetsToJob(store.db, {
    ...baseJob,
    fieldVisit: { id: 'visit-WO-1', status: 'on_site' },
    allowedActions: ['read'],
  });
  assert.equal(helper.canAddExistingAsset, false);

  const enRoute = await attachVisitAssetsToJob(store.db, {
    ...baseJob,
    fieldVisit: { id: 'visit-WO-1', status: 'en_route' },
    allowedActions: ['read', 'asset.add'],
  });
  assert.equal(enRoute.canAddExistingAsset, false);
});
