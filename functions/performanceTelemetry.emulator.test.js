"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const PROJECT = 'demo-demac-health';
// Fail closed before loading SDKs: these tests must never use a real project.
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error(`Local ${key} is mandatory`);
}
if (process.env.GCLOUD_PROJECT !== PROJECT) throw Error('Only demo-demac-health is permitted');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { createPerformanceTelemetryApi } = require('./performanceTelemetryService');
const C = require('./performanceTelemetryCore');
const app = initializeApp({ projectId: PROJECT }, 'performance-emulator');
const db = getFirestore(app);

async function user(role) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${role}-${Date.now()}@example.test`, password: 'isolated-test-only-123', returnSecureToken: true }),
  });
  const value = await response.json();
  assert.ok(value.idToken);
  await db.collection('users').doc(value.localId).set({ role, active: true });
  return value;
}
function batch(id, at = Date.now()) {
  return { version: 2, environment: 'test', batchId: `emulator_batch_identity_${id}`,
    sessionId: 'emulator_session_identity', release: 'a'.repeat(40), visible: true, module: 'scheduling',
    measurements: [{ name: 'support_slot_validation', module: 'scheduling', unit: 'ms', value: 125, observedAtMs: at }],
  };
}

test('Auth + Firestore emulator: authorization, atomic replay, concurrency, shutoff and business isolation', { timeout: 120000 }, async () => {
  try {
    const api = createPerformanceTelemetryApi({ db, verifyIdToken: (token) => getAuth(app).verifyIdToken(token), timestamp: Timestamp.fromMillis, enabled: true, environment: 'test' });
    const admin = await user('admin');
    const office = await user('office');
    const call = (action, data, token) => api.handle({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: { action, data } });
    const sentinels = ['clients', 'appointments', 'workOrders', 'properties', 'capacityLocks'];
    for (const collection of sentinels) await db.collection(collection).doc('do-not-change').set({ value: 'synthetic-existing-business-record' });
    assert.equal((await call('dashboard', {}, undefined)).status, 401);
    assert.equal((await call('dashboard', {}, office.idToken)).status, 403);
    assert.equal((await call('set_collection', { enabled: false, expectedVersion: 0 }, office.idToken)).status, 403);

    const input = batch('same');
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => call('ingest', input, office.idToken)));
    assert.ok(concurrent.every((result) => result.status === 200), JSON.stringify(concurrent));
    assert.equal(concurrent.filter((result) => !result.body.replayed).length, 1);
    const dashboard = (await call('dashboard', { rangeMinutes: 60 }, admin.idToken)).body;
    assert.equal(dashboard.metrics.find((metric) => metric.name === 'support_slot_validation').count, 1);
    assert.equal(dashboard.metrics.find((metric) => metric.name === 'support_slot_validation').p95, 150);

    // Deliberately discard the first response after Firestore commits, then resend EXACTLY the same payload.
    const lostAck = batch('lost-ack');
    await call('ingest', lostAck, office.idToken);
    const replay = await call('ingest', lostAck, office.idToken);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    const changed = structuredClone(lostAck);
    changed.measurements[0].value += 1;
    assert.equal((await call('ingest', changed, office.idToken)).status, 409);
    assert.equal((await call('dashboard', { rangeMinutes: 60 }, admin.idToken)).body.metrics.find((metric) => metric.name === 'support_slot_validation').count, 2);

    assert.equal((await call('set_collection', { enabled: false, expectedVersion: 0 }, admin.idToken)).status, 200);
    assert.equal((await call('ingest', batch('paused'), office.idToken)).body.error.code, 'disabled');
    assert.equal((await call('set_collection', { enabled: true, expectedVersion: 1 }, admin.idToken)).status, 200);

    // Service-level concurrency harness. Fifty distinct collector sessions, not a whole-ERP load test.
    const started = performance.now();
    const senders = await Promise.all(Array.from({ length: 50 }, (_, index) => {
      const data = { ...batch(`sender-${index}`), sessionId: `emulator_independent_session_${index}` };
      return api.ingest(data, { uid: `synthetic-sender-${index}`, role: 'office_operator' }).then(() => true).catch((error) => error.code || error.message);
    }));
    assert.ok(senders.every((value) => value === true), JSON.stringify(senders));
    console.log(`Telemetry concurrency: 50 independent senders completed in ${Math.round(performance.now() - started)} ms (emulator, not production).`);
    const counted = (await call('dashboard', { rangeMinutes: 60 }, admin.idToken)).body.metrics.find((metric) => metric.name === 'support_slot_validation');
    assert.equal(counted.count, 52, 'No dropped or double-counted samples during concurrent writes');
    for (const collection of sentinels) assert.deepEqual((await db.collection(collection).doc('do-not-change').get()).data(), { value: 'synthetic-existing-business-record' });

    const direct = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${C.COLLECTIONS.quarter}`, { headers: { Authorization: `Bearer ${office.idToken}` } });
    assert.equal(direct.status, 403, 'Direct browser access to server-only telemetry must stay denied');
  } finally {
    await deleteApp(app);
  }
});
