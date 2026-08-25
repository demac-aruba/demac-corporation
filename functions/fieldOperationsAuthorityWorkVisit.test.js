const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildScheduledScopeSnapshot,
  canonicalStatusFromStorage,
  createPrepareWorkVisitCommand,
  initialVisitDocumentId,
  projectCanonicalWorkVisit,
  storageStatusFromCanonical,
  storageStatusFromWorkOrder,
  workOrderAllowsInitialVisitPreparation,
} = require('./fieldOperationsAuthorityWorkVisit');

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

  function queryRef(name, filters = [], limitCount = null) {
    return {
      kind: 'query',
      collectionName: name,
      filters,
      limitCount,
      where(field, op, expected) {
        return queryRef(name, [...filters, { field, op, expected }], limitCount);
      },
      limit(count) {
        return queryRef(name, filters, count);
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
            const docs = [...values.entries()]
              .filter(([, value]) => target.filters.every((filter) => matches(value, filter)))
              .slice(0, target.limitCount ?? undefined)
              .map(([id, value]) => snapshot(id, value));
            return { docs };
          }
          return snapshot(target.id, values.get(target.id));
        },
        create(ref, value) {
          const values = ensure(ref.collectionName);
          if (values.has(ref.id) || writes.some((write) => write.ref.collectionName === ref.collectionName && write.ref.id === ref.id)) {
            throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          }
          writes.push({ type: 'create', ref, value: { ...value } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) ensure(write.ref.collectionName).set(write.ref.id, { ...write.value });
      commits.push(writes);
      return result;
    },
  };

  return {
    db,
    commits,
    get(name, id) { return ensure(name).get(id); },
    all(name) { return [...ensure(name).values()]; },
  };
}

const baseSeed = {
  workOrders: [{
    id: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'Confirmada',
    date: '2026-08-24',
    technicianIds: ['staff-tech'],
    airConditionerCount: 0,
    customerFacingDescription: 'Standard Service; quantity to be confirmed on site',
    technicianInstructions: 'Confirm actual equipment before work.',
    appointmentWorkItems: [{ id: 'planned-1', serviceId: 'service-standard', label: 'Standard Service', quantity: 1, durationMinutes: 60 }],
  }],
  appointments: [{
    id: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    workLines: [{ id: 'planned-1', serviceId: 'service-standard', label: 'Standard Service', quantity: 1 }],
  }],
  clients: [{ id: 'CLIENT-1', name: 'Customer' }],
  properties: [{ id: 'PROPERTY-1', clientId: 'CLIENT-1', address: 'Santa Cruz 1' }],
  workVisits: [],
};

function identity(staffId = 'staff-tech') {
  return { uid: `uid-${staffId}`, staffId, name: staffId, email: `${staffId}@demac.invalid`, role: 'technician', operations: false };
}

function assignment(overrides = {}) {
  return {
    assigned: true,
    responsibility: 'technician',
    source: 'direct_staff',
    readOnly: false,
    leadTechnicianStaffId: 'staff-lead',
    participatingStaffIds: ['staff-lead', 'staff-tech'],
    ...overrides,
  };
}

function commandFixture(options = {}) {
  const store = createDb(options.seed || baseSeed);
  const auditEvents = [];
  const prepare = createPrepareWorkVisitCommand({
    db: store.db,
    now: () => '2026-08-24T18:30:00.000-04:00',
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { auditEvents.push(event); }),
  });
  return { store, auditEvents, prepare };
}

