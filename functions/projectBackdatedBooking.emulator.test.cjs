const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { PROJECT, assertIsolated, resetSynthetic } = require('./test-support/manualMoveSynthetic.cjs');
const { createOfficeBookingApi } = require('./officeBookingAuthority');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { withProjectBookingLinks } = require('./projectBookingLinks');

assertIsolated();
const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const now = new Date('2026-10-05T17:24:00Z'); // 13:24 in Aruba, matching the reported case.
const provider = withProjectBookingLinks({ db, provider: createSchedulingProvider({ db }) });
const authority = createBookingAuthority({ db, availabilityProvider: provider, clock: () => now });
const api = createOfficeBookingApi({ db, verifyIdToken: async () => ({ uid: 'demo-office' }), bookingAuthority: authority });
const input = (overrides = {}) => ({
  requestId: 'historical-project-check', customerId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY',
  project: { id: 'DEMO-PROJECT', phaseId: 'PHASE-1', version: 1 },
  workLines: [{ presetId: 'other', quantity: 1, manualDurationMinutes: 120 }],
  requestedDate: '2026-10-05', requestedTime: '08:30', requiredVanId: 'VAN-2',
  bookingMode: 'backdated', backdatingAcknowledged: true, ...overrides,
});
const call = (action, data) => api.handle({ method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: { action, data } });
async function offer(overrides) {
  const response = await call('check_availability', input(overrides));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.available, true, JSON.stringify(response.body));
  return { requestId: 'historical-project-create', offerId: response.body.offer.id,
    offerVersion: response.body.offer.version, optionId: response.body.options[0].id,
    bookingMode: 'backdated', backdatingAcknowledged: true };
}
async function get(path) { return (await db.doc(path).get()).data(); }
async function count(collection) { return (await db.collection(collection).get()).size; }
async function assertNoNewWork() {
  assert.equal(await count('appointments'), 1); // Only the unrelated seeded booking.
  assert.equal(await count('workOrders'), 1);
  assert.equal(await count('bookingCapacityLocks'), 3);
  assert.equal((await get('projectRecords/DEMO-PROJECT')).assignments.length, 0);
  assert.equal(await count('projectBookingClaims'), 0);
}
beforeEach(async () => {
  await resetSynthetic(db, '2026-10-05');
  await db.doc('projectRecords/DEMO-PROJECT').set({
    id: 'DEMO-PROJECT', projectNumber: 'PRJ-HISTORY-001', name: 'Unscheduled completed work',
    customerId: 'DEMO-CUSTOMER', siteId: 'DEMO-PROPERTY', status: 'Planned', serverVersion: 1,
    phases: [{ id: 'PHASE-1', name: 'Installation', status: 'Planned', workflowStatus: 'Ready to Schedule' }],
    assignments: [], assignedVans: [], scheduledFutureHours: 0, actualLaborHours: 0,
    estimatedSlots: 20, estimatedLaborHours: 20, slotDurationMinutes: 60, slotsPerWorkDay: 6,
  });
});
after(() => deleteApp(app));

