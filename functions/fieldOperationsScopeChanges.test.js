const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachScopeChangesToJob,
  createAdditionalWorkInterventionCommand,
  projectScopeChange,
} = require('./fieldOperationsScopeChanges');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(
    Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]),
  );
  function ensure(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }
  function docRef(collectionName, id) {
    return { kind: 'document', collectionName, id };
  }
  function queryRef(collectionName, filters = []) {
    return {
      kind: 'query', collectionName, filters,
      where(field, op, expected) {
        assert.equal(op, '==');
        return queryRef(collectionName, [...filters, { field, expected }]);
      },
      async get() {
        return {
          docs: [...ensure(collectionName).entries()]
            .filter(([, value]) => filters.every((filter) => value?.[filter.field] === filter.expected))
            .map(([id, value]) => snapshot(id, value)),
        };
      },
    };
  }
  const db = {
    collection(name) {
      return {
        doc(id) {
          const ref = docRef(name, id);
          return { ...ref, async get() { return snapshot(id, ensure(name).get(id)); } };
        },
        where(field, op, expected) {
          assert.equal(op, '==');
          return queryRef(name, [{ field, expected }]);
        },
        async get() {
          return { docs: [...ensure(name).entries()].map(([id, value]) => snapshot(id, value)) };
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
                .filter(([, value]) => target.filters.every((filter) => value?.[filter.field] === filter.expected))
                .map(([id, value]) => snapshot(id, value)),
            };
          }
          return snapshot(target.id, ensure(target.collectionName).get(target.id));
        },
        create(ref, value) {
          if (ensure(ref.collectionName).has(ref.id)) throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          writes.push({ ref, value: { ...value } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) ensure(write.ref.collectionName).set(write.ref.id, { ...write.value });
      return result;
    },
  };
  return {
    db,
    all(name) { return [...ensure(name).values()]; },
    get(name, id) { return ensure(name).get(id); },
    set(name, id, value) { ensure(name).set(id, { ...value }); },
  };
}

function visit(overrides = {}) {
  return {
    id: 'visit-WO-1',
    fieldAuthorityVersion: 1,
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1',
      capturedAt: '2026-08-25T10:00:00.000Z',
      estimatedUnitCount: 1,
      workLines: [{ id: 'line-standard', presetId: 'standard_service', label: 'Standard Service', quantity: 1 }],
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

function order(overrides = {}) {
  return {
    id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    status: 'En el sitio', date: '2026-08-25', technicianIds: ['staff-1'], airConditionerCount: 1,
    ...overrides,
  };
}

function visitAsset(overrides = {}) {
  return {
    id: 'VA-2', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', assetId: 'AC-2', sequence: 2,
    locationLabel: 'Habitación', source: 'existing_asset', status: 'identified', addedOnSite: true,
    createdAt: '2026-08-25T10:20:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:20:00.000Z', updatedByUserId: 'uid-1', version: 1,
    ...overrides,
  };
}

function service(overrides = {}) {
  return {
    id: 'service-standard', itemType: 'Servicio', name: '12K Standard Service', category: 'Maintenance',
    active: true, durationMinutes: 60,
    serviceDefinition: { version: 1, bookingCode: '12k_standard', duration: { minutes: 60 } },
    ...overrides,
  };
}

function identity() {
  return { uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', role: 'technician', operations: false };
}

function assignment(overrides = {}) {
  return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false, ...overrides };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: [options.visit || visit()],
    workOrders: [options.order || order()],
    visitAssets: options.visitAssets || [visitAsset()],
    services: options.services || [service()],
    scopeChanges: options.scopeChanges || [],
    workInterventions: options.workInterventions || [],
  });
  const events = [];
  const create = createAdditionalWorkInterventionCommand({
    db: store.db,
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { events.push(event); }),
    now: () => '2026-08-25T10:30:00.000Z',
  });
  return { store, events, create };
}

function input(overrides = {}) {
  return {
    identity: identity(),
    visitId: 'visit-WO-1',
    visitAssetId: 'VA-2',
    serviceCatalogItemId: 'service-standard',
    origin: 'client_requested_additional_work',
    reason: 'Client requested service on the bedroom A/C.',
    requestId: 'additional-work-001',
    ...overrides,
  };
}

