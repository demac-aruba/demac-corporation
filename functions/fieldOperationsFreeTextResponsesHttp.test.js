const assert = require('node:assert/strict');
const test = require('node:test');
const { createFieldOperationsApi } = require('./fieldOperationsAuthority');

function authDb(profile) {
  return {
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc(uid) {
          return { async get() { return { id: uid, exists: profile !== undefined, data: () => profile }; } };
        },
      };
    },
  };
}

function request(data, token = 'valid-token') {
  const authorization = token ? `Bearer ${token}` : '';
  return {
    method: 'POST', headers: { authorization },
    get(name) { return String(name).toLowerCase() === 'authorization' ? authorization : ''; },
    body: { action: 'set_report_free_text', data },
  };
}

test('set_report_free_text authenticates and forwards only governed report inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1', role: 'super_admin' }),
    setFieldFreeTextResponse: async (input) => {
      calls.push(input);
      return {
        success: true, replayed: false,
        response: {
          id: 'FTXT-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
          sectionId: 'notes', value: 'Technical note', technicianStaffId: 'staff-1',
          respondedAt: '2026-08-26T10:30:00.000Z', createdAt: '2026-08-26T10:30:00.000Z', createdBy: 'uid-1',
          updatedAt: '2026-08-26T10:30:00.000Z', updatedBy: 'uid-1', version: 1,
        },
        sectionCompleted: true, workInterventionVersion: 3, allowedActions: ['read', 'report.edit'],
      };
    },
  });

  const result = await api.handle(request({
    visitId: ' visit-WO-1 ', interventionId: ' WI-1 ', sectionId: ' notes ', value: ' Technical note ',
    expectedVersion: 0, requestId: ' free-text-001 ',
    assetId: 'AC-ATTACKER', visitAssetId: 'VA-ATTACKER', technicianStaffId: 'staff-attacker',
    respondedAt: '2000-01-01T00:00:00.000Z', templateId: 'fake-template', sectionCompleted: false,
    reportSectionStatus: { notes: 'completed' }, allowedActions: ['price.override'],
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician');
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].interventionId, 'WI-1');
  assert.equal(calls[0].sectionId, 'notes');
  assert.equal(calls[0].value, ' Technical note ');
  assert.equal(calls[0].expectedVersion, 0);
  assert.equal(calls[0].requestId, 'free-text-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'expectedVersion', 'identity', 'interventionId', 'requestId', 'sectionId', 'value', 'visitId',
  ]);
  for (const forbidden of ['assetId', 'visitAssetId', 'technicianStaffId', 'respondedAt', 'templateId', 'sectionCompleted', 'reportSectionStatus', 'allowedActions']) {
    assert.equal(forbidden in calls[0], false);
  }
});

test('set_report_free_text cannot be configured with a non-function authority', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      setFieldFreeTextResponse: {},
    }),
    /setFieldFreeTextResponse must be a function/,
  );
});
