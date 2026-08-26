const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAddFieldFindingCommand,
  projectFieldFinding,
} = require('./fieldOperationsFindings');

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
  return {
    db,
    get(name, id) { return ensure(name).get(id); },
    values(name) { return [...ensure(name).values()]; },
  };
}

function baseVisit(overrides = {}) {
  return {
    id: 'visit-WO-1', fieldAuthorityVersion: 1, workOrderId: 'WO-1', appointmentId: 'APT-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: {
      appointmentId: 'APT-1', capturedAt: '2026-08-25T10:00:00.000Z', estimatedUnitCount: 1,
      workLines: [{ id: 'line-standard', label: 'Standard Service', quantity: 1 }],
    },
    status: 'in_progress', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
    arrivedAt: '2026-08-25T10:10:00.000Z', startedAt: '2026-08-25T10:15:00.000Z',
    createdAt: '2026-08-25T10:00:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:15:00.000Z', updatedByUserId: 'uid-1', version: 4,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    status: 'En proceso', date: '2026-08-25', technicianIds: ['staff-1'], ...overrides,
  };
}

function reportTemplate() {
  return {
    id: 'standard-report', name: 'Standard Report', serviceId: 'service-standard', version: 2,
    sections: [
      { id: 'findings', title: 'Findings', type: 'findings', required: true },
      { id: 'photos', title: 'Photos', type: 'photos', required: true, minEvidenceCount: 1 },
    ],
  };
}

function intervention(overrides = {}) {
  return {
    id: 'WI-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1', plannedWorkLineId: 'line-standard',
    serviceCatalogItemId: 'service-standard', interventionType: 'Standard Service', origin: 'planned', requestedBy: 'office',
    status: 'in_progress', templateId: 'standard-report', templateVersion: 2, reportTemplateSnapshot: reportTemplate(),
    reportSectionStatus: { findings: 'pending', photos: 'pending' }, startedAt: '2026-08-25T10:20:00.000Z',
    performedByStaffIds: ['staff-1'], createdAt: '2026-08-25T10:18:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:20:00.000Z', updatedByUserId: 'uid-1', version: 2,
    ...overrides,
  };
}

function identity(overrides = {}) {
  return { uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', role: 'technician', operations: false, ...overrides };
}

function assignment(overrides = {}) {
  return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false, ...overrides };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: [options.visit || baseVisit()],
    workOrders: [options.order || order()],
    workInterventions: [options.intervention || intervention()],
    fieldFindings: options.findings || [],
  });
  const events = [];
  const command = createAddFieldFindingCommand({
    db: store.db,
    now: () => '2026-08-25T10:30:00.000Z',
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { events.push(event); }),
  });
  return { store, events, command };
}

function input(overrides = {}) {
  return {
    identity: identity(), visitId: 'visit-WO-1', interventionId: 'WI-1', sectionId: 'findings',
    summary: 'Evaporator coil heavily dirty',
    details: 'Visible dust buildup is restricting airflow across the evaporator coil.',
    recommendation: 'Perform deep cleaning before evaluating airflow again.',
    requestId: 'finding-001',
    ...overrides,
  };
}

test('finding is atomically linked to the exact report section and advances report progress', async () => {
  const { store, events, command } = fixture();
  const beforeVisit = structuredClone(store.get('workVisits', 'visit-WO-1'));
  const beforeOrder = structuredClone(store.get('workOrders', 'WO-1'));
  const result = await command(input());
  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.finding.summary, 'Evaporator coil heavily dirty');
  assert.equal(result.finding.technicianStaffId, 'staff-1');
  assert.equal(result.workInterventionVersion, 3);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.findings, 'in_progress');
  assert.equal(store.values('fieldFindings').length, 1);
  assert.deepEqual(store.get('workVisits', 'visit-WO-1'), beforeVisit);
  assert.deepEqual(store.get('workOrders', 'WO-1'), beforeOrder);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'field_finding_recorded');
});

