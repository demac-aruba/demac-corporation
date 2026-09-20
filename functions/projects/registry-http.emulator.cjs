'use strict';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const PROJECT = 'demo-demac-projects';
assert.equal(process.versions.node.split('.')[0], '22', 'Use the actual Functions Node 22 runtime');
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name] || '')) throw new Error(`Refusing non-local ${name}`);
}
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Only isolated demo emulators without production credentials are allowed.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { COLLECTIONS } = require('./registry-service');
const app = initializeApp({ projectId: PROJECT }, 'projects-http-test');
const db = getFirestore(app); const auth = getAuth(app);
const URL = `http://127.0.0.1:5001/${PROJECT}/us-central1/projectsRegistry`;
const ORIGIN = 'https://erp.example.test';
const actors = {};
const protectedCollections = ['clients', 'properties', 'appointments', 'workOrders', 'workVisits', 'bookingCapacityLocks', 'warehouseInventory', 'whatsappOutboundQueue'];
let protectedBefore;
let seq = 0;
const PLAN = { name: 'Synthetic HTTP project', type: 'VRF Project', customerId: 'HTTP-CUSTOMER', propertyId: 'HTTP-PROPERTY', startsOn: '2026-09-01', estimatedCompletionOn: '2026-10-01', budgetedVanMinutes: 3960, phases: [] };
const command = (action, data, requestId = `HTTP-REQUEST-${++seq}`) => ({ action, data, requestId });
async function request(body, actor = 'admin', extraHeaders = {}) {
  const response = await fetch(URL, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${actors[actor]?.token || actor}`, ...extraHeaders }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}
async function accepted(body, actor) {
  const result = await request(body, actor);
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.success, true);
  return result.body.data;
}
async function rejected(body, actor, status, code, extraHeaders) {
  const result = await request(body, actor, extraHeaders);
  assert.equal(result.response.status, status, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  assert.equal(result.body.error.outcome, 'rejected');
  return result;
}
async function protectedSnapshot() {
  const records = {};
  for (const name of protectedCollections) records[name] = (await db.collection(name).orderBy('__name__').get()).docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  return records;
}
before(async () => {
  // A missing/incorrect runtime must fail, never fall back to an in-process service.
  const preflight = await fetch(URL, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
  assert.equal(preflight.status, 204, 'The actual Firebase endpoint must be running');
  for (const [name, role] of [['admin', 'admin'], ['manager', 'project_manager'], ['finance', 'finance'], ['technician', 'technician'], ['disabled', 'admin'], ['unprovisioned', null]]) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `http-${name}@example.test`, password: 'synthetic-http-password-1', returnSecureToken: true }) });
    const value = await response.json(); assert.ok(value.idToken);
    actors[name] = { token: value.idToken, uid: value.localId };
    if (role) await db.collection('users').doc(value.localId).set({ role, active: name !== 'disabled' });
  }
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true });
  await db.collection('clients').doc(PLAN.customerId).set({ name: 'Synthetic HTTP customer', active: true });
  await db.collection('properties').doc(PLAN.propertyId).set({ clientId: PLAN.customerId, active: true });
  for (const name of protectedCollections) await db.collection(name).doc('HTTP-PROTECTED-SENTINEL').set({ protected: true, collection: name });
  protectedBefore = await protectedSnapshot();
});
after(async () => {
  try { if (protectedBefore) assert.deepEqual(await protectedSnapshot(), protectedBefore); }
  finally { await deleteApp(app); }
});

test('real Functions preflight applies the exact allowlist without wildcard or credentials', async () => {
  const response = await fetch(URL, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } });
  assert.equal(response.status, 204); assert.equal(await response.text(), '');
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  const denied = await fetch(URL, { method: 'OPTIONS', headers: { origin: 'https://unapproved.example.test', 'access-control-request-method': 'POST' } });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('real transport rejects wrong origins, absent/forged tokens, media and oversized payloads', async () => {
  const list = command('list_plans', {});
  await rejected(list, 'admin', 403, 'origin_denied', { origin: 'https://unapproved.example.test' });
  await rejected(list, 'admin', 401, 'unauthenticated', { authorization: '' });
  await rejected(list, 'forged', 401, 'unauthenticated');
  await rejected(list, 'admin', 415, 'unsupported_media_type', { 'content-type': 'text/plain' });
  await rejected(command('create_plan', { ...PLAN, name: 'x'.repeat(128 * 1024) }), 'admin', 413, 'payload_too_large');
  assert.equal((await db.collection(COLLECTIONS.records).get()).size, 0);
});

test('real Firebase identities require provisioned active roles on the server', async () => {
  for (const actor of ['technician', 'disabled', 'unprovisioned', 'finance']) await rejected(command('create_plan', PLAN), actor, 403, 'forbidden');
  const result = await accepted(command('list_plans', {}), 'finance');
  assert.deepEqual(result.projects, []);
});

test('server activation is reread for each actual HTTP request', async () => {
  await db.collection('businessSettings').doc('projects-registry').update({ backendEnabled: false });
  try {
    await rejected(command('list_plans', {}), 'admin', 503, 'projects_not_active');
    await rejected(command('create_plan', PLAN), 'admin', 503, 'projects_not_active');
  } finally { await db.collection('businessSettings').doc('projects-registry').update({ backendEnabled: true }); }
});

test('concurrent duplicate HTTP commands commit one record, number, event and receipt', async () => {
  const input = command('create_plan', PLAN);
  const results = await Promise.all([accepted(input), accepted(input)]);
  assert.equal(results[0].projectId, results[1].projectId);
  assert.deepEqual(results.map((value) => value.replayed).sort(), [false, true]);
  for (const name of [COLLECTIONS.records, COLLECTIONS.numbers, COLLECTIONS.events, COLLECTIONS.receipts]) assert.equal((await db.collection(name).get()).size, 1);
  const other = await accepted(command('get_plan', { projectId: results[0].projectId }), 'manager');
  assert.equal(other.project.budget.originalMinutes, 3960);
  await rejected({ ...input, data: { ...PLAN, name: 'Altered intent' } }, 'admin', 409, 'request_conflict');
});

test('discarded HTTP acknowledgement recovers exactly while new writes are paused', async () => {
  const input = command('create_plan', { ...PLAN, name: 'Synthetic response-loss project' });
  const response = await fetch(URL, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${actors.admin.token}` }, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  // Intentionally discard the committed response instead of learning its identity.
  await response.body.cancel();
  await db.collection('businessSettings').doc('projects-registry').update({ writesPaused: true });
  try {
    const recovered = await accepted(input); assert.equal(recovered.replayed, true);
    assert.equal((await accepted(command('get_plan', { projectId: recovered.projectId }))).project.name, input.data.name);
    await rejected(command('create_plan', PLAN), 'admin', 503, 'projects_writes_paused');
    assert.equal((await db.collection(COLLECTIONS.events).where('projectId', '==', recovered.projectId).get()).size, 1);
  } finally { await db.collection('businessSettings').doc('projects-registry').update({ writesPaused: false }); }
});

