'use strict';
// Actual client adapter -> authenticated Office API -> Booking Authority -> Firestore emulator.
// Capacity provider is synthetic; existing Booking/Field regressions remain mandatory.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const PROJECT = 'demo-demac-projects';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error('Loopback emulators required.');
}
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Demo-only; no production credentials.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { createOfficeBookingApi } = require('../officeBookingAuthority');
const { createBookingAuthority } = require('../bookingAuthorityFirestore');
const { createProjectRegistryService } = require('./registry-service');
const { createProjectBookingIntegration } = require('./booking-integration');
const { bindCentralProjectBooking, prepareCentralProjectConfirmation, verifyCentralProjectBooking } = require('../../apps/erp-next/lib/projects/booking-handoff.ts');
const app = initializeApp({ projectId: PROJECT }, 'project-client-handoff');
const db = getFirestore(app), auth = getAuth(app);
const registry = createProjectRegistryService({ db, verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), enabled: true });
let actor, sequence = 0;
const nextId = () => `CLIENT-HANDOFF-${++sequence}`;
const protectedCollections = ['clients', 'properties', 'workVisits', 'warehouseInventory', 'whatsappOutboundQueue'];
async function planCommand(action, data) { return registry.execute({ idToken: actor.idToken, command: { action, data, requestId: nextId() } }); }
before(async () => {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'project-client-handoff@example.test', password: 'synthetic-emulator-password', returnSecureToken: true }),
  });
  actor = await response.json(); assert.ok(actor.idToken);
  await db.collection('users').doc(actor.localId).set({ role: 'admin', active: true });
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true, bookingEnabled: true });
  for (const collection of protectedCollections) await db.collection(collection).doc('CLIENT-SENTINEL').set({ untouched: collection });
});
after(async () => {
  for (const collection of protectedCollections) assert.deepEqual((await db.collection(collection).doc('CLIENT-SENTINEL').get()).data(), { untouched: collection });
  await deleteApp(app);
});
async function fixture() {
  const prefix = nextId(), customerId = `${prefix}-C`, propertyId = `${prefix}-S`;
  await db.collection('clients').doc(customerId).set({ active: true });
  await db.collection('properties').doc(propertyId).set({ clientId: customerId, active: true });
  const created = await planCommand('create_plan', { name: 'Synthetic Project', type: 'VRF Project', customerId, propertyId, startsOn: '2099-01-01', estimatedCompletionOn: '2099-12-31', budgetedVanMinutes: 180, phases: [] });
  const project = (await planCommand('get_plan', { projectId: created.projectId })).project;
  const option = { id: `${prefix}-OPTION`, date: '2099-09-18', time: '08:30', endTime: '15:30', capacityEndTime: '15:30', presetId: 'other', quantity: 1, durationMode: 'manual', durationMinutes: 360,
    assignments: [{ vanId: `${prefix}-VAN-A`, role: 'primary', quantity: 1, slots: 6 }, { vanId: `${prefix}-VAN-B`, role: 'support', quantity: 1, slots: 2 }] };
  const provider = {
    checkAvailability: async () => ({ options: [option] }),
    revalidateSelection: async () => ({ available: true, option }),
    validateTransaction: async () => ({ available: true, capacityLocks: option.assignments.map((row, index) => ({ id: `${prefix}-LOCK-${index}`, vanId: row.vanId, date: option.date, slot: option.time })) }),
    buildWorkOrders: async ({ appointment }) => [360, 120].map((minutes, index) => ({ id: `${appointment.appointmentId}-WO-${index}`, appointmentId: appointment.appointmentId, clientId: customerId, propertyId, vanId: option.assignments[index].vanId, status: appointment.status === 'temporary_hold' ? 'Reserva temporal' : 'Confirmada', appointmentDurationMinutes: minutes, scheduledSlots: minutes / 60, date: option.date, time: option.time })),
  };
  const authority = createBookingAuthority({ db, availabilityProvider: provider, projectIntegration: createProjectBookingIntegration({ db, enabled: true }) });
  const office = createOfficeBookingApi({ db, verifyIdToken: token => auth.verifyIdToken(token, true), schedulingProvider: provider, bookingAuthority: authority, projectsEnabled: true });
  const call = (action, data) => office.handle({ method: 'POST', headers: { authorization: `Bearer ${actor.idToken}` }, body: { action, data } });
  const input = bindCentralProjectBooking(project, null, { requestId: nextId(), customerId, propertyId, requestedDate: option.date, requestedTime: option.time, requiredVanId: option.assignments[0].vanId, workLines: [{ id: 'PROJECT-WORK', presetId: 'other', quantity: 1, manualDurationMinutes: 360 }] });
  const checked = await call('check_availability', input);
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  return { project, option, call, input, availability: checked.body };
}
for (const mode of ['confirmed', 'temporary_hold']) {
  test(`client contract and real Office ${mode} commit link every Work Order with one recoverable request`, async () => {
    const f = await fixture();
    const prepared = prepareCentralProjectConfirmation({ input: f.input, availability: f.availability, actorId: actor.localId, optionId: f.option.id, requestId: nextId(), mode });
    const action = mode === 'confirmed' ? 'create_appointment' : 'create_temporary_hold';
    const response = await f.call(action, prepared.command);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const result = verifyCentralProjectBooking(response.body, prepared.expectation);
    assert.equal(result.workOrderIds.length, 2); assert.equal(result.mode, mode);
    const link = (await db.collection('projectAppointmentLinks').doc(result.appointmentId).get()).data();
    assert.equal(link.projectId, f.project.id); assert.deepEqual(link.workOrderIdsAtLink, [...result.workOrderIds].sort());
    assert.equal(link.plannedVanMinutesAtBooking, 480);
    assert.deepEqual((await planCommand('get_plan', { projectId: f.project.id })).project, f.project);
    const replay = await f.call(action, prepared.command);
    assert.equal(replay.status, 200); assert.equal(verifyCentralProjectBooking(replay.body, prepared.expectation).replayed, true);
    assert.equal((await db.collection('projectAppointmentLinks').where('projectId', '==', f.project.id).get()).size, 1);
    assert.equal((await db.collection('appointments').where('customerId', '==', f.project.customerId).get()).size, 1);
    const activity = await planCommand('get_activity', { projectId: f.project.id });
    assert.equal(activity.actualLabor.personMinutes, null);
    assert.equal(activity.physicalProgress.percent, null);
    if (mode === 'confirmed') assert.equal(activity.projectForecast.overBudgetMinutes, 300);
  });
}
test('changed planning version still stops the server commit without partial operational writes', async () => {
  const f = await fixture();
  const prepared = prepareCentralProjectConfirmation({ input: f.input, availability: f.availability, actorId: actor.localId, optionId: f.option.id, requestId: nextId(), mode: 'confirmed' });
  await planCommand('edit_metadata', { projectId: f.project.id, expectedVersion: f.project.version, patch: { description: 'Another operator changed the plan' } });
  const rejected = await f.call('create_appointment', prepared.command);
  assert.notEqual(rejected.status, 200);
  assert.equal((await db.collection('appointments').where('customerId', '==', f.project.customerId).get()).size, 0);
  assert.equal((await db.collection('projectAppointmentLinks').where('projectId', '==', f.project.id).get()).size, 0);
  assert.equal((await db.collection('workOrders').where('propertyId', '==', f.project.propertyId).get()).size, 0);
});
