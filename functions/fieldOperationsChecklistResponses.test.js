const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createSetFieldChecklistItemCommand,
  projectFieldChecklistResponse,
} = require('./fieldOperationsChecklistResponses');

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
      { id: 'condition', title: 'Condition', type: 'checklist', required: true, checklistItems: [{ id: 'filter-clean', label: 'Filter cleaned' }, { id: 'drain-clear', label: 'Drain clear' }] },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 1 },
    ],
  };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
    origin: 'planned', requestedBy: 'office', status: 'in_progress', templateId: 'standard-report', templateVersion: 2, reportTemplateSnapshot: template(),
    reportSectionStatus: { condition: 'pending', photos: 'pending' }, startedAt: '2026-08-25T10:20:00.000Z', performedByStaffIds: ['staff-1'],
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
    fieldChecklistResponses: options.responses || [],
  });
  const events = [];
  const command = createSetFieldChecklistItemCommand({
    db: store.db,
    now: () => '2026-08-25T10:30:00.000Z',
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { events.push(event); }),
  });
  return { store, events, command };
}

function input(overrides = {}) {
  return { identity: identity(), visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'condition', itemId: 'filter-clean', checked: true, expectedVersion: 0, requestId: 'check-filter-001', ...overrides };
}

test('checklist item state is canonical, audited and completes section only when every frozen item is checked', async () => {
  const { store, events, command } = fixture();
  const first = await command(input());
  assert.equal(first.response.checked, true);
  assert.equal(first.sectionCompleted, false);
  assert.equal(first.workInterventionVersion, 3);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.condition, 'in_progress');
  assert.equal(events.length, 1);

  const second = await command(input({ itemId: 'drain-clear', requestId: 'check-drain-001' }));
  assert.equal(second.sectionCompleted, true);
  assert.equal(second.workInterventionVersion, 4);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.condition, 'completed');
  assert.equal(store.values('fieldChecklistResponses').length, 2);
  assert.equal(events.length, 2);
});

test('checklist item can be corrected with response version and reopens section', async () => {
  const { store, command } = fixture();
  await command(input());
  await command(input({ itemId: 'drain-clear', requestId: 'check-drain-001' }));
  const changed = await command(input({ checked: false, expectedVersion: 1, requestId: 'uncheck-filter-001' }));
  assert.equal(changed.response.checked, false);
  assert.equal(changed.response.version, 2);
  assert.equal(changed.sectionCompleted, false);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.condition, 'in_progress');
});

test('same checklist request replays idempotently and stale device versions fail closed', async () => {
  const { command } = fixture();
  const first = await command(input());
  const replay = await command(input());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.workInterventionVersion, 3);
  await assert.rejects(
    () => command(input({ checked: false, expectedVersion: 0, requestId: 'different-request-001' })),
    (error) => error?.code === 'version_conflict' && error?.details?.actualVersion === 1,
  );
});

test('checklist authority rejects invented items, inactive execution and read-only assignments', async () => {
  const invented = fixture();
  await assert.rejects(() => invented.command(input({ itemId: 'invented', requestId: 'invented-item-001' })), (error) => error?.code === 'report_checklist_item_not_available');

  const inactive = fixture({ visit: visit({ status: 'on_site', startedAt: undefined }) });
  await assert.rejects(() => inactive.command(input()), (error) => error?.code === 'field_checklist_not_allowed');

  const denied = fixture({ resolveAssignment: async () => assignment({ readOnly: true, source: 'profile_van_fallback' }) });
  await assert.rejects(() => denied.command(input()), (error) => error?.code === 'permission_denied');
});

test('helper may edit checklist but audit failure rolls back response and report progress', async () => {
  const helper = fixture({ resolveAssignment: async () => assignment({ responsibility: 'helper', source: 'dated_crew' }) });
  assert.equal((await helper.command(input({ requestId: 'helper-check-001' }))).success, true);

  const rollback = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
  await assert.rejects(() => rollback.command(input()), /audit unavailable/);
  assert.equal(rollback.store.values('fieldChecklistResponses').length, 0);
  assert.equal(rollback.store.get('workInterventions', 'WI-1').version, 2);
  assert.equal(rollback.store.get('workInterventions', 'WI-1').reportSectionStatus.condition, 'pending');
});

test('persisted checklist projection fails closed on identity, checked state, timestamps and version', () => {
  const record = {
    id: 'CHECK-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'condition', itemId: 'filter-clean', checked: true,
    technicianStaffId: 'staff-1', respondedAt: '2026-08-25T10:30:00.000Z', lastRequestId: 'request-001',
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:30:00.000Z', updatedByUserId: 'uid-1', version: 1,
  };
  assert.equal(projectFieldChecklistResponse(record, { visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'condition', itemId: 'filter-clean' }).checked, true);
  for (const patch of [{ checked: 'yes' }, { technicianStaffId: '' }, { respondedAt: 'bad' }, { version: 0 }, { clientId: 'CLIENT-X' }]) {
    assert.throws(() => projectFieldChecklistResponse({ ...record, ...patch }, { customerId: 'CLIENT-1' }));
  }
});