test('finding requires meaningful summary/details but recommendation remains optional', async () => {
  const optional = fixture();
  const result = await optional.command(input({ recommendation: '', requestId: 'no-recommendation' }));
  assert.equal(result.finding.recommendation, undefined);

  for (const patch of [{ summary: 'x' }, { details: 'x' }]) {
    const current = fixture();
    await assert.rejects(() => current.command(input({ ...patch, requestId: `bad-${Object.keys(patch)[0]}` })));
    assert.equal(current.store.values('fieldFindings').length, 0);
  }
});

test('finding requires active execution and a findings report section', async () => {
  const wrongVisit = fixture({ visit: baseVisit({ status: 'on_site', startedAt: undefined }) });
  await assert.rejects(() => wrongVisit.command(input()), (error) => error?.code === 'field_finding_not_allowed');

  const wrongIntervention = fixture({ intervention: intervention({ status: 'completed', completedAt: '2026-08-25T10:25:00.000Z', resultCode: 'completed' }) });
  await assert.rejects(() => wrongIntervention.command(input()), (error) => error?.code === 'field_finding_not_allowed');

  const wrongSection = fixture();
  await assert.rejects(
    () => wrongSection.command(input({ sectionId: 'photos', requestId: 'wrong-section' })),
    (error) => error?.code === 'report_section_type_mismatch' && error?.details?.sectionType === 'photos',
  );
});

test('helper may record findings, but read-only and unassigned principals remain denied', async () => {
  const helper = fixture({ resolveAssignment: async () => assignment({ responsibility: 'helper', source: 'dated_crew' }) });
  assert.equal((await helper.command(input({ requestId: 'helper-finding' }))).success, true);

  for (const denied of [
    assignment({ readOnly: true, source: 'profile_van_fallback' }),
    assignment({ assigned: false, readOnly: true, responsibility: null, source: 'unassigned' }),
  ]) {
    const current = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(() => current.command(input({ requestId: `denied-${denied.source}` })), (error) => error?.code === 'permission_denied');
    assert.equal(current.store.values('fieldFindings').length, 0);
  }
});

test('finding request replay is idempotent only for exact content', async () => {
  const { store, events, command } = fixture();
  const first = await command(input());
  const replay = await command(input());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(store.values('fieldFindings').length, 1);
  assert.equal(store.get('workInterventions', 'WI-1').version, 3);
  assert.equal(events.length, 1);
  await assert.rejects(
    () => command(input({ details: 'Different technical detail' })),
    (error) => error?.code === 'field_finding_request_conflict' && error?.status === 409,
  );
});

test('audit failure rolls back finding and intervention report progress', async () => {
  const { store, command } = fixture({ appendAuditInTransaction: async () => { throw new Error('audit unavailable'); } });
  await assert.rejects(() => command(input()), /audit unavailable/);
  assert.equal(store.values('fieldFindings').length, 0);
  assert.equal(store.get('workInterventions', 'WI-1').version, 2);
  assert.equal(store.get('workInterventions', 'WI-1').reportSectionStatus.findings, 'pending');
});

test('persisted finding projection fails closed on identity, content, timestamps and version drift', () => {
  const record = {
    id: 'FIND-1', fieldAuthorityVersion: 1, visitId: 'visit-WO-1', workOrderId: 'WO-1', clientId: 'CLIENT-1',
    propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'findings',
    summary: 'Drain restriction observed', details: 'Drain pan contains standing water and slow discharge.',
    recommendation: 'Clean drain line and retest.', technicianStaffId: 'staff-1', observedAt: '2026-08-25T10:30:00.000Z',
    createdAt: '2026-08-25T10:30:00.000Z', createdByUserId: 'uid-1', updatedAt: '2026-08-25T10:30:00.000Z',
    updatedByUserId: 'uid-1', version: 1,
  };
  const expected = { visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1', sectionId: 'findings' };
  assert.equal(projectFieldFinding(record, expected).summary, 'Drain restriction observed');
  for (const patch of [
    { fieldAuthorityVersion: 2 }, { clientId: 'CLIENT-X' }, { summary: '' }, { details: '' },
    { technicianStaffId: '' }, { observedAt: 'not-a-date' }, { version: 0 },
  ]) {
    assert.throws(() => projectFieldFinding({ ...record, ...patch }, expected));
  }
});