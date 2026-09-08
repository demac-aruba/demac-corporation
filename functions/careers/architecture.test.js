'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { transactionStore } = require('./test-support/transaction-store');
const { createService, COLLECTIONS } = require('./service');
const C = require('./core');

test('a lost finalization acknowledgement must not schedule deletion of a committed clean file', async () => {
  const store = transactionStore();
  const token = 'a'.repeat(64), sessionId = 'test-session';
  store.rows.set(`${COLLECTIONS.sessions}/${sessionId}`, { id: sessionId, secretHash: C.digest(token), expiresAt: 900000, files: {}, status: 'draft' });
  const files = { decode: value => Buffer.from(value, 'base64'), prepare: async bytes => ({ bytes, mime: 'application/pdf' }),
    store: async (sid, key, prepared, lease) => ({ path: `careers-private/${sid}/${key}-${lease}`, generation: '1' }),
    publicFile: record => ({ id: record.id, status: record.status, name: record.name }) };
  const service = createService({ db: store.db, files, infrastructure: {}, now: () => 1000 });
  store.failAfterCommitOnce(writes => writes.some(([kind, , data]) => kind === 'update' && Object.values(data || {}).some(value => value?.status === 'clean')));
  const result = await service.upload({ sessionId, token, name: 'test.pdf', kind: 'cv', base64: Buffer.from('%PDF-test').toString('base64') });
  assert.equal(result.status, 'clean');
  assert.equal([...store.rows.keys()].filter(key => key.startsWith(`${COLLECTIONS.deletions}/`)).length, 0);
  assert.equal(Object.values(store.rows.get(`${COLLECTIONS.sessions}/${sessionId}`).files)[0].status, 'clean');
});

test('settings idempotency includes the optimistic version, not only edited values', async () => {
  const store = transactionStore();
  store.rows.set('users/test-admin', { active: true, role: 'admin', name: 'Test Admin' });
  const service = createService({ db: store.db, files: {}, infrastructure: { signature: () => 'test', blockers: () => [] }, now: () => 1000 });
  const settings = { intakeEnabled: false, privacyText: 'Synthetic notice.', privacyVersion: 'v1', retentionDays: 30, talentRetentionDays: 30, from: 'careers@example.test', replyTo: 'careers@example.test', senderName: 'Test' };
  const request = { settings, requestId: 'settings-test', expectedVersion: 0 };
  assert.equal((await service.saveSettings('test-admin', request)).version, 1);
  assert.equal((await service.saveSettings('test-admin', request)).version, 1, 'exact retry returns the original result');
  await assert.rejects(service.saveSettings('test-admin', { ...request, expectedVersion: 1 }), { code: 'idempotency-conflict' });
});
