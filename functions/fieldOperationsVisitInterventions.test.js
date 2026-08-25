const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachWorkInterventionsToJob,
  createPlannedWorkInterventionCommand,
  projectWorkIntervention,
} = require('./fieldOperationsVisitInterventions');

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

  function matches(value, filter) {
    if (filter.op === '==') return value?.[filter.field] === filter.expected;
    throw new Error(`Unsupported fake query operator ${filter.op}`);
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

  const db = {
    collection(name) {
      return {
        doc(id) {
          const ref = documentRef(name, id);
          return {
            ...ref,
            async get() { return snapshot(id, ensure(name).get(id)); },
          };
        },
        where(field, op, expected) { return queryRef(name, [{ field, op, expected }]); },
        async get() {
          return { docs: [...ensure(name).entries()].map(([id, value]) => snapshot(id, value)) };
        },
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
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === 'create') ensure(write.ref.collectionName).set(write.ref.id, { ...write.value });
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
    fieldAuthorityVersion: 1,
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1',
      capturedAt: '2026-08-25T10:00:00.000Z',
      estimatedUnitCount: 1,
      workLines: [{ id: 'line-standard', serviceId: '', presetId: 'standard_service', label: 'Standard Service', quantity: 1, durationMinutes: 60 }],
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
    appointmentWorkItems: [{ id: 'line-standard', presetId: 'standard_service', label: 'Standard Service', quantity: 1 }],
    airConditionerCount: 1,
    ...overrides,
  };
}

function visitAsset(id = 'VA-1', assetId = 'AC-1', overrides = {}) {
  return {
    id,
    fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    assetId,
    sequence: id === 'VA-2' ? 2 : 1,
    locationLabel: id === 'VA-2' ? 'Habitación' : 'Sala',
    source: 'existing_asset',
    status: 'identified',
    addedOnSite: true,
    createdAt: '2026-08-25T10:20:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:20:00.000Z',
    updatedByUserId: 'uid-1',
    version: 1,
    ...overrides,
  };
}

function service(id = 'service-standard', overrides = {}) {
  return {
    id,
    itemType: 'Servicio',
    name: id === 'service-checkup' ? 'Check-up' : '12K Standard Service',
    category: 'Maintenance',
    active: true,
    durationMinutes: 60,
    serviceDefinition: {
      version: 1,
      bookingCode: id === 'service-checkup' ? 'check_up' : '12k_standard',
      duration: { minutes: 60 },
    },
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

function storedIntervention(id = 'WI-EXISTING', overrides = {}) {
  return {
    id,
    fieldAuthorityVersion: 1,
    visitId: 'visit-WO-1',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1',
    assetId: 'AC-1',
    plannedWorkLineId: 'line-standard',
    serviceCatalogItemId: 'service-standard',
    interventionType: '12K Standard Service',
    origin: 'planned',
    requestedBy: 'office',
    status: 'confirmed',
    performedByStaffIds: [],
    createdAt: '2026-08-25T10:25:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:25:00.000Z',
    updatedByUserId: 'uid-1',
    version: 1,
    ...overrides,
  };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: options.visits || [options.visit || baseVisit()],
    workOrders: [options.order || baseOrder()],
    visitAssets: options.visitAssets || [visitAsset()],
    services: options.services || [service('service-standard'), service('service-checkup')],
    workInterventions: options.workInterventions || [],
  });
  const auditEvents = [];
  const create = createPlannedWorkInterventionCommand({
    db: store.db,
    now: () => '2026-08-25T10:30:00.000Z',
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { auditEvents.push(event); }),
  });
  return { store, auditEvents, create };
}

function createInput(overrides = {}) {
  return {
    identity: identity(),
    visitId: 'visit-WO-1',
    visitAssetId: 'VA-1',
    plannedWorkLineId: 'line-standard',
    serviceCatalogItemId: 'service-standard',
    requestId: 'planned-intervention-001',
    ...overrides,
  };
}