test('additional work creates ScopeChange + pending authorization WorkIntervention atomically without rewriting planned truth', async () => {
  const { store, events, create } = fixture();
  const beforeVisit = structuredClone(store.get('workVisits', 'visit-WO-1'));
  const beforeOrder = structuredClone(store.get('workOrders', 'WO-1'));
  const result = await create(input());

  assert.equal(result.replayed, false);
  assert.equal(result.scopeChange.origin, 'client_requested_additional_work');
  assert.equal(result.scopeChange.visitAssetId, 'VA-2');
  assert.equal(result.workIntervention.visitAssetId, 'VA-2');
  assert.equal(result.workIntervention.assetId, 'AC-2');
  assert.equal(result.workIntervention.origin, 'added_on_site_client_request');
  assert.equal(result.workIntervention.requestedBy, 'client');
  assert.equal(result.workIntervention.status, 'pending_authorization');
  assert.equal(result.workIntervention.scopeChangeId, result.scopeChange.id);
  assert.deepEqual(result.workIntervention.performedByStaffIds, []);
  assert.deepEqual(store.get('workVisits', 'visit-WO-1'), beforeVisit);
  assert.deepEqual(store.get('workOrders', 'WO-1'), beforeOrder);
  assert.equal(store.all('scopeChanges').length, 1);
  assert.equal(store.all('workInterventions').length, 1);
  assert.deepEqual(events.map((event) => event.type), ['scope_change_created', 'additional_work_intervention_proposed']);
});

test('technician-discovered work remains pending authorization and records technician origin without claiming execution', async () => {
  const { create } = fixture();
  const result = await create(input({
    origin: 'technician_discovered_additional_need',
    reason: 'Technician found a drain issue requiring an additional service.',
  }));
  assert.equal(result.scopeChange.origin, 'technician_discovered_additional_need');
  assert.equal(result.workIntervention.origin, 'added_on_site_technician_discovery');
  assert.equal(result.workIntervention.requestedBy, 'technician');
  assert.equal(result.workIntervention.status, 'pending_authorization');
});

test('same request id replays only exact additional-work input and partial persisted state fails closed', async () => {
  const { store, events, create } = fixture();
  const first = await create(input());
  const replay = await create(input());
  assert.equal(replay.replayed, true);
  assert.equal(replay.scopeChange.id, first.scopeChange.id);
  assert.equal(replay.workIntervention.id, first.workIntervention.id);
  assert.equal(events.length, 2, 'idempotent replay must not append duplicate audit');

  await assert.rejects(
    () => create(input({ reason: 'Different reason for same request id.' })),
    (error) => error?.code === 'scope_change_request_conflict' && error?.status === 409,
  );

  const intervention = store.all('workInterventions')[0];
  const partial = fixture({ workInterventions: [intervention] });
  await assert.rejects(
    () => partial.create(input()),
    (error) => error?.code === 'scope_change_request_conflict' && error?.status === 409,
  );
});

