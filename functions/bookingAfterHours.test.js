const assert = require("node:assert/strict");
const test = require("node:test");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const {
  AFTER_HOURS_KIND,
  afterHoursGuard,
  createAfterHoursAuthority,
} = require("./bookingAfterHours");

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
