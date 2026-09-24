'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectHistoricalCapacityAuthority } = require('./bookingProjectHistoricalCapacity');
const { lockId } = require('./projectHistoricalBooking');
const { initialVisitDocumentId } = require('./fieldOperationsAuthorityWorkVisit');

class Snapshot {
  constructor(id, value) { this.id = id; this.value = value; this.exists = value !== undefined; }
  data() { return this.value; }
}
class Doc {
  constructor(db, collection, id) { Object.assign(this, { db, collection, id }); }
  async get() { return new Snapshot(this.id, this.db.records.get(`${this.collection}/${this.id}`)); }
  async set(value, options) {
    const key = `${this.collection}/${this.id}`;
    this.db.records.set(key, options?.merge ? { ...(this.db.records.get(key) || {}), ...value } : value);
  }
}
class Query {
  constructor(db, collection, field, value, max = Infinity) { Object.assign(this, { db, collection, field, value, max }); }
  limit(max) { return new Query(this.db, this.collection, this.field, this.value, max); }
  async get() {
    if (this.db.failQueries.has(`${this.collection}.${this.field}`)) throw Error('Query unavailable');
    const docs = [...this.db.records.entries()].filter(([key, value]) => key.startsWith(`${this.collection}/`)
      && (this.field === null || value?.[this.field] === this.value)).slice(0, this.max)
      .map(([key, value]) => new Snapshot(key.slice(this.collection.length + 1), value));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}
class Db {
  constructor(seed) { this.records = new Map(Object.entries(seed)); this.writes = 0; this.failQueries = new Set(); }
  collection(name) { return {
    doc: id => new Doc(this, name, id),
    get: () => new Query(this, name, null, null).get(),
    where: (field, operator, value) => {
      assert.equal(operator, '==');
      return new Query(this, name, field, value);
    },
  }; }
  async runTransaction(callback) {
    const writes = [];
    const result = await callback({ get: ref => ref.get(), set: (ref, value, options) => writes.push({ ref, value, options }) });
    for (const write of writes) { await write.ref.set(write.value, write.options); this.writes += 1; }
    return result;
  }
  read(path) { return this.records.get(path); }
  write(path, value) { this.records.set(path, value); }
  count(collection) { return [...this.records.keys()].filter(key => key.startsWith(`${collection}/`)).length; }
}

const date = '2026-09-21';
const anchors = ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30'];
function fixture({ slots = 3, budget = 6, backdated = false } = {}) {
  const end = slots <= 3 ? `${String(8 + slots).padStart(2, '0')}:30` : `${String(10 + slots).padStart(2, '0')}:30`;
  const assignment = { vanId: 'VAN-1', vanName: 'Van 1', technicianIds: ['TECH-1'], role: 'primary',
    time: '08:30', slots, quantity: 1, durationMinutes: slots * 60, endTime: end, capacityEndTime: end };
  const bookingMeta = backdated ? { bookingMode: 'backdated', backdatingAcknowledged: true, workAlreadyPerformed: true } : {};
  const project = { id: 'PROJECT-1', customerId: 'CLIENT-1', siteId: 'PROPERTY-1', name: 'Synthetic Project',
    serverVersion: 1, estimatedSlots: budget, estimatedLaborHours: budget, scheduledFutureHours: slots, actualLaborHours: 0,
    phases: [{ id: 'PHASE-1', name: 'Work', estimatedLaborHours: budget }],
    assignments: [{ projectId: 'PROJECT-1', phaseId: 'PHASE-1', appointmentId: 'APT-1', workOrderId: 'WO-1',
      scheduledSlots: slots, scheduledHours: slots, actualHours: 0, unitsCompleted: 0, status: 'Scheduled' }] };
  const seed = {
    'users/owner-1': { role: 'admin', active: true, name: 'Owner' },
    'projectRecords/PROJECT-1': project,
    'projectBookingClaims/APT-1': { projectId: 'PROJECT-1', appointmentId: 'APT-1', phaseId: 'PHASE-1' },
    'appointments/APT-1': { id: 'APT-1', appointmentId: 'APT-1', projectId: 'PROJECT-1', customerId: 'CLIENT-1', propertyId: 'PROPERTY-1',
      date, status: 'confirmed', startTime: '08:30', endTime: end, capacityEndTime: end,
      primaryVanId: 'VAN-1', workOrderIds: ['WO-1'], assignments: [assignment],
      capacityLockIds: anchors.slice(0, slots).map(slot => lockId(date, 'VAN-1', slot)), ...bookingMeta },
    'workOrders/WO-1': { id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
      date, time: '08:30', vanId: 'VAN-1', technicianIds: ['TECH-1'], status: 'Confirmada',
      scheduledSlots: slots, appointmentDurationMinutes: slots * 60, appointmentEndTime: end,
      appointmentCapacityEndTime: end, ...bookingMeta },
    'staffProfiles/TECH-1': { name: 'Synthetic Technician' },
  };
  for (const slot of anchors.slice(0, slots)) seed[`bookingCapacityLocks/${lockId(date, 'VAN-1', slot)}`] = {
    appointmentId: 'APT-1', date, vanId: 'VAN-1', slot, active: true,
  };
  const db = new Db(seed);
  const authority = createProjectHistoricalCapacityAuthority({ db, clock: () => new Date('2026-09-23T14:00:00Z') });
  return { db, authority };
}
function input(overrides = {}) { return { projectId: 'PROJECT-1', appointmentId: 'APT-1', requestId: 'capacity-request-1',
  expectedVersion: 1, slots: 4, reason: 'Correct unexecuted historical capacity', noBillingAcknowledged: true, ...overrides }; }

test('in-place increase crosses lunch with canonical anchors, exact elapsed duration and Project delta', async () => {
  const { db, authority } = fixture();
  const sources = await authority.sources('owner-1', 'PROJECT-1');
  assert.equal(sources.sources[0].eligible, true);
  assert.deepEqual(sources.sources[0].technicianNames, ['Synthetic Technician']);
  assert.equal(sources.budgetSlots, 6); assert.equal(sources.usedSlots, 3);
  const result = await authority.adjust('owner-1', input());
  assert.equal(result.currentSlots, 4); assert.equal(result.usedAfter, 4);
  assert.equal(db.count('appointments'), 1); assert.equal(db.count('workOrders'), 1);
  assert.deepEqual(db.read('appointments/APT-1').capacityLockIds, anchors.slice(0, 4).map(slot => lockId(date, 'VAN-1', slot)));
  assert.equal(db.read(`bookingCapacityLocks/${lockId(date, 'VAN-1', '13:30')}`).active, true);
  assert.equal(db.read('appointments/APT-1').endTime, '14:30');
  assert.equal(db.read('workOrders/WO-1').appointmentDurationMinutes, 360);
  assert.equal(db.read('workOrders/WO-1').scheduledSlots, 4);
  assert.equal(db.read('workOrders/WO-1').whatsappNotificationsEnabled, false);
  assert.equal(db.read('projectRecords/PROJECT-1').assignments[0].scheduledSlots, 4);
  assert.equal(db.read('projectRecords/PROJECT-1').scheduledFutureHours, 4);
  assert.equal(db.read('projectRecords/PROJECT-1').estimatedSlots, 6);
});

test('in-place reduction releases only own tail and preserves same appointment and Work Order', async () => {
  const { db, authority } = fixture({ slots: 4 });
  const result = await authority.adjust('owner-1', input({ slots: 3 }));
  assert.equal(result.currentSlots, 3);
  assert.equal(db.read(`bookingCapacityLocks/${lockId(date, 'VAN-1', '13:30')}`).active, false);
  assert.equal(db.read('appointments/APT-1').endTime, '11:30');
  assert.equal(db.read('workOrders/WO-1').appointmentDurationMinutes, 180);
  assert.equal(db.read('projectRecords/PROJECT-1').scheduledFutureHours, 3);
  assert.equal(db.count('appointments'), 1); assert.equal(db.count('workOrders'), 1);
});

test('stale planning counter is reconciled to canonical linked Work Order usage', async () => {
  const { db, authority } = fixture({ slots: 2 });
  db.write('projectRecords/PROJECT-1', { ...db.read('projectRecords/PROJECT-1'), scheduledFutureHours: 6 });
  const result = await authority.adjust('owner-1', input({ slots: 4 }));
  assert.equal(result.usedBefore, 2);
  assert.equal(result.usedAfter, 4);
  assert.equal(db.read('projectRecords/PROJECT-1').scheduledFutureHours, 4);
});

test('planning counter excludes posted links while budget view includes their canonical Work Orders', async () => {
  const { db, authority } = fixture({ slots: 3, budget: 10 });
  const project = db.read('projectRecords/PROJECT-1');
  db.write('projectRecords/PROJECT-1', { ...project, scheduledFutureHours: 99, actualLaborHours: 2,
    assignments: [...project.assignments, { projectId: 'PROJECT-1', phaseId: 'PHASE-1', appointmentId: 'APT-POSTED',
      workOrderId: 'WO-POSTED', scheduledSlots: 2, scheduledHours: 2, actualHours: 2, unitsCompleted: 1,
      status: 'Completed', postedAt: '2026-09-20T12:00:00Z' }] });
  db.write('workOrders/WO-POSTED', { appointmentId: 'APT-POSTED', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
    date: '2026-09-20', time: '08:30', status: 'Completada', scheduledSlots: 2 });
  const result = await authority.adjust('owner-1', input());
  assert.equal(result.usedBefore, 5); assert.equal(result.usedAfter, 6);
  assert.equal(db.read('projectRecords/PROJECT-1').scheduledFutureHours, 4);
  assert.equal(db.read('projectRecords/PROJECT-1').actualLaborHours, 2);
});

test('foreign, ambiguous lock or same-day Work Order for crew blocks an increase without writes', async () => {
  for (const conflict of ['lock', 'ambiguous-lock', 'crew', 'unknown-crew']) {
    const { db, authority } = fixture();
    if (conflict === 'lock') db.write(`bookingCapacityLocks/${lockId(date, 'VAN-1', '13:30')}`,
      { appointmentId: 'OTHER', date, vanId: 'VAN-1', slot: '13:30', active: true });
    else if (conflict === 'ambiguous-lock') db.write(`bookingCapacityLocks/${lockId(date, 'VAN-1', '13:30')}`,
      { appointmentId: 'OTHER', date, vanId: 'VAN-1', slot: '13:30' });
    else db.write('workOrders/WO-OTHER', { appointmentId: 'OTHER', date, time: '13:30', vanId: 'VAN-2',
      ...(conflict === 'crew' ? { technicianIds: ['TECH-1'] } : {}),
      status: 'Confirmada', appointmentCapacityEndTime: '14:30' });
    await assert.rejects(() => authority.adjust('owner-1', input()), /reserved|occupied|ambiguous/i);
    assert.equal(db.writes, 0);
    assert.equal(db.read('projectRecords/PROJECT-1').serverVersion, 1);
  }
});

test('request replay returns current canonical Project after a second correction and later billing', async () => {
  const { db, authority } = fixture();
  const first = await authority.adjust('owner-1', input());
  assert.equal(first.currentSlots, 4);
  await authority.adjust('owner-1', input({ requestId: 'capacity-request-2', expectedVersion: 2, slots: 5 }));
  const writes = db.writes;
  db.write('invoices/INV-LATER', { workOrderId: 'WO-1' });
  db.failQueries.add('invoices.workOrderId');
  const replay = await authority.adjust('owner-1', input());
  assert.equal(replay.replayed, true); assert.equal(replay.currentSlots, 5);
  assert.equal(replay.previousSlots, null);
  assert.equal(replay.usedNow, 5); assert.equal(replay.usedAfter, 5);
  assert.equal(replay.replayedEntry.requestId, input().requestId);
  assert.equal(replay.replayedEntry.currentSlots, 4);
  assert.equal(db.writes, writes);
  await assert.rejects(() => authority.adjust('owner-1', input({ slots: 5 })), /already used/i);
});

test('manual no-billing attestation is required and auditable but does not override local evidence', async () => {
  const { db, authority } = fixture();
  await assert.rejects(() => authority.adjust('owner-1', input({ noBillingAcknowledged: false })), /no invoice or payment/i);
  assert.equal(db.writes, 0);
  const result = await authority.adjust('owner-1', input());
  assert.equal(result.currentSlots, 4);
  const audit = [...db.records.entries()].find(([key]) => key.startsWith('projectCapacityCorrections/'))[1];
  assert.equal(audit.noBillingAcknowledged, true);
  const blocked = fixture();
  blocked.db.write('payments/PAY-1', { workOrderId: 'WO-1' });
  await assert.rejects(() => blocked.authority.adjust('owner-1', input()), /commercial/i);
});

test('over-budget increase requires explicit audited acknowledgement from canonical Work Orders', async () => {
  const { db, authority } = fixture({ budget: 3 });
  await assert.rejects(() => authority.adjust('owner-1', input()), /over-budget acknowledgement/i);
  assert.equal(db.writes, 0);
  const result = await authority.adjust('owner-1', input({ overBudgetAcknowledged: true }));
  assert.equal(result.overBudget, 1);
  assert.equal(result.budgetSlots, 3); assert.equal(result.usedBefore, 3); assert.equal(result.usedAfter, 4);
  assert.equal([...db.records.entries()].find(([key]) => key.startsWith('projectCapacityCorrections/'))[1].overBudgetAcknowledged, true);
});

test('Field, finance, Project actuals, conflicting identity/link and non-synthetic execution block both directions', async () => {
  const cases = [
    db => db.write('workVisits/VISIT-1', { workOrderId: 'WO-1', status: 'pending' }),
    db => db.write(`workVisits/${initialVisitDocumentId('WO-1')}`, { status: 'not_started' }),
    db => db.write('invoices/INV-1', { appointmentId: 'APT-1' }),
    db => db.write('projectBookingClaims/APT-1', { projectId: 'OTHER', appointmentId: 'APT-1' }),
    db => db.write('appointments/APT-1', { ...db.read('appointments/APT-1'), projectPhaseId: 'OTHER-PHASE' }),
    db => db.write('workOrders/WO-1', { ...db.read('workOrders/WO-1'), projectId: 'OTHER-PROJECT' }),
    db => db.write('workOrders/WO-1', { ...db.read('workOrders/WO-1'), projectPhaseId: 'OTHER-PHASE' }),
    db => db.write('projectRecords/PROJECT-1', { ...db.read('projectRecords/PROJECT-1'),
      assignments: [{ ...db.read('projectRecords/PROJECT-1').assignments[0], scheduledDate: '2026-09-20' }] }),
    db => db.write('projectRecords/PROJECT-1', { ...db.read('projectRecords/PROJECT-1'),
      assignments: [{ ...db.read('projectRecords/PROJECT-1').assignments[0], scheduledEnd: '15:30' }] }),
    db => db.write('projectRecords/PROJECT-1', { ...db.read('projectRecords/PROJECT-1'),
      assignments: [{ ...db.read('projectRecords/PROJECT-1').assignments[0], actualHours: 2 }] }),
    db => db.write('appointments/APT-1', { ...db.read('appointments/APT-1'), workAlreadyPerformed: true }),
  ];
  for (const prepare of cases) for (const slots of [2, 4]) {
    const { db, authority } = fixture({ slots: 3 }); prepare(db);
    await assert.rejects(() => authority.adjust('owner-1', input({ slots })), /Project|Field|commercial|execution|identit(?:y|ies)|assignment/i);
    assert.equal(db.writes, 0);
  }
  const backdated = fixture({ backdated: true });
  assert.equal((await backdated.authority.adjust('owner-1', input())).currentSlots, 4,
    'synthetic backdated marker alone is not Field actuals');
});
