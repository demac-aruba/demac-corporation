const assert = require('node:assert/strict');
const test = require('node:test');
const { createTransitionWorkInterventionCommand } = require('./fieldOperationsInterventionMutation');

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
  function documentRef(name, id) { return { kind: 'document', collectionName: name, id }; }
  function queryRef(name, filters = []) {
    return {
      kind: 'query', collectionName: name, filters,
      where(field, op, expected) { return queryRef(name, [...filters, { field, op, expected }]); },
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
    fieldAuthorityVersion: 1,
    workOrderId: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1',
      capturedAt: '2026-08-25T10:00:00.000Z',
      estimatedUnitCount: 1,
      workLines: [{ id: 'line-standard', presetId: 'standard_service', label: 'Standard Service', quantity: 1, durationMinutes: 60 }],
    },
    status: 'in_progress',
    participatingStaffIds: ['staff-1'],
    requiresSecondVisit: false,
    arrivedAt: '2026-08-25T10:15:00.000Z',
    startedAt: '2026-08-25T10:20:00.000Z',
    createdAt: '2026-08-25T10:00:00.000Z',
    createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:20:00.000Z',
    updatedByUserId: 'uid-1',
    version: 4,
    ...overrides,
  };
}

function baseOrder(overrides = {}) {
  return {
    id: 'WO-1',
    appointmentId: 'APT-1',
    clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1',
    status: 'En proceso',
    date: '2026-08-25',
    technicianIds: ['staff-1'],
    ...overrides,
  };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1',
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

function service(overrides = {}) {
  return {
    id: 'service-standard',
    itemType: 'Servicio',
    name: '12K Standard Service',
    category: 'Maintenance',
    durationMinutes: 60,
    active: true,
    serviceDefinition: { version: 1, bookingCode: '12k_standard', duration: { minutes: 60 } },
    ...overrides,
  };
}

function serviceWithTemplate(overrides = {}) {
  return service({
    fieldExecutionDefinition: {
      version: 1,
      reportTemplate: {
        id: 'standard-service-report',
        name: 'Standard Service Report',
        version: 3,
        sections: [
          { id: 'condition', title: 'Condition', type: 'checklist', required: true },
          { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 2 },
        ],
      },
    },
    ...overrides,
  });
}

function identity(overrides = {}) {
  return {
    uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', email: 'tech@example.invalid',
    role: 'technician', operations: false, ...overrides,
  };
}

function assignment(overrides = {}) {
  return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false, ...overrides };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: options.visits || [options.visit || baseVisit()],
    workOrders: [options.order || baseOrder()],
    workInterventions: [options.intervention || intervention()],
    services: options.services || [options.service || service()],
  });
  const auditEvents = [];
  let clock = 0;
  const times = options.times || ['2026-08-25T10:30:00.000Z', '2026-08-25T10:45:00.000Z'];
  const transition = createTransitionWorkInterventionCommand({
    db: store.db,
    now: () => times[Math.min(clock++, times.length - 1)],
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { auditEvents.push(event); }),
  });
  return { store, auditEvents, transition };
}

function input(overrides = {}) {
  return {
    identity: identity(),
    visitId: 'visit-WO-1',
    interventionId: 'WI-1',
    to: 'in_progress',
    expectedVersion: 1,
    note: '',
    requestId: 'intervention-start-001',
    ...overrides,
  };
}

test('confirmed intervention starts actual execution with performer, timestamp, version and audit', async () => {
  const { store, auditEvents, transition } = fixture();
  const beforeVisit = structuredClone(store.get('workVisits', 'visit-WO-1'));
  const beforeOrder = structuredClone(store.get('workOrders', 'WO-1'));
  const result = await transition(input());
  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.workIntervention.status, 'in_progress');
  assert.equal(result.workIntervention.version, 2);
  assert.equal(result.workIntervention.startedAt, '2026-08-25T10:30:00.000Z');
  assert.deepEqual(result.workIntervention.performedByStaffIds, ['staff-1']);
  assert.equal(result.workIntervention.completedAt, undefined);
  assert.deepEqual(store.get('workVisits', 'visit-WO-1'), beforeVisit);
  assert.deepEqual(store.get('workOrders', 'WO-1'), beforeOrder);
  assert.equal(auditEvents.length, 1);
  assert.deepEqual(auditEvents[0].before, { status: 'confirmed', version: 1 });
  assert.equal(auditEvents[0].after.status, 'in_progress');
});

