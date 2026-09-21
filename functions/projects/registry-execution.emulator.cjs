'use strict';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const PROJECT = 'demo-demac-projects';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw new Error('Loopback emulators required.');
}
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Demo project only; no production credentials.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { createProjectRegistryService } = require('./registry-service');
const { MAX_EVENTS } = require('./registry-execution');
const app = initializeApp({ projectId: PROJECT }, 'projects-field-execution');
const db = getFirestore(app), auth = getAuth(app);
const service = createProjectRegistryService({ db, verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), enabled: true });
const actors = {}; let sequence = 0;
const next = prefix => `${prefix}-${++sequence}`;
const customerId = 'EXECUTION-CUSTOMER', propertyId = 'EXECUTION-PROPERTY';
const protectedCollections = ['clients', 'properties', 'appointments', 'workOrders', 'workVisits', 'fieldOperationEvents', 'bookingCapacityLocks', 'warehouseInventory', 'whatsappOutboundQueue', 'projectRecords', 'projectEvents', 'projectCommandReceipts'];
const when = minute => new Date(Date.UTC(2026, 8, 18, 8, minute)).toISOString();
async function run(action, data, actor = 'admin') {
  return service.execute({ idToken: actors[actor], command: { action, data, requestId: next('EXECUTION-REQUEST') } });
}
async function snapshot() {
  const data = {};
  for (const collection of protectedCollections) {
    const docs = await db.collection(collection).get();
    data[collection] = docs.docs.map(doc => [doc.id, doc.data()]).sort((a, b) => a[0].localeCompare(b[0]));
  }
  return data;
}
async function seed({ visits = 1, sameVan = false, returnVisit = false, historicalAssignment = true } = {}) {
  const plan = await run('create_plan', { name: 'Synthetic execution project', type: 'VRF Project', customerId, propertyId,
    startsOn: '2026-09-01', estimatedCompletionOn: '2026-10-01', budgetedVanMinutes: 66 * 60, phases: [] });
  const appointmentId = next('EXECUTION-APT'), orderIds = [];
  for (let i = 0; i < visits; i++) {
    const orderId = next('EXECUTION-WO'); orderIds.push(orderId);
    await db.collection('workOrders').doc(orderId).set({ appointmentId, clientId: customerId, propertyId,
      status: 'Confirmada', vanId: sameVan ? 'VAN-1' : `VAN-${i + 1}`, date: '2026-09-18', time: '08:00', scheduledSlots: 6, appointmentDurationMinutes: 360 });
    await seedVisit({ orderId, appointmentId, status: returnVisit ? 'requires_return_visit' : 'pending',
      vanId: historicalAssignment ? (sameVan ? 'VAN-1' : `VAN-${i + 1}`) : undefined });
  }
  await db.collection('appointments').doc(appointmentId).set({ appointmentId, customerId, propertyId, status: 'confirmed', workOrderIds: orderIds });
  await run('attach_existing_appointment', { projectId: plan.projectId, expectedVersion: 1, appointmentId,
    phaseId: null, reason: 'Reviewed synthetic test', confirmedAssociation: true });
  return { projectId: plan.projectId, orderIds, appointmentId };
}
async function seedVisit({ orderId, appointmentId, status = 'pending', previousVisitId, startOffset = 0, vanId }) {
  const visitId = next('EXECUTION-VISIT');
  await db.collection('workVisits').doc(visitId).set({ workOrderId: orderId, appointmentId, clientId: customerId, propertyId,
    status, startedAt: when(startOffset + 10), version: 5, ...(previousVisitId ? { previousVisitId } : {}) });
  const changes = [['scheduled', 'en_route', 0], ['en_route', 'on_site', 5], ['on_site', 'in_progress', 10], ['in_progress', status, 70]];
  for (let i = 0; i < changes.length; i++) {
    const [from, to, minute] = changes[i]; const id = next('EXECUTION-EVENT');
    await db.collection('fieldOperationEvents').doc(id).set({ id, fieldEventVersion: 1, type: 'work_visit_status_changed',
      entityType: 'WorkVisit', entityId: visitId, visitId, workOrderId: orderId, appointmentId, customerId, propertyId,
      requestId: next('FIELD-REQUEST'), performedByUserId: 'SYNTHETIC-FIELD-USER', occurredAt: when(startOffset + minute),
      before: { status: from, version: i + 1 }, after: { status: to, version: i + 2 },
      ...(to === 'in_progress' && vanId ? { metadata: { executionAssignment: { version: 1, vanId } } } : {}) });
  }
  return visitId;
}
before(async () => {
  for (const [name, role] of [['admin', 'admin'], ['finance', 'finance'], ['technician', 'technician']]) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `projects-execution-${name}@example.test`, password: 'synthetic-execution-password', returnSecureToken: true }),
    });
    const value = await response.json(); assert.ok(value.idToken);
    actors[name] = value.idToken;
    await db.collection('users').doc(value.localId).set({ role, active: true });
  }
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true });
  await db.collection('clients').doc(customerId).set({ name: 'Synthetic execution customer', active: true });
  await db.collection('properties').doc(propertyId).set({ clientId: customerId, active: true });
});
after(async () => { await deleteApp(app); });

