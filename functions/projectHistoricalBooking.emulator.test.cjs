const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createProjectApi } = require('./projectAuthority');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { lockId } = require('./projectHistoricalBooking');
const { REGULAR_SLOTS } = require('./bookingSchedulingPrimitives');
const { withProjectBookingLinks } = require('./projectBookingLinks');
const { createOfficeBookingApi } = require('./officeBookingAuthority');
const { seedRecords } = require('./test-support/manualMoveSynthetic.cjs');
const { createBookingAppointmentLifecycle } = require('./bookingAuthorityAppointmentLifecycle');
const PROJECT = 'demo-demac-project-history';
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8398' || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Historical tests require the isolated loopback demo emulator without production credentials.');
const app = initializeApp({ projectId: PROJECT }, 'project-history-tests');
const db = getFirestore(app);
const clock = () => new Date('2026-09-23T14:00:00Z');
const api = createProjectApi({ db, clock, verifyIdToken: async uid => ({ uid }) });
const call = (action, data = {}, uid = 'demo-owner') => api.handle({ method: 'POST', headers: { authorization: `Bearer ${uid}` }, body: { action, data } });
const get = async path => (await db.doc(path).get()).data();
const project = () => ({ id: 'DEMO-HISTORY-PROJECT', projectNumber: 'DEMO-101', name: 'Synthetic VRF', customerId: 'DEMO-C', siteId: 'DEMO-P',
  status: 'Planned', estimatedSlots: 6, estimatedLaborHours: 6, actualLaborHours: 0, completedUnits: 0, materialActual: 0,
  phases: [{ id: 'DEMO-PHASE', name: 'Installation', estimatedLaborHours: 6, actualLaborHours: 0, actualMaterialCost: 0, unitsCompleted: 0, progress: 0 }],
  materials: [], expenses: [], costEntries: [], assignments: [{ id: 'legacy-link', projectId: 'DEMO-HISTORY-PROJECT', phaseId: 'DEMO-PHASE', appointmentId: 'DEMO-OLD', workOrderId: 'DEMO-OLD-WO', actualHours: 0, unitsCompleted: 0 }] });
const correction = (extra = {}) => ({ projectId: 'DEMO-HISTORY-PROJECT', phaseId: 'DEMO-PHASE', sourceAppointmentId: 'DEMO-OLD', expectedVersion: 1,
  start: '08:30', slots: 2, reason: 'Only two slots were used', backdatingAcknowledged: true, requestId: 'preview-1', ...extra });
