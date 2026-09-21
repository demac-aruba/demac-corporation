'use strict';
// Explicit isolated benchmark, not a production latency gate or a browser paint metric.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const PROJECT = 'demo-demac-projects';
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  assert.match(process.env[name] || '', /^(127\.0\.0\.1|localhost):\d+$/);
}
assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
const baseline = process.env.PROJECTS_PERFORMANCE_BASELINE;
assert.ok(baseline && path.isAbsolute(baseline), 'A separately checked-out baseline is required');
const output = process.env.PROJECTS_PERFORMANCE_OUTPUT;
assert.ok(output && path.isAbsolute(output));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: PROJECT }, 'projects-performance');
const db = getFirestore(app), auth = getAuth(app), measurements = new AsyncLocalStorage();
const measuredDb = { collection: db.collection.bind(db), runTransaction: (callback, options) => db.runTransaction(transaction => {
  const stats = measurements.getStore();
  if (stats) {
    assert.equal(options?.readOnly, true, 'Measured reads must preserve the service transaction mode');
    stats.transactionAttempts++;
  }
  const read = async (method, targets) => {
    const result = await transaction[method](...targets);
    if (stats) {
      stats.readCalls++;
      const snapshots = Array.isArray(result) ? result : result.docs || [result];
      stats.documentSnapshots += snapshots.length;
      stats.documentsReturned += snapshots.filter(snapshot => snapshot.exists).length;
      if (result.docs) stats.queries++;
    }
    return result;
  };
  return callback(new Proxy(transaction, { get(target, name) {
    if (name === 'get' || name === 'getAll') return (...targets) => read(name, targets);
    const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
  } }));
}, options) };
const make = source => require(source).createProjectRegistryService({ db: measuredDb, enabled: true,
  verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked) });
const services = { baseline: make(path.join(baseline, 'functions/projects/registry-service.js')), current: make('./registry-service') };
let seq = 0; const tokens = [];
const execute = (service, uid, action, data) => service.execute({ idToken: tokens[uid],
  command: { action, data, requestId: `PERFORMANCE-REQUEST-${++seq}` } });
