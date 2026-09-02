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

function request(data, token = 'valid-token') {
  const authorization = token ? `Bearer ${token}` : '';
  return {
    method: 'POST',
    headers: { authorization },
    get(name) { return String(name).toLowerCase() === 'authorization' ? authorization : ''; },
    body: { action: 'set_report_checklist_item', data },
  };
}

test('set_report_checklist_item authenticates and forwards only governed checklist inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1', role: 'super_admin' }),
    setFieldChecklistItem: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        response: {
          id: 'CHECK-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
          sectionId: 'condition', itemId: 'filter-clean', checked: true, technicianStaffId: 'staff-1',
          respondedAt: '2026-08-25T20:30:00.000Z', createdAt: '2026-08-25T20:30:00.000Z', createdBy: 'uid-1',
          updatedAt: '2026-08-25T20:30:00.000Z', updatedBy: 'uid-1', version: 1,
        },
        sectionCompleted: false,
        workInterventionVersion: 3,
        allowedActions: ['read', 'report.edit'],
      };
    },
  });

  const result = await api.handle(request({
    visitId: ' visit-WO-1 ', interventionId: ' WI-1 ', sectionId: ' condition ', itemId: ' filter-clean ',
    checked: true, expectedVersion: 0, requestId: ' checklist-001 ',
    label: 'ATTACKER LABEL', assetId: 'AC-ATTACKER', visitAssetId: 'VA-ATTACKER', technicianStaffId: 'staff-attacker',
    respondedAt: '2000-01-01T00:00:00.000Z', templateId: 'fake-template', sectionCompleted: true,
    reportSectionStatus: { condition: 'completed' }, allowedActions: ['price.override'],
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician');
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].interventionId, 'WI-1');
  assert.equal(calls[0].sectionId, 'condition');
  assert.equal(calls[0].itemId, 'filter-clean');
  assert.equal(calls[0].checked, true);
  assert.equal(calls[0].expectedVersion, 0);
  assert.equal(calls[0].requestId, 'checklist-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'checked', 'expectedVersion', 'identity', 'interventionId', 'itemId', 'requestId', 'sectionId', 'visitId',
  ]);
  for (const forbidden of ['label', 'assetId', 'visitAssetId', 'technicianStaffId', 'respondedAt', 'templateId', 'sectionCompleted', 'reportSectionStatus', 'allowedActions']) {
    assert.equal(forbidden in calls[0], false);
  }
});

test('set_report_checklist_item cannot be configured with a non-function authority', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      setFieldChecklistItem: {},
    }),
    /setFieldChecklistItem must be a function/,
  );
});