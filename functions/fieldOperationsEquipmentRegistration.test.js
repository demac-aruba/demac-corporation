const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRegisterEquipmentSystemCommand,
  normalizeRegistrationInput,
  projectRegisteredEquipment,
} = require('./fieldOperationsEquipmentRegistration');

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
  function documentRef(collectionName, id) {
    return { kind: 'document', collectionName, id };
  }
  function queryRef(collectionName, filters = []) {
    return {
      kind: 'query', collectionName, filters,
      where(field, op, expected) {
        assert.equal(op, '==');
        return queryRef(collectionName, [...filters, { field, expected }]);
      },
    };
  }
  const db = {
    collection(name) {
      return {
        doc(id) { return documentRef(name, id); },
        where(field, op, expected) {
          assert.equal(op, '==');
          return queryRef(name, [{ field, expected }]);
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
                .filter(([, value]) => target.filters.every((filter) => value?.[filter.field] === filter.expected))
                .map(([id, value]) => snapshot(id, value)),
            };
          }
          return snapshot(target.id, values.get(target.id));
        },
        create(ref, value) {
          if (ensure(ref.collectionName).has(ref.id)) throw new Error(`Document already exists: ${ref.collectionName}/${ref.id}`);
          writes.push({ ref, value: structuredClone(value) });
        },
      };
      const result = await callback(transaction);
      for (const write of writes) ensure(write.ref.collectionName).set(write.ref.id, structuredClone(write.value));
      return result;
    },
  };
  return {
    db,
    all(name) { return [...ensure(name).values()]; },
    get(name, id) { return ensure(name).get(id); },
    set(name, id, value) { ensure(name).set(id, structuredClone(value)); },
  };
}

function visit(overrides = {}) {
  return {
    id: 'visit-WO-1', fieldAuthorityVersion: 1, workOrderId: 'WO-1', appointmentId: 'APT-1',
    clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    scheduledScopeSnapshot: { appointmentId: 'APT-1', capturedAt: '2026-08-25T10:00:00.000Z', estimatedUnitCount: 1, workLines: [] },
    status: 'on_site', participatingStaffIds: ['staff-1'], requiresSecondVisit: false,
    arrivedAt: '2026-08-25T10:15:00.000Z', createdAt: '2026-08-25T10:00:00.000Z', createdByUserId: 'uid-1',
    updatedAt: '2026-08-25T10:15:00.000Z', updatedByUserId: 'uid-1', version: 3,
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1', status: 'En el sitio',
    date: '2026-08-25', technicianIds: ['staff-1'], airConditionerCount: 1,
    ...overrides,
  };
}

function identity() {
  return { uid: 'uid-1', staffId: 'staff-1', name: 'Tech One', role: 'technician', operations: false };
}

function assignment(overrides = {}) {
  return { assigned: true, responsibility: 'technician', source: 'direct_staff', readOnly: false, ...overrides };
}

function input(overrides = {}) {
  return {
    identity: identity(),
    visitId: 'visit-WO-1',
    requestId: 'register-equipment-001',
    locationLabel: 'Cuarto principal',
    systemType: 'Split wall mounted',
    brand: 'Adina',
    btu: 12000,
    refrigerant: 'R32',
    voltage: '220V',
    qrCode: '',
    evidencePaths: {
      equipment_reference: 'field-evidence/visit-WO-1/register-equipment-001/equipment_reference.jpg',
      indoor_nameplate: 'field-evidence/visit-WO-1/register-equipment-001/indoor_nameplate.jpg',
      outdoor_nameplate: 'field-evidence/visit-WO-1/register-equipment-001/outdoor_nameplate.jpg',
    },
    ...overrides,
  };
}

function fixture(options = {}) {
  const store = createDb({
    workVisits: options.visits || [options.visit || visit()],
    workOrders: [options.order || order()],
    clients: options.clients || [{ id: 'CLIENT-1', name: 'Customer', active: true }],
    properties: options.properties || [{ id: 'PROPERTY-1', clientId: 'CLIENT-1', active: true }],
    equipmentSystems: options.equipmentSystems || [],
    fieldEvidence: options.fieldEvidence || [],
  });
  const events = [];
  const verifiedPaths = [];
  const register = createRegisterEquipmentSystemCommand({
    db: store.db,
    resolveAssignment: options.resolveAssignment || (async () => assignment()),
    appendAuditInTransaction: options.appendAuditInTransaction || (async ({ event }) => { events.push(event); }),
    verifyStoredImage: options.verifyStoredImage || (async (storagePath) => {
      verifiedPaths.push(storagePath);
      return { contentType: 'image/jpeg', sizeBytes: 125000 };
    }),
    now: () => '2026-08-25T19:15:00.000Z',
  });
  return { store, events, verifiedPaths, register };
}

