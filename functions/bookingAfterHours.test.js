const assert = require("node:assert/strict");
const test = require("node:test");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const {
  AFTER_HOURS_KIND,
  afterHoursGuard,
  createAfterHoursAuthority,
} = require("./bookingAfterHours");
const { createOfficeBookingAuthorityFacade } = require("./officeBookingAuthorityFacade");
const { createWorkOrderApplicationService } = require("./workOrderApplicationService");

class FakeSnapshot {
  constructor(id, value, ref = null) {
    this.id = id;
    this._value = value;
    this.exists = value !== undefined;
    this.ref = ref;
  }
  data() { return this._value; }
}

class FakeDocRef {
  constructor(db, collection, id) {
    this.db = db;
    this.collectionName = collection;
    this.id = id;
  }
  key() { return `${this.collectionName}/${this.id}`; }
  async get() { return new FakeSnapshot(this.id, this.db.store.get(this.key()), this); }
  async set(value, options) {
    const current = this.db.store.get(this.key());
    this.db.store.set(this.key(), options?.merge ? { ...(current || {}), ...value } : value);
  }
}

class FakeQuery {
  constructor(db, collection, filters = []) {
    this.db = db;
    this.collectionName = collection;
    this.filters = filters;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, operator, value }]);
  }
  async get() {
    const prefix = `${this.collectionName}/`;
    const docs = [];
    for (const [path, value] of this.db.store.entries()) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
      const matches = this.filters.every((filter) => {
        const actual = value?.[filter.field];
        if (filter.operator === "==") return actual === filter.value;
        if (filter.operator === ">=") return actual >= filter.value;
        if (filter.operator === "<=") return actual <= filter.value;
        throw new Error(`Unsupported fake query operator ${filter.operator}`);
      });
      if (!matches) continue;
      const id = path.slice(prefix.length);
      const ref = new FakeDocRef(this.db, this.collectionName, id);
      docs.push(new FakeSnapshot(id, value, ref));
    }
    return { docs };
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(db, name) {
    super(db, name, []);
    this.name = name;
  }
  doc(id) { return new FakeDocRef(this.db, this.name, id); }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(ref) { return ref.get(); }
  set(ref, value, options) { this.writes.push({ ref, value, options }); }
  async commit() {
    for (const write of this.writes) await write.ref.set(write.value, write.options);
  }
}

class FakeFirestore {
  constructor(seed = {}) { this.store = new Map(Object.entries(seed)); }
  collection(name) { return new FakeCollectionRef(this, name); }
  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  }
  read(path) { return this.store.get(path); }
}

const DATE = "2026-08-27";
const CLOCK = "2026-08-27T18:00:00.000Z";

function baseSeed(extra = {}) {
  return {
    "clients/client-1": {
      id: "client-1",
      name: "Izaira Mansur",
      phone: "+2975600000",
      whatsapp: "+2975600000",
      preferredLanguage: "Papiamento",
      active: true,
    },
    "properties/property-1": {
      id: "property-1",
      clientId: "client-1",
      name: "Pastechi House Building",
      address: "Santa Cruz 54 C",
      zone: "Santa Cruz",
      operationalZone: "Santa Cruz",
      active: true,
    },
    "vans/VAN-1": {
      id: "VAN-1",
      active: true,
      status: "Disponible",
      name: "Van 1",
      responsibleStaffId: "driver-1",
      regularHelperId: "helper-1",
      additionalHelperId: "helper-2",
    },
    "staffProfiles/driver-1": {
      id: "driver-1",
      name: "Miguel Reyes",
      active: true,
      availability: "Disponible",
      canDriveVan: true,
    },
    "staffProfiles/helper-1": {
      id: "helper-1",
      name: "Alan Baquero",
      active: true,
      availability: "Disponible",
      canDriveVan: false,
    },
    "staffProfiles/helper-2": {
      id: "helper-2",
      name: "Third Helper",
      active: true,
      availability: "Disponible",
      canDriveVan: false,
    },
    "businessSettings/business-calendar": { id: "business-calendar", closedWeekdays: [0] },
    ...extra,
  };
}

