const assert = require('node:assert/strict');
const test = require('node:test');
const { FIELD_ACTIONS, createFieldOperationsApi } = require('./fieldOperationsAuthority');
const { normalizeFieldIdentity } = require('./fieldOperationsAuthorityCore');

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