test('Work Order preparation eligibility is separate from Work Visit storage status compatibility', () => {
  assert.equal(workOrderAllowsInitialVisitPreparation({ status: 'Confirmada' }), true);
  assert.equal(workOrderAllowsInitialVisitPreparation({ status: 'Asignada' }), true);
  for (const status of ['En camino', 'En el sitio', 'En proceso', 'Pendiente', 'Estado futuro', '']) {
    assert.equal(workOrderAllowsInitialVisitPreparation({ status }), false);
    assert.throws(() => storageStatusFromWorkOrder({ status }), /Unsupported Work Order status/);
  }
  assert.equal(storageStatusFromWorkOrder({ status: 'Confirmada' }), 'not_started');
  assert.equal(storageStatusFromWorkOrder({ status: 'Asignada' }), 'not_started');

  assert.equal(storageStatusFromCanonical('scheduled'), 'not_started');
  assert.equal(storageStatusFromCanonical('en_route'), 'on_the_way');
  assert.equal(storageStatusFromCanonical('requires_return_visit'), 'requires_return_visit');
  assert.equal(storageStatusFromCanonical('no_access'), 'no_access');
  assert.throws(() => storageStatusFromCanonical('future_status'), /Unknown canonical Work Visit status/);
  assert.throws(() => storageStatusFromCanonical(''), /Unknown canonical Work Visit status/);

  assert.equal(canonicalStatusFromStorage('not_started'), 'scheduled');
  assert.equal(canonicalStatusFromStorage('on_the_way'), 'en_route');
  assert.equal(canonicalStatusFromStorage('requires_return_visit'), 'requires_return_visit');
  assert.equal(canonicalStatusFromStorage('no_access'), 'no_access');
  assert.throws(() => canonicalStatusFromStorage('mystery_state'), /Unknown persisted Work Visit status/);
  assert.throws(() => canonicalStatusFromStorage(''), /Unknown persisted Work Visit status/);
});

test('initial WorkVisit identity matches active Legacy id truncation and is not a return-visit id factory', () => {
  const id = initialVisitDocumentId(`WO-${'x'.repeat(120)}`);
  assert.equal(id.length, 'visit-'.length + 80);
  assert.ok(id.startsWith('visit-WO-'));
});

test('planned quantity zero stays zero instead of inventing one actual or expected asset', () => {
  const order = baseSeed.workOrders[0];
  const appointment = baseSeed.appointments[0];
  const snapshotValue = buildScheduledScopeSnapshot(order, appointment, '2026-08-24T18:30:00.000-04:00');
  assert.equal(snapshotValue.estimatedUnitCount, 0);
  assert.equal(snapshotValue.workLines.length, 1);
  assert.equal(snapshotValue.workLines[0].quantity, 1);
});

test('prepare WorkVisit is transaction-backed, audited, Legacy-compatible and does not mutate planned authorities', async () => {
  const { store, auditEvents, prepare } = commandFixture();
  const beforeOrder = structuredClone(store.get('workOrders', 'WO-1'));
  const beforeAppointment = structuredClone(store.get('appointments', 'APT-1'));

  const result = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-WO-1-001' });

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.visit.status, 'scheduled');
  assert.equal(result.visit.scheduledScopeSnapshot.estimatedUnitCount, 0);
  assert.equal(result.visit.workOrderId, 'WO-1');
  assert.equal(result.visit.customerId, 'CLIENT-1');
  assert.deepEqual(result.visit.participatingStaffIds, ['staff-tech', 'staff-lead']);
  assert.ok(result.allowedActions.includes('execute'));
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].type, 'work_visit_prepared');
  assert.equal(auditEvents[0].entityId, initialVisitDocumentId('WO-1'));

  const stored = store.get('workVisits', initialVisitDocumentId('WO-1'));
  assert.equal(stored.status, 'not_started');
  assert.equal(stored.clientId, 'CLIENT-1');
  assert.equal(stored.fieldAuthorityVersion, 1);
  assert.equal(stored.scheduledScopeSnapshot.appointmentId, 'APT-1');
  assert.equal(stored.scheduledScopeSnapshot.problemDescription, stored.scheduledScopeSnapshot.customerFacingDescription);
  assert.deepEqual(store.get('workOrders', 'WO-1'), beforeOrder);
  assert.deepEqual(store.get('appointments', 'APT-1'), beforeAppointment);
});

test('Asignada Work Order can prepare the initial scheduled WorkVisit', async () => {
  const seed = structuredClone(baseSeed);
  seed.workOrders[0].status = 'Asignada';
  const { prepare } = commandFixture({ seed });
  const result = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-assigned-status' });
  assert.equal(result.visit.status, 'scheduled');
});

test('in-flight Work Order status cannot synthesize a new physical WorkVisit', async () => {
  for (const status of ['En camino', 'En el sitio', 'En proceso', 'Pendiente']) {
    const seed = structuredClone(baseSeed);
    seed.workOrders[0].status = status;
    const { store, auditEvents, prepare } = commandFixture({ seed });
    await assert.rejects(
      () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: `prepare-in-flight-${status}` }),
      (error) => error?.code === 'work_visit_preparation_not_allowed' && error?.status === 409,
    );
    assert.equal(store.all('workVisits').length, 0, `${status} must not create a WorkVisit`);
    assert.equal(auditEvents.length, 0);
  }
});