test('role removal and Firebase account disabling invalidate exact receipt recovery', async () => {
  const input = command('create_plan', PLAN); await accepted(input, 'manager');
  await db.collection('users').doc(actors.manager.uid).update({ role: 'technician' });
  try { await rejected(input, 'manager', 403, 'forbidden'); }
  finally { await db.collection('users').doc(actors.manager.uid).update({ role: 'project_manager' }); }
  await auth.updateUser(actors.manager.uid, { disabled: true });
  try { await rejected(input, 'manager', 401, 'unauthenticated'); }
  finally { await auth.updateUser(actors.manager.uid, { disabled: false }); }
});

test('normal deployment keeps legacy import closed even if the DB import setting is enabled', async () => {
  await db.collection('businessSettings').doc('projects-registry').update({ legacyImportEnabled: true });
  try { await rejected(command('import_legacy_plan', {}), 'admin', 503, 'legacy_import_not_active'); }
  finally { await db.collection('businessSettings').doc('projects-registry').update({ legacyImportEnabled: false }); }
});

test('actual HTTP optimistic concurrency preserves original estimate and rejects stale writers', async () => {
  const project = await accepted(command('create_plan', PLAN));
  const values = await Promise.all([4200, 4260].map((minutes) => request(command('revise_estimate', { projectId: project.projectId, expectedVersion: 1, budgetedVanMinutes: minutes, reason: 'Synthetic HTTP revision' }))));
  assert.deepEqual(values.map((value) => value.response.status).sort(), [200, 409]);
  assert.equal(values.find((value) => value.response.status === 409).body.error.code, 'version_conflict');
  const { project: current } = await accepted(command('get_plan', { projectId: project.projectId }));
  assert.equal(current.version, 2); assert.equal(current.budget.originalMinutes, 3960);
  assert.ok([4200, 4260].includes(current.budget.currentMinutes));
});