test('authenticated execution read measures both Vans without changing any operational or project collection', async () => {
  const data = await seed({ visits: 2 }); const before = await snapshot();
  const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.pageTotals.closedRecordedMinutes, 120);
  assert.equal(result.projectRecordedMinutes, 120);
  assert.equal(result.actualPersonMinutes, null); assert.equal(result.physicalProgressPercent, null);
  assert.equal(result.rows.length, 2); assert.equal(result.coverage.eventReadComplete, true);
  assert.deepEqual(await snapshot(), before);
});
test('reading from a second allowed role produces the same evidence; a technician has no administrative access', async () => {
  const data = await seed();
  const admin = await run('get_execution', { projectId: data.projectId });
  const finance = await run('get_execution', { projectId: data.projectId }, 'finance');
  assert.deepEqual(admin, finance);
  await assert.rejects(run('get_execution', { projectId: data.projectId }, 'technician'), { code: 'forbidden' });
});
test('overlapping same-Van visits do not become duplicated project time', async () => {
  const data = await seed({ visits: 2, sameVan: true });
  const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.projectRecordedMinutes, null);
  assert.ok(result.issues.some(issue => issue.code === 'overlapping_van_execution'));
});
test('explicit physical return remains a separate visit without duplicating the reservation', async () => {
  const data = await seed({ returnVisit: true });
  const visits = await db.collection('workVisits').where('workOrderId', '==', data.orderIds[0]).get();
  await seedVisit({ orderId: data.orderIds[0], appointmentId: data.appointmentId, previousVisitId: visits.docs[0].id, startOffset: 120, vanId: 'VAN-2' });
  const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.pageTotals.visits, 2); assert.equal(result.projectRecordedMinutes, 120);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].scheduledSlots, 6);
});
test('cancelling the booking preserves its already-recorded execution', async () => {
  const data = await seed();
  await db.collection('appointments').doc(data.appointmentId).update({ status: 'cancelled' });
  await db.collection('workOrders').doc(data.orderIds[0]).update({ status: 'Cancelada' });
  const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.rows[0].cancelled, true); assert.equal(result.projectRecordedMinutes, 60);
});
test('foreign event identity blocks the measurement without changing Field or scheduling evidence', async () => {
  const data = await seed();
  const events = await db.collection('fieldOperationEvents').where('workOrderId', '==', data.orderIds[0]).get();
  await events.docs[0].ref.update({ customerId: 'FOREIGN' });
  const before = await snapshot(); const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.pageTotals.closedRecordedMinutes, null);
  assert.ok(result.issues.some(issue => issue.code === 'field_event_invalid'));
  assert.deepEqual(await snapshot(), before);
});
test('event-history read cap detects truncation and does not certify zero', async () => {
  const data = await seed();
  for (let offset = 0; offset < MAX_EVENTS; offset += 400) {
    const batch = db.batch();
    for (let n = offset; n < Math.min(MAX_EVENTS, offset + 400); n++) batch.create(db.collection('fieldOperationEvents').doc(next('EXECUTION-EXTRA')),
      { type: 'field_measurement_recorded', workOrderId: data.orderIds[0] });
    await batch.commit();
  }
  const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.coverage.eventReadComplete, false);
  assert.equal(result.pageTotals.closedRecordedMinutes, null);
  assert.ok(result.issues.some(issue => issue.code === 'field_event_read_truncated'));
});
test('an unknown action payload cannot write local claimed hours and requires current server activation', async () => {
  const data = await seed();
  await assert.rejects(run('get_execution', { projectId: data.projectId, actualHours: 70 }), { code: 'invalid_fields' });
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: false });
  try { await assert.rejects(run('get_execution', { projectId: data.projectId }), { code: 'projects_not_active' }); }
  finally { await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true }); }
});

test('reassigning a Work Order cannot invent an overlap between historically separate Vans', async () => {
  const data = await seed({ visits: 2 });
  await db.collection('workOrders').doc(data.orderIds[0]).update({ vanId: 'VAN-2' });
  const before = await snapshot();
  const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.projectRecordedMinutes, 120);
  assert.equal(result.rows.find(row => row.workOrderId === data.orderIds[0]).visits[0].intervals[0].vanId, 'VAN-1');
  assert.deepEqual(await snapshot(), before);
});

test('reassigning a Work Order cannot hide a historical same-Van overlap', async () => {
  const data = await seed({ visits: 2, sameVan: true });
  await db.collection('workOrders').doc(data.orderIds[0]).update({ vanId: 'VAN-2' });
  const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.projectRecordedMinutes, null);
  assert.ok(result.issues.some(issue => issue.code === 'overlapping_van_execution'));
});

test('older events preserve visit minutes but cannot certify historical Van totals from a current assignment', async () => {
  const data = await seed({ visits: 2, historicalAssignment: false });
  const before = await snapshot();
  const result = await run('get_execution', { projectId: data.projectId });
  assert.equal(result.projectRecordedMinutes, null);
  assert.equal(result.pageTotals.closedRecordedMinutes, null);
  assert.deepEqual(result.rows.map(row => row.visits[0].closedRecordedMinutes), [60, 60]);
  assert.equal(result.issues.filter(issue => issue.code === 'execution_van_unresolved').length, 2);
  assert.deepEqual(await snapshot(), before);
});
