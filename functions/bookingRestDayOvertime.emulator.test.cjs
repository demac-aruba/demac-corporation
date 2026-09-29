const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { PROJECT, assertIsolated, resetSynthetic } = require('./test-support/manualMoveSynthetic.cjs');
const { createAfterHoursAuthority } = require('./bookingAfterHours');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
assertIsolated();
const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const date = '2098-12-23';
const authority = createAfterHoursAuthority({ db, clock: () => new Date('2098-12-22T12:00:00Z') });
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async token => {
  if (!['demo-office', 'demo-technician'].includes(token)) throw Error('Invalid synthetic token');
  return { uid: token };
} });
const input = (extra = {}) => ({ requestId: 'synthetic-rest-overtime-001', customerId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY',
  presetId: 'standard_service', quantity: 4, requestedDate: date, requestedTime: '13:30', requiredVanId: 'VAN-2', actor: { id: 'demo-office', source: 'office-scheduling' }, ...extra });
async function prepared(request = input()) {
  const { proposal } = await authority.prepareRestDayOvertime(request);
  return { ...request, overtimeConsent: { accepted: true, confirmationToken: proposal.confirmationToken } };
}
async function snapshot() {
  const result = {};
  for (const name of ['appointments', 'workOrders', 'bookingCapacityLocks', 'employeeTimesheets', 'whatsappOutboundQueue']) result[name] = (await db.collection(name).get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return result;
}
beforeEach(async () => {
  await resetSynthetic(db, date);
  await db.doc('vanHalfDaySchedules/REST-VAN-2').set({ vanId: 'VAN-2', weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), active: true, workdayStart: '08:00', workdayEnd: '13:00' });
});
after(() => deleteApp(app));

test('preparation is read-only; concurrent duplicate confirmation creates one appointment and one audited acceptance', async () => {
  const before = await snapshot();
  const request = await prepared();
  assert.deepEqual(await snapshot(), before);
  const results = await Promise.all([authority.createRestDayOvertime(request), authority.createRestDayOvertime(request)]);
  assert.equal(results.filter(result => !result.replayed).length, 1);
  const saved = results[0].appointment;
  assert.equal(saved.endTime, '17:30');
  assert.equal(saved.capacityLockIds.length, 4);
  assert.equal(saved.lifecycleHistory.length, 1);
  assert.equal((await db.collection('employeeTimesheets').get()).size, 0);
  assert.equal((await db.collection('whatsappOutboundQueue').get()).size, 0);
});

test('two distinct overtime bookings racing for the same rest interval have one winner', async () => {
  const a = await prepared();
  const b = await prepared(input({ requestId: 'synthetic-rest-overtime-002' }));
  const results = await Promise.allSettled([authority.createRestDayOvertime(a), authority.createRestDayOvertime(b)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await db.collection('appointments').where('primaryVanId', '==', 'VAN-2').get()).size, 1);
});

test('emergency and four-service rest booking share serialization and cannot overlap', async () => {
  const request = await prepared();
  const emergency = input({ requestId: 'synthetic-future-emergency', requestedTime: '17:00', quantity: 1 });
  const results = await Promise.allSettled([authority.createRestDayOvertime(request), authority.createEmergency(emergency)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, JSON.stringify(results));
});

test('dated schedule change and new reservation after consent fail without partial writes', async () => {
  const request = await prepared();
  await db.doc('vanHalfDaySchedules/REST-VAN-2').update({ workdayEnd: '12:30' });
  const before = await snapshot();
  await assert.rejects(() => authority.createRestDayOvertime(request), /Confirm the current overtime/);
  assert.deepEqual(await snapshot(), before);
});

test('office facade rejects unauthenticated and technician prepare/create; office confirmed path succeeds', async () => {
  for (const action of ['prepare_rest_day_overtime', 'create_rest_day_overtime', 'create_after_hours_emergency']) {
    for (const token of ['', 'demo-technician', 'invalid']) {
      const result = await facade.handle({ method: 'POST', headers: { authorization: token ? `Bearer ${token}` : '' }, body: { action, data: input() } });
      assert.ok([401, 403].includes(result.status), JSON.stringify(result));
    }
  }
  const handle = (action, data) => facade.handle({ method: 'POST', headers: { authorization: 'Bearer demo-office' }, body: { action, data } });
  const preview = await handle('prepare_rest_day_overtime', input());
  assert.equal(preview.status, 200, JSON.stringify(preview));
  const result = await handle('create_rest_day_overtime', { ...input(), overtimeConsent: { accepted: true, confirmationToken: preview.body.proposal.confirmationToken } });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.appointment.endTime, '17:30');
});

test('ordinary availability still excludes weekly rest, including after confirmed overtime', async () => {
  const booking = createBookingAuthority({ db, availabilityProvider: createSchedulingProvider({ db }), clock: () => new Date('2098-12-22T12:00:00Z') });
  const check = () => booking.checkAvailability({ request: { customerId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY', workLines: [{ presetId: 'standard_service', quantity: 1 }], constraints: { requestedDate: date, requestedTime: '13:30' } }, actor: { id: 'demo-office' }, context: { channel: 'office', requiredPrimaryVanId: 'VAN-2' } });
  assert.equal((await check()).available, false);
  await authority.createRestDayOvertime(await prepared());
  assert.equal((await check()).available, false);
});
