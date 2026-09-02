const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRecordCustomerAcknowledgementCommand,
  projectCustomerAcknowledgement,
} = require('./fieldOperationsCustomerAcknowledgements');

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
  function matches(value, filter) {
    return filter.op === '==' && value?.[filter.field] === filter.expected;
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
      { id: 'ack', title: 'Customer acknowledgement', type: 'customer_acknowledgement', required: true },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 1 },
    ],
  };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service',
    origin: 'planned', requestedBy: 'office', status: 'in_progress', templateId: 'standard-report', templateVersion: 2, reportTemplateSnapshot: template(),
    reportSectionStatus: { ack: 'pending', photos: 'pending' }, startedAt: '2026-08-25T10:20:00.000Z', performedByStaffIds: ['staff-1'],
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
    fieldCustomerAcknowledgements: options.acknowledgements || [],
  });
  const events = [];
  const command = createRecordCustomerAcknowledgementCommand({
    db: store.db,
    now: () => '2026-08-25T10:30:00.000Z',
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { events.push(event); }),
  });
  return { store, events, command };
}

function input(overrides = {}) {
  return {
    identity: identity(), visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'ack',
    receiverName: 'Maria Customer', note: 'Report reviewed on site.', requestId: 'customer-ack-001', ...overrides,
  };
}

test('customer acknowledgement is immutable canonical evidence and completes its report section', async () => {
  const { store, events, command } = fixture();
  const result = await command(input());
  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.acknowledgement.receiverName, 'Maria Customer');
  assert.equal(result.acknowledgement.method, 'verbal');
  assert.equal(result.acknowledgement.version, 1);
  assert.equal(result.workInterventionVersion, 3);
  assert.equal(store.values('fieldCustomerAcknowledgements').length, 1);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.ack, 'completed');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'customer_report_acknowledged');
});

test('exact retry replays but a different correction is rejected as immutable evidence', async () => {
  const { store, events, command } = fixture();
  const first = await command(input());
  const replay = await command(input());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(store.values('fieldCustomerAcknowledgements').length, 1);
  assert.equal(events.length, 1);
  await assert.rejects(
    () => command(input({ receiverName: 'Other Person', requestId: 'customer-ack-002' })),
    (error) => error?.code === 'customer_acknowledgement_already_recorded' && error?.status === 409,
  );
});

test('customer acknowledgement requires exact frozen section and active execution', async () => {
  const wrongSection = fixture();
  await assert.rejects(() => wrongSection.command(input({ sectionId: 'photos' })), (error) => error?.code === 'report_section_type_mismatch');

  const inactiveVisit = fixture({ visit: visit({ status: 'on_site', startedAt: undefined }) });
  await assert.rejects(() => inactiveVisit.command(input()), (error) => error?.code === 'customer_acknowledgement_not_allowed');

  const inactiveIntervention = fixture({ intervention: intervention({ status: 'confirmed', startedAt: undefined, performedByStaffIds: [] }) });
  await assert.rejects(() => inactiveIntervention.command(input()), (error) => error?.code === 'customer_acknowledgement_not_allowed');
});

test('helper and read-only assignments cannot record customer decision evidence', async () => {
  for (const denied of [
    assignment({ responsibility: 'helper', source: 'dated_crew' }),
    assignment({ readOnly: true, source: 'profile_van_fallback' }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  ]) {
    const current = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(() => current.command(input({ requestId: `denied-${denied.source}` })), (error) => error?.code === 'permission_denied');
    assert.equal(current.store.values('fieldCustomerAcknowledgements').length, 0);
  }
});

test('audit failure rolls back acknowledgement and projection fails closed on identity/schema drift', async () => {
  const rollback = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
  await assert.rejects(() => rollback.command(input()), /audit unavailable/);
  assert.equal(rollback.store.values('fieldCustomerAcknowledgements').length, 0);
  assert.equal(rollback.store.get('workInterventions', 'WI-1').version, 2);
  assert.equal(rollback.store.get('workInterventions', 'WI-1').reportSectionStatus.ack, 'pending');

  const record = {
    id: 'CACK-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'ack', receiverName: 'Maria Customer', method: 'verbal',
    note: 'Reviewed', acknowledgedAt: '2026-08-25T10:30:00.000Z', recordedByStaffId: 'staff-1', requestId: 'request-001',
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1', version: 1,
  };
  assert.equal(projectCustomerAcknowledgement(record, { visitId: 'visit-WO-1', sectionId: 'ack' }).receiverName, 'Maria Customer');
  for (const patch of [{ method: 'signature' }, { receiverName: '' }, { acknowledgedAt: 'bad' }, { version: 2 }, { clientId: 'CLIENT-X' }]) {
    assert.throws(() => projectCustomerAcknowledgement({ ...record, ...patch }, { customerId: 'CLIENT-1' }));
  }
});