test('owner and office operators record unbooked Project work today and on past dates for every Van', async () => {
  for (const [index, role] of ['owner', 'office', 'office_operator', 'operator'].entries()) {
    await db.doc('users/demo-office').update({ role });
    const date = index === 0 ? '2026-10-02' : '2026-10-05';
    const project = await get('projectRecords/DEMO-PROJECT');
    const args = await offer({ requestedDate: date, requiredVanId: `VAN-${index + 1}`,
      project: { id: project.id, phaseId: 'PHASE-1', version: project.serverVersion } });
    const response = await call('create_appointment', args);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const appointment = await get(`appointments/${response.body.appointmentId}`);
    const order = await get(`workOrders/${response.body.workOrderIds[0]}`);
    assert.equal(appointment.date, date);
    assert.equal(appointment.primaryVanId, `VAN-${index + 1}`);
    assert.equal(appointment.backdated, true);
    assert.equal(appointment.backdatingAcknowledged, true);
    assert.equal(appointment.workAlreadyPerformed, true);
    assert.equal(appointment.createdBy, 'demo-office');
    assert.equal(appointment.backdatedRecordedAtIso, now.toISOString());
    assert.deepEqual(appointment.notificationRecipients, []);
    assert.equal(appointment.capacityLockIds.length, 2);
    assert.equal(order.projectId, 'DEMO-PROJECT');
    assert.equal(order.workAlreadyPerformed, true);
    assert.equal(order.whatsappNotificationsEnabled, false);
    const replay = await call('create_appointment', args);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.appointmentId, response.body.appointmentId);
  }
  const project = await get('projectRecords/DEMO-PROJECT');
  assert.equal(project.assignments.length, 4);
  assert.equal(project.scheduledFutureHours, 8);
  assert.equal(project.actualLaborHours, 0);
  for (const collection of ['employeeTimesheets', 'workVisits', 'whatsappOutboundQueue', 'invoices']) assert.equal(await count(collection), 0);
});

test('past Project registration requires acknowledged intent at availability and confirmation and cannot be held', async () => {
  assert.equal((await call('check_availability', input({ backdatingAcknowledged: false }))).status, 409);
  const normal = await call('check_availability', input({ bookingMode: undefined, backdatingAcknowledged: undefined }));
  assert.equal(normal.body.available, false);
  const args = await offer();
  assert.equal((await call('create_appointment', { ...args, bookingMode: undefined, backdatingAcknowledged: undefined })).status, 409);
  assert.equal((await call('create_temporary_hold', args)).status, 409);
  await assertNoNewWork();
});

test('backdating preserves historical conflicts, company closures and crew absences', async () => {
  const busy = await call('check_availability', input({ requiredVanId: 'VAN-1' }));
  assert.equal(busy.body.available, false);
  const sunday = await call('check_availability', input({ requestedDate: '2026-10-04' }));
  assert.equal(sunday.body.available, false);
  await db.doc('staffAbsences/ABSENCE').set({ staffId: 'DRIVER-2', fromDate: '2026-10-05', toDate: '2026-10-05', active: true });
  const absent = await call('check_availability', input());
  assert.equal(absent.body.available, false);
  await assertNoNewWork();
});

test('a Project changed after the offer or a revoked operator cannot commit any booking records', async () => {
  const args = await offer();
  await db.doc('projectRecords/DEMO-PROJECT').update({ serverVersion: 2 });
  assert.notEqual((await call('create_appointment', args)).status, 200);
  await assertNoNewWork();
  await db.doc('projectRecords/DEMO-PROJECT').update({ serverVersion: 1 });
  await db.doc('users/demo-office').update({ active: false });
  assert.equal((await call('create_appointment', args)).status, 403);
  await assertNoNewWork();
});

test('concurrent exact retries create one historical appointment and one Project link', async () => {
  const args = await offer();
  const responses = await Promise.all([call('create_appointment', args), call('create_appointment', args)]);
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(responses.filter(response => response.body.replayed === false).length, 1);
  assert.equal(responses[0].body.appointmentId, responses[1].body.appointmentId);
  assert.equal((await get('projectRecords/DEMO-PROJECT')).assignments.length, 1);
  assert.equal(await count('appointments'), 2);
  assert.equal(await count('projectBookingClaims'), 1);
});

test('competing Project offers cannot both reserve the same historical capacity', async () => {
  const a = await offer({ requestId: 'historical-project-race-a' });
  const b = await offer({ requestId: 'historical-project-race-b' });
  const responses = await Promise.all([call('create_appointment', a), call('create_appointment', b)]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal((await get('projectRecords/DEMO-PROJECT')).assignments.length, 1);
  assert.equal(await count('appointments'), 2);
  assert.equal(await count('projectBookingClaims'), 1);
});
