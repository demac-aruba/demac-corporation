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
              return {
                id: uid,
                exists: profile !== undefined,
                data: () => profile,
              };
            },
          };
        },
      };
    },
  };
}

function request({ token = 'valid-token', data = {} } = {}) {
  const authorization = token ? `Bearer ${token}` : '';
  return {
    method: 'POST',
    headers: { authorization },
    get(name) { return String(name).toLowerCase() === 'authorization' ? authorization : ''; },
    body: { action: 'create_additional_intervention', data },
  };
}

test('create_additional_intervention authenticates and forwards only governed additional-work inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async (token) => {
      assert.equal(token, 'valid-token');
      return { uid: 'uid-1', role: 'super_admin' };
    },
    createAdditionalWorkIntervention: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        scopeChange: {
          id: 'SC-1',
          visitId: 'visit-WO-1',
          visitAssetId: 'VA-1',
          interventionId: 'WI-1',
          origin: 'technician_discovered_additional_need',
          reason: 'Condensate drain repair is also required.',
          requestedAt: '2026-08-25T13:00:00.000Z',
          createdAt: '2026-08-25T13:00:00.000Z',
          createdBy: 'uid-1',
          updatedAt: '2026-08-25T13:00:00.000Z',
          updatedBy: 'uid-1',
          version: 1,
        },
        workIntervention: {
          id: 'WI-1',
          visitId: 'visit-WO-1',
          visitAssetId: 'VA-1',
          assetId: 'AC-1',
          serviceCatalogItemId: 'service-repair',
          interventionType: 'Drain Repair',
          origin: 'added_on_site_technician_discovery',
          requestedBy: 'technician',
          status: 'pending_authorization',
          scopeChangeId: 'SC-1',
          performedByStaffIds: [],
          createdAt: '2026-08-25T13:00:00.000Z',
          createdBy: 'uid-1',
          updatedAt: '2026-08-25T13:00:00.000Z',
          updatedBy: 'uid-1',
          version: 1,
        },
        allowedActions: ['read', 'execute', 'intervention.add'],
      };
    },
  });

  const result = await api.handle(request({
    data: {
      visitId: ' visit-WO-1 ',
      visitAssetId: ' VA-1 ',
      serviceCatalogItemId: ' service-repair ',
      origin: ' technician_discovered_additional_need ',
      reason: ' Condensate drain repair is also required. ',
      requestId: ' additional-intervention-001 ',
      status: 'completed',
      assetId: 'AC-OTHER',
      approved: true,
      customerApproved: true,
      resolvedAt: '2026-08-25T13:01:00.000Z',
      customerId: 'CLIENT-OTHER',
      allowedActions: ['price.override', 'review'],
    },
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(result.body.workIntervention.status, 'pending_authorization');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician', 'governed profile role must override token role claims');
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].visitAssetId, 'VA-1');
  assert.equal(calls[0].serviceCatalogItemId, 'service-repair');
  assert.equal(calls[0].origin, 'technician_discovered_additional_need');
  assert.equal(calls[0].reason, 'Condensate drain repair is also required.');
  assert.equal(calls[0].requestId, 'additional-intervention-001');

  const forwardedKeys = Object.keys(calls[0]).sort();
  assert.deepEqual(forwardedKeys, [
    'identity',
    'origin',
    'reason',
    'requestId',
    'serviceCatalogItemId',
    'visitAssetId',
    'visitId',
  ]);
  assert.equal('status' in calls[0], false);
  assert.equal('approved' in calls[0], false);
  assert.equal('customerApproved' in calls[0], false);
  assert.equal('resolvedAt' in calls[0], false);
  assert.equal('allowedActions' in calls[0], false);
  assert.equal('assetId' in calls[0], false);
  assert.equal('customerId' in calls[0], false);
});

test('additional intervention handler cannot be configured with a non-function authority', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      createAdditionalWorkIntervention: {},
    }),
    /createAdditionalWorkIntervention must be a function/,
  );
});