test('existing in-flight Legacy WorkVisit can be replayed without manufacturing new history', async () => {
  const seed = structuredClone(baseSeed);
  seed.workOrders[0].status = 'En camino';
  seed.workVisits = [{
    id: 'legacy-in-flight',
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'on_the_way',
    scheduledScopeSnapshot: { appointmentId: 'APT-1', estimatedUnitCount: 1, workLines: [] },
    version: 1,
  }];
  const { store, auditEvents, prepare } = commandFixture({ seed });
  const result = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-existing-in-flight' });
  assert.equal(result.replayed, true);
  assert.equal(result.visit.id, 'legacy-in-flight');
  assert.equal(result.visit.status, 'en_route');
  assert.equal(store.all('workVisits').length, 1);
  assert.equal(auditEvents.length, 0);
});

test('unknown Work Order lifecycle fails before creating a WorkVisit', async () => {
  const seed = structuredClone(baseSeed);
  seed.workOrders[0].status = 'Estado futuro';
  const { store, auditEvents, prepare } = commandFixture({ seed });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-unknown-status' }),
    /not released for active Field execution/,
  );
  assert.equal(store.all('workVisits').length, 0);
  assert.equal(auditEvents.length, 0);
});

test('Work Order technicianIds are not copied into canonical staff-only participation', async () => {
  const seed = structuredClone(baseSeed);
  seed.workOrders[0].technicianIds = ['uid-staff-tech'];
  const { prepare } = commandFixture({ seed });
  const result = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-staff-namespace' });
  assert.deepEqual(result.visit.participatingStaffIds, ['staff-tech', 'staff-lead']);
  assert.ok(!result.visit.participatingStaffIds.includes('uid-staff-tech'));
});

test('replaying preparation reuses deterministic initial WorkVisit and does not append a duplicate event', async () => {
  const { store, auditEvents, prepare } = commandFixture();
  const first = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-WO-1-001' });
  const second = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-WO-1-001' });

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.source, 'field_authority');
  assert.equal(first.visit.id, second.visit.id);
  assert.equal(store.all('workVisits').length, 1);
  assert.equal(auditEvents.length, 1);
});

test('duplicate execution with a different retry key still reuses the already prepared initial visit', async () => {
  const { store, auditEvents, prepare } = commandFixture();
  const first = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-WO-1-A' });
  const second = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-WO-1-B' });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(store.all('workVisits').length, 1);
  assert.equal(auditEvents.length, 1);
});

test('deterministic Legacy initial visit fills only missing canonical Appointment identity from the validated Work Order', async () => {
  const legacyVisit = {
    id: initialVisitDocumentId('WO-1'),
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'not_started',
    participatingStaffIds: ['staff-tech'],
    requiresSecondVisit: false,
    scheduledScopeSnapshot: { estimatedUnitCount: 1, problemDescription: 'Legacy snapshot' },
    createdAt: '2026-08-24T10:00:00Z', createdByUserId: 'legacy-user',
    updatedAt: '2026-08-24T10:00:00Z', updatedByUserId: 'legacy-user', version: 1,
  };
  const seed = { ...baseSeed, workVisits: [legacyVisit] };
  const { store, auditEvents, prepare } = commandFixture({ seed });
  const result = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-WO-1-legacy' });

  assert.equal(result.replayed, true);
  assert.equal(result.source, 'legacy_existing');
  assert.equal(result.visit.status, 'scheduled');
  assert.equal(result.visit.appointmentId, 'APT-1');
  assert.equal(result.visit.scheduledScopeSnapshot.appointmentId, 'APT-1');
  assert.deepEqual(result.visit.scheduledScopeSnapshot.workLines, []);
  assert.equal(store.get('workVisits', initialVisitDocumentId('WO-1')).appointmentId, undefined);
  assert.equal(auditEvents.length, 0);
});