test('helper, read-only fallback and unassigned principals cannot propose additional work', async () => {
  for (const denied of [
    assignment({ responsibility: 'helper' }),
    assignment({ source: 'profile_van_fallback', readOnly: true }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  ]) {
    const { store, create } = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(
      () => create(input({ requestId: `additional-denied-${denied.source}-001` })),
      (error) => error?.code === 'permission_denied' && error?.status === 403,
    );
    assert.equal(store.all('scopeChanges').length, 0);
    assert.equal(store.all('workInterventions').length, 0);
  }
});

test('pre-arrival state, foreign VisitAsset, invalid origin and invalid canonical Service are rejected', async () => {
  const preArrival = fixture({ visit: visit({ status: 'on_the_way' }) });
  await assert.rejects(
    () => preArrival.create(input({ requestId: 'additional-prearrival-001' })),
    (error) => error?.code === 'work_intervention_add_not_allowed' && error?.status === 409,
  );

  const foreignAsset = fixture({ visitAssets: [visitAsset({ propertyId: 'PROPERTY-OTHER' })] });
  await assert.rejects(
    () => foreignAsset.create(input({ requestId: 'additional-foreign-asset-001' })),
    (error) => error?.code === 'visit_asset_identity_conflict' && error?.status === 409,
  );

  const invalidOrigin = fixture();
  await assert.rejects(
    () => invalidOrigin.create(input({ origin: 'office_updated_scope', requestId: 'additional-origin-001' })),
    (error) => error?.code === 'invalid_scope_change_origin' && error?.status === 400,
  );

  const invalidService = fixture({ services: [service({ active: false })] });
  await assert.rejects(
    () => invalidService.create(input({ requestId: 'additional-service-001' })),
    (error) => error?.code === 'service_not_available' && error?.status === 409,
  );
});

test('audit failure rolls back both ScopeChange and WorkIntervention', async () => {
  let auditCalls = 0;
  const { store, create } = fixture({
    appendAuditInTransaction: async () => {
      auditCalls += 1;
      if (auditCalls === 2) throw new Error('audit unavailable');
    },
  });
  await assert.rejects(() => create(input()), /audit unavailable/);
  assert.equal(store.all('scopeChanges').length, 0);
  assert.equal(store.all('workInterventions').length, 0);
});

test('ScopeChange projection fails closed on schema, identity, origin, reason, timestamp and version corruption', () => {
  const valid = {
    id: 'SC-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitAssetId: 'VA-2', interventionId: 'WI-2',
    origin: 'client_requested_additional_work', reason: 'Client requested extra work.', requestedByStaffId: 'staff-1',
    requestedAt: '2026-08-25T10:30:00.000Z', createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:30:00.000Z', updatedByUserId: 'uid-1', version: 1,
  };
  assert.equal(projectScopeChange(valid).id, 'SC-1');
  assert.throws(() => projectScopeChange({ ...valid, fieldAuthorityVersion: 2 }), /Unsupported Scope Change storage version/);
  assert.throws(() => projectScopeChange({ ...valid, propertyId: '' }), /Property identity is missing or conflicting/);
  assert.throws(() => projectScopeChange({ ...valid, origin: 'future_origin' }), /Unknown persisted Scope Change origin/);
  assert.throws(() => projectScopeChange({ ...valid, reason: '' }), /reason is missing/);
  assert.throws(() => projectScopeChange({ ...valid, requestedAt: 'not-a-date' }), /requestedAt is invalid/);
  assert.throws(() => projectScopeChange({ ...valid, version: 1.5 }), /version is invalid/);
});

test('job projection links ScopeChanges to additional WorkInterventions and server-projects eligible VisitAssets', async () => {
  const storedScope = {
    id: 'SC-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1', visitAssetId: 'VA-2', interventionId: 'WI-2', origin: 'client_requested_additional_work',
    reason: 'Client requested extra work.', requestedByStaffId: 'staff-1', requestedAt: '2026-08-25T10:30:00.000Z',
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:30:00.000Z',
    updatedByUserId: 'uid-1', version: 1,
  };
  const store = createDb({ scopeChanges: [storedScope], services: [service()] });
  const job = {
    workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    fieldVisit: { id: 'visit-WO-1', status: 'on_site' },
    visitAssets: [{ id: 'VA-2', assetId: 'AC-2' }],
    allowedActions: ['read', 'intervention.add'],
    workInterventions: [{
      id: 'WI-2', visitId: 'visit-WO-1', visitAssetId: 'VA-2', assetId: 'AC-2', serviceCatalogItemId: 'service-standard',
      interventionType: '12K Standard Service', origin: 'added_on_site_client_request', requestedBy: 'client',
      status: 'pending_authorization', scopeChangeId: 'SC-1', performedByStaffIds: [],
    }],
    availableFieldServices: [],
  };
  const result = await attachScopeChangesToJob(store.db, job);
  assert.equal(result.scopeChanges.length, 1);
  assert.deepEqual(result.additionalInterventionVisitAssetIds, ['VA-2']);
  assert.equal(result.availableFieldServices[0].id, 'service-standard');
  assert.equal(result.canAddAdditionalIntervention, true);

  const helper = await attachScopeChangesToJob(store.db, { ...job, allowedActions: ['read'], availableFieldServices: [] });
  assert.deepEqual(helper.additionalInterventionVisitAssetIds, []);
  assert.deepEqual(helper.availableFieldServices, []);
  assert.equal(helper.canAddAdditionalIntervention, false);

  await assert.rejects(
    () => attachScopeChangesToJob(store.db, { ...job, workInterventions: [] }),
    (error) => error?.code === 'scope_change_identity_conflict' && error?.status === 409,
  );
});