test('starting execution freezes configured Service report template and initializes section status', async () => {
  const { store, auditEvents, transition } = fixture({ service: serviceWithTemplate() });
  const result = await transition(input());
  assert.equal(result.workIntervention.templateId, 'standard-service-report');
  assert.equal(result.workIntervention.templateVersion, 3);
  const stored = store.get('workInterventions', 'WI-1');
  assert.deepEqual(stored.reportTemplateSnapshot, {
    id: 'standard-service-report',
    name: 'Standard Service Report',
    serviceId: 'service-standard',
    version: 3,
    sections: [
      { id: 'condition', title: 'Condition', type: 'checklist', required: true },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 2 },
    ],
  });
  assert.deepEqual(stored.reportSectionStatus, { condition: 'pending', photos: 'pending' });
  assert.equal(auditEvents[0].after.templateId, 'standard-service-report');
  assert.equal(auditEvents[0].after.templateVersion, 3);
});

test('starting execution fails closed when canonical Service is missing or configured template is malformed', async () => {
  const missing = fixture({ services: [] });
  await assert.rejects(
    () => missing.transition(input({ requestId: 'missing-service' })),
    (error) => error?.code === 'service_not_available' && error?.status === 409,
  );
  assert.equal(missing.store.get('workInterventions', 'WI-1').status, 'confirmed');

  const malformed = fixture({ service: serviceWithTemplate({
    fieldExecutionDefinition: {
      version: 1,
      reportTemplate: { id: 'bad', name: 'Bad', version: 1, sections: [] },
    },
  }) });
  await assert.rejects(
    () => malformed.transition(input({ requestId: 'bad-template' })),
    (error) => error?.code === 'invalid_field_report_template' && error?.status === 409,
  );
  assert.equal(malformed.store.get('workInterventions', 'WI-1').status, 'confirmed');
});

test('started intervention completes only after execution and adds the resolving technician without erasing prior performers', async () => {
  const { store, auditEvents, transition } = fixture({
    intervention: intervention({
      status: 'in_progress',
      startedAt: '2026-08-25T10:25:00.000Z',
      performedByStaffIds: ['staff-2'],
      version: 2,
    }),
  });
  const result = await transition(input({
    to: 'completed', expectedVersion: 2, note: 'Service completed normally.', requestId: 'intervention-complete-001',
  }));
  assert.equal(result.workIntervention.status, 'completed');
  assert.equal(result.workIntervention.version, 3);
  assert.equal(result.workIntervention.completedAt, '2026-08-25T10:30:00.000Z');
  assert.equal(result.workIntervention.resultCode, 'completed');
  assert.equal(result.workIntervention.resultNotes, 'Service completed normally.');
  assert.deepEqual(result.workIntervention.performedByStaffIds, ['staff-2', 'staff-1']);
  assert.equal(auditEvents[0].after.status, 'completed');
  assert.equal(store.get('workInterventions', 'WI-1').lastExecutionTarget, 'completed');
});

test('pending part is a performed-work outcome and requires a reason', async () => {
  const started = intervention({
    status: 'in_progress', startedAt: '2026-08-25T10:25:00.000Z', performedByStaffIds: ['staff-1'], version: 2,
  });
  const { store, transition } = fixture({ intervention: started });
  await assert.rejects(
    () => transition(input({ to: 'pending_part', expectedVersion: 2, requestId: 'pending-no-note' })),
    (error) => error?.code === 'work_intervention_reason_required' && error?.status === 400,
  );
  assert.equal(store.get('workInterventions', 'WI-1').status, 'in_progress');

  const result = await transition(input({
    to: 'pending_part', expectedVersion: 2, note: 'Replacement capacitor required.', requestId: 'pending-part-001',
  }));
  assert.equal(result.workIntervention.status, 'pending_part');
  assert.equal(result.workIntervention.resultCode, 'pending_part');
  assert.equal(result.workIntervention.resultNotes, 'Replacement capacitor required.');
  assert.equal(result.workIntervention.completedAt, undefined);
});