test('a single compatible Legacy initial WorkVisit with a historical id is adopted by workOrderId instead of duplicated', async () => {
  const legacyVisit = {
    id: 'historical-visit-id',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'not_started',
    participatingStaffIds: ['staff-tech'],
    requiresSecondVisit: false,
    scheduledScopeSnapshot: { estimatedUnitCount: 0, problemDescription: 'Historical snapshot' },
    createdAt: '2026-08-24T09:00:00Z', createdByUserId: 'legacy-user',
    updatedAt: '2026-08-24T09:00:00Z', updatedByUserId: 'legacy-user', version: 1,
  };
  const { store, auditEvents, prepare } = commandFixture({ seed: { ...baseSeed, workVisits: [legacyVisit] } });
  const result = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-historical-id' });

  assert.equal(result.replayed, true);
  assert.equal(result.source, 'legacy_existing');
  assert.equal(result.visit.id, 'historical-visit-id');
  assert.equal(result.visit.appointmentId, 'APT-1');
  assert.equal(store.all('workVisits').length, 1);
  assert.equal(store.get('workVisits', initialVisitDocumentId('WO-1')), undefined);
  assert.equal(auditEvents.length, 0);
});

test('one historical initial visit plus multiple return visits resolves to the initial visit', async () => {
  const initial = {
    id: 'legacy-initial', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'pending',
    scheduledScopeSnapshot: { estimatedUnitCount: 1 }, createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-20T10:00:00Z', version: 1,
  };
  const returns = Array.from({ length: 5 }, (_, index) => ({
    id: `legacy-return-${index + 1}`,
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'pending',
    previousVisitId: index === 0 ? 'legacy-initial' : `legacy-return-${index}`,
    scheduledScopeSnapshot: { estimatedUnitCount: 1 },
  }));
  const { store, prepare } = commandFixture({ seed: { ...baseSeed, workVisits: [initial, ...returns] } });
  const result = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-with-returns' });
  assert.equal(result.replayed, true);
  assert.equal(result.visit.id, 'legacy-initial');
  assert.equal(store.all('workVisits').length, 6);
});

test('ambiguous historical WorkVisit history fails closed instead of creating or guessing an initial visit', async () => {
  const visits = [
    {
      id: 'legacy-initial-a', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', appointmentId: 'APT-1',
      status: 'not_started', scheduledScopeSnapshot: { appointmentId: 'APT-1', estimatedUnitCount: 0 },
    },
    {
      id: 'legacy-initial-b', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', appointmentId: 'APT-1',
      status: 'pending', scheduledScopeSnapshot: { appointmentId: 'APT-1', estimatedUnitCount: 0 },
    },
  ];
  const { store, auditEvents, prepare } = commandFixture({ seed: { ...baseSeed, workVisits: visits } });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-ambiguous-history' }),
    /cannot be resolved to one unambiguous initial visit/,
  );
  assert.equal(store.all('workVisits').length, 2);
  assert.equal(store.get('workVisits', initialVisitDocumentId('WO-1')), undefined);
  assert.equal(auditEvents.length, 0);
});

test('deterministic initial plus another historical initial fails closed', async () => {
  const deterministic = {
    id: initialVisitDocumentId('WO-1'), workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'not_started',
    scheduledScopeSnapshot: { estimatedUnitCount: 1 },
  };
  const duplicateInitial = {
    id: 'other-initial', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'pending',
    scheduledScopeSnapshot: { estimatedUnitCount: 1 },
  };
  const { prepare } = commandFixture({ seed: { ...baseSeed, workVisits: [deterministic, duplicateInitial] } });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-duplicate-initial' }),
    /more than one possible initial visit/,
  );
});

test('deterministic initial plus valid return history remains an idempotent replay', async () => {
  const deterministic = {
    id: initialVisitDocumentId('WO-1'), workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'pending',
    scheduledScopeSnapshot: { estimatedUnitCount: 1 },
  };
  const returnVisit = {
    id: 'return-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'pending',
    previousVisitId: initialVisitDocumentId('WO-1'), scheduledScopeSnapshot: { estimatedUnitCount: 1 },
  };
  const { prepare } = commandFixture({ seed: { ...baseSeed, workVisits: [deterministic, returnVisit] } });
  const result = await prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-existing-with-return' });
  assert.equal(result.replayed, true);
  assert.equal(result.visit.id, initialVisitDocumentId('WO-1'));
});

test('return-only historical WorkVisit cannot be silently adopted as the initial visit', async () => {
  const returnVisit = {
    id: 'legacy-return', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', appointmentId: 'APT-1',
    status: 'pending', previousVisitId: 'missing-initial', scheduledScopeSnapshot: { appointmentId: 'APT-1', estimatedUnitCount: 0 },
  };
  const { store, auditEvents, prepare } = commandFixture({ seed: { ...baseSeed, workVisits: [returnVisit] } });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-return-only' }),
    /cannot be resolved to one unambiguous initial visit/,
  );
  assert.equal(store.all('workVisits').length, 1);
  assert.equal(store.get('workVisits', initialVisitDocumentId('WO-1')), undefined);
  assert.equal(auditEvents.length, 0);
});

