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
    body: { action: 'transition_intervention', data },
  };
}

test('transition_intervention authenticates and forwards only governed execution-transition inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1', role: 'super_admin' }),
    transitionWorkIntervention: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        workIntervention: {
          id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1',
          plannedWorkLineId: 'line-standard', serviceCatalogItemId: 'service-standard',
          interventionType: '12K Standard Service', origin: 'planned', requestedBy: 'office',
          status: 'in_progress', startedAt: '2026-08-25T20:00:00.000Z', performedByStaffIds: ['staff-1'],
          createdAt: '2026-08-25T19:55:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T20:00:00.000Z', updatedBy: 'uid-1', version: 2,
        },
        allowedActions: ['read', 'execute', 'intervention.complete'],
      };
    },
  });

  const result = await api.handle(request({
    visitId: ' visit-WO-1 ',
    interventionId: ' WI-1 ',
    to: ' in_progress ',
    expectedVersion: 1,
    note: ' ignored for start ',
    requestId: ' intervention-start-001 ',
    status: 'completed',
    performedByStaffIds: ['staff-attacker'],
    startedAt: '2000-01-01T00:00:00.000Z',
    completedAt: '2000-01-01T00:00:00.000Z',
    resultCode: 'fake',
    allowedActions: ['price.override'],
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician');
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].interventionId, 'WI-1');
  assert.equal(calls[0].to, 'in_progress');
  assert.equal(calls[0].expectedVersion, 1);
  assert.equal(calls[0].note, 'ignored for start');
  assert.equal(calls[0].requestId, 'intervention-start-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'expectedVersion', 'identity', 'interventionId', 'note', 'requestId', 'to', 'visitId',
  ]);
  for (const forbidden of ['status', 'performedByStaffIds', 'startedAt', 'completedAt', 'resultCode', 'allowedActions']) {
    assert.equal(forbidden in calls[0], false);
  }
});

test('transition_intervention cannot be configured with a non-function authority', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      transitionWorkIntervention: {},
    }),
    /transitionWorkIntervention must be a function/,
  );
});