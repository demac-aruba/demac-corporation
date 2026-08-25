const assert = require('node:assert/strict');
const test = require('node:test');
const { createFieldOperationsApi } = require('./fieldOperationsAuthority');

function authDb(profile) {
  return {
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc(uid) {
          return {
            async get() {
              return { id: uid, exists: profile !== undefined, data: () => profile };
            },
          };
        },
      };
    },
  };
}

function request(data = {}, token = 'valid-token') {
  const authorization = token ? `Bearer ${token}` : '';
  return {
    method: 'POST',
    headers: { authorization },
    get(name) { return String(name).toLowerCase() === 'authorization' ? authorization : ''; },
    body: { action: 'register_visit_asset', data },
  };
}

function registeredEquipment() {
  return {
    id: 'AC-REGISTERED-1',
    locationLabel: 'Cuarto principal',
    systemType: 'Split wall mounted',
    brand: 'Adina',
    btu: 12000,
    refrigerant: 'R32',
    voltage: '220V',
    active: true,
    evidenceIds: {
      equipment_reference: 'EVID-REF',
      indoor_nameplate: 'EVID-IN',
      outdoor_nameplate: 'EVID-OUT',
    },
    createdAt: '2026-08-25T19:15:00.000Z',
    createdBy: 'uid-1',
    updatedAt: '2026-08-25T19:15:00.000Z',
    updatedBy: 'uid-1',
    version: 1,
  };
}

