'use strict';
// Production facade + real Scheduling provider + Auth/Firestore, synthetic demo data only.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const PROJECT = 'demo-demac-projects';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw Error('Loopback emulators required.');
if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Credential-free demo project required.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore'); const { getAuth } = require('firebase-admin/auth');
const { createOfficeBookingAuthorityFacade } = require('../officeBookingAuthorityFacade');
const { createProjectRegistryService } = require('./registry-service');
const app = initializeApp({ projectId: PROJECT }, 'public-booking-tests'); const db = getFirestore(app), auth = getAuth(app);
const verifyIdToken = token => auth.verifyIdToken(token, true);
const facade = createOfficeBookingAuthorityFacade({ db, verifyIdToken, projectsEnabled: true });
const disabled = createOfficeBookingAuthorityFacade({ db, verifyIdToken });
const registry = createProjectRegistryService({ db, verifyIdToken, enabled: true });
let actor, serial = 0;
const next = prefix => `PUBLIC-${prefix}-${++serial}`;
const call = (action, data, api = facade) => api.handle({ method: 'POST', headers: { authorization: `Bearer ${actor.idToken}` }, body: { action, data } });
const success = result => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
const planCommand = (action, data) => registry.execute({ idToken: actor.idToken, command: { action, data, requestId: next('plan') } });
async function snapshot() {
  const result = {};
  for (const name of ['appointments', 'workOrders', 'bookingOffers', 'bookingIdempotency', 'bookingCapacityLocks', 'projectAppointmentLinks', 'projectEvents', 'workVisits', 'whatsappOutboundQueue']) {
    result[name] = (await db.collection(name).get()).docs.map(row => [row.id, row.data()]);
  }
  return result;
}
async function fixture() {
  const customerId = next('C'), propertyId = next('P');
  await db.collection('clients').doc(customerId).set({ name: 'Synthetic customer', active: true });
  await db.collection('properties').doc(propertyId).set({ clientId: customerId, address: 'Synthetic site', operationalZone: 'Oranjestad', active: true });
  const plan = await planCommand('create_plan', { name: next('project'), type: 'VRF Project', customerId, propertyId,
    startsOn: '2098-01-01', estimatedCompletionOn: '2099-12-31', budgetedVanMinutes: 30, phases: [] });
  // Each fixture uses its own future date so physical locks cannot overlap other tests.
  const date = new Date(Date.UTC(2098, 0, 6 + serial * 7)).toISOString().slice(0, 10);
  const input = { customerId, propertyId, requestedDate: date, requestedTime: '08:30', requiredVanId: 'VAN-1',
    workLines: [{ id: 'WORK', presetId: 'standard_service', serviceId: 'PUBLIC-SERVICE', quantity: 2 }],
    projectSelection: { projectId: plan.projectId, phaseId: null, expectedVersion: 1 } };
  const available = async (extra = {}, api = facade) => success(await call('check_availability', { ...input, requestId: next('offer'), ...extra }, api));
  const create = async () => { const offered = await available(); assert.ok(offered.available, JSON.stringify(offered));
    return success(await call('create_appointment', { requestId: next('create'), offerId: offered.offer.id, offerVersion: offered.offer.version, optionId: offered.options[0].id })); };
  const read = async id => success(await call('get_appointment', { appointmentId: id })).appointment;
  return { input, plan, available, create, read };
}
before(async () => {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'public-booking@example.test', password: 'synthetic-password-123', returnSecureToken: true }) });
  actor = await response.json(); assert.ok(actor.idToken);
  await db.collection('users').doc(actor.localId).set({ role: 'admin', active: true });
  await db.collection('businessSettings').doc('projects-registry').set({ backendEnabled: true, bookingEnabled: true });
  await db.collection('businessSettings').doc('business-calendar').set({ closedWeekdays: [0] });
  await db.collection('businessSettings').doc('appointment-work-presets').set({ presets: [
    { id: 'standard_service', label: 'Synthetic standard service', serviceId: 'PUBLIC-SERVICE', durationMinutesPerUnit: 60, active: true },
  ] });
  await db.collection('services').doc('PUBLIC-SERVICE').set({ name: 'Synthetic standard service', durationMinutes: 60, active: true });
  for (const n of [1, 2]) {
    await db.collection('vans').doc(`VAN-${n}`).set({ name: `Van ${n}`, active: true, responsibleStaffId: `PUBLIC-DRIVER-${n}` });
    await db.collection('staffProfiles').doc(`PUBLIC-DRIVER-${n}`).set({ active: true, availability: 'Disponible', canDriveVan: true });
  }
});
after(async () => { await deleteApp(app); });
test('production facade keeps Projects off by default and creates atomic Project links when explicitly enabled', async () => {
  const f = await fixture();
  const off = await call('check_availability', { ...f.input, requestId: next('off') }, disabled);
  assert.equal(off.body.error.details.reason, 'project_booking_not_active');
  const ordinary = await f.available({ projectSelection: undefined }, disabled); assert.equal(ordinary.offer.projectContext, undefined);
  const created = await f.create(); const link = (await db.collection('projectAppointmentLinks').doc(created.appointmentId).get()).data();
  assert.equal(link.projectId, f.plan.projectId); assert.equal(link.phaseId, null); assert.ok(created.workOrderIds.length);
});
test('public reschedule uses consistent receipts, rejects stale intent and never resets later partial history on retry', async () => {
  const f = await fixture(), created = await f.create(), appointmentId = created.appointmentId;
  const observed = await f.read(appointmentId);
  const offered = await f.available({ projectSelection: undefined, appointmentId, expectedAppointmentToken: observed.lifecycleToken,
    changeKind: 'details_edited', workLines: [{ ...f.input.workLines[0], quantity: 1 }] });
  const command = { appointmentId, requestId: next('edit'), offerId: offered.offer.id, offerVersion: offered.offer.version,
    optionId: offered.options[0].id, reason: 'Synthetic reviewed scope', changeKind: 'details_edited' };
  const responses = await Promise.all([call('reschedule_appointment', command), call('reschedule_appointment', command)]);
  responses.forEach(success); assert.equal(responses.filter(result => result.body.replayed).length, 1);
  await db.collection('appointments').doc(appointmentId).set({ executionOutcome: { status: 'partial' } }, { merge: true });
  const before = await snapshot();
  assert.equal(success(await call('reschedule_appointment', command)).replayed, true);
  assert.equal((await call('reschedule_appointment', { ...command, note: 'changed payload' })).body.error.code, 'idempotency_conflict');
  assert.deepEqual(await snapshot(), before);
  await db.collection('users').doc(actor.localId).set({ role: 'finance', active: true });
  try { assert.equal((await call('reschedule_appointment', command)).status, 403); }
  finally { await db.collection('users').doc(actor.localId).set({ role: 'admin', active: true }); }
});
test('public partial completion and remaining-work booking retain General Project association and readable slot allocation', async () => {
  const f = await fixture(), created = await f.create(), appointmentId = created.appointmentId;
  // Time travel is confined to this synthetic original fixture; the public partial writer requires past work.
  await db.collection('appointments').doc(appointmentId).set({ date: '2000-01-03' }, { merge: true });
  const partial = success(await call('record_partial_completion', { appointmentId, requestId: next('partial'), completedQuantity: 1,
    actualEndTime: '09:30', reason: 'Synthetic reassignment' }));
  const activity = await planCommand('get_activity', { projectId: f.plan.projectId });
  assert.equal(activity.coverage.pageIsValid, true, JSON.stringify(activity.issues));
  const date = new Date(Date.parse(`${f.input.requestedDate}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const offered = await f.available({ projectSelection: undefined, requestedDate: date, workLines: partial.outcome.remainingWorkLines,
    sourcePartialAppointmentId: appointmentId, sourcePartialOutcomeRevision: partial.outcome.revision });
  const command = { appointmentId, requestId: next('remaining'), offerId: offered.offer.id, offerVersion: offered.offer.version, optionId: offered.options[0].id };
  const result = success(await call('schedule_remaining_work', command));
  const link = (await db.collection('projectAppointmentLinks').doc(result.followUpAppointmentId).get()).data();
  assert.equal(link.projectId, f.plan.projectId); assert.equal(link.phaseId, null); assert.equal(link.sourcePartialAppointmentId, appointmentId);
  const before = await snapshot(); assert.equal(success(await call('schedule_remaining_work', command)).replayed, true); assert.deepEqual(await snapshot(), before);
  const final = await planCommand('get_activity', { projectId: f.plan.projectId });
  assert.equal(final.coverage.pageIsValid, true, JSON.stringify(final.issues)); assert.equal(final.coverage.linkedAppointmentsOnPage, 2);
});
