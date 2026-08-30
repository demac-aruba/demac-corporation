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

test("after-hours emergency is same-day only", async () => {
  const { authority } = fixture({}, "2026-08-28T18:00:00.000Z");
  await assert.rejects(
    authority.createEmergency(input()),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST
      && error.details?.reason === "after-hours-same-day-only",
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
