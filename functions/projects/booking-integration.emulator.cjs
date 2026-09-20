'use strict';
// Actual Firebase Auth + Firestore transactions. Scheduling inputs are deterministic fixtures;
// the existing Booking Authority/provider regression suite remains a separate mandatory gate.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const PROJECT = 'demo-demac-projects';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error(`Loopback ${key} required.`);
}
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Only credential-free demo emulators are allowed.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { createOfficeBookingApi } = require('../officeBookingAuthority');
const { createProjectRegistryService } = require('./registry-service');
const { createBookingAuthority } = require('../bookingAuthorityFirestore');
const { createProjectBookingIntegration } = require('./booking-integration');
const app = initializeApp({ projectId: PROJECT }, 'project-booking-atomic-tests');
const db = getFirestore(app), auth = getAuth(app);
const registry = createProjectRegistryService({ db, verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), enabled: true });
const users = {}; let sequence = 0;
const id = prefix => `PB-EMULATOR-${prefix}-${++sequence}`;
const flags = { backendEnabled: true, bookingEnabled: true };
const protectedCollections = ['clients', 'properties', 'appointments', 'workOrders', 'bookingCapacityLocks', 'workVisits', 'whatsappOutboundQueue', 'warehouseInventory'];
async function registryCommand(action, data) {
  return registry.execute({ idToken: users.owner.token, command: { action, data, requestId: id('registry') } });
}
async function readPlan(projectId) { return (await registryCommand('get_plan', { projectId })).project; }
async function fixture({ enabled = true, malformedOrder = false, transactionDb = db } = {}) {
  const prefix = id('scope');
  const customerId = `${prefix}-C`, propertyId = `${prefix}-S`;
  await db.collection('clients').doc(customerId).set({ name: 'Synthetic project client', active: true });
  await db.collection('properties').doc(propertyId).set({ clientId: customerId, active: true });
  await db.collection('businessSettings').doc('projects-registry').set(flags);
  const plan = await registryCommand('create_plan', { name: prefix, type: 'VRF Project', customerId, propertyId, startsOn: '2099-01-01', estimatedCompletionOn: '2099-12-31', budgetedVanMinutes: 180, phases: [] });
  const option = {
    id: `${prefix}-OPTION`, date: '2099-09-18', time: '08:30', endTime: '15:30', capacityEndTime: '15:30',
    presetId: 'other', serviceId: 'SERVICE-TEST', quantity: 1, durationMode: 'manual', durationMinutes: 360,
    assignments: [{ vanId: `${prefix}-VAN-A`, role: 'primary', quantity: 1, slots: 6 }, { vanId: `${prefix}-VAN-B`, role: 'support', quantity: 1, slots: 2 }],
  };
  const provider = {
    checkAvailability: async () => ({ options: [option] }),
    revalidateSelection: async () => ({ available: true, option }),
    validateTransaction: async () => ({ available: true, capacityLocks: option.assignments.map((row, index) => ({ id: `${prefix}-LOCK-${index}`, vanId: row.vanId, date: option.date, slot: option.time })) }),
    buildWorkOrders: async ({ appointment }) => [360, 120].map((minutes, index) => ({
      id: `${appointment.appointmentId}-WO-${index}`, appointmentId: appointment.appointmentId,
      clientId: malformedOrder && index === 1 ? 'FOREIGN-CLIENT' : customerId, propertyId,
      vanId: option.assignments[index].vanId, appointmentAssignmentRole: index ? 'support' : 'primary',
      status: appointment.status === 'temporary_hold' ? 'Reserva temporal' : 'Confirmada',
      appointmentDurationMinutes: minutes, scheduledSlots: minutes / 60, date: option.date, time: option.time,
    })),
  };
  const authority = createBookingAuthority({ db: transactionDb, availabilityProvider: provider,
    projectIntegration: createProjectBookingIntegration({ db: transactionDb, enabled }) });
  const office = createOfficeBookingApi({ db: transactionDb, verifyIdToken: token => auth.verifyIdToken(token, true),
    schedulingProvider: provider, bookingAuthority: authority, projectsEnabled: enabled });
  const call = async (action, data, who = 'owner') => office.handle({ method: 'POST', headers: { authorization: `Bearer ${users[who].token}` }, body: { action, data } });
  const selected = { projectId: plan.projectId, phaseId: null, expectedVersion: 1 };
  const check = async (requestId = id('availability'), selection = selected) => {
    const response = await call('check_availability', { requestId, customerId, propertyId,
      requestedDate: option.date, requestedTime: option.time,
      workLines: [{ id: 'WORK-TEST', presetId: 'other', serviceId: 'SERVICE-TEST', quantity: 1, manualDurationMinutes: 360 }],
      ...(selection ? { projectSelection: selection } : {}),
    });
    return response;
  };
  const commit = async (offer, requestId = id('confirm'), action = 'create_appointment', who = 'owner') => call(action, {
    requestId, offerId: offer.id, offerVersion: offer.version, optionId: option.id,
  }, who);
  const allocation = async () => ({
    appointments: (await db.collection('appointments').where('customerId', '==', customerId).get()).docs.map(row => row.id).sort(),
    workOrders: (await db.collection('workOrders').where('propertyId', '==', propertyId).get()).docs.map(row => row.id).sort(),
    links: (await db.collection('projectAppointmentLinks').where('projectId', '==', plan.projectId).get()).docs.map(row => row.id).sort(),
    events: (await db.collection('projectEvents').where('projectId', '==', plan.projectId).where('action', '==', 'appointment_linked_at_booking').get()).docs.map(row => row.id).sort(),
    locks: (await db.getAll(...option.assignments.map((_, index) => db.collection('bookingCapacityLocks').doc(`${prefix}-LOCK-${index}`)))).filter(row => row.exists).map(row => row.id),
  });
  const offer = async () => { const response = await check(); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.offer; };
  return { plan, option, customerId, propertyId, call, check, offer, commit, allocation };
}
const EMPTY = { appointments: [], workOrders: [], links: [], events: [], locks: [] };
before(async () => {
  for (const [name, role] of [['owner', 'admin'], ['operator', 'supervisor'], ['finance', 'finance']]) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `booking-project-${name}@example.test`, password: 'synthetic-emulator-test-password', returnSecureToken: true }) });
    const actor = await response.json(); assert.ok(actor.idToken, 'Auth emulator token required');
    users[name] = { token: actor.idToken, uid: actor.localId };
    await db.collection('users').doc(actor.localId).set({ role, active: true });
  }
  for (const collection of protectedCollections) await db.collection(collection).doc('PB-PROTECTED').set({ preserved: collection });
});
after(async () => {
  for (const collection of protectedCollections) assert.deepEqual((await db.collection(collection).doc('PB-PROTECTED').get()).data(), { preserved: collection });
  await deleteApp(app);
});