test('on-site registration requires technical identification and three photos but QR is explicitly optional', async () => {
  const { store, events, verifiedPaths, register } = fixture();
  const beforeVisit = structuredClone(store.get('workVisits', 'visit-WO-1'));
  const beforeOrder = structuredClone(store.get('workOrders', 'WO-1'));
  const result = await register(input());

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.equipment.qrCode, undefined, 'QR must remain optional until DEMAC has stickers');
  assert.equal(result.equipment.locationLabel, 'Cuarto principal');
  assert.equal(result.equipment.brand, 'Adina');
  assert.equal(result.equipment.btu, 12000);
  assert.equal(result.equipment.refrigerant, 'R32');
  assert.equal(result.equipment.voltage, '220V');
  assert.equal(result.evidence.length, 3);
  assert.deepEqual(result.evidence.map((item) => item.evidenceKind).sort(), ['equipment_reference', 'indoor_nameplate', 'outdoor_nameplate']);
  assert.equal(verifiedPaths.length, 3);
  assert.equal(store.all('equipmentSystems').length, 1);
  assert.equal(store.all('fieldEvidence').length, 3);
  assert.equal(store.get('equipmentSystems', result.equipment.id).qrCode, undefined);
  assert.deepEqual(store.get('workVisits', 'visit-WO-1'), beforeVisit, 'registering actual A/C must not rewrite planned WorkVisit truth');
  assert.deepEqual(store.get('workOrders', 'WO-1'), beforeOrder, 'registering actual A/C must not rewrite WorkOrder planned quantity');
  assert.deepEqual(events.map((event) => event.type), [
    'equipment_registration_evidence_recorded',
    'equipment_registration_evidence_recorded',
    'equipment_registration_evidence_recorded',
    'equipment_registered_on_site',
  ]);
});

test('optional QR is persisted when supplied and cannot be reused by another A/C registration', async () => {
  const first = fixture();
  const created = await first.register(input({ qrCode: 'DEMAC-QR-0001' }));
  assert.equal(created.equipment.qrCode, 'DEMAC-QR-0001');

  const existingRecord = first.store.get('equipmentSystems', created.equipment.id);
  const second = fixture({ equipmentSystems: [existingRecord] });
  await assert.rejects(
    () => second.register(input({ requestId: 'register-equipment-002', qrCode: 'DEMAC-QR-0001' })),
    (error) => error?.code === 'equipment_qr_already_assigned' && error?.status === 409,
  );
  assert.equal(second.store.all('equipmentSystems').length, 1);
});

test('required location, type, brand, BTU, refrigerant, voltage and every identification photo fail closed when missing', () => {
  const invalidInputs = [
    { locationLabel: '' },
    { systemType: '' },
    { brand: '' },
    { btu: '' },
    { refrigerant: '' },
    { voltage: '' },
    { evidencePaths: { equipment_reference: '', indoor_nameplate: 'x', outdoor_nameplate: 'x' } },
    { evidencePaths: { equipment_reference: 'x', indoor_nameplate: '', outdoor_nameplate: 'x' } },
    { evidencePaths: { equipment_reference: 'x', indoor_nameplate: 'x', outdoor_nameplate: '' } },
  ];
  for (const patch of invalidInputs) {
    assert.throws(() => normalizeRegistrationInput({ ...input(), ...patch }));
  }
  assert.doesNotThrow(() => normalizeRegistrationInput({ ...input(), qrCode: '' }));
});

test('registration is idempotent for exact replay and same request id with changed details conflicts', async () => {
  const { store, events, register } = fixture();
  const first = await register(input());
  const replay = await register(input());
  assert.equal(replay.replayed, true);
  assert.equal(replay.equipment.id, first.equipment.id);
  assert.equal(store.all('equipmentSystems').length, 1);
  assert.equal(store.all('fieldEvidence').length, 3);
  assert.equal(events.length, 4, 'replay must not append duplicate audit');

  await assert.rejects(
    () => register(input({ brand: 'Different Brand' })),
    (error) => error?.code === 'equipment_registration_request_conflict' && error?.status === 409,
  );
});