test('confirmed work can be marked not performed on site without falsely recording a performer', async () => {
  const { store, transition } = fixture({
    visit: baseVisit({ status: 'on_site', startedAt: undefined, version: 3 }),
    order: baseOrder({ status: 'En el sitio' }),
  });
  const result = await transition(input({
    to: 'not_performed', note: 'Customer asked us not to service this unit.', requestId: 'not-performed-001',
  }));
  assert.equal(result.workIntervention.status, 'not_performed');
  assert.equal(result.workIntervention.startedAt, undefined);
  assert.equal(result.workIntervention.completedAt, undefined);
  assert.deepEqual(result.workIntervention.performedByStaffIds, []);
  assert.equal(result.workIntervention.resultCode, 'not_performed');
  assert.equal(result.workIntervention.resultNotes, 'Customer asked us not to service this unit.');
  assert.equal(store.get('workVisits', 'visit-WO-1').status, 'on_site');
});

test('completion cannot skip actual start and started work cannot be relabeled not performed', async () => {
  const { transition } = fixture();
  await assert.rejects(
    () => transition(input({ to: 'completed', requestId: 'skip-start-001' })),
    (error) => error?.code === 'work_intervention_transition_not_allowed' && error?.status === 409,
  );

  const startedFixture = fixture({
    intervention: intervention({ status: 'in_progress', startedAt: '2026-08-25T10:25:00.000Z', performedByStaffIds: ['staff-1'], version: 2 }),
  });
  await assert.rejects(
    () => startedFixture.transition(input({ to: 'not_performed', expectedVersion: 2, note: 'No work.', requestId: 'started-not-performed' })),
    (error) => error?.code === 'work_intervention_transition_not_allowed' && error?.status === 409,
  );
});

test('intervention execution is unavailable before the WorkVisit enters in progress', async () => {
  const { store, transition } = fixture({
    visit: baseVisit({ status: 'on_site', startedAt: undefined, version: 3 }),
    order: baseOrder({ status: 'En el sitio' }),
  });
  await assert.rejects(
    () => transition(input()),
    (error) => error?.code === 'work_intervention_transition_not_allowed' && error?.details?.visitStatus === 'on_site',
  );
  assert.equal(store.get('workInterventions', 'WI-1').status, 'confirmed');
});

test('helper, read-only fallback and unassigned principals cannot transition intervention execution', async () => {
  for (const denied of [
    assignment({ responsibility: 'helper' }),
    assignment({ readOnly: true, source: 'profile_van_fallback' }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned' }),
  ]) {
    const { store, transition } = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(
      () => transition(input({ requestId: `denied-${denied.source}` })),
      (error) => error?.code === 'permission_denied' && error?.status === 403,
    );
    assert.equal(store.get('workInterventions', 'WI-1').status, 'confirmed');
  }
});

test('stale expectedVersion fails closed and exact retry is idempotent only for the same request', async () => {
  const { store, auditEvents, transition } = fixture();
  const first = await transition(input());
  const replay = await transition(input());
  assert.equal(first.workIntervention.version, 2);
  assert.equal(replay.replayed, true);
  assert.equal(store.commits[1].length, 0);
  assert.equal(auditEvents.length, 1);

  await assert.rejects(
    () => transition(input({ requestId: 'different-request-same-target' })),
    (error) => error?.code === 'work_intervention_transition_already_applied' && error?.status === 409,
  );

  await assert.rejects(
    () => transition(input({ to: 'completed', expectedVersion: 1, requestId: 'stale-complete' })),
    (error) => error?.code === 'version_conflict' && error?.status === 409,
  );
});

test('audit failure rolls back intervention mutation including report-template snapshot', async () => {
  const { store, transition } = fixture({
    service: serviceWithTemplate(),
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });
  await assert.rejects(() => transition(input()), /audit unavailable/);
  const stored = store.get('workInterventions', 'WI-1');
  assert.equal(stored.status, 'confirmed');
  assert.equal(stored.version, 1);
  assert.equal(stored.startedAt, undefined);
  assert.equal(stored.reportTemplateSnapshot, undefined);
});