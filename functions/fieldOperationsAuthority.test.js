const assert = require('node:assert/strict');
const test = require('node:test');
const { FIELD_ACTIONS, createFieldOperationsApi } = require('./fieldOperationsAuthority');
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

test('Field HTTP authority remains read-only until governed Field audit persistence exists', async () => {
  assert.deepEqual([...FIELD_ACTIONS].sort(), ['get_job', 'get_schedule']);

  const api = createFieldOperationsApi({
    db: { collection() { return {}; } },
    verifyIdToken: async () => ({ uid: 'unused' }),
  });

  for (const action of ['prepare_visit', 'start_visit']) {
    await assert.rejects(
      () => api.execute({ action, data: {}, identity: { operations: false } }),
      /Unsupported Field Operations action/,
    );
  }
});

test('HTTP method and unsupported action fail before protected business execution', async () => {
  let verified = false;
  const api = createFieldOperationsApi({
    db: authDb({ active: true, role: 'technician', staffId: 'staff-1' }),
    verifyIdToken: async () => { verified = true; return { uid: 'uid-1' }; },
  });

  const wrongMethod = await api.handle(request({ method: 'GET', token: 'token' }));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');

  const unsupported = await api.handle(request({ token: 'token', action: 'prepare_visit' }));
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error.code, 'unsupported_action');
  assert.equal(verified, false);
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
