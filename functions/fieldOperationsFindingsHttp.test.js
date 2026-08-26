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
    body: { action: 'add_report_finding', data },
  };
}

test('add_report_finding authenticates and forwards only governed finding inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1', role: 'super_admin' }),
    addFieldFinding: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        finding: {
          id: 'FIND-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', interventionId: 'WI-1',
          sectionId: 'findings', summary: 'Drain restriction observed',
          details: 'Drain pan contains standing water and slow discharge.', recommendation: 'Clean drain line and retest.',
          technicianStaffId: 'staff-1', observedAt: '2026-08-25T20:30:00.000Z',
          createdAt: '2026-08-25T20:30:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T20:30:00.000Z', updatedBy: 'uid-1', version: 1,
        },
        workInterventionVersion: 3,
        allowedActions: ['read', 'finding.add'],
      };
    },
  });

  const result = await api.handle(request({
    visitId: ' visit-WO-1 ', interventionId: ' WI-1 ', sectionId: ' findings ',
    summary: ' Drain restriction observed ',
    details: ' Drain pan contains standing water and slow discharge. ',
    recommendation: ' Clean drain line and retest. ', requestId: ' finding-001 ',
    assetId: 'AC-ATTACKER', visitAssetId: 'VA-ATTACKER', technicianStaffId: 'staff-attacker',
    observedAt: '2000-01-01T00:00:00.000Z', templateId: 'fake-template',
    reportSectionStatus: { findings: 'completed' }, allowedActions: ['price.override'],
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician');
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].interventionId, 'WI-1');
  assert.equal(calls[0].sectionId, 'findings');
  assert.equal(calls[0].summary, 'Drain restriction observed');
  assert.equal(calls[0].details, 'Drain pan contains standing water and slow discharge.');
  assert.equal(calls[0].recommendation, 'Clean drain line and retest.');
  assert.equal(calls[0].requestId, 'finding-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'details', 'identity', 'interventionId', 'recommendation', 'requestId', 'sectionId', 'summary', 'visitId',
  ]);
  for (const forbidden of ['assetId', 'visitAssetId', 'technicianStaffId', 'observedAt', 'templateId', 'reportSectionStatus', 'allowedActions']) {
    assert.equal(forbidden in calls[0], false);
  }
});

test('add_report_finding cannot be configured with a non-function authority', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      addFieldFinding: {},
    }),
    /addFieldFinding must be a function/,
  );
});