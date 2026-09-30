'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createRegularHistoricalCapacityAuthority, lockId } = require('./bookingRegularHistoricalCapacity');

const PROJECT = 'demo-demac-project-history';
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8398'
  || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw Error('Regular historical capacity tests require the isolated loopback demo emulator without production credentials.');
}

const app = initializeApp({ projectId: PROJECT }, 'regular-historical-capacity-tests');
const db = getFirestore(app);
const date = '2026-09-21';
const appointmentId = 'DEMO-REGULAR-APT';
const workOrderId = 'DEMO-REGULAR-WO';
const vanId = 'DEMO-REGULAR-VAN';
const anchors = ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30'];
const authority = createRegularHistoricalCapacityAuthority({ db, clock: () => new Date('2026-09-23T14:00:00Z') });
const actor = { id: 'demo-office', name: 'Synthetic office user', source: 'office-scheduling' };
const request = (requestId, slots, expectedSlots = 3) => ({ appointmentId, requestId, slots, expectedSlots,
  reason: 'Correct synthetic historical Van allocation', noBillingAcknowledged: true });
const get = async path => (await db.doc(path).get()).data();
const lockPath = slot => `bookingCapacityLocks/${lockId(date, vanId, slot)}`;

beforeEach(async () => {
  const response = await fetch(`http://127.0.0.1:8398/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.ok, true, 'synthetic emulator reset');
  const assignment = { vanId, technicianIds: ['DEMO-TECH'], time: '08:30', quantity: 3, slots: 3,
    durationMinutes: 180, endTime: '11:30', capacityEndTime: '11:30', role: 'primary', fullDay: false };
  const seed = {
    [`appointments/${appointmentId}`]: { appointmentId, bookingAuthorityVersion: 1, status: 'confirmed',
      customerId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY', date, startTime: '08:30',
      endTime: '11:30', capacityEndTime: '11:30', primaryVanId: vanId,
      workOrderIds: [workOrderId], assignments: [assignment],
      capacityLockIds: anchors.slice(0, 3).map(slot => lockId(date, vanId, slot)), lifecycleHistory: [] },
    [`workOrders/${workOrderId}`]: { appointmentId, clientId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY',
      date, time: '08:30', vanId, technicianIds: ['DEMO-TECH'], status: 'Confirmada',
      scheduledSlots: 3, appointmentDurationMinutes: 180, appointmentEndTime: '11:30',
      appointmentCapacityEndTime: '11:30', airConditionerCount: 3, fullDaySingleProperty: false,
      appointmentWorkItems: [{ id: 'DEMO-SERVICE', quantity: 3, durationMinutesPerUnit: 60,
        durationMinutes: 180, durationMode: 'per_unit' }] },
  };
  anchors.slice(0, 3).forEach(slot => { seed[lockPath(slot)] = { date, vanId, slot, appointmentId, active: true }; });
  const batch = db.batch();
  for (const [path, value] of Object.entries(seed)) batch.set(db.doc(path), value);
  await batch.commit();
});
after(async () => { await db.terminate(); await deleteApp(app); });

test('simultaneous corrections with the same expected slots commit exactly once', async () => {
  const outcomes = await Promise.allSettled([
    authority.adjust(actor, request('regular-race-request-a', 4)),
    authority.adjust(actor, request('regular-race-request-b', 5)),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1, JSON.stringify(outcomes));
  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
  const result = outcomes.find(outcome => outcome.status === 'fulfilled').value;
  const appointment = await get(`appointments/${appointmentId}`);
  assert.equal(appointment.assignments[0].slots, result.currentSlots);
  assert.equal((await get(`workOrders/${workOrderId}`)).scheduledSlots, result.currentSlots);
  assert.equal((await db.collection('regularCapacityCorrections').get()).size, 1);
  assert.equal((await db.collection('bookingCapacityLocks').where('active', '==', true).get()).size, result.currentSlots);
  for (const slot of anchors.slice(0, result.currentSlots)) assert.equal((await get(lockPath(slot))).appointmentId, appointmentId);
});

test('correction and a competing transactional reservation cannot both own the added anchor', async () => {
  const reserveNewBooking = () => db.runTransaction(async transaction => {
    const targetRef = db.doc(lockPath('13:30'));
    const target = await transaction.get(targetRef);
    if (target.exists && target.data().active !== false) throw Error('Historical Van anchor is already reserved.');
    // This models the shared lock transaction of a new booking, not the full
    // availability/offer flow; the added anchor is the contention boundary.
    transaction.set(targetRef, { date, vanId, slot: '13:30', appointmentId: 'DEMO-NEW-APT', active: true });
    transaction.set(db.doc('appointments/DEMO-NEW-APT'), { appointmentId: 'DEMO-NEW-APT', date,
      primaryVanId: vanId, status: 'confirmed' });
    transaction.set(db.doc('workOrders/DEMO-NEW-WO'), { appointmentId: 'DEMO-NEW-APT', date,
      time: '13:30', vanId, technicianIds: ['DEMO-OTHER-TECH'], status: 'Confirmada',
      appointmentEndTime: '14:30', appointmentCapacityEndTime: '14:30', appointmentDurationMinutes: 60 });
    return 'new booking';
  });
  const outcomes = await Promise.allSettled([
    authority.adjust(actor, request('regular-competing-reservation', 4)),
    reserveNewBooking(),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1, JSON.stringify(outcomes));
  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
  const correctionWon = outcomes[0].status === 'fulfilled';
  const addedLock = await get(lockPath('13:30'));
  assert.equal(addedLock.appointmentId, correctionWon ? appointmentId : 'DEMO-NEW-APT');
  assert.equal((await get(`appointments/${appointmentId}`)).assignments[0].slots, correctionWon ? 4 : 3);
  assert.equal((await db.collection('regularCapacityCorrections').get()).size, correctionWon ? 1 : 0);
  assert.equal(Boolean(await get('appointments/DEMO-NEW-APT')), !correctionWon);
});

test('A to B then exact A retry is read-only and reports latest slots separately', async () => {
  const first = request('regular-retry-request-a', 4);
  const second = request('regular-retry-request-b', 2, 4);
  assert.equal((await authority.adjust(actor, first)).currentSlots, 4);
  assert.equal((await authority.adjust(actor, second)).currentSlots, 2);
  const before = await db.doc(`appointments/${appointmentId}`).get();
  const auditCount = (await db.collection('regularCapacityCorrections').get()).size;
  const replay = await authority.adjust(actor, first);
  const after = await db.doc(`appointments/${appointmentId}`).get();
  assert.equal(replay.replayed, true);
  assert.equal(replay.currentSlots, 4, 'immutable result of A');
  assert.equal(replay.observedCurrentSlots, 2, 'live state after B');
  assert.equal(replay.currentMatchesAudit, false);
  assert.equal(after.updateTime.toMillis(), before.updateTime.toMillis(), 'exact retry must not write');
  assert.equal((await db.collection('regularCapacityCorrections').get()).size, auditCount);
  assert.equal((await get(lockPath('13:30'))).active, false);
});