test('planned WorkIntervention links actual Asset work to immutable planned scope using canonical Service identity', async () => {
  const { store, auditEvents, create } = fixture();
  const beforeVisit = structuredClone(store.get('workVisits', 'visit-WO-1'));
  const beforeOrder = structuredClone(store.get('workOrders', 'WO-1'));
  const beforeAsset = structuredClone(store.get('visitAssets', 'VA-1'));

  const result = await create(createInput());

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.workIntervention.visitAssetId, 'VA-1');
  assert.equal(result.workIntervention.assetId, 'AC-1');
  assert.equal(result.workIntervention.plannedWorkLineId, 'line-standard');
  assert.equal(result.workIntervention.serviceCatalogItemId, 'service-standard');
  assert.equal(result.workIntervention.interventionType, '12K Standard Service', 'service label must come from canonical Service, not client input');
  assert.equal(result.workIntervention.origin, 'planned');
  assert.equal(result.workIntervention.status, 'confirmed');
  assert.deepEqual(result.workIntervention.performedByStaffIds, [], 'confirmation must not falsely claim the work has already been performed');
  assert.deepEqual(store.get('workVisits', 'visit-WO-1'), beforeVisit);
  assert.deepEqual(store.get('workOrders', 'WO-1'), beforeOrder);
  assert.deepEqual(store.get('visitAssets', 'VA-1'), beforeAsset);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].type, 'planned_work_intervention_created');
});

test('planned quantity is consumed by actual interventions without rewriting the planned quantity', async () => {
  const twoPlanned = baseVisit({
    scheduledScopeSnapshot: {
      ...baseVisit().scheduledScopeSnapshot,
      estimatedUnitCount: 2,
      workLines: [{ id: 'line-standard', presetId: 'standard_service', label: 'Standard Service', quantity: 2, durationMinutes: 60 }],
    },
  });
  const { store, create } = fixture({ visit: twoPlanned, visitAssets: [visitAsset('VA-1', 'AC-1'), visitAsset('VA-2', 'AC-2')] });
  await create(createInput({ requestId: 'planned-intervention-one-001' }));
  await create(createInput({ visitAssetId: 'VA-2', requestId: 'planned-intervention-two-001' }));
  assert.equal(store.all('workInterventions').length, 2);
  assert.equal(store.get('workVisits', 'visit-WO-1').scheduledScopeSnapshot.workLines[0].quantity, 2);

  await assert.rejects(
    () => create(createInput({ visitAssetId: 'VA-2', requestId: 'planned-intervention-three-001' })),
    (error) => error?.code === 'planned_work_already_linked_to_asset' && error?.status === 409,
  );
});

test('planned quantity one cannot be silently over-linked to a second A/C; additional work must become Scope Change', async () => {
  const { store, create } = fixture({ visitAssets: [visitAsset('VA-1', 'AC-1'), visitAsset('VA-2', 'AC-2')] });
  await create(createInput({ requestId: 'planned-one-001' }));
  await assert.rejects(
    () => create(createInput({ visitAssetId: 'VA-2', requestId: 'planned-overflow-001' })),
    (error) => error?.code === 'planned_work_fully_linked' && error?.status === 409,
  );
  assert.equal(store.all('workInterventions').length, 1);
  assert.equal(store.get('workVisits', 'visit-WO-1').scheduledScopeSnapshot.workLines[0].quantity, 1);
});

test('same request id is idempotent only for the exact same intervention input', async () => {
  const { store, auditEvents, create } = fixture();
  const first = await create(createInput());
  const replay = await create(createInput());
  assert.equal(replay.replayed, true);
  assert.equal(replay.workIntervention.id, first.workIntervention.id);
  assert.equal(store.all('workInterventions').length, 1);
  assert.equal(auditEvents.length, 1);

  await assert.rejects(
    () => create(createInput({ serviceCatalogItemId: 'service-checkup' })),
    (error) => error?.code === 'work_intervention_request_conflict' && error?.status === 409,
  );
});

test('unknown, inactive, product or non-canonical services are denied instead of becoming shadow Field services', async () => {
  const cases = [
    { services: [], serviceId: 'missing', status: 404 },
    { services: [service('bad', { active: false })], serviceId: 'bad', status: 409 },
    { services: [service('bad', { itemType: 'Producto' })], serviceId: 'bad', status: 409 },
    { services: [service('bad', { serviceDefinition: undefined })], serviceId: 'bad', status: 409 },
  ];
  for (const item of cases) {
    const { store, create } = fixture({ services: item.services });
    await assert.rejects(
      () => create(createInput({ serviceCatalogItemId: item.serviceId, requestId: `service-deny-${item.serviceId}-001` })),
      (error) => error?.code === 'service_not_available' && error?.status === item.status,
    );
    assert.equal(store.all('workInterventions').length, 0);
  }
});