async function seed() {
  for (let i = 0; i < 50; i++) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `performance-${i}@example.test`, password: 'isolated-performance-only', returnSecureToken: true }),
    });
    const user = await response.json(); assert.ok(user.idToken); tokens.push(user.idToken);
    await db.collection('users').doc(user.localId).set({ role: 'operations', active: true });
  }
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true });
  await db.collection('clients').doc('PERF-CUSTOMER').set({ name: 'Synthetic benchmark', active: true });
  await db.collection('properties').doc('PERF-PROPERTY').set({ clientId: 'PERF-CUSTOMER', active: true });
  let projectId;
  for (let i = 0; i < 20; i++) {
    const project = await execute(services.current, 0, 'create_plan', { name: `Synthetic benchmark ${i}`, type: 'VRF Project',
      customerId: 'PERF-CUSTOMER', propertyId: 'PERF-PROPERTY', startsOn: '2026-09-01', estimatedCompletionOn: '2026-10-01',
      budgetedVanMinutes: 3960, phases: [] });
    projectId ||= project.projectId;
  }
  for (let i = 0; i < 4; i++) {
    const appointmentId = `PERF-APT-${i}`, workOrderId = `PERF-WO-${i}`, visitId = `PERF-VISIT-${i}`;
    await db.collection('appointments').doc(appointmentId).set({ appointmentId, customerId: 'PERF-CUSTOMER', propertyId: 'PERF-PROPERTY', status: 'confirmed', workOrderIds: [workOrderId] });
    await db.collection('workOrders').doc(workOrderId).set({ appointmentId, clientId: 'PERF-CUSTOMER', propertyId: 'PERF-PROPERTY', status: 'Confirmada', vanId: `VAN-${i + 1}`, date: '2026-09-18', time: '08:00', scheduledSlots: 6, appointmentDurationMinutes: 360 });
    await db.collection('workVisits').doc(visitId).set({ workOrderId, appointmentId, clientId: 'PERF-CUSTOMER', propertyId: 'PERF-PROPERTY', status: 'pending', startedAt: '2026-09-18T08:10:00.000Z', version: 5 });
    const transitions = [['scheduled', 'en_route', 0], ['en_route', 'on_site', 5], ['on_site', 'in_progress', 10], ['in_progress', 'pending', 70]];
    for (let n = 0; n < transitions.length; n++) {
      const [from, to, minute] = transitions[n], id = `PERF-EVENT-${i}-${n}`;
      await db.collection('fieldOperationEvents').doc(id).set({ id, fieldEventVersion: 1, type: 'work_visit_status_changed',
        entityType: 'WorkVisit', entityId: visitId, visitId, workOrderId, appointmentId, customerId: 'PERF-CUSTOMER', propertyId: 'PERF-PROPERTY',
        requestId: `PERF-FIELD-${i}-${n}`, performedByUserId: 'PERF-TECH', occurredAt: new Date(Date.UTC(2026, 8, 18, 8, minute)).toISOString(),
        before: { status: from, version: n + 1 }, after: { status: to, version: n + 2 },
        ...(to === 'in_progress' ? { metadata: { executionAssignment: { version: 1, vanId: `VAN-${i + 1}` } } } : {}) });
    }
    await execute(services.current, 0, 'attach_existing_appointment', { projectId, expectedVersion: i + 1,
      appointmentId, phaseId: null, reason: 'Synthetic benchmark association', confirmedAssociation: true });
  }
  for (let n = 0; n < 45; n++) {
    const id = `PERF-MOVEMENT-${String(n).padStart(3, '0')}`;
    await db.collection('inventoryMovements').doc(id).set({ id, version: 1, workOrderId: 'PERF-WO-0', type: 'issue_to_work_order',
      itemKind: 'material', itemId: 'PERF-MATERIAL', itemName: 'Synthetic material', quantity: 1, occurredAt: '2026-09-18T08:00:00.000Z', sourceLocationId: 'PERF-WAREHOUSE' });
  }
  return projectId;
}
const protectedCollections = ['projectRecords', 'projectAppointmentLinks', 'projectEvents', 'projectCommandReceipts', 'appointments', 'workOrders', 'workVisits', 'fieldOperationEvents', 'inventoryMovements', 'bookingCapacityLocks', 'whatsappOutboundQueue'];
async function snapshot() {
  return Object.fromEntries(await Promise.all(protectedCollections.map(async collection => [collection,
    (await db.collection(collection).get()).docs.map(doc => [doc.id, doc.data()]).sort((a, b) => a[0].localeCompare(b[0]))])));
}
const percentile = (items, p) => [...items].sort((a, b) => a - b)[Math.min(items.length - 1, Math.ceil(items.length * p) - 1)];
async function main() {
  const projectId = await seed(), before = await snapshot(), results = [];
  const routes = [['list_plans', { limit: 20 }], ['get_plan', { projectId }], ['get_activity', { projectId }],
    ['get_execution', { projectId }], ['get_materials', { projectId, workOrderId: 'PERF-WO-0' }]];
  for (const concurrency of [4, 10, 25, 50]) for (const [action, data] of routes) {
    for (const service of Object.values(services)) await execute(service, 0, action, data);
    const samples = { baseline: [], current: [] };
    for (let round = 0; round < 3; round++) {
      // Alternate ordering to reduce one-sided emulator/JIT warmup bias.
      for (const variant of (round % 2 ? ['current', 'baseline'] : ['baseline', 'current'])) {
        await Promise.all(Array.from({ length: concurrency }, (_, uid) => measurements.run({ readCalls: 0, queries: 0,
          documentsReturned: 0, documentSnapshots: 0, transactionAttempts: 0 }, async () => {
          const stats = measurements.getStore(), start = performance.now();
          try {
            const result = await execute(services[variant], uid, action, data);
            samples[variant].push({ ...stats, durationMs: performance.now() - start, responseBytes: Buffer.byteLength(JSON.stringify(result)), error: false });
          } catch (error) { samples[variant].push({ ...stats, durationMs: performance.now() - start, error: error.code || error.name }); }
        })));
      }
    }
    for (const variant of ['baseline', 'current']) {
      const data = samples[variant], times = data.map(sample => sample.durationMs), errors = data.filter(sample => sample.error);
      const row = { variant, concurrency, action, samples: data.length, errors: errors.length,
        p50ms: percentile(times, .5), p95ms: percentile(times, .95), p99ms: percentile(times, .99),
        meanResponseBytes: data.reduce((sum, sample) => sum + (sample.responseBytes || 0), 0) / data.length,
        maxReadCalls: Math.max(...data.map(sample => sample.readCalls)), maxQueries: Math.max(...data.map(sample => sample.queries)),
        maxDocumentSnapshots: Math.max(...data.map(sample => sample.documentSnapshots)), maxDocumentsReturned: Math.max(...data.map(sample => sample.documentsReturned)),
        maxTransactionAttempts: Math.max(...data.map(sample => sample.transactionAttempts)) };
      results.push(row);
      console.log(`${variant} ${action} users=${concurrency} n=${row.samples} p95=${row.p95ms.toFixed(1)}ms errors=${row.errors}`);
      assert.equal(errors.length, 0, `${variant}/${action} failed`);
    }
  }
  assert.deepEqual(await snapshot(), before, 'All measured requests are read-only');
  fs.writeFileSync(output, JSON.stringify({ project: PROJECT, generatedAt: new Date().toISOString(), baseline: 'a99402ece30f7042105daea1feac8d34174b1453',
    methodologyVersion: 2, transactionOptionsForwarded: true, nodeVersion: process.version,
    scope: 'Warm in-process registry service with real Auth/Firestore emulators; 50 distinct synthetic users; no browser/network/production SLA inference.',
    limitations: 'Three batches per concurrency; p99 at small N is descriptive maximum, not a stable tail estimate. Read counts are observed SDK snapshots, not billed production reads.',
    fixture: { projects: 20, appointments: 4, orders: 4, visits: 4, events: 16, materials: 45 }, protectedCollectionsUnchanged: true, results }, null, 2));
}
main().finally(() => deleteApp(app)).catch(error => { console.error(error); process.exitCode = 1; });
