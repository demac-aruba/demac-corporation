const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createSetFieldFreeTextResponseCommand,
  projectFieldFreeTextResponse,
} = require('./fieldOperationsFreeTextResponses');

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}

function createDb(seed = {}) {
  const collections = new Map(Object.entries(seed).map(([name, values]) => [name, new Map(values.map((item) => [item.id, { ...item }]))]));
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
  function matches(value, filter) { return filter.op === '==' && value?.[filter.field] === filter.expected; }
  const db = {
    collection(name) {
      return {
        doc(id) { return documentRef(name, id); },
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
        update(ref, patch) {
          if (!ensure(ref.collectionName).has(ref.id)) throw new Error(`Missing document: ${ref.collectionName}/${ref.id}`);
          writes.push({ type: 'update', ref, patch: { ...patch } });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === 'create') ensure(write.ref.collectionName).set(write.ref.id, { ...write.value });
        else ensure(write.ref.collectionName).set(write.ref.id, { ...ensure(write.ref.collectionName).get(write.ref.id), ...write.patch });
      }
      return result;
    },
  };
  return { db, get: (name, id) => ensure(name).get(id), values: (name) => [...ensure(name).values()] };
}

function visit(overrides = {}) {
  return {
    id: 'visit-WO-1', fieldAuthorityVersion: 1, workOrderId: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: { appointmentId: 'APT-1', capturedAt: '2026-08-25T10:00:00.000Z', estimatedUnitCount: 1, workLines: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }] },
    status: 'in_progress', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
    arrivedAt: '2026-08-25T10:10:00.000Z', startedAt: '2026-08-25T10:15:00.000Z',
    createdAt: '2026-08-25T10:00:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:15:00.000Z', updatedByUserId: 'uid-1', version: 4,
    ...overrides,
  };
}

function order(overrides = {}) {
  return { id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'En proceso', date: '2026-08-25', technicianIds: ['staff-1'], ...overrides };
}

function template() {
  return {
    id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 2,
    sections: [
      { id: 'notes', title: 'Technical notes', type: 'free_text', required: true },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 1 },
    ],
  };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
    origin: 'planned', requestedBy: 'office', status: 'in_progress', templateId: 'standard-report', templateVersion: 2, reportTemplateSnapshot: template(),
    reportSectionStatus: { notes: 'pending', photos: 'pending' }, startedAt: '2026-08-25T10:20:00.000Z', performedByStaffIds: ['staff-1'],
    createdAt: '2026-08-25T10:18:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:20:00.000Z', updatedByUserId: 'uid-1', version: 2,
    ...overrides,
  };
}

function identity(overrides = {}) { return { uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', role: 'technician', operations: false, ...overrides }; }
function assignment(overrides = {}) { return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false, ...overrides }; }

function fixture(options = {}) {
  const store = createDb({
    workVisits: [options.visit || visit()],
    workOrders: [options.order || order()],
    workInterventions: [options.intervention || intervention()],
    fieldFreeTextResponses: options.responses || [],
  });
  const events = [];
  const command = createSetFieldFreeTextResponseCommand({
    db: store.db,
    now: () => '2026-08-25T10:30:00.000Z',
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { events.push(event); }),
  });
  return { store, events, command };
}

function input(overrides = {}) {
  return {
    identity: identity(), visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'notes',
    value: 'Drain and electrical connections checked.', expectedVersion: 0, requestId: 'free-text-001', ...overrides,
  };
}

test('free-text section stores one canonical versioned response and completes when non-empty', async () => {
  const { store, events, command } = fixture();
  const result = await command(input());
  assert.equal(result.response.value, 'Drain and electrical connections checked.');
  assert.equal(result.response.version, 1);
  assert.equal(result.sectionCompleted, true);
  assert.equal(result.workInterventionVersion, 3);
  assert.equal(store.values('fieldFreeTextResponses').length, 1);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.notes, 'completed');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'report_free_text_changed');
});

test('free-text correction updates the same response and clearing reopens the section', async () => {
  const { store, command } = fixture();
  await command(input());
  const edited = await command(input({ value: 'Updated technical note.', expectedVersion: 1, requestId: 'free-text-002' }));
  assert.equal(edited.response.version, 2);
  assert.equal(store.values('fieldFreeTextResponses').length, 1);
  const cleared = await command(input({ value: '   ', expectedVersion: 2, requestId: 'free-text-003' }));
  assert.equal(cleared.response.value, '');
  assert.equal(cleared.response.version, 3);
  assert.equal(cleared.sectionCompleted, false);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.notes, 'in_progress');
});

test('same request replays exactly and stale devices fail closed', async () => {
  const { command } = fixture();
  const first = await command(input());
  const replay = await command(input());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    () => command(input({ value: 'Other device value', expectedVersion: 0, requestId: 'free-text-other' })),
    (error) => error?.code === 'version_conflict' && error?.details?.actualVersion === 1,
  );
});

test('free-text authority rejects wrong section type, inactive execution and read-only assignment', async () => {
  const wrongSection = fixture();
  await assert.rejects(() => wrongSection.command(input({ sectionId: 'photos' })), (error) => error?.code === 'report_section_type_mismatch');

  const inactive = fixture({ visit: visit({ status: 'on_site', startedAt: undefined }) });
  await assert.rejects(() => inactive.command(input()), (error) => error?.code === 'field_free_text_not_allowed');

  const denied = fixture({ resolveAssignment: async () => assignment({ readOnly: true, source: 'profile_van_fallback' }) });
  await assert.rejects(() => denied.command(input()), (error) => error?.code === 'permission_denied');
});

test('helper may edit free text, audit failure rolls back, and projection fails closed on drift', async () => {
  const helper = fixture({ resolveAssignment: async () => assignment({ responsibility: 'helper', source: 'dated_crew' }) });
  assert.equal((await helper.command(input({ requestId: 'helper-free-text' }))).success, true);

  const rollback = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
  await assert.rejects(() => rollback.command(input()), /audit unavailable/);
  assert.equal(rollback.store.values('fieldFreeTextResponses').length, 0);
  assert.equal(rollback.store.get('workInterventions', 'WI-1').version, 2);
  assert.equal(rollback.store.get('workInterventions', 'WI-1').reportSectionStatus.notes, 'pending');

  const record = {
    id: 'FTXT-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'notes', value: 'Canonical note',
    technicianStaffId: 'staff-1', respondedAt: '2026-08-25T10:30:00.000Z', lastRequestId: 'request-001',
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:30:00.000Z', updatedByUserId: 'uid-1', version: 1,
  };
  assert.equal(projectFieldFreeTextResponse(record, { visitId: 'visit-WO-1', sectionId: 'notes' }).value, 'Canonical note');
  for (const patch of [{ value: null }, { technicianStaffId: '' }, { respondedAt: 'bad' }, { version: 0 }, { clientId: 'CLIENT-X' }]) {
    assert.throws(() => projectFieldFreeTextResponse({ ...record, ...patch }, { customerId: 'CLIENT-1' }));
  }
});
