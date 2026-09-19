'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBookingAuthority } = require('../bookingAuthorityFirestore');
const { createProjectBookingIntegration } = require('./booking-integration');

const COPY = value => value === undefined ? undefined : structuredClone(value);
class MemoryDb {
  constructor() { this.store = new Map(); this.reads = []; this.failCommit = false; }
  collection(name) {
    return { doc: id => ({
      id, path: `${name}/${id}`,
      get: async () => this.snap(`${name}/${id}`, id),
      set: async (value, options) => this.store.set(`${name}/${id}`, COPY(options?.merge ? { ...this.store.get(`${name}/${id}`), ...value } : value)),
    }) };
  }
  snap(path, id) {
    this.reads.push(path);
    const value = COPY(this.store.get(path));
    return { id, exists: value !== undefined, data: () => COPY(value) };
  }
  async runTransaction(callback, options = {}) {
    const writes = [];
    const transaction = {
      get: async ref => { assert.equal(writes.length, 0, 'All reads precede writes'); return this.snap(ref.path, ref.id); },
      getAll: async (...refs) => { assert.equal(writes.length, 0, 'All reads precede writes'); return refs.map(ref => this.snap(ref.path, ref.id)); },
      set: (ref, value, opts) => { assert.notEqual(options.readOnly, true); writes.push({ ref, value: COPY(value), opts }); },
      create: (ref, value) => { assert.notEqual(options.readOnly, true); writes.push({ ref, value: COPY(value), create: true }); },
    };
    const result = await callback(transaction);
    if (this.failCommit && writes.length) throw new Error('Synthetic atomic commit failure');
    const next = new Map(this.store);
    for (const write of writes) {
      if (write.create && next.has(write.ref.path)) throw new Error('Already exists');
      next.set(write.ref.path, write.opts?.merge ? { ...next.get(write.ref.path), ...write.value } : write.value);
    }
    this.store = next;
    return result;
  }
}
const actor = { source: 'office-scheduling', id: 'PROJECT-USER', name: 'Synthetic operator' };
const selection = () => ({ projectId: 'PROJECT-P', phaseId: null, expectedVersion: 1 });
const request = () => ({ customerId: 'PROJECT-C', propertyId: 'PROJECT-S', workLines: [{ id: 'WORK', presetId: 'other', serviceId: 'SERVICE', quantity: 1, manualDurationMinutes: 360 }] });
const clock = () => new Date('2026-09-18T12:00:00.000Z');
function plan() {
  return { id: 'PROJECT-P', projectNumber: 'PRJ-TEST', schemaVersion: 1, version: 1,
    customerId: 'PROJECT-C', propertyId: 'PROJECT-S', name: 'Synthetic project',
    planningStatus: 'Planned', phases: [], budget: { unit: 'van_minutes', originalMinutes: 180, currentMinutes: 180, revision: 1 } };
}
function provider() {
  const option = { id: 'OPTION', date: '2026-09-19', time: '08:30', endTime: '15:30', capacityEndTime: '15:30',
    presetId: 'other', serviceId: 'SERVICE', quantity: 1, durationMode: 'manual', durationMinutes: 360,
    assignments: [{ vanId: 'VAN-A', role: 'primary', quantity: 1, slots: 6 }, { vanId: 'VAN-B', role: 'support', quantity: 1, slots: 2 }] };
  return {
    checkAvailability: async () => ({ options: [option] }),
    revalidateSelection: async () => ({ available: true, option }),
    validateTransaction: async () => ({ available: true, capacityLocks: [
      { id: 'LOCK-A', date: option.date, vanId: 'VAN-A', slot: option.time },
      { id: 'LOCK-B', date: option.date, vanId: 'VAN-B', slot: option.time },
    ] }),
    buildWorkOrders: async ({ appointment }) => [360, 120].map((minutes, index) => ({ id: `WO-${appointment.appointmentId}-${index}`, appointmentId: appointment.appointmentId,
      clientId: 'PROJECT-C', propertyId: 'PROJECT-S', vanId: index ? 'VAN-B' : 'VAN-A', status: 'Confirmada',
      appointmentDurationMinutes: minutes, scheduledSlots: minutes / 60, date: option.date, time: option.time })),
  };
}
function fixture({ enabled = true, customProvider } = {}) {
  const db = new MemoryDb();
  db.store.set('users/PROJECT-USER', { role: 'admin', active: true });
  db.store.set('businessSettings/projects-registry', { backendEnabled: true, bookingEnabled: true });
  db.store.set('projectRecords/PROJECT-P', plan());
  db.store.set('clients/PROJECT-C', { active: true });
  db.store.set('properties/PROJECT-S', { clientId: 'PROJECT-C', active: true });
  const availabilityProvider = { ...provider(), ...customProvider };
  const authority = createBookingAuthority({ db, availabilityProvider, clock, serverTimestamp: () => 'SYNTHETIC-TIMESTAMP', projectIntegration: createProjectBookingIntegration({ db, enabled }) });
  const check = (selected = selection(), requestKey = 'PROJECT-REQUEST') => authority.checkAvailability({ request: request(), actor, context: { channel: 'office', requestKey, ...(selected === false ? {} : { projectSelection: selected }) } });
  const commit = async (offer, extra = {}) => authority.createAppointment({ offerId: offer.id, offerVersion: offer.version, optionId: 'OPTION', idempotencyKey: 'PROJECT-CREATE-REQUEST', actor, context: { channel: 'office' }, ...extra });
  return { db, authority, check, commit };
}
function bookings(db) { return [...db.store].filter(([key]) => /^(appointments|workOrders|bookingCapacityLocks|bookingIdempotency|projectAppointmentLinks|projectEvents)\//.test(key)); }

test('ordinary bookings do not read or mutate the central registry', async () => {
  const f = fixture({ enabled: false }); const offer = (await f.check(false)).offer;
  await f.commit(offer);
  assert.equal(f.db.reads.some(path => /^(project|users\/|businessSettings\/projects-registry)/.test(path)), false);
  assert.equal([...f.db.store.keys()].some(key => key.startsWith('projectAppointmentLinks/')), false);
});
test('a Project offer is identity/version bound but makes no booking or Project writes', async () => {
  const f = fixture(); const offer = (await f.check()).offer;
  assert.deepEqual(offer.projectContext, { schemaVersion: 1, ...selection(), actorId: actor.id });
  assert.equal(bookings(f.db).length, 0); assert.deepEqual(f.db.store.get('projectRecords/PROJECT-P'), plan());
});
test('Firestores sorted map keys do not break exact offer reuse', async () => {
  const f = fixture(); const first = await f.check();
  const saved = f.db.store.get(`bookingOffers/${first.offer.id}`);
  saved.projectContext = Object.fromEntries(Object.entries(saved.projectContext).sort());
  assert.equal((await f.check()).replayed, true);
});
test('a request key cannot change between ordinary and Project work', async () => {
  const f = fixture(); await f.check(false);
  await assert.rejects(f.check(), error => error.details?.reason === 'project_offer_context_conflict');
});
test('budget exhaustion does not block atomic booking plus all Van links and audit', async () => {
  const f = fixture(); const before = COPY(f.db.store.get('projectRecords/PROJECT-P'));
  const result = await f.commit((await f.check()).offer);
  assert.equal(result.success, true); assert.equal(result.workOrderIds.length, 2);
  const link = f.db.store.get(`projectAppointmentLinks/${result.appointmentId}`);
  assert.deepEqual(link.workOrderIdsAtLink, [...result.workOrderIds].sort());
  assert.equal(link.plannedVanMinutesAtBooking, 480); assert.equal(link.budgetAtBooking.currentMinutes, 180);
  assert.deepEqual(f.db.store.get('projectRecords/PROJECT-P'), before);
  assert.equal([...f.db.store.keys()].filter(key => key.startsWith('projectEvents/')).length, 1);
});
test('a failed final transaction cannot leave an appointment, link, event or lock behind', async () => {
  const f = fixture(); const offer = (await f.check()).offer; f.db.failCommit = true;
  await assert.rejects(f.commit(offer), /Synthetic atomic commit failure/);
  assert.deepEqual(bookings(f.db), []);
});
test('stale planning versions fail with no live booking effects', async () => {
  const f = fixture(); const offer = (await f.check()).offer;
  f.db.store.set('projectRecords/PROJECT-P', { ...plan(), version: 2 });
  await assert.rejects(f.commit(offer), error => error.details?.reason === 'version_conflict');
  assert.deepEqual(bookings(f.db), []);
});
test('missing, inactive or unauthorized provisioned users cannot create Project bookings', async () => {
  for (const profile of [null, { role: 'admin', active: false }, { role: 'finance', active: true }, { role: 'technician', active: true }]) {
    const f = fixture(); const offer = (await f.check()).offer;
    if (profile) f.db.store.set('users/PROJECT-USER', profile); else f.db.store.delete('users/PROJECT-USER');
    await assert.rejects(f.commit(offer), error => error.details?.reason === 'forbidden'); assert.deepEqual(bookings(f.db), []);
  }
});
test('both build-time and runtime activation fail closed for new Project work', async () => {
  const disabled = fixture({ enabled: false }); await assert.rejects(disabled.check(), error => error.details?.reason === 'project_booking_not_active');
  for (const flags of [{ backendEnabled: true }, { backendEnabled: false, bookingEnabled: true }]) {
    const f = fixture(); const offer = (await f.check()).offer; f.db.store.set('businessSettings/projects-registry', flags);
    await assert.rejects(f.commit(offer), error => error.details?.reason === 'project_booking_not_active'); assert.deepEqual(bookings(f.db), []);
  }
});
test('terminal/on-hold plans cannot be silently reopened', async () => {
  for (const planningStatus of ['Cancelled', 'On Hold']) {
    const f = fixture(); f.db.store.set('projectRecords/PROJECT-P', { ...plan(), planningStatus });
    await assert.rejects(f.check(), error => error.details?.reason === 'project_not_schedulable');
  }
});
test('wrong customer, missing phase and injected operational fields are rejected', async () => {
  const f = fixture(); f.db.store.set('projectRecords/PROJECT-P', { ...plan(), customerId: 'OTHER' });
  await assert.rejects(f.check(), error => error.details?.reason === 'project_booking_identity_conflict');
  const g = fixture(); await assert.rejects(g.check({ ...selection(), phaseId: 'MISSING' }), error => error.details?.reason === 'unknown_project_phase');
  await assert.rejects(g.check({ ...selection(), actualLaborHours: 900 }), error => error.details?.reason === 'invalid_fields');
});
test('exact retries do not duplicate links, appointments, audit or capacity', async () => {
  const f = fixture(); const offer = (await f.check()).offer; const first = await f.commit(offer); const before = bookings(f.db);
  const again = await f.commit(offer); assert.equal(again.replayed, true); assert.equal(again.appointmentId, first.appointmentId);
  assert.deepEqual(bookings(f.db), before);
});
test('read-only replay survives later plan revisions and booking deactivation', async () => {
  const f = fixture(); const offer = (await f.check()).offer; await f.commit(offer);
  f.db.store.set('projectRecords/PROJECT-P', { ...plan(), version: 2, planningStatus: 'Cancelled' });
  f.db.store.set('businessSettings/projects-registry', { backendEnabled: false, bookingEnabled: false });
  assert.equal((await f.commit(offer)).replayed, true);
});
test('revoked access or another actor cannot obtain a Project retry through cached booking receipts', async () => {
  const f = fixture(); const offer = (await f.check()).offer; await f.commit(offer);
  await assert.rejects(f.commit(offer, { actor: { ...actor, id: 'OTHER-USER' } }), error => error.details?.reason === 'project_offer_identity_conflict');
  f.db.store.set('users/PROJECT-USER', { role: 'finance', active: true });
  await assert.rejects(f.commit(offer), error => error.details?.reason === 'forbidden');
});
test('a conflicting historical link is never overwritten', async () => {
  const f = fixture(); const offer = (await f.check()).offer; const made = await f.commit(offer);
  f.db.store.set(`projectAppointmentLinks/${made.appointmentId}`, { ...f.db.store.get(`projectAppointmentLinks/${made.appointmentId}`), projectId: 'OTHER' });
  const before = bookings(f.db); await assert.rejects(f.commit(offer), error => error.details?.reason === 'project_booking_link_conflict'); assert.deepEqual(bookings(f.db), before);
});
test('temporary holds reserve/link once without manufacturing execution or changing the estimate', async () => {
  const f = fixture(); const made = await f.commit((await f.check()).offer, { createMode: 'temporary_hold' });
  assert.equal(made.appointment.status, 'temporary_hold'); assert.ok(f.db.store.has(`projectAppointmentLinks/${made.appointmentId}`));
  assert.deepEqual(f.db.store.get('projectRecords/PROJECT-P'), plan());
});
test('real capacity conflicts still block an over-budget Project booking', async () => {
  const f = fixture({ customProvider: { validateTransaction: async () => ({ available: false, reason: 'concurrent-reservation' }) } });
  await assert.rejects(f.commit((await f.check()).offer), error => error.code === 'slot_conflict'); assert.deepEqual(bookings(f.db), []);
});
test('malformed or foreign Work Orders abort the entire linked booking', async () => {
  const f = fixture({ customProvider: { buildWorkOrders: async ({ appointment }) => [{ id: 'WO-WRONG', appointmentId: appointment.appointmentId, clientId: 'OTHER', propertyId: 'PROJECT-S', appointmentDurationMinutes: 360 }] } });
  await assert.rejects(f.commit((await f.check()).offer), error => error.details?.reason === 'work_order_identity_conflict'); assert.deepEqual(bookings(f.db), []);
});

test('existing draft eligibility is preserved, while imported closed status is never reopened', async () => {
  const f = fixture(); f.db.store.set('projectRecords/PROJECT-P', { ...plan(), planningStatus: 'Draft' });
  assert.equal((await f.check()).available, true);
  const g = fixture(); g.db.store.set('projectRecords/PROJECT-P', { ...plan(), migration: { status: 'pending_reconciliation', sourceDeclaredStatus: 'Completed' } });
  await assert.rejects(g.check(), error => error.details?.reason === 'project_reconciliation_required');
});
test('unreconciled phase prerequisites cannot be overridden by local/preview progress', async () => {
  const phase = { id: 'PH-1', name: 'First', scopeOfWork: 'Test', completionCriteria: 'Evidence', plannedVanMinutes: 30, dependencies: [], progressMethod: 'approval', unitsPlanned: 0, checklist: [] };
  const f = fixture(); f.db.store.set('projectRecords/PROJECT-P', { ...plan(), phases: [phase, { ...phase, id: 'PH-2', dependencies: ['PH-1'] }] });
  await assert.rejects(f.check({ ...selection(), phaseId: 'PH-2' }), error => error.details?.reason === 'project_phase_reconciliation_required');
  assert.equal((await f.check({ ...selection(), phaseId: 'PH-1' })).available, true);
});