async function publish() {
  const result = await call('save', { project: project(), expectedVersion: 0, requestId: 'publish-1' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.project;
}
async function preview(extra) {
  const result = await call('history_preview', correction(extra));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.available, true, JSON.stringify(result.body));
  return result.body;
}
const confirmData = (offer, requestId = 'confirm-1') => ({ requestId, offerId: offer.offer.id, offerVersion: offer.offer.version, optionId: offer.options[0].id, backdatingAcknowledged: true });
beforeEach(async () => {
  const response = await fetch(`http://127.0.0.1:8398/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.ok, true);
  const seed = {
    'users/demo-owner': { role: 'admin', active: true, name: 'Synthetic owner' },
    'users/demo-finance': { role: 'accounting', active: true }, 'users/demo-office': { role: 'office', active: true },
    'users/demo-inactive': { role: 'admin', active: false }, 'users/demo-tech': { role: 'technician', active: true },
    'clients/DEMO-C': { name: 'Synthetic customer', active: true }, 'properties/DEMO-P': { clientId: 'DEMO-C', active: true, address: 'Synthetic site' },
    'appointments/DEMO-OLD': { appointmentId: 'DEMO-OLD', customerId: 'DEMO-C', propertyId: 'DEMO-P', date: '2026-09-21', status: 'cancelled', startTime: '08:30', endTime: '16:30',
      workOrderIds: ['DEMO-OLD-WO'], capacityLockIds: REGULAR_SLOTS.map(slot => lockId('2026-09-21', 'DEMO-VAN', slot)),
      assignments: [{ vanId: 'DEMO-VAN', vanName: 'Historical Van', technicianIds: ['DEMO-TECH-OLD'], quantity: 1, slots: 6, durationMinutes: 360, fullDay: true, time: '08:30', endTime: '16:30', role: 'primary' }] },
    'workOrders/DEMO-OLD-WO': { appointmentId: 'DEMO-OLD', clientId: 'DEMO-C', propertyId: 'DEMO-P', date: '2026-09-21', time: '08:30', appointmentCapacityEndTime: '16:30', vanId: 'DEMO-VAN', technicianIds: ['DEMO-TECH-OLD'], status: 'Cancelada', scheduledSlots: 6 },
    'vans/DEMO-VAN': { active: false, driverStaffId: 'DEMO-TECH-TODAY' },
    'payrollAttendance/DEMO-ATTENDANCE': { staffId: 'DEMO-TECH-OLD', date: '2026-09-21', hours: 8 },
  };
  await Promise.all(Object.entries(seed).map(([path, value]) => db.doc(path).set(value)));
});
after(async () => { await db.terminate(); await deleteApp(app); });

test('publish dry run writes nothing; explicit import is shared, canonical and idempotent', async () => {
  const input = { project: project(), expectedVersion: 0, requestId: 'publish-1' };
  assert.equal((await call('save', { ...input, dryRun: true })).status, 200);
  assert.equal((await db.collection('projectRecords').get()).size, 0);
  await publish();
  assert.equal((await call('save', input)).body.replayed, true);
  const secondSession = await call('list', {}, 'demo-finance');
  assert.equal(secondSession.body.projects[0].assignments[0].scheduledSlots, 6);
  assert.deepEqual(secondSession.body.projects[0].assignments[0].technicianIds, ['DEMO-TECH-OLD']);
  assert.equal((await db.collection('projectPlanningAudit').get()).size, 1);
});
test('six cancelled slots become two linked slots, preserving original, old crew, audit and silent registration', async () => {
  await db.doc('appointments/DEMO-OLD').update({ status: 'confirmed' });
  await db.doc('workOrders/DEMO-OLD-WO').update({ status: 'Confirmada' });
  await Promise.all(REGULAR_SLOTS.map(slot => db.doc(`bookingCapacityLocks/${lockId('2026-09-21', 'DEMO-VAN', slot)}`).set({ date: '2026-09-21', vanId: 'DEMO-VAN', slot, appointmentId: 'DEMO-OLD', active: true })));
  await publish();
  await createBookingAppointmentLifecycle({ db, schedulingProvider: createSchedulingProvider({ db }), clock }).cancelAppointment({ appointmentId: 'DEMO-OLD', reason: 'Historical capacity correction', actor: { id: 'demo-owner', name: 'Synthetic owner' } });
  const before = JSON.stringify(await get('appointments/DEMO-OLD'));
  const offer = await preview();
  const result = await call('history_confirm', confirmData(offer));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const replacement = result.body.appointment;
  assert.equal(replacement.assignments[0].slots, 2);
  assert.equal(replacement.capacityEndTime, '10:30');
  assert.deepEqual(replacement.assignments[0].technicianIds, ['DEMO-TECH-OLD']);
  assert.equal(JSON.stringify(await get('appointments/DEMO-OLD')), before);
  const order = await get(`workOrders/${result.body.workOrderIds[0]}`);
  assert.equal(order.scheduledSlots, 2); assert.equal(order.whatsappNotificationsEnabled, false);
  assert.deepEqual(order.notificationRecipients, []);
  const reload = (await call('list')).body.projects[0];
  assert.equal(reload.assignments.length, 2); assert.equal(reload.serverVersion, 2); assert.equal(reload.actualLaborHours, 0);
  const orders = await Promise.all(reload.assignments.map(link => get(`workOrders/${link.workOrderId}`)));
  assert.equal(orders.filter(item => item.status !== 'Cancelada').reduce((sum, item) => sum + item.scheduledSlots, 0), 2);
  const audit = await get('projectHistoricalCorrections/DEMO-OLD');
  assert.equal(audit.originalSlots, 6); assert.equal(audit.replacementSlots, 2); assert.equal(audit.actor.id, 'demo-owner');
  assert.equal((await db.collection('payrollAttendance').get()).size, 1);
  assert.equal((await db.collection('workVisits').get()).size, 0);
  assert.equal((await db.collection('whatsappMessages').get()).size, 0);
  const replay = await call('history_confirm', confirmData(offer));
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal((await db.collection('appointments').get()).size, 2);
  assert.equal((await db.collection('bookingCapacityLocks').where('active', '==', true).get()).size, 2);
  assert.equal((await db.collection('bookingCapacityLocks').where('active', '==', false).get()).size, 4);
});
test('fresh roles deny office, finance writes, technicians, inactive and missing users', async () => {
  for (const uid of ['demo-office', 'demo-tech', 'demo-inactive', 'missing']) assert.equal((await call('list', {}, uid)).status, 403);
  assert.equal((await call('save', { project: project(), requestId: 'x', expectedVersion: 0 }, 'demo-finance')).status, 403);
  await publish(); const offer = await preview();
  await db.doc('users/demo-owner').update({ active: false });
  assert.equal((await call('history_confirm', confirmData(offer))).status, 403);
});
test('foreign links, forged actuals and stale versions are rejected without partial writes', async () => {
  const foreign = project(); foreign.siteId = 'FOREIGN';
  assert.notEqual((await call('save', { project: foreign, requestId: 'x', expectedVersion: 0 })).status, 200);
  const actual = project(); actual.actualLaborHours = 6;
  assert.notEqual((await call('save', { project: actual, requestId: 'y', expectedVersion: 0 })).status, 200);
  const saved = await publish();
  assert.equal((await call('save', { project: saved, requestId: 'stale', expectedVersion: 0 })).status, 409);
  assert.equal((await db.collection('projectRecords').get()).size, 1);
});
test('conflicting Van or technician capacity is rejected even when inserted after preview', async () => {
  await publish(); const offer = await preview();
  await db.doc('workOrders/DEMO-CONFLICT').set({ date: '2026-09-21', time: '09:30', appointmentCapacityEndTime: '10:30', status: 'Confirmada', vanId: 'ANOTHER-VAN', technicianIds: ['DEMO-TECH-OLD'] });
  const result = await call('history_confirm', confirmData(offer));
  assert.notEqual(result.status, 200); assert.equal((await db.collection('appointments').get()).size, 1);
  assert.equal((await db.collection('projectHistoricalCorrections').get()).size, 0);
});
test('two competing replacements commit only one; normal office provider cannot confirm historical Project offers', async () => {
  await publish(); const a = await preview(); const b = await preview({ requestId: 'preview-2', slots: 1 });
  const generic = createBookingAuthority({ db, clock, availabilityProvider: createSchedulingProvider({ db }) });
  await assert.rejects(generic.createAppointment({ ...confirmData(a), idempotencyKey: 'unauthorized-generic', actor: { id: 'demo-office' } }), /Project Authority/);
  const results = await Promise.all([call('history_confirm', confirmData(a, 'race-a')), call('history_confirm', confirmData(b, 'race-b'))]);
  assert.equal(results.filter(result => result.status === 200).length, 1, JSON.stringify(results));
  assert.equal((await db.collection('appointments').get()).size, 2); assert.equal((await db.collection('projectHistoricalCorrections').get()).size, 1);
});
test('missing historical crew, unowned slots and an uncancelled source fail closed', async () => {
  await publish();
  for (const extra of [{ start: '11:30' }, { start: '15:30', slots: 2 }, { backdatingAcknowledged: false }]) assert.notEqual((await call('history_preview', correction(extra))).status, 200);
  await db.doc('appointments/DEMO-OLD').update({ status: 'confirmed' });
  assert.notEqual((await call('history_preview', correction())).status, 200);
  await db.doc('appointments/DEMO-OLD').update({ status: 'cancelled', assignments: [{ vanId: 'DEMO-VAN', slots: 6, technicianIds: [] }] });
  assert.notEqual((await call('history_preview', correction())).status, 200);
});
test('regular shared Project confirm and hold link atomically; office role cannot read cached Project offer or retry', async () => {
  await publish();
  const seed = seedRecords('2026-09-24');
  await Promise.all(Object.entries(seed).filter(([path]) => !path.startsWith('users/')).map(([path, value]) => db.doc(path).set(value)));
  await db.doc('properties/DEMO-P').update({ operationalZone: 'Santa Cruz' });
  const baseProvider = createSchedulingProvider({ db });
  const authority = createBookingAuthority({ db, clock, availabilityProvider: withProjectBookingLinks({ db, provider: baseProvider }) });
  const office = createOfficeBookingApi({ db, verifyIdToken: async uid => ({ uid }), bookingAuthority: authority, schedulingProvider: baseProvider });
  const invoke = (action, data) => office.handle({ method: 'POST', headers: { authorization: 'Bearer demo-owner' }, body: { action, data } });
  for (const [index, action] of ['create_appointment', 'create_temporary_hold'].entries()) {
    const version = (await get('projectRecords/DEMO-HISTORY-PROJECT')).serverVersion;
    const input = { requestId: `future-preview-${index}`, customerId: 'DEMO-C', propertyId: 'DEMO-P', requestedDate: '2026-09-24', requestedTime: index ? '13:30' : '08:30', requiredVanId: 'VAN-2',
      workLines: [{ presetId: 'standard_service', serviceId: 'SYNTHETIC-SERVICE', quantity: 2 }], project: { id: 'DEMO-HISTORY-PROJECT', phaseId: 'DEMO-PHASE', version } };
    const offer = await invoke('check_availability', input);
    assert.equal(offer.status, 200, JSON.stringify(offer.body)); assert.equal(offer.body.available, true, JSON.stringify(offer.body));
    const data = { requestId: `future-confirm-${index}`, offerId: offer.body.offer.id, offerVersion: offer.body.offer.version, optionId: offer.body.options[0].id };
    const result = await invoke(action, data);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const saved = await get('projectRecords/DEMO-HISTORY-PROJECT');
    const link = saved.assignments.find(item => item.appointmentId === result.body.appointmentId);
    assert.ok(link); assert.equal(link.scheduledSlots, 2); assert.equal(link.bookingStatus, index ? 'temporary_hold' : 'confirmed');
    assert.equal(result.body.appointment.projectId, saved.id);
    assert.equal((await invoke(action, data)).body.replayed, true);
    await db.doc('users/demo-owner').update({ role: 'office' });
    assert.notEqual((await invoke(action, data)).status, 200);
    assert.notEqual((await invoke('check_availability', input)).status, 200);
    await db.doc('users/demo-owner').update({ role: 'admin' });
  }
});
test('capacity locks, phase edits and cross-Project claims reject stale or ambiguous corrections', async () => {
  await publish(); const offer = await preview();
  await db.doc(`bookingCapacityLocks/${lockId('2026-09-21', 'DEMO-VAN', '08:30')}`).set({ active: true, appointmentId: 'OTHER' });
  assert.notEqual((await call('history_confirm', confirmData(offer))).status, 200);
  assert.equal((await db.collection('projectHistoricalCorrections').get()).size, 0);
  await db.doc(`bookingCapacityLocks/${lockId('2026-09-21', 'DEMO-VAN', '08:30')}`).delete();
  await db.doc('projectRecords/DEMO-HISTORY-PROJECT').update({ serverVersion: 2 });
  assert.equal((await call('history_confirm', confirmData(offer))).status, 409);
  const other = project(); other.id = 'DEMO-OTHER'; other.projectNumber = 'DEMO-OTHER'; other.assignments[0].projectId = other.id;
  assert.notEqual((await call('save', { project: other, requestId: 'foreign-claim', expectedVersion: 0 })).status, 200);
});
test('direct anonymous Firestore access to Project records and audit is denied by existing rules', async () => {
  await publish();
  for (const collection of ['projectRecords', 'projectPlanningAudit', 'projectHistoricalCorrections', 'projectBookingClaims']) {
    const response = await fetch(`http://127.0.0.1:8398/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/DEMO-TEST`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { forged: { booleanValue: true } } }),
    });
    assert.equal(response.status, 403, collection);
  }
});
