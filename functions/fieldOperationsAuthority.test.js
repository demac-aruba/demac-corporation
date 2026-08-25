const assert = require('node:assert/strict');
const test = require('node:test');
const { FIELD_ACTIONS, createFieldOperationsApi, publicJobProjection } = require('./fieldOperationsAuthority');
const { normalizeFieldIdentity } = require('./fieldOperationsAuthorityCore');

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

function request({ method = 'POST', token = '', action = 'get_schedule', data = {} } = {}) {
  const authorization = token ? `Bearer ${token}` : '';
  return {
    method,
    headers: { authorization },
    get(name) { return String(name).toLowerCase() === 'authorization' ? authorization : ''; },
    body: { action, data },
  };
}

test('inactive Field principals fail closed before assignment resolution', () => {
  assert.throws(() => normalizeFieldIdentity({
    uid: 'uid-inactive',
    profile: { active: false, role: 'technician', staffId: 'staff-inactive' },
    decoded: {},
  }), /inactive or not provisioned/);
});

test('Field HTTP authority exposes only governed read actions plus audited visit preparation', async () => {
  assert.deepEqual([...FIELD_ACTIONS].sort(), ['get_job', 'get_schedule', 'prepare_visit']);

  const api = createFieldOperationsApi({
    db: { collection() { return {}; } },
    verifyIdToken: async () => ({ uid: 'unused' }),
  });

  await assert.rejects(
    () => api.execute({ action: 'prepare_visit', data: {}, identity: { operations: false } }),
    (error) => error?.code === 'mutation_not_configured' && error?.status === 503,
  );
  await assert.rejects(
    () => api.execute({ action: 'start_visit', data: {}, identity: { operations: false } }),
    /Unsupported Field Operations action/,
  );
});

test('public Field DTO does not expose Legacy mixed-namespace technicianIds', () => {
  const projected = publicJobProjection({
    workOrderId: 'WO-1',
    technicianIds: ['uid-legacy', 'staff-1'],
    responsibility: 'technician',
    allowedActions: ['read'],
  });
  assert.equal('technicianIds' in projected, false);
  assert.equal(projected.workOrderId, 'WO-1');
  assert.equal(projected.responsibility, 'technician');
  assert.deepEqual(projected.allowedActions, ['read']);
});

test('HTTP method and truly unsupported action fail before protected business execution', async () => {
  let verified = false;
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => { verified = true; return { uid: 'uid-1' }; },
  });

  const wrongMethod = await api.handle(request({ method: 'GET', token: 'token' }));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');

  const unsupported = await api.handle(request({ token: 'token', action: 'start_visit' }));
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error.code, 'unsupported_action');
  assert.equal(verified, false);
});

test('prepare_visit authenticates first and forwards only server-derived identity plus stable request data', async () => {
  const calls = [];
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1', name: 'Tech One', vanId: 'VAN-1' }),
    verifyIdToken: async (token) => {
      assert.equal(token, 'valid-token');
      return { uid: 'uid-1', role: 'super_admin', email: 'token@example.invalid' };
    },
    prepareWorkVisit: async (input) => {
      calls.push(input);
      return { success: true, replayed: false, visit: { id: 'visit-WO-1', status: 'scheduled' }, allowedActions: ['execute'] };
    },
  });

  const result = await api.handle(request({
    token: 'valid-token',
    action: 'prepare_visit',
    data: { workOrderId: ' WO-1 ', requestId: ' prepare-WO-1-001 ' },
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workOrderId, 'WO-1');
  assert.equal(calls[0].requestId, 'prepare-WO-1-001');
  assert.equal(calls[0].identity.uid, 'uid-1');
  assert.equal(calls[0].identity.staffId, 'staff-1');
  assert.equal(calls[0].identity.role, 'technician', 'token role must not override governed profile role');
});

test('prepare_visit cannot execute without authentication', async () => {
  let called = false;
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    prepareWorkVisit: async () => { called = true; return { success: true }; },
  });

  const result = await api.handle(request({ action: 'prepare_visit', data: { workOrderId: 'WO-1', requestId: 'prepare-WO-1-001' } }));
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'unauthenticated');
  assert.equal(called, false);
});

test('missing and expired Firebase sessions return controlled unauthenticated errors', async () => {
  const missingTokenApi = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => ({ uid: 'uid-1' }),
  });
  const missing = await missingTokenApi.handle(request());
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'unauthenticated');

  const expiredApi = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => { throw new Error('expired'); },
  });
  const expired = await expiredApi.handle(request({ token: 'expired-token' }));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'unauthenticated');
});

test('missing or incompletely governed user profile cannot inherit token role authority', async () => {
  const missingProfileApi = createFieldOperationsApi({
    db: authDb(undefined),
    verifyIdToken: async () => ({ uid: 'uid-missing', role: 'technician' }),
  });
  const missingProfile = await missingProfileApi.handle(request({ token: 'valid-token' }));
  assert.equal(missingProfile.status, 403);
  assert.equal(missingProfile.body.error.code, 'permission_denied');

  const missingRoleApi = createFieldOperationsApi({
    db: authDb({ active: true, staffId: 'staff-token-only' }),
    verifyIdToken: async () => ({ uid: 'uid-token-only', role: 'technician' }),
  });
  const missingRole = await missingRoleApi.handle(request({ token: 'valid-token' }));
  assert.equal(missingRole.status, 403);
  assert.equal(missingRole.body.error.code, 'permission_denied');
});

test('unexpected internal failures are logged internally and sanitized from the public response', async () => {
  const reports = [];
  const api = createFieldOperationsApi({
    db: {
      collection(name) {
        assert.equal(name, 'users');
        return {
          doc() {
            return {
              async get() {
                throw new Error('sensitive Firestore/runtime diagnostic');
              },
            };
          },
        };
      },
    },
    verifyIdToken: async () => ({ uid: 'uid-1' }),
    reportError: (report) => reports.push(report),
  });

  const result = await api.handle(request({ token: 'valid-token', action: 'get_schedule' }));
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'internal_error');
  assert.equal(result.body.error.message, 'Unexpected Field Operations error.');
  assert.deepEqual(result.body.error.details, {});
  assert.equal(JSON.stringify(result.body).includes('sensitive Firestore/runtime diagnostic'), false);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].action, 'get_schedule');
  assert.equal(reports[0].status, 500);
  assert.equal(reports[0].code, 'internal_error');
  assert.equal(reports[0].error.message, 'sensitive Firestore/runtime diagnostic');
});