test('register_visit_asset authenticates, sanitizes input and composes CRM registration with registered_on_site VisitAsset attach', async () => {
  const registrationCalls = [];
  const attachCalls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async (token) => {
      assert.equal(token, 'valid-token');
      return { uid: 'uid-1', role: 'super_admin' };
    },
    registerEquipmentSystem: async (input) => {
      registrationCalls.push(input);
      return {
        success: true,
        replayed: false,
        equipment: registeredEquipment(),
        evidence: [
          { id: 'EVID-REF', visitId: 'visit-WO-1', assetId: 'AC-REGISTERED-1', evidenceKind: 'equipment_reference' },
          { id: 'EVID-IN', visitId: 'visit-WO-1', assetId: 'AC-REGISTERED-1', evidenceKind: 'indoor_nameplate' },
          { id: 'EVID-OUT', visitId: 'visit-WO-1', assetId: 'AC-REGISTERED-1', evidenceKind: 'outdoor_nameplate' },
        ],
        auditEventIds: ['FE-REF', 'FE-IN', 'FE-OUT', 'FE-REGISTER'],
        allowedActions: ['read', 'execute', 'asset.add'],
      };
    },
    attachExistingVisitAsset: async (input) => {
      attachCalls.push(input);
      return {
        success: true,
        replayed: false,
        visitAsset: {
          id: 'VA-1', visitId: 'visit-WO-1', assetId: 'AC-REGISTERED-1', sequence: 1,
          locationLabel: 'Cuarto principal', source: 'registered_on_site', status: 'identified', addedOnSite: true,
          createdAt: '2026-08-25T19:15:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T19:15:00.000Z', updatedBy: 'uid-1', version: 1,
        },
        allowedActions: ['read', 'execute', 'asset.add'],
        auditEventId: 'FE-ATTACH',
      };
    },
  });

  const result = await api.handle(request({
    visitId: ' visit-WO-1 ',
    requestId: ' register-001 ',
    locationLabel: ' Cuarto principal ',
    systemType: ' Split wall mounted ',
    brand: ' Adina ',
    btu: 12000,
    refrigerant: ' R32 ',
    voltage: ' 220V ',
    qrCode: ' ',
    evidencePaths: {
      equipment_reference: ' field-evidence/visit-WO-1/register-001/equipment_reference.jpg ',
      indoor_nameplate: ' field-evidence/visit-WO-1/register-001/indoor_nameplate.jpg ',
      outdoor_nameplate: ' field-evidence/visit-WO-1/register-001/outdoor_nameplate.jpg ',
      extra: 'should-not-pass',
    },
    customerId: 'CLIENT-OTHER',
    propertyId: 'PROPERTY-OTHER',
    assetId: 'AC-CLIENT-FORCED',
    active: false,
    status: 'completed',
    components: [{ brand: 'CLIENT-FORCED' }],
    contentType: 'image/jpeg',
    sizeBytes: 1,
    evidenceIds: { equipment_reference: 'CLIENT-FORCED' },
    allowedActions: ['price.override'],
    source: 'existing_asset',
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(result.body.registrationReplayed, false);
  assert.equal(result.body.attachReplayed, false);
  assert.equal(result.body.replayed, false);
  assert.equal(result.body.equipment.id, 'AC-REGISTERED-1');
  assert.equal(result.body.visitAsset.source, 'registered_on_site');
  assert.deepEqual(result.body.auditEventIds, ['FE-REF', 'FE-IN', 'FE-OUT', 'FE-REGISTER', 'FE-ATTACH']);

  assert.equal(registrationCalls.length, 1);
  const registration = registrationCalls[0];
  assert.equal(registration.identity.uid, 'uid-1');
  assert.equal(registration.identity.staffId, 'staff-1');
  assert.equal(registration.identity.role, 'technician');
  assert.equal(registration.visitId, 'visit-WO-1');
  assert.equal(registration.requestId, 'register-001');
  assert.equal(registration.locationLabel, 'Cuarto principal');
  assert.equal(registration.systemType, 'Split wall mounted');
  assert.equal(registration.brand, 'Adina');
  assert.equal(registration.btu, 12000);
  assert.equal(registration.refrigerant, 'R32');
  assert.equal(registration.voltage, '220V');
  assert.equal(registration.qrCode, '', 'QR must remain optional and blank must be forwarded as blank');
  assert.deepEqual(registration.evidencePaths, {
    equipment_reference: 'field-evidence/visit-WO-1/register-001/equipment_reference.jpg',
    indoor_nameplate: 'field-evidence/visit-WO-1/register-001/indoor_nameplate.jpg',
    outdoor_nameplate: 'field-evidence/visit-WO-1/register-001/outdoor_nameplate.jpg',
  });
  assert.deepEqual(Object.keys(registration).sort(), [
    'brand', 'btu', 'evidencePaths', 'identity', 'locationLabel', 'qrCode', 'refrigerant', 'requestId', 'systemType', 'visitId', 'voltage',
  ]);
  for (const forbidden of ['customerId', 'propertyId', 'assetId', 'active', 'status', 'components', 'contentType', 'sizeBytes', 'evidenceIds', 'allowedActions', 'source']) {
    assert.equal(forbidden in registration, false, `${forbidden} must never be forwarded from browser input`);
  }

  assert.equal(attachCalls.length, 1);
  assert.deepEqual(Object.keys(attachCalls[0]).sort(), ['assetId', 'identity', 'requestId', 'source', 'visitId']);
  assert.equal(attachCalls[0].assetId, 'AC-REGISTERED-1');
  assert.equal(attachCalls[0].visitId, 'visit-WO-1');
  assert.equal(attachCalls[0].requestId, 'register-001');
  assert.equal(attachCalls[0].source, 'registered_on_site');
});

test('registration replay followed by first successful attach reports the two saga phases honestly', async () => {
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    registerEquipmentSystem: async () => ({
      success: true,
      replayed: true,
      equipment: registeredEquipment(),
      evidence: [],
      allowedActions: ['asset.add'],
    }),
    attachExistingVisitAsset: async () => ({
      success: true,
      replayed: false,
      visitAsset: { id: 'VA-1', assetId: 'AC-REGISTERED-1', source: 'registered_on_site' },
      allowedActions: ['asset.add'],
      auditEventId: 'FE-ATTACH',
    }),
  });
  const result = await api.handle(request({ visitId: 'visit-WO-1', requestId: 'register-001' }));
  assert.equal(result.status, 200);
  assert.equal(result.body.registrationReplayed, true);
  assert.equal(result.body.attachReplayed, false);
  assert.equal(result.body.replayed, false, 'whole command is not a replay if attach was newly completed');
});

test('register_visit_asset requires both registration and existing VisitAsset attachment authorities', async () => {
  const identity = { operations: false };
  const missingRegistration = createFieldOperationsApi({
    db: { collection() { return {}; } },
    verifyIdToken: async () => ({ uid: 'unused' }),
    attachExistingVisitAsset: async () => ({ success: true }),
  });
  await assert.rejects(
    () => missingRegistration.execute({ action: 'register_visit_asset', data: {}, identity }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );

  const missingAttach = createFieldOperationsApi({
    db: { collection() { return {}; } },
    verifyIdToken: async () => ({ uid: 'unused' }),
    registerEquipmentSystem: async () => ({ success: true }),
  });
  await assert.rejects(
    () => missingAttach.execute({ action: 'register_visit_asset', data: {}, identity }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
});

test('registration handler configuration rejects non-function authorities', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      registerEquipmentSystem: {},
    }),
    /registerEquipmentSystem must be a function/,
  );
});