test('pre-arrival, helper, read-only fallback and unassigned principals are denied before storage is trusted', async () => {
  const preArrival = fixture({ visit: visit({ status: 'on_the_way' }) });
  await assert.rejects(
    () => preArrival.register(input()),
    (error) => error?.code === 'equipment_registration_not_allowed' && error?.status === 409,
  );
  assert.equal(preArrival.verifiedPaths.length, 0);

  for (const denied of [
    assignment({ responsibility: 'helper' }),
    assignment({ source: 'profile_van_fallback', readOnly: true }),
    assignment({ assigned: false, responsibility: null, source: 'unassigned', readOnly: true }),
  ]) {
    const blocked = fixture({ resolveAssignment: async () => denied });
    await assert.rejects(
      () => blocked.register(input()),
      (error) => error?.code === 'permission_denied' && error?.status === 403,
    );
    assert.equal(blocked.verifiedPaths.length, 0);
    assert.equal(blocked.store.all('equipmentSystems').length, 0);
  }
});

test('cross-visit evidence paths and missing/non-image Storage objects cannot create a CRM Asset', async () => {
  const wrongVisit = fixture();
  await assert.rejects(
    () => wrongVisit.register(input({ evidencePaths: {
      ...input().evidencePaths,
      equipment_reference: 'field-evidence/visit-OTHER/register-equipment-001/equipment_reference.jpg',
    } })),
    (error) => error?.code === 'invalid_equipment_evidence_path' && error?.status === 409,
  );
  assert.equal(wrongVisit.store.all('equipmentSystems').length, 0);

  const missing = fixture({ verifyStoredImage: async () => { throw new Error('not found'); } });
  await assert.rejects(
    () => missing.register(input()),
    (error) => error?.code === 'equipment_evidence_unavailable' && error?.status === 409,
  );
  assert.equal(missing.store.all('equipmentSystems').length, 0);

  const nonImage = fixture({ verifyStoredImage: async () => ({ contentType: 'application/pdf', sizeBytes: 1000 }) });
  await assert.rejects(
    () => nonImage.register(input()),
    (error) => error?.code === 'invalid_equipment_evidence' && error?.status === 409,
  );
  assert.equal(nonImage.store.all('equipmentSystems').length, 0);
});

test('CRM Property must remain canonical and belong to the Work Order customer', async () => {
  for (const properties of [
    [],
    [{ id: 'PROPERTY-1', clientId: 'CLIENT-OTHER', active: true }],
    [{ id: 'PROPERTY-1', clientId: 'CLIENT-1', active: false }],
  ]) {
    const { store, register } = fixture({ properties });
    await assert.rejects(() => register(input()), (error) => ['crm_identity_unavailable', 'crm_identity_conflict'].includes(error?.code));
    assert.equal(store.all('equipmentSystems').length, 0);
  }
});

test('audit failure rolls back CRM Asset and all FieldEvidence documents atomically', async () => {
  const { store, register } = fixture({
    appendAuditInTransaction: async () => { throw new Error('audit unavailable'); },
  });
  await assert.rejects(() => register(input()), /audit unavailable/);
  assert.equal(store.all('equipmentSystems').length, 0);
  assert.equal(store.all('fieldEvidence').length, 0);
});

test('persisted registered equipment projection fails closed on identity/schema/required technical corruption', async () => {
  const { store, register } = fixture();
  const result = await register(input({ qrCode: 'DEMAC-QR-0002' }));
  const valid = store.get('equipmentSystems', result.equipment.id);
  const expected = { visitId: 'visit-WO-1', workOrderId: 'WO-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1' };
  assert.equal(projectRegisteredEquipment(valid, expected).qrCode, 'DEMAC-QR-0002');
  for (const patch of [
    { fieldRegistrationVersion: 99 },
    { clientId: 'CLIENT-OTHER' },
    { propertyId: 'PROPERTY-OTHER' },
    { brand: '' },
    { btu: 0 },
    { refrigerant: '' },
    { voltage: '' },
    { active: false },
    { registrationEvidenceIds: {} },
  ]) {
    assert.throws(() => projectRegisteredEquipment({ ...valid, ...patch }, expected));
  }
});