test('helper, read-only fallback and unassigned principals cannot create WorkInterventions', async () => {
  for (const denied of [
    assignment({ responsibility: 'helper' }),
    assignment({ readOnly: true, source: 'profile_van_fallback' }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  ]) {
    const { store, create } = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(
      () => create(createInput({ requestId: `intervention-denied-${denied.source}-001` })),
      (error) => error?.code === 'permission_denied' && error?.status === 403,
    );
    assert.equal(store.all('workInterventions').length, 0);
  }
});

test('intervention creation revalidates current visit state, VisitAsset identity and planned snapshot inside the transaction', async () => {
  const prearrival = fixture({ visit: baseVisit({ status: 'on_the_way' }) });
  await assert.rejects(
    () => prearrival.create(createInput({ requestId: 'prearrival-intervention-001' })),
    (error) => error?.code === 'work_intervention_add_not_allowed' && error?.status === 409,
  );

  const foreignAsset = fixture({ visitAssets: [visitAsset('VA-1', 'AC-1', { propertyId: 'PROPERTY-OTHER' })] });
  await assert.rejects(
    () => foreignAsset.create(createInput({ requestId: 'foreign-visit-asset-001' })),
    (error) => error?.code === 'visit_asset_identity_conflict' && error?.status === 409,
  );

  const unknownLine = fixture();
  await assert.rejects(
    () => unknownLine.create(createInput({ plannedWorkLineId: 'line-other', requestId: 'unknown-line-001' })),
    (error) => error?.code === 'planned_work_line_not_found' && error?.status === 409,
  );
});

test('audit failure aborts WorkIntervention persistence atomically', async () => {
  const { store, create } = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
  await assert.rejects(() => create(createInput()), /audit unavailable/);
  assert.equal(store.all('workInterventions').length, 0);
});

test('WorkIntervention projection fails closed on schema, identity, origin, status, requester, staff and version corruption', () => {
  const valid = storedIntervention();
  assert.equal(projectWorkIntervention(valid).id, 'WI-EXISTING');
  assert.deepEqual(projectWorkIntervention(valid).performedByStaffIds, [], 'confirmed work may legitimately have no performers yet');
  assert.throws(() => projectWorkIntervention({ ...valid, fieldAuthorityVersion: 2 }), /Unsupported Work Intervention storage version/);
  assert.throws(() => projectWorkIntervention({ ...valid, propertyId: '', siteId: '' }), /Property identity is missing or conflicting/);
  assert.throws(() => projectWorkIntervention({ ...valid, origin: 'future_origin' }), /Unknown persisted Work Intervention origin/);
  assert.throws(() => projectWorkIntervention({ ...valid, status: 'future_status' }), /Unknown persisted Work Intervention status/);
  assert.throws(() => projectWorkIntervention({ ...valid, requestedBy: 'robot' }), /Unknown persisted Work Intervention requestedBy/);
  assert.throws(() => projectWorkIntervention({ ...valid, performedByStaffIds: ['staff-1', 'staff-1'] }), /staff assignment is invalid/);
  assert.throws(() => projectWorkIntervention({ ...valid, performedByStaffIds: [''] }), /staff assignment is invalid/);
  assert.throws(() => projectWorkIntervention({ ...valid, version: 1.5 }), /version is invalid/);
});

test('job projection derives planned-vs-actual progress and exposes catalog choices only to eligible intervention writers', async () => {
  const store = createDb({
    services: [service('service-standard'), service('service-checkup')],
    workInterventions: [storedIntervention()],
  });
  const baseJob = {
    workOrderId: 'WO-1',
    customerId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 2 }],
    fieldVisit: { id: 'visit-WO-1', status: 'on_site' },
    visitAssets: [{ id: 'VA-1' }, { id: 'VA-2' }],
  };
  const result = await attachWorkInterventionsToJob(store.db, {
    ...baseJob,
    allowedActions: ['read', 'intervention.add'],
  });

  assert.equal(result.workInterventions.length, 1);
  assert.deepEqual(result.plannedWorkProgress[0], {
    id: 'line-standard', plannedQuantity: 2, linkedActualQuantity: 1, remainingQuantity: 1,
  });
  assert.deepEqual(result.availableFieldServices.map((item) => item.id), ['service-standard', 'service-checkup']);
  assert.equal(result.canAddPlannedIntervention, true);

  const helper = await attachWorkInterventionsToJob(store.db, {
    ...baseJob,
    allowedActions: ['read'],
  });
  assert.deepEqual(helper.availableFieldServices, [], 'read-only users must not receive mutation-only service choices');
  assert.equal(helper.canAddPlannedIntervention, false);

  const full = await attachWorkInterventionsToJob(store.db, {
    ...baseJob,
    plannedWork: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }],
    allowedActions: ['read', 'intervention.add'],
  });
  assert.equal(full.plannedWorkProgress[0].remainingQuantity, 0);
  assert.deepEqual(full.availableFieldServices, [], 'fully linked plan does not need mutation-only service choices');
  assert.equal(full.canAddPlannedIntervention, false);
});