function fixture(extra = {}, clock = CLOCK) {
  const db = new FakeFirestore(baseSeed(extra));
  const authority = createAfterHoursAuthority({
    db,
    clock: () => new Date(clock),
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { db, authority };
}

function input(overrides = {}) {
  return {
    requestId: "after-hours-request-0001",
    customerId: "client-1",
    propertyId: "property-1",
    presetId: "standard_service",
    quantity: 1,
    requestedDate: DATE,
    requestedTime: "17:30",
    requiredVanId: "VAN-1",
    customerFacingDescription: "Emergency no-cooling diagnostic",
    technicianInstructions: "Call office before replacing parts.",
    actor: { id: "office-1", name: "Dispatcher" },
    ...overrides,
  };
}

test("after-hours emergency rejects past dates", async () => {
  const { authority } = fixture({}, "2026-08-28T18:00:00.000Z");
  await assert.rejects(
    authority.createEmergency(input()),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST
      && error.details?.reason === "after-hours-past-date",
  );
});

test("after-hours emergency rejects starts before 17:00", async () => {
  const { authority } = fixture();
  await assert.rejects(
    authority.createEmergency(input({ requestedTime: "16:59" })),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST
      && error.details?.reason === "after-hours-start-before-17",
  );
});

test("after-hours emergency creates one canonical open-ended appointment, work order and guard", async () => {
  const { db, authority } = fixture();
  const result = await authority.createEmergency(input());

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.workOrderIds.length, 1);

  const appointment = db.read(`appointments/${result.appointmentId}`);
  const workOrder = db.read(`workOrders/${result.workOrderIds[0]}`);
  assert.equal(appointment.status, "confirmed");
  assert.equal(appointment.afterHoursKind, AFTER_HOURS_KIND);
  assert.equal(appointment.afterHoursOpenEnded, true);
  assert.equal(appointment.actualCompletedAt, null);
  assert.equal(appointment.startTime, "17:30");
  assert.equal(appointment.primaryVanId, "VAN-1");
  assert.deepEqual(appointment.assignments[0].technicianIds, ["driver-1", "helper-1", "helper-2"]);

  assert.equal(workOrder.status, "Confirmada");
  assert.equal(workOrder.afterHoursKind, AFTER_HOURS_KIND);
  assert.equal(workOrder.afterHoursOpenEnded, true);
  assert.equal(workOrder.actualCompletedAt, null);
  assert.equal(workOrder.time, "17:30");
  assert.equal(workOrder.appointmentEndTime, undefined);
  assert.equal(workOrder.vanId, "VAN-1");
  assert.deepEqual(workOrder.technicianIds, ["driver-1", "helper-1", "helper-2"]);
  assert.equal(workOrder.whatsappNotificationsEnabled, true);

  const guard = afterHoursGuard(DATE, "VAN-1");
  const storedGuard = db.read(`bookingCapacityLocks/${guard.id}`);
  assert.equal(storedGuard.active, true);
  assert.equal(storedGuard.openEnded, true);
  assert.equal(storedGuard.appointmentId, result.appointmentId);
  assert.equal(storedGuard.workOrderId, result.workOrderIds[0]);
});

test("after-hours emergency accepts the same multi-line work selection as normal booking", async () => {
  const { db, authority } = fixture();
  const result = await authority.createEmergency(input({
    presetId: undefined,
    quantity: undefined,
    customerFacingDescription: "",
    workLines: [
      { id: "standard", presetId: "standard_service", quantity: 2 },
      { id: "check", presetId: "check_up", quantity: 1 },
    ],
  }));

  const appointment = db.read(`appointments/${result.appointmentId}`);
  const workOrder = db.read(`workOrders/${result.workOrderIds[0]}`);
  assert.deepEqual(appointment.workLines.map((line) => [line.presetId, line.quantity]), [
    ["standard_service", 2],
    ["check_up", 1],
  ]);
  assert.deepEqual(appointment.workItems.map((item) => [item.presetId, item.quantity, item.durationMode]), [
    ["standard_service", 2, "open_ended"],
    ["check_up", 1, "open_ended"],
  ]);
  assert.equal(workOrder.appointmentWorkItems.length, 2);
  assert.equal(workOrder.airConditionerCount, 3);
  assert.match(workOrder.customerFacingDescription, /Standard Service × 2/);
  assert.match(workOrder.customerFacingDescription, /Check Up × 1/);
  assert.equal(workOrder.afterHoursOpenEnded, true);
  assert.equal(workOrder.appointmentEndTime, undefined);
});

test("office facade preserves every after-hours work line from the canonical drawer", async () => {
  const arubaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Aruba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const db = new FakeFirestore(baseSeed({
    "users/office-user": { id: "office-user", role: "office", active: true, name: "Dispatcher" },
    "businessSettings/business-calendar": { id: "business-calendar", closedWeekdays: [] },
  }));
  const facade = createOfficeBookingAuthorityFacade({
    db,
    verifyIdToken: async () => ({ uid: "office-user", name: "Dispatcher" }),
  });
  const response = await facade.handle({
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: {
      action: "create_after_hours_emergency",
      data: input({
        requestedDate: arubaDate,
        presetId: undefined,
        quantity: undefined,
        workLines: [
          { id: "standard", presetId: "standard_service", quantity: 2 },
          { id: "check", presetId: "check_up", quantity: 1 },
        ],
      }),
    },
  });

  assert.equal(response.status, 200);
  const appointment = db.read(`appointments/${response.body.appointmentId}`);
  assert.deepEqual(appointment.workItems.map((item) => [item.presetId, item.quantity]), [
    ["standard_service", 2],
    ["check_up", 1],
  ]);
});

test("retrying the same after-hours request is idempotent", async () => {
  const { db, authority } = fixture();
  const first = await authority.createEmergency(input());
  const second = await authority.createEmergency(input());
  assert.equal(second.success, true);
  assert.equal(second.replayed, true);
  assert.equal(second.appointmentId, first.appointmentId);
  assert.deepEqual(second.workOrderIds, first.workOrderIds);
  assert.equal(db.read(`appointments/${first.appointmentId}`).afterHoursRequestId, "after-hours-request-0001");
});

test("a Van cannot receive a second open-ended after-hours emergency while its guard is active", async () => {
  const { authority } = fixture();
  await authority.createEmergency(input());
  await assert.rejects(
    authority.createEmergency(input({ requestId: "after-hours-request-0002" })),
    (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT
      && error.details?.reason === "after-hours-open-job-exists",
  );
});

test("completion releases the Van so a later after-hours emergency can be assigned without inventing an end time", async () => {
  const { db, authority } = fixture();
  const first = await authority.createEmergency(input());
  const completion = createWorkOrderApplicationService({
    db,
    clock: () => new Date("2026-08-27T23:15:00.000Z"),
  });
  const completed = await completion.completeAfterHours({
    requestId: "complete-after-hours-0001",
    workOrderId: first.workOrderIds[0],
    actor: { uid: "tech-user-1", role: "technician", staffId: "driver-1", name: "Miguel Reyes" },
  });

  assert.equal(completed.afterHoursWorkedMinutes, 105);
  assert.equal(db.read(`bookingCapacityLocks/${afterHoursGuard(DATE, "VAN-1").id}`).active, false);
  assert.equal(db.read(`workOrders/${first.workOrderIds[0]}`).appointmentEndTime, undefined);

  const second = await authority.createEmergency(input({
    requestId: "after-hours-request-0002",
    requestedTime: "20:00",
  }));
  assert.equal(second.success, true);
  assert.notEqual(second.appointmentId, first.appointmentId);
  assert.equal(db.read(`workOrders/${second.workOrderIds[0]}`).appointmentEndTime, undefined);
});

test("after-hours emergency respects the canonical company closure calendar", async () => {
  const { authority } = fixture({
    "calendarClosures/closed-date": { id: "closed-date", date: DATE, active: true, reason: "Company closure" },
  });
  await assert.rejects(
    authority.createEmergency(input()),
    (error) => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED
      && error.details?.reason === "company-calendar-closed",
  );
});

const REST_DATE = '2026-09-29';
function restFixture(extra = {}) {
  return fixture({
    'vanHalfDaySchedules/rest-1': { vanId: 'VAN-1', weekday: 2, active: true, workdayStart: '08:00', workdayEnd: '13:00' },
    ...extra,
  }, '2026-09-28T14:00:00.000Z');
}
const restInput = (extra = {}) => input({ requestedDate: REST_DATE, requestedTime: '13:30', quantity: 4,
  actor: { id: 'office-1', name: 'Dispatcher', source: 'office-scheduling' }, ...extra });
async function confirmedRest(authority, request = restInput()) {
  const { proposal } = await authority.prepareRestDayOvertime(request);
  return { ...request, overtimeConsent: { accepted: true, confirmationToken: proposal.confirmationToken } };
}

test('future after-hours emergencies preserve the selected date and dated crew; malformed dates fail', async () => {
  const { authority } = restFixture();
  const result = await authority.createEmergency(input({ requestedDate: REST_DATE }));
  assert.equal(result.appointment.date, REST_DATE);
  assert.equal(result.workOrder.date, REST_DATE);
  assert.equal(result.workOrder.afterHoursOpenEnded, true);
  for (const requestedDate of ['2026-02-30', 'tomorrow', '2026-13-01']) {
    await assert.rejects(() => authority.createEmergency(input({ requestedDate })), /valid appointment date/);
  }
});

test('weekly-rest preparation writes nothing; four services reserve 13:30 to 17:30 with audit', async () => {
  const { db, authority } = restFixture();
  const before = [...db.store];
  const request = await confirmedRest(authority);
  assert.deepEqual([...db.store], before);
  const result = await authority.createRestDayOvertime(request);
  assert.equal(result.appointment.endTime, '17:30');
  assert.equal(result.appointment.capacityLockIds.length, 4);
  assert.equal(result.workOrder.appointmentDurationMinutes, 240);
  assert.equal(result.workOrder.scheduledSlots, 4);
  assert.equal(result.workOrder.airConditionerCount, 4);
  assert.equal(result.workOrder.afterHoursOpenEnded, undefined);
  assert.equal(result.workOrder.scheduledOvertime.acceptedBy, 'office-1');
  assert.deepEqual(result.workOrder.scheduledOvertime.slotStarts, ['13:30', '14:30', '15:30', '16:30']);
  assert.equal(result.appointment.lifecycleHistory[0].kind, 'weekly_rest_overtime_booked');
  assert.equal(db.read(`bookingCapacityLocks/${afterHoursGuard(REST_DATE, 'VAN-1').id}`).active, false);
  assert.equal([...db.store.keys()].some((key) => /employeeTimesheets|payroll|whatsappOutboundQueue/.test(key)), false);
});

test('three services and mixed manual work retain canonical duration without ordinary capacity limit', async () => {
  for (const [extra, minutes, slots, end] of [
    [{ quantity: 3 }, 180, 3, '16:30'],
    [{ workLines: [{ presetId: 'standard_service', quantity: 2 }, { presetId: 'other', quantity: 1, manualDurationMinutes: 90 }] }, 210, 4, '17:00'],
    [{ quantity: 7 }, 420, 7, '20:30'],
  ]) {
    const { authority } = restFixture();
    const result = await authority.createRestDayOvertime(await confirmedRest(authority, restInput(extra)));
    assert.equal(result.workOrder.appointmentDurationMinutes, minutes);
    assert.equal(result.workOrder.scheduledSlots, slots);
    assert.equal(result.appointment.endTime, end);
  }
});

test('confirmation is required and bound to actor, work, schedule and crew', async () => {
  const { db, authority } = restFixture();
  const before = [...db.store];
  await assert.rejects(() => authority.createRestDayOvertime(restInput()), /Confirm the current overtime/);
  assert.deepEqual([...db.store], before);
  const request = await confirmedRest(authority);
  for (const changed of [{ quantity: 3 }, { actor: { id: 'office-2', source: 'office-scheduling' } }, { customerFacingDescription: 'Changed scope' }]) {
    await assert.rejects(() => authority.createRestDayOvertime({ ...request, ...changed }), /Confirm the current overtime/);
  }
  db.store.set('vanHalfDaySchedules/rest-1', { ...db.read('vanHalfDaySchedules/rest-1'), workdayEnd: '12:30' });
  await assert.rejects(() => authority.createRestDayOvertime(request), /Confirm the current overtime/);
});

test('overtime retry is exact and changed payload is rejected without duplicate appointment', async () => {
  const { db, authority } = restFixture();
  const request = await confirmedRest(authority);
  const saved = await authority.createRestDayOvertime(request);
  assert.equal((await authority.createRestDayOvertime(request)).replayed, true);
  await assert.rejects(() => authority.createRestDayOvertime({ ...request, quantity: 3 }), (error) => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT);
  assert.equal([...db.store.keys()].filter((key) => key.startsWith('appointments/')).length, 1);
  assert.equal(db.read(`appointments/${saved.appointmentId}`).endTime, '17:30');
});

test('weekly-rest overtime rejects unavailable crew, duplicate crew, closures and ordinary slots', async () => {
  const variants = [
    { 'vans/VAN-1': { ...baseSeed()['vans/VAN-1'], status: 'Mantenimiento' } },
    { 'staffProfiles/helper-1': { ...baseSeed()['staffProfiles/helper-1'], active: false } },
    { 'staffAbsences/off': { staffId: 'driver-1', fromDate: REST_DATE, toDate: REST_DATE, active: true } },
    { 'vans/VAN-2': { id: 'VAN-2', responsibleStaffId: 'driver-1', active: true } },
    { 'calendarClosures/closed': { date: REST_DATE, active: true } },
    { 'vanHalfDaySchedules/rest-1': { vanId: 'VAN-1', weekday: 3, active: true } },
  ];
  for (const extra of variants) {
    const { db, authority } = restFixture(extra);
    const before = [...db.store];
    await assert.rejects(() => authority.prepareRestDayOvertime(restInput()), undefined, JSON.stringify(extra));
    assert.deepEqual([...db.store], before);
  }
  const { authority } = restFixture();
  await assert.rejects(() => authority.prepareRestDayOvertime(restInput({ requestedTime: '08:30' })), /blocked weekly rest/);
  await assert.rejects(() => authority.prepareRestDayOvertime(restInput({ quantity: 11 })), /finish on the selected date/);
  await assert.rejects(() => authority.prepareRestDayOvertime(restInput({ actor: { id: 'external' } })), /authenticated office/);
});

test('new conflict or orphan capacity lock after preparation fails without partial writes', async () => {
  for (const orphan of [false, true]) {
    const { db, authority } = restFixture();
    const request = await confirmedRest(authority);
    if (orphan) {
      const { hashId } = require('./bookingSchedulingPrimitives');
      const id = `BAL-${hashId(`${REST_DATE}|VAN-1|16:30`, 32).toUpperCase()}`;
      db.store.set(`bookingCapacityLocks/${id}`, { active: true, appointmentId: 'other' });
    } else db.store.set('workOrders/conflict', { date: REST_DATE, time: '16:00', vanId: 'VAN-1', status: 'Confirmada', appointmentDurationMinutes: 60 });
    const before = [...db.store];
    await assert.rejects(() => authority.createRestDayOvertime(request), (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT);
    assert.deepEqual([...db.store], before);
  }
});

test('overtime and emergency intervals reject overlap but allow an emergency after the reserved end', async () => {
  const { authority } = restFixture();
  await authority.createRestDayOvertime(await confirmedRest(authority));
  await assert.rejects(() => authority.createEmergency(input({ requestId: 'emergency-overlap', requestedDate: REST_DATE, requestedTime: '17:00' })), /reserved by a fixed-duration/);
  await authority.createEmergency(input({ requestId: 'emergency-after-end', requestedDate: REST_DATE, requestedTime: '17:30' }));
  const reverse = restFixture();
  await reverse.authority.createEmergency(input({ requestedDate: REST_DATE, requestedTime: '17:30' }));
  await reverse.authority.createRestDayOvertime(await confirmedRest(reverse.authority));
});

test('cancelling weekly-rest overtime releases its slots and preserves the emergency serialization guard', async () => {
  const { createBookingAppointmentLifecycle } = require('./bookingAuthorityAppointmentLifecycle');
  const { db, authority } = restFixture();
  const saved = await authority.createRestDayOvertime(await confirmedRest(authority));
  const lifecycle = createBookingAppointmentLifecycle({ db, schedulingProvider: {}, clock: () => new Date(CLOCK), serverTimestamp: () => 'SERVER_TIMESTAMP' });
  await lifecycle.cancelAppointment({ appointmentId: saved.appointmentId, reason: 'Test cancellation', actor: { id: 'office-1' } });
  for (const id of saved.appointment.capacityLockIds) assert.equal(db.read(`bookingCapacityLocks/${id}`).active, false);
  const next = await confirmedRest(authority, restInput({ requestId: 'replacement-overtime' }));
  assert.equal((await authority.createRestDayOvertime(next)).success, true);
});

async function confirmedCapacity(authority, request = restInput()) {
  const { proposal } = await authority.prepareCapacityOvertime(request);
  return { ...request, overtimeConsent: { accepted: true, confirmationToken: proposal.confirmationToken } };
}
const capacityFixture = (extra = {}) => fixture(extra, '2026-09-28T14:00:00.000Z');

test('new regular booking: four services, three ordinary afternoon slots, explicit possible overtime through 17:30', async () => {
  const { db, authority } = capacityFixture();
  const before = [...db.store];
  const { proposal } = await authority.prepareCapacityOvertime(restInput());
  assert.deepEqual([...db.store], before);
  assert.equal(proposal.ordinarySlots, 3);
  assert.equal(proposal.requiredSlots, 4);
  assert.equal(proposal.estimatedEnd, '17:30');
  const request = await confirmedCapacity(authority);
  const saved = await authority.createCapacityOvertime(request);
  assert.equal(saved.workOrder.scheduledOvertime.kind, 'capacity_overflow_overtime');
  assert.equal(saved.workOrder.airConditionerCount, 4);
  assert.equal(saved.workOrder.appointmentDurationMinutes, 240);
  assert.equal(saved.appointment.capacityLockIds.length, 4);
  assert.equal(saved.appointment.lifecycleHistory[0].kind, 'capacity_overflow_overtime_booked');
  assert.equal(saved.workOrder.afterHoursOpenEnded, undefined);
  assert.deepEqual(saved.workOrder.scheduledOvertime.slotStarts, ['13:30', '14:30', '15:30', '16:30']);
  assert.equal((await authority.createCapacityOvertime(request)).replayed, true);
  assert.equal([...db.store.keys()].filter(key => key.startsWith('appointments/')).length, 1);
  await assert.rejects(() => authority.createCapacityOvertime({ ...restInput(), quantity: 5 }), error => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT);
});

test('afternoon overflow preserves three-at-14:30 and mixed workloads; ordinary fitting work uses the ordinary route', async () => {
  for (const [extra, slots, end] of [
    [{ quantity: 3, requestedTime: '14:30' }, 3, '17:30'],
    [{ workLines: [{ presetId: 'standard_service', quantity: 2 }, { presetId: 'other', quantity: 1, manualDurationMinutes: 90 }] }, 4, '17:00'],
    [{ quantity: 6 }, 6, '19:30'],
  ]) {
    const { authority } = capacityFixture();
    const result = await authority.createCapacityOvertime(await confirmedCapacity(authority, restInput(extra)));
    assert.equal(result.workOrder.scheduledSlots, slots); assert.equal(result.appointment.endTime, end);
  }
  const { authority } = capacityFixture();
  for (const extra of [{ quantity: 3 }, { requestedTime: '10:30' }, { requestedTime: '17:00' }, { requestedTime: '12:30' }]) {
    await assert.rejects(() => authority.prepareCapacityOvertime(restInput(extra)));
  }
  await assert.rejects(() => authority.prepareCapacityOvertime(restInput({ quantity: 11 })), /finish on the selected date/);
  await assert.rejects(() => restFixture().authority.prepareCapacityOvertime(restInput()), /remaining ordinary afternoon slots/);
});

test('capacity overflow consent is mandatory; changes, absences and actual reservations still block', async () => {
  const { db, authority } = capacityFixture();
  const request = await confirmedCapacity(authority);
  await assert.rejects(() => authority.createCapacityOvertime(restInput()), /Confirm the current overtime/);
  for (const change of [{ quantity: 5 }, { technicianInstructions: 'Changed' }, { actor: { id: 'office-2', source: 'office-scheduling' } }]) {
    await assert.rejects(() => authority.createCapacityOvertime({ ...request, ...change }), /Confirm the current overtime/);
  }
  db.store.set('staffAbsences/off', { staffId: 'helper-1', fromDate: REST_DATE, toDate: REST_DATE, active: true });
  const before = [...db.store];
  await assert.rejects(() => authority.createCapacityOvertime(request));
  assert.deepEqual([...db.store], before);
  for (const time of ['14:30', '16:30', '17:15']) {
    const next = capacityFixture({ 'workOrders/real-conflict': { date: REST_DATE, time, vanId: 'VAN-1', status: 'Confirmada', appointmentDurationMinutes: 60 } });
    await assert.rejects(() => next.authority.prepareCapacityOvertime(restInput()), error => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT);
  }
});

test('capacity overtime cancellation frees all four locks and exact retry stays the original canceled identity', async () => {
  const { createBookingAppointmentLifecycle } = require('./bookingAuthorityAppointmentLifecycle');
  const { db, authority } = capacityFixture();
  const request = await confirmedCapacity(authority);
  const saved = await authority.createCapacityOvertime(request);
  const lifecycle = createBookingAppointmentLifecycle({ db, schedulingProvider: {}, clock: () => new Date(CLOCK), serverTimestamp: () => 'SERVER_TIMESTAMP' });
  await lifecycle.cancelAppointment({ appointmentId: saved.appointmentId, reason: 'Test', actor: { id: 'office-1' } });
  for (const id of saved.appointment.capacityLockIds) assert.equal(db.read(`bookingCapacityLocks/${id}`).active, false);
  assert.equal((await authority.createCapacityOvertime(request)).appointment.status, 'cancelled');
  assert.equal((await authority.createCapacityOvertime(await confirmedCapacity(authority, restInput({ requestId: 'capacity-replacement' })))).success, true);
});

test('after-hours references are included at the initial atomic appointment write', async () => {
  const { db, authority } = fixture({ 'users/office-1': { active: true, role: 'office' } });
  const result = await authority.createEmergency(input({ actor: { id: 'office-1', source: 'office-scheduling' },
    visitReferences: { notes: 'Entrance behind kitchen', files: [], location: { url: '12.5,-70.0', label: 'Entrance' } } }));
  assert.equal(result.appointment.visitReferences.notes, 'Entrance behind kitchen');
  assert.match(result.appointment.visitReferences.location.url, /query=12.5,-70/);
});
