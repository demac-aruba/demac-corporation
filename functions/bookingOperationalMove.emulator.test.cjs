const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { PROJECT, assertIsolated, resetSynthetic } = require('./test-support/manualMoveSynthetic.cjs');
const { createOperationalMoveAuthority } = require('./bookingOperationalMove');
const { createAfterHoursAuthority } = require('./bookingAfterHours');
const { createOfficeBookingAuthorityFacade } = require('./officeBookingAuthorityFacade');
const { candidateAvailability, assignmentCapacityInterval } = require('./bookingCapacityAvailability');
const { createBookingAuthority } = require('./bookingAuthorityFirestore');
const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { arubaDateParts, REGULAR_SLOTS } = require('./bookingSchedulingPrimitives');
const { BOOKING_ERROR_CODES } = require('./bookingAuthorityCore');
assertIsolated();
const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const date = arubaDateParts(new Date()).date;
const authority = createOperationalMoveAuthority({ db });
const afterHours = createAfterHoursAuthority({ db });
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken: async (token) => {
  if (!['demo-office', 'demo-technician'].includes(token)) throw new Error('Invalid demo token');
  return { uid: token };
} });
const input = (requestId = 'emulator-move-001') => ({ appointmentId: 'DEMO-APT', requestId, requestedDate: date, requestedTime: '14:30', targetVanId: 'VAN-2', actor: { id: 'demo-office', source: 'office-scheduling' } });
const get = async (path) => (await db.doc(path).get()).data();
async function prepared(request = input()) {
  const { proposal } = await authority.prepareMove(request);
  return { ...request, overtimeConsent: { accepted: true, confirmationToken: proposal.confirmationToken } };
}
async function snapshot() {
  const result = {};
  for (const collection of ['appointments', 'workOrders', 'bookingCapacityLocks', 'bookingIdempotency', 'employeeTimesheets', 'whatsappOutboundQueue']) result[collection] = (await db.collection(collection).orderBy('__name__').get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return result;
}
beforeEach(() => resetSynthetic(db, date));
after(() => deleteApp(app));

test('real Firestore preparation is read only; commit persists the complete move and actual payroll stays untouched', async () => {
  const before = await snapshot();
  const request = await prepared();
  assert.deepEqual(await snapshot(), before);
  await authority.moveAppointment(request);
  const appointment = await get('appointments/DEMO-APT');
  assert.equal(appointment.endTime, '17:30');
  assert.equal(appointment.capacityLockIds.length, 3);
  assert.equal(appointment.lifecycleHistory.length, 1);
  assert.equal((await get('workOrders/DEMO-WO')).scheduledSlots, 3);
  assert.equal((await db.collection('employeeTimesheets').get()).size, 0);
  assert.equal((await db.collection('whatsappOutboundQueue').get()).size, 0);
  assert.equal((await authority.moveAppointment(request)).replayed, true);
});

test('simultaneous duplicate submissions commit one lifecycle event and one receipt', async () => {
  const request = await prepared();
  const results = await Promise.all([authority.moveAppointment(request), authority.moveAppointment(request)]);
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal((await get('appointments/DEMO-APT')).lifecycleHistory.length, 1);
  assert.equal((await db.collection('bookingIdempotency').get()).size, 1);
});

test('two appointments racing for the same destination have one winner and preserve the loser', async () => {
  const second = { ...await get('appointments/DEMO-APT'), appointmentId: 'DEMO-APT-2', primaryVanId: 'VAN-3', workOrderIds: ['DEMO-WO-2'], capacityLockIds: [], assignments: [{ vanId: 'VAN-3', time: '08:30', endTime: '11:30', slots: 3, quantity: 3, role: 'primary' }] };
  await db.doc('appointments/DEMO-APT-2').set(second);
  await db.doc('workOrders/DEMO-WO-2').set({ ...await get('workOrders/DEMO-WO'), appointmentId: 'DEMO-APT-2', vanId: 'VAN-3', technicianIds: ['DRIVER-3', 'HELPER-3'] });
  const a = await prepared();
  const b = await prepared({ ...input('emulator-move-002'), appointmentId: 'DEMO-APT-2' });
  const results = await Promise.allSettled([authority.moveAppointment(a), authority.moveAppointment(b)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(results.some((result) => result.status === 'rejected' && result.reason.code === BOOKING_ERROR_CODES.SLOT_CONFLICT));
  const loser = results[0].status === 'rejected' ? 'DEMO-APT' : 'DEMO-APT-2';
  assert.equal((await get(`appointments/${loser}`)).startTime, '08:30');
  assert.equal((await get(`appointments/${loser}`)).lifecycleHistory.length, 0);
});

test('new additional-interval blocker after preview rejects confirmation with no partial writes', async () => {
  const request = await prepared();
  await db.doc('workOrders/DEMO-CONFLICT').set({ appointmentId: 'DEMO-OTHER', date, time: '17:00', vanId: 'VAN-2', status: 'Confirmada', appointmentDurationMinutes: 60 });
  const before = await snapshot();
  await assert.rejects(() => authority.moveAppointment(request));
  assert.deepEqual(await snapshot(), before);
});

test('after-hours emergency and a bounded transfer share serialization and cannot overlap', async () => {
  const request = await prepared();
  const emergency = { requestId: 'synthetic-after-hours-race', customerId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY', presetId: 'standard_service', requestedDate: date, requestedTime: '17:00', requiredVanId: 'VAN-2', actor: { id: 'demo-office' } };
  const results = await Promise.allSettled([authority.moveAppointment(request), afterHours.createEmergency(emergency)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, JSON.stringify(results));
  assert.ok(results.some((result) => result.status === 'rejected' && result.reason.code === BOOKING_ERROR_CODES.SLOT_CONFLICT), JSON.stringify(results));
  if (results[0].status === 'rejected') assert.equal((await get('appointments/DEMO-APT')).startTime, '08:30');
  else assert.equal((await get('appointments/DEMO-APT')).endTime, '17:30');
});

test('existing office permission boundary rejects technicians and unauthenticated callers for prepare and confirm', async () => {
  for (const action of ['prepare_appointment_move', 'move_appointment']) {
    for (const token of ['', 'demo-technician', 'invalid']) {
      const result = await facade.handle({ method: 'POST', headers: { authorization: token ? `Bearer ${token}` : '' }, body: { action, data: { ...input(), requiredVanId: 'VAN-2' } } });
      assert.ok([401, 403].includes(result.status), JSON.stringify(result));
    }
  }
  assert.equal((await get('appointments/DEMO-APT')).startTime, '08:30');
});

test('canonical booking availability does not gain overtime capacity, and accepted ordinary tail remains blocked', async () => {
  assert.deepEqual(REGULAR_SLOTS, ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30']);
  assert.equal(assignmentCapacityInterval({ time: '14:30', allocation: { slots: 3, durationMinutes: 180 }, halfDay: false }), null);
  await authority.moveAppointment(await prepared());
  const order = await get('workOrders/DEMO-WO');
  const available = candidateAvailability({ date, time: '15:30', allocation: { slots: 1, durationMinutes: 60 }, van: { id: 'VAN-2', active: true }, assignment: { driverStaffId: 'DRIVER-2', status: 'Disponible' }, data: { workOrders: [order], services: [], properties: [], vanHalfDaySchedules: [] } });
  assert.equal(available, null);
});

test('a normal Booking Authority creation racing the transfer cannot double-book the ordinary tail', async () => {
  const booking = createBookingAuthority({ db, availabilityProvider: createSchedulingProvider({ db }), clock: () => new Date(`${date}T12:00:00Z`) });
  const offerResult = await booking.checkAvailability({ request: { customerId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY', workLines: [{ id: 'line-1', presetId: 'standard_service', serviceId: 'SYNTHETIC-SERVICE', quantity: 1 }], constraints: { requestedDate: date, requestedTime: '15:30' } }, actor: { id: 'demo-office' }, context: { channel: 'office', requiredPrimaryVanId: 'VAN-2' } });
  assert.equal(offerResult.available, true, JSON.stringify(offerResult));
  const request = await prepared();
  const option = offerResult.options[0];
  const results = await Promise.allSettled([
    authority.moveAppointment(request),
    booking.createAppointment({ offerId: offerResult.offer.id, offerVersion: offerResult.offer.version, optionId: option.id, idempotencyKey: 'demo-booking-race-001', actor: { id: 'demo-office' }, context: { channel: 'office' } }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, JSON.stringify(results));
  assert.ok(results.some((result) => result.status === 'rejected' && [BOOKING_ERROR_CODES.SLOT_CONFLICT, BOOKING_ERROR_CODES.AVAILABILITY_CHANGED].includes(result.reason.code)), JSON.stringify(results));
  assert.equal((await db.collection('appointments').where('primaryVanId', '==', 'VAN-2').get()).size, 1);
});
