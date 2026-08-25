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

function request({ token = 'valid-token', data = {} } = {}) {
  const authorization = token ? `Bearer ${token}` : '';
  return {
    method: 'POST',
    headers: { authorization },
    get(name) { return String(name).toLowerCase() === 'authorization' ? authorization : ''; },
    body: { action: 'record_additional_intervention_decision', data },
  };
}

test('record_additional_intervention_decision authenticates and forwards only governed customer-decision inputs', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async (token) => {
      assert.equal(token, 'valid-token');
      return { uid: 'uid-1', role: 'super_admin' };
    },
    recordAdditionalWorkDecision: async (input) => {
      calls.push(input);
      return {
        success: true,
        replayed: false,
        fieldApproval: {
          id: 'FA-1', visitId: 'visit-WO-1', status: 'approved', method: 'verbal',
          affected: [{ type: 'intervention', id: 'WI-1' }, { type: 'scope_change', id: 'SC-1' }],
          receiverName: 'Maria Customer', decidedAt: '2026-08-25T14:00:00.000Z', technicianStaffId: 'staff-1',
          createdAt: '2026-08-25T14:00:00.000Z', createdBy: 'uid-1', updatedAt: '2026-08-25T14:00:00.000Z', updatedBy: 'uid-1', version: 1,
        },
        scopeChange: {
          id: 'SC-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', interventionId: 'WI-1',
          origin: 'client_requested_additional_work', reason: 'Client requested second service.', requestedAt: '2026-08-25T13:55:00.000Z',
          resolvedAt: '2026-08-25T14:00:00.000Z', createdAt: '2026-08-25T13:55:00.000Z', createdBy: 'uid-1',
          updatedAt: '2026-08-25T14:00:00.000Z', updatedBy: 'uid-1', version: 2,
        },
        workIntervention: {
          id: 'WI-1', visitId: 'visit-WO-1', visitAssetId: 'VA-1', assetId: 'AC-1', serviceCatalogItemId: 'service-standard',
          interventionType: '12K Standard Service', origin: 'added_on_site_client_request', requestedBy: 'client', status: 'confirmed',
          priceSnapshot: { currency: 'AWG', unitPrice: 125, sourceCatalogItemId: 'service-standard', pricingVersion: 'rules:v7', capturedAt: '2026-08-25T13:55:00.000Z' },
          scopeChangeId: 'SC-1', performedByStaffIds: [], createdAt: '2026-08-25T13:55:00.000Z', createdBy: 'uid-1',
          updatedAt: '2026-08-25T14:00:00.000Z', updatedBy: 'uid-1', version: 2,
        },
        allowedActions: ['read', 'execute', 'intervention.add'],
      };
    },
  });

  const result = await api.handle(request({ data: {
    visitId: ' visit-WO-1 ',
    interventionId: ' WI-1 ',
    decision: ' approved ',
    receiverName: ' Maria Customer ',
    note: ' Approved verbally on site. ',
    requestId: ' approval-001 ',
    method: 'signature',
    status: 'completed',
    resolvedAt: '2026-08-25T14:00:00.000Z',
    priceSnapshot: { unitPrice: 1 },
    allowedActions: ['price.override'],
  } }));

  assert.equal(result.status, 200);
  assert.equal(result.body.version, 1);
  assert.equal(result.body.fieldApproval.method, 'verbal');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician');
  assert.equal(calls[0].visitId, 'visit-WO-1');
  assert.equal(calls[0].interventionId, 'WI-1');
  assert.equal(calls[0].decision, 'approved');
  assert.equal(calls[0].receiverName, 'Maria Customer');
  assert.equal(calls[0].note, 'Approved verbally on site.');
  assert.equal(calls[0].requestId, 'approval-001');
  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'decision', 'identity', 'interventionId', 'note', 'receiverName', 'requestId', 'visitId',
  ]);
  assert.equal('method' in calls[0], false);
  assert.equal('status' in calls[0], false);
  assert.equal('resolvedAt' in calls[0], false);
  assert.equal('priceSnapshot' in calls[0], false);
  assert.equal('allowedActions' in calls[0], false);
});

test('additional work decision handler cannot be configured with a non-function authority', () => {
  assert.throws(
    () => createFieldOperationsApi({
      db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
      verifyIdToken: async () => ({ uid: 'uid-1' }),
      recordAdditionalWorkDecision: {},
    }),
    /recordAdditionalWorkDecision must be a function/,
  );
});