test('existing deterministic visit with conflicting identity fails closed', async () => {
  const conflicting = {
    id: initialVisitDocumentId('WO-1'), workOrderId: 'WO-1', clientId: 'OTHER', propertyId: 'PROPERTY-1', status: 'not_started',
  };
  const { prepare } = commandFixture({ seed: { ...baseSeed, workVisits: [conflicting] } });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-WO-1-conflict' }),
    /different Customer/,
  );
});

test('malformed existing visit status fails closed instead of being reopened as scheduled', async () => {
  const malformed = {
    id: initialVisitDocumentId('WO-1'), workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'mystery_state',
  };
  const { prepare } = commandFixture({ seed: { ...baseSeed, workVisits: [malformed] } });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-WO-1-malformed' }),
    /Unknown persisted Work Visit status/,
  );
});

test('helper cannot prepare a WorkVisit', async () => {
  const { store, prepare } = commandFixture({
    resolveAssignment: async () => assignment({ responsibility: 'helper', source: 'daily_assignment' }),
  });
  await assert.rejects(
    () => prepare({ identity: identity('staff-helper'), workOrderId: 'WO-1', requestId: 'prepare-helper-001' }),
    /cannot prepare a Work Visit/,
  );
  assert.equal(store.all('workVisits').length, 0);
});

test('van-only compatibility assignment remains read-only for preparation', async () => {
  const { store, prepare } = commandFixture({
    resolveAssignment: async () => assignment({ responsibility: 'technician', source: 'profile_van_fallback', readOnly: true }),
  });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-van-only' }),
    /cannot prepare a Work Visit/,
  );
  assert.equal(store.all('workVisits').length, 0);
});

test('unassigned technician cannot prepare another team WorkVisit', async () => {
  const { store, prepare } = commandFixture({
    resolveAssignment: async () => assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  });
  await assert.rejects(
    () => prepare({ identity: identity('staff-other'), workOrderId: 'WO-1', requestId: 'prepare-other-team' }),
    /not assigned/,
  );
  assert.equal(store.all('workVisits').length, 0);
});

test('CRM relationship mismatch aborts preparation before any write or audit', async () => {
  const seed = structuredClone(baseSeed);
  seed.properties[0].clientId = 'OTHER-CLIENT';
  const { store, auditEvents, prepare } = commandFixture({ seed });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-bad-property' }),
    /Property does not belong/,
  );
  assert.equal(store.all('workVisits').length, 0);
  assert.equal(auditEvents.length, 0);
});

test('audit failure aborts the transaction and leaves no canonical WorkVisit behind', async () => {
  const { store, prepare } = commandFixture({
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });
  await assert.rejects(
    () => prepare({ identity: identity(), workOrderId: 'WO-1', requestId: 'prepare-audit-fail' }),
    /audit unavailable/,
  );
  assert.equal(store.all('workVisits').length, 0);
});

test('command cannot be constructed without a transaction-scoped audit writer', () => {
  const { db } = createDb(baseSeed);
  assert.throws(
    () => createPrepareWorkVisitCommand({ db, resolveAssignment: async () => assignment() }),
    /appendAuditInTransaction is required/,
  );
});

test('canonical projection keeps historical Legacy aliases out of the domain surface', () => {
  const projected = projectCanonicalWorkVisit({
    id: 'visit-WO-1', workOrderId: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    status: 'on_the_way', participatingStaffIds: [], requiresSecondVisit: false,
    scheduledScopeSnapshot: { appointmentId: 'APT-1', capturedAt: '2026-08-24T10:00:00Z', estimatedUnitCount: 0, workLines: [] },
    createdAt: '2026-08-24T10:00:00Z', createdByUserId: 'u1', updatedAt: '2026-08-24T10:00:00Z', updatedByUserId: 'u1', version: 1,
  });
  assert.equal(projected.status, 'en_route');
  assert.equal(projected.customerId, 'CLIENT-1');
  assert.equal('clientId' in projected, false);
  assert.equal('not_started' in projected, false);
});
