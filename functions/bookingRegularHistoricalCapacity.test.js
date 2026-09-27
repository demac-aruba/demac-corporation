'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegularHistoricalCapacityAuthority, lockId } = require('./bookingRegularHistoricalCapacity');
const { minutesTime, timeMinutes } = require('./bookingSchedulingPrimitives');
const { createOfficeBookingApi, OFFICE_BOOKING_ACTIONS } = require('./officeBookingAuthority');

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
    const docs = [...this.db.records.entries()].filter(([key, value]) => key.startsWith(`${this.collection}/`)
      && (this.field === null || value?.[this.field] === this.value)).slice(0, this.max)
      .map(([key, value]) => new Snapshot(key.slice(this.collection.length + 1), value));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}
class Db {
  constructor(seed) { this.records = new Map(Object.entries(seed)); this.writes = 0; }
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
const actor = { id: 'office-1', name: 'Office User', source: 'office-scheduling' };
function fixture({ slots = 3, start = '08:30', backdated = false, durationMinutesPerUnit = 60,
  quantity = slots, fullDay = false } = {}) {
  const owned = anchors.slice(anchors.indexOf(start), anchors.indexOf(start) + slots);
  const durationMinutes = quantity * durationMinutesPerUnit;
  const end = minutesTime(timeMinutes(start) + durationMinutes);
  const capacityEnd = minutesTime(timeMinutes(owned.at(-1)) + 60);
  const assignment = { vanId: 'VAN-1', technicianIds: ['TECH-1'], role: 'primary', time: start, slots,
    quantity, durationMinutes, endTime: end, capacityEndTime: capacityEnd, fullDay };
  const metadata = backdated ? { bookingMode: 'backdated', backdatingAcknowledged: true, workAlreadyPerformed: true } : {};
  const seed = {
    'appointments/APT-1': { id: 'APT-1', appointmentId: 'APT-1', bookingAuthorityVersion: 1,
      customerId: 'CLIENT-1', propertyId: 'PROPERTY-1', date, status: 'confirmed', startTime: start,
      endTime: end, capacityEndTime: capacityEnd, primaryVanId: 'VAN-1', workOrderIds: ['WO-1'], assignments: [assignment],
      capacityLockIds: owned.map(slot => lockId(date, 'VAN-1', slot)),
      notificationRecipients: [{ phone: '+2975551234', sendConfirmation: true }], ...metadata },
    'workOrders/WO-1': { id: 'WO-1', appointmentId: 'APT-1', clientId: 'CLIENT-1', propertyId: 'PROPERTY-1',
      date, time: start, vanId: 'VAN-1', technicianIds: ['TECH-1'], status: 'Confirmada',
      airConditionerCount: quantity, fullDaySingleProperty: fullDay,
      scheduledSlots: slots, appointmentDurationMinutes: durationMinutes,
      appointmentEndTime: end, appointmentCapacityEndTime: capacityEnd,
      appointmentWorkItems: [{ id: 'service', quantity, durationMinutesPerUnit,
        durationMinutes, durationMode: 'per_unit' }],
      whatsappNotificationsEnabled: true, notificationRecipients: [{ phone: '+2975551234' }], ...metadata },
  };
  for (const slot of owned) seed[`bookingCapacityLocks/${lockId(date, 'VAN-1', slot)}`] = {
    appointmentId: 'APT-1', date, vanId: 'VAN-1', slot, active: true,
  };
  const db = new Db(seed);
  return { db, authority: createRegularHistoricalCapacityAuthority({ db, clock: () => new Date('2026-09-23T14:00:00Z') }) };
}
function input(overrides = {}) { return { appointmentId: 'APT-1', requestId: 'regular-capacity-request-1',
  expectedSlots: 3, slots: 4, reason: 'Correct historical Van allocation', noBillingAcknowledged: true, ...overrides }; }

test('increase crosses lunch, preserves distinct worked and capacity ends, and never changes notifications', async () => {
  const { db, authority } = fixture();
  const beforeAppointmentRecipients = db.read('appointments/APT-1').notificationRecipients;
  const beforeOrderRecipients = db.read('workOrders/WO-1').notificationRecipients;
  const result = await authority.adjust(actor, input());
  assert.equal(result.currentSlots, 4);
  assert.equal(db.count('appointments'), 1); assert.equal(db.count('workOrders'), 1);
  assert.equal(db.read('appointments/APT-1').endTime, '12:30');
  assert.equal(db.read('appointments/APT-1').capacityEndTime, '14:30');
  assert.equal(db.read('appointments/APT-1').assignments[0].endTime, '12:30');
  assert.equal(db.read('appointments/APT-1').assignments[0].capacityEndTime, '14:30');
  assert.equal(db.read('workOrders/WO-1').appointmentDurationMinutes, 240);
  assert.equal(db.read('workOrders/WO-1').appointmentEndTime, '12:30');
  assert.equal(db.read('workOrders/WO-1').appointmentCapacityEndTime, '14:30');
  assert.equal(db.read('workOrders/WO-1').scheduledSlots, 4);
  assert.equal(db.read('workOrders/WO-1').appointmentWorkItems[0].durationMinutes, 180,
    'planned work scope is not rewritten by an allocated-slot correction');
  assert.equal(db.read(`bookingCapacityLocks/${lockId(date, 'VAN-1', '13:30')}`).active, true);
  assert.deepEqual(db.read('appointments/APT-1').notificationRecipients, beforeAppointmentRecipients);
  assert.deepEqual(db.read('workOrders/WO-1').notificationRecipients, beforeOrderRecipients);
  assert.equal(db.read('workOrders/WO-1').whatsappNotificationsEnabled, true);
  assert.equal(db.count('regularCapacityCorrections'), 1);
  assert.equal(db.count('whatsappOutboundQueue'), 0);
});

test('an existing four-slot booking across lunch validates and may gain a fifth slot', async () => {
  const { db, authority } = fixture({ slots: 4 });
  assert.equal(db.read('appointments/APT-1').endTime, '12:30');
  assert.equal(db.read('appointments/APT-1').capacityEndTime, '14:30');
  const result = await authority.adjust(actor, input({ expectedSlots: 4, slots: 5 }));
  assert.equal(result.currentSlots, 5);
  assert.equal(db.read('appointments/APT-1').endTime, '13:30');
  assert.equal(db.read('appointments/APT-1').capacityEndTime, '15:30');
  assert.equal(db.read('workOrders/WO-1').appointmentDurationMinutes, 300);
  assert.equal(db.read('workOrders/WO-1').appointmentCapacityEndTime, '15:30');
});

test('reduction releases only the owned tail; replay makes no additional writes', async () => {
  const { db, authority } = fixture({ slots: 4 });
  const request = input({ expectedSlots: 4, slots: 2 });
  const result = await authority.adjust(actor, request);
  assert.equal(result.currentSlots, 2);
  assert.equal(db.read('appointments/APT-1').endTime, '10:30');
  assert.equal(db.read('workOrders/WO-1').appointmentDurationMinutes, 120);
  assert.equal(db.read(`bookingCapacityLocks/${lockId(date, 'VAN-1', '10:30')}`).active, false);
  assert.equal(db.read(`bookingCapacityLocks/${lockId(date, 'VAN-1', '13:30')}`).active, false);
  const writes = db.writes;
  const replay = await authority.adjust(actor, request);
  assert.equal(replay.replayed, true); assert.equal(replay.currentSlots, 2);
  assert.equal(replay.observedCurrentSlots, 2); assert.equal(replay.currentMatchesAudit, true);
  assert.equal(db.writes, writes);
  await assert.rejects(() => authority.adjust(actor, { ...request, slots: 3 }), /request ID was already used/i);
});

test('an old request replay after a newer correction reports historical result and latest state separately', async () => {
  const { db, authority } = fixture();
  const first = input({ requestId: 'regular-capacity-first-request' });
  const second = input({ requestId: 'regular-capacity-second-request', expectedSlots: 4, slots: 2 });
  assert.equal((await authority.adjust(actor, first)).currentSlots, 4);
  assert.equal((await authority.adjust(actor, second)).currentSlots, 2,
    'a second correction must reconcile the unchanged work scope with the prior audit');
  const writes = db.writes;
  const replay = await authority.adjust(actor, first);
  assert.equal(replay.replayed, true);
  assert.equal(replay.previousSlots, 3);
  assert.equal(replay.currentSlots, 4, 'original audited result, not latest state');
  assert.equal(replay.observedCurrentSlots, 2);
  assert.equal(replay.currentMatchesAudit, false);
  assert.equal(db.read('appointments/APT-1').assignments[0].slots, 2);
  assert.equal(db.writes, writes);
});

test('stale, occupied, lunch-gap, cross-Van crew, unknown crew and ambiguous locks block increases without writes', async () => {
  for (const conflict of ['stale', 'lock', 'ambiguous-lock', 'inactive-corrupt-lock',
    'crew', 'unknown-crew', 'lunch-gap', 'empty-crew']) {
    const { db, authority } = fixture();
    if (conflict === 'lock' || conflict === 'ambiguous-lock') db.write(`bookingCapacityLocks/${lockId(date, 'VAN-1', '13:30')}`,
      { appointmentId: 'OTHER', date, vanId: 'VAN-1', slot: '13:30', ...(conflict === 'lock' ? { active: true } : {}) });
    if (conflict === 'crew' || conflict === 'unknown-crew') db.write('workOrders/WO-OTHER', {
      appointmentId: 'OTHER', date, time: '13:30', vanId: 'VAN-2', status: 'Confirmada',
      ...(conflict === 'crew' ? { technicianIds: ['TECH-1'] } : {}), appointmentCapacityEndTime: '14:30',
    });
    if (conflict === 'inactive-corrupt-lock') db.write(`bookingCapacityLocks/${lockId(date, 'VAN-1', '13:30')}`,
      { appointmentId: 'OTHER', date, vanId: 'VAN-2', slot: '13:30', active: false });
    if (conflict === 'lunch-gap' || conflict === 'empty-crew') db.write('workOrders/WO-OTHER', {
      appointmentId: 'OTHER', date, time: '11:45', vanId: conflict === 'lunch-gap' ? 'VAN-1' : 'VAN-2',
      status: 'Confirmada', technicianIds: conflict === 'lunch-gap' ? ['TECH-2'] : [],
      appointmentEndTime: '12:45', appointmentCapacityEndTime: '12:45', appointmentDurationMinutes: 60,
    });
    await assert.rejects(() => authority.adjust(actor, input(conflict === 'stale' ? { expectedSlots: 2 } : {})),
      /changed|reserved|occupied|ambiguous/i);
    assert.equal(db.writes, 0);
  }
});

test('six ordinary hourly units may shrink even when marked full-day; seven-unit and non-hourly scope fail closed', async () => {
  const standard = fixture({ slots: 6, quantity: 6, fullDay: true });
  assert.equal(standard.db.read('appointments/APT-1').endTime, '14:30');
  assert.equal(standard.db.read('appointments/APT-1').capacityEndTime, '16:30');
  assert.equal((await standard.authority.adjust(actor, input({ expectedSlots: 6, slots: 3 }))).currentSlots, 3);
  assert.equal(standard.db.read('workOrders/WO-1').fullDaySingleProperty, false);

  for (const options of [{ slots: 6, quantity: 7, fullDay: true }, { slots: 3, quantity: 2, durationMinutesPerUnit: 90 }]) {
    const { db, authority } = fixture(options);
    await assert.rejects(() => authority.adjust(actor, input({ expectedSlots: options.slots, slots: options.slots - 1 })),
      /nonstandard|one-hour-per-unit/i);
    assert.equal(db.writes, 0);
  }
});

test('Project links, Field actuals, billing and contradictory canonical identity block both directions', async () => {
  const cases = [
    db => db.write('projectBookingClaims/APT-1', { projectId: 'PROJECT-1' }),
    db => db.write('appointments/APT-1', { ...db.read('appointments/APT-1'), projectId: 'PROJECT-1' }),
    db => db.write('workOrders/WO-1', { ...db.read('workOrders/WO-1'), projectId: 'PROJECT-1' }),
    db => db.write('workOrders/WO-1', { ...db.read('workOrders/WO-1'), clientId: 'OTHER' }),
    db => db.write('workVisits/VISIT-1', { workOrderId: 'WO-1' }),
    db => db.write('invoices/INV-1', { appointmentId: 'APT-1' }),
    db => db.write('payments/PAY-1', { workOrderId: 'WO-1' }),
    db => db.write('appointments/APT-1', { ...db.read('appointments/APT-1'), actualHours: 1 }),
  ];
  for (const prepare of cases) for (const slots of [2, 4]) {
    const { db, authority } = fixture(); prepare(db);
    await assert.rejects(() => authority.adjust(actor, input({ slots })), /Project|Field|commercial|identit|crew/i);
    assert.equal(db.writes, 0);
  }
});

test('no-billing attestation, canonical status, office actor and synthetic backdate boundaries', async () => {
  const { db, authority } = fixture();
  await assert.rejects(() => authority.adjust(actor, input({ noBillingAcknowledged: false })), /no invoice or payment/i);
  await assert.rejects(() => authority.adjust({ id: 'TECH-1', source: 'field' }, input()), /Office Booking Authority/i);
  db.write('appointments/APT-1', { ...db.read('appointments/APT-1'), status: 'temporary_hold' });
  await assert.rejects(() => authority.adjust(actor, input()), /confirmed canonical/i);
  assert.equal(db.writes, 0);
  const backdated = fixture({ backdated: true });
  assert.equal((await backdated.authority.adjust(actor, input())).currentSlots, 4,
    'synthetic backdated marker alone is not verified Field execution');
});

test('office action is available only through authenticated authorized Booking Authority', async () => {
  const { db } = fixture();
  db.write('users/OFFICE-1', { role: 'office', active: true, name: 'Office User' });
  let calls = 0;
  const createApi = () => createOfficeBookingApi({ db,
    verifyIdToken: async () => ({ uid: 'OFFICE-1' }), bookingAuthority: {}, schedulingProvider: {},
    regularHistoricalCapacityAuthority: { adjust: async (receivedActor, receivedInput) => {
      calls += 1;
      assert.equal(receivedActor.id, 'OFFICE-1');
      assert.equal(receivedActor.source, 'office-scheduling');
      assert.equal(receivedInput.appointmentId, 'APT-1');
      return { success: true, currentSlots: 4 };
    } },
  });
  const request = { method: 'POST', headers: { authorization: 'Bearer test-token' },
    body: { action: OFFICE_BOOKING_ACTIONS.ADJUST_HISTORICAL_REGULAR_CAPACITY, data: input() } };
  assert.equal((await createApi().handle(request)).status, 200);
  assert.equal(calls, 1);
  db.write('users/OFFICE-1', { role: 'technician', active: true });
  const denied = await createApi().handle(request);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'permission_denied');
  assert.equal(calls, 1);
});