test('authenticated Office flow atomically commits all vans and advisory over-budget evidence', async () => {
  const f = await fixture(); const original = await readPlan(f.plan.projectId);
  const response = await f.commit(await f.offer()); assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.workOrderIds.length, 2);
  const state = await f.allocation(); assert.equal(state.appointments.length, 1); assert.equal(state.links.length, 1); assert.equal(state.events.length, 1); assert.equal(state.locks.length, 2);
  const link = (await db.collection('projectAppointmentLinks').doc(response.body.appointmentId).get()).data();
  assert.deepEqual(link.workOrderIdsAtLink, [...response.body.workOrderIds].sort()); assert.equal(link.plannedVanMinutesAtBooking, 480);
  assert.deepEqual(await readPlan(f.plan.projectId), original, 'Booking must not mutate baseline or invent worked hours');
  const activity = await registryCommand('get_activity', { projectId: f.plan.projectId });
  assert.equal(activity.projectForecast.plannedMinutes, 480); assert.equal(activity.projectForecast.overBudgetMinutes, 300);
  assert.equal(activity.actualLabor.personMinutes, null); assert.equal(activity.physicalProgress.percent, null);
});
test('two concurrent identical Office requests create only one booking/link/event', async () => {
  const f = await fixture(); const offer = await f.offer(); const requestId = id('same-request');
  const responses = await Promise.all([f.commit(offer, requestId), f.commit(offer, requestId)]);
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(responses[0].body.appointmentId, responses[1].body.appointmentId);
  const state = await f.allocation(); assert.equal(state.appointments.length, 1); assert.equal(state.links.length, 1); assert.equal(state.events.length, 1);
});
test('different concurrent bookings cannot acquire the same physical capacity', async () => {
  const f = await fixture(); const offer = await f.offer();
  const responses = await Promise.all([f.commit(offer), f.commit(offer)]);
  assert.equal(responses.filter(row => row.status === 200).length, 1);
  const rejected = responses.find(row => row.status !== 200); assert.ok(['slot_conflict', 'offer_not_open'].includes(rejected.body.error.code), JSON.stringify(rejected.body));
  const state = await f.allocation(); assert.equal(state.appointments.length, 1); assert.equal(state.links.length, 1); assert.equal(state.workOrders.length, 2);
});
test('plan version changed after offer fails without partial booking records', async () => {
  const f = await fixture(); const offer = await f.offer();
  await registryCommand('edit_metadata', { projectId: f.plan.projectId, expectedVersion: 1, patch: { name: 'Second operator edit' } });
  const result = await f.commit(offer); assert.equal(result.body.error.details.reason, 'version_conflict'); assert.deepEqual(await f.allocation(), EMPTY);
});
test('runtime deactivation between offer and confirmation prevents all new writes', async () => {
  const f = await fixture(); const offer = await f.offer();
  await db.collection('businessSettings').doc('projects-registry').set({ ...flags, bookingEnabled: false });
  try { const result = await f.commit(offer); assert.equal(result.body.error.details.reason, 'project_booking_not_active'); assert.deepEqual(await f.allocation(), EMPTY); }
  finally { await db.collection('businessSettings').doc('projects-registry').set(flags); }
});
test('unauthorized and revoked provisioned roles cannot bypass the bridge', async () => {
  const f = await fixture(); const offer = await f.offer();
  assert.notEqual((await f.commit(offer, id('finance'), 'create_appointment', 'finance')).status, 200);
  await db.collection('users').doc(users.owner.uid).set({ role: 'finance', active: true });
  try { assert.notEqual((await f.commit(offer)).status, 200); assert.deepEqual(await f.allocation(), EMPTY); }
  finally { await db.collection('users').doc(users.owner.uid).set({ role: 'admin', active: true }); }
});
test('foreign support Work Order rejects the entire transaction', async () => {
  const f = await fixture({ malformedOrder: true }); const result = await f.commit(await f.offer());
  assert.equal(result.body.error.details.reason, 'work_order_identity_conflict'); assert.deepEqual(await f.allocation(), EMPTY);
});
test('throw after staged Project writes aborts the actual Firestore transaction', async () => {
  const wrapped = {
    collection: db.collection.bind(db),
    runTransaction: (callback, options) => db.runTransaction(async transaction => {
      let stagedLink = false;
      const proxy = new Proxy(transaction, { get(target, name) {
        if (name === 'create') return (ref, data) => { if (ref.path.startsWith('projectAppointmentLinks/')) stagedLink = true; return target.create(ref, data); };
        const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
      const result = await callback(proxy);
      if (stagedLink) throw Error('Synthetic failure after all booking writes were staged');
      return result;
    }, options),
  };
  const f = await fixture({ transactionDb: wrapped }); const result = await f.commit(await f.offer());
  assert.notEqual(result.status, 200); assert.deepEqual(await f.allocation(), EMPTY);
});
test('temporary hold confirmation and cancellation keep history while excluding cancelled allocation', async () => {
  const f = await fixture(); const offer = await f.offer(); const requestId = id('hold');
  const held = await f.commit(offer, requestId, 'create_temporary_hold'); assert.equal(held.status, 200, JSON.stringify(held.body));
  const appointmentId = held.body.appointmentId;
  const beforeLink = (await db.collection('projectAppointmentLinks').doc(appointmentId).get()).data();
  const confirmed = await f.call('confirm_temporary_hold', { appointmentId, requestId: id('confirm-hold') }); assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const observed = await f.call('get_appointment', { appointmentId });
  const cancelled = await f.call('cancel_appointment', { appointmentId, expectedAppointmentToken: observed.body.appointment.lifecycleToken, requestId: id('cancel'), reason: 'Synthetic customer request' }); assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  const retry = await f.commit(offer, requestId, 'create_temporary_hold'); assert.equal(retry.status, 200, JSON.stringify(retry.body)); assert.equal(retry.body.replayed, true);
  assert.deepEqual((await db.collection('projectAppointmentLinks').doc(appointmentId).get()).data(), beforeLink);
  const activity = await registryCommand('get_activity', { projectId: f.plan.projectId });
  assert.equal(activity.pageTotals.plannedVanMinutes, 0); assert.equal(activity.rows.length, 2);
  assert.ok(activity.rows.every(row => row.cancelled)); assert.equal((await readPlan(f.plan.projectId)).budget.originalMinutes, 180);
});
test('deactivated new booking path still resolves an already committed exact retry read-only', async () => {
  const f = await fixture(); const offer = await f.offer(); const requestId = id('retry-after-off');
  const result = await f.commit(offer, requestId); assert.equal(result.status, 200, JSON.stringify(result.body));
  const before = await f.allocation(); await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: false, bookingEnabled: false });
  try { const replay = await f.commit(offer, requestId); assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.replayed, true); assert.deepEqual(await f.allocation(), before); }
  finally { await db.collection('businessSettings').doc('projects-registry').set(flags); }
});

test('concurrent ordinary and Project checks cannot retag the same offer ID', async () => {
  const f = await fixture(); const requestId = id('shared-availability');
  const results = await Promise.all([f.check(requestId), f.check(requestId, null)]);
  assert.equal(results.filter(row => row.status === 200).length, 1);
  const rejected = results.find(row => row.status !== 200);
  assert.equal(rejected.body.error.details.reason, 'project_offer_context_conflict');
  assert.deepEqual(await f.allocation(), EMPTY);
});
