const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BOOKING_ERROR_CODES,
} = require("./bookingAuthorityCore");
const {
  createAdhocSupportAuthority,
  supportCapacityLock,
} = require("./bookingAdhocSupport");

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

function baseSeed(extra = {}) {
  return {
    "appointments/APT-SUPPORT-1": {
      id: "APT-SUPPORT-1",
      appointmentId: "APT-SUPPORT-1",
      customerId: "client-1",
      propertyId: "property-1",
      status: "confirmed",
      date: DATE,
      startTime: "09:30",
      endTime: "11:30",
      primaryVanId: "VAN-1",
      assignments: [{
        vanId: "VAN-1",
        vanName: "Van 1",
        technicianIds: ["primary-driver", "primary-helper"],
        quantity: 2,
        slots: 2,
        time: "09:30",
        endTime: "11:30",
        role: "primary",
      }],
      workOrderIds: ["WO-APT-SUPPORT-1-1"],
      capacityLockIds: ["lock-primary-0930", "lock-primary-1030"],
      lifecycleHistory: [],
    },
    "workOrders/WO-APT-SUPPORT-1-1": {
      id: "WO-APT-SUPPORT-1-1",
      appointmentId: "APT-SUPPORT-1",
      clientId: "client-1",
      propertyId: "property-1",
      status: "Confirmada",
      date: DATE,
      time: "09:30",
      appointmentEndTime: "11:30",
      vanId: "VAN-1",
      scheduledSlots: 2,
      appointmentDurationMinutes: 120,
      appointmentAssignmentRole: "primary",
      airConditionerCount: 2,
      address: "Santa Cruz 54 C",
      zone: "Santa Cruz",
      customerFacingDescription: "Two standard AC services",
      whatsappNotificationsEnabled: true,
      notificationRecipients: [{ id: "client-1", sendConfirmation: true, sendReminder: true }],
    },
    "properties/property-1": {
      id: "property-1",
      clientId: "client-1",
      name: "Main Property",
      address: "Santa Cruz 54 C",
      addressRaw: "Santa Cruz 54 C",
      zone: "Santa Cruz",
      operationalZone: "Santa Cruz",
    },
    "vans/VAN-1": {
      id: "VAN-1",
      active: true,
      name: "Van 1",
      responsibleStaffId: "primary-driver",
      regularHelperId: "primary-helper",
    },
    "vans/VAN-2": {
      id: "VAN-2",
      active: true,
      name: "Van 2",
      responsibleStaffId: "support-driver-default",
      regularHelperId: "support-helper-default",
      additionalHelperId: "support-third-default",
    },
    "staffProfiles/primary-driver": { id: "primary-driver", name: "Miguel Reyes", active: true, availability: "Disponible", canDriveVan: true },
    "staffProfiles/primary-helper": { id: "primary-helper", name: "Alan Baquero", active: true, availability: "Disponible", canDriveVan: false },
    "staffProfiles/support-driver-default": { id: "support-driver-default", name: "Default Driver", active: true, availability: "Disponible", canDriveVan: true },
    "staffProfiles/support-helper-default": { id: "support-helper-default", name: "Default Helper", active: true, availability: "Disponible", canDriveVan: false },
    "staffProfiles/support-third-default": { id: "support-third-default", name: "Default Third", active: true, availability: "Disponible", canDriveVan: false },
    "staffProfiles/support-driver-date": { id: "support-driver-date", name: "Walter Gomez", active: true, availability: "Disponible", canDriveVan: true },
    "staffProfiles/support-helper-date": { id: "support-helper-date", name: "Goyo Perez", active: true, availability: "Disponible", canDriveVan: false },
    "staffProfiles/support-third-date": { id: "support-third-date", name: "Third Helper", active: true, availability: "Disponible", canDriveVan: false },
    "dailyVanAssignments/VAN-2-2026-08-27": {
      id: "VAN-2-2026-08-27",
      date: DATE,
      vanId: "VAN-2",
      driverStaffId: "support-driver-date",
      helperStaffId: "support-helper-date",
      additionalHelperStaffId: "support-third-date",
      status: "Disponible",
    },
    "businessSettings/business-calendar": { id: "business-calendar", closedWeekdays: [0] },
    ...extra,
  };
}

function fixture(extra = {}, clock = "2026-08-27T14:00:00.000Z") {
  const db = new FakeFirestore(baseSeed(extra));
  const authority = createAdhocSupportAuthority({
    db,
    clock: () => new Date(clock),
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { db, authority };
}

function addInput(overrides = {}) {
  return {
    appointmentId: "APT-SUPPORT-1",
    requestId: "support-request-0001",
    requestedDate: DATE,
    requestedTime: "13:30",
    targetVanId: "VAN-2",
    reason: "Need a second team for lifting",
    actor: { id: "office-1", name: "Dispatcher" },
    ...overrides,
  };
}

test("ad hoc support creates one linked SUPPORT work order and one canonical capacity lock without moving primary", async () => {
  const { db, authority } = fixture();
  const result = await authority.addSupport(addInput());
  assert.equal(result.success, true);
  assert.equal(result.replayed, false);

  const appointment = db.read("appointments/APT-SUPPORT-1");
  assert.equal(appointment.assignments.length, 2);
  assert.equal(appointment.assignments[0].vanId, "VAN-1");
  assert.equal(appointment.assignments[0].time, "09:30");
  assert.equal(appointment.assignments[1].role, "support");
  assert.equal(appointment.assignments[1].vanId, "VAN-2");
  assert.equal(appointment.assignments[1].time, "13:30");
  assert.deepEqual(appointment.assignments[1].technicianIds, ["support-driver-date", "support-helper-date", "support-third-date"]);
  assert.equal(appointment.lastScheduleChangeKind, "support_added");
  assert.equal(appointment.customerNotificationRecommended, false);

  const supportOrder = db.read(`workOrders/${result.supportWorkOrderId}`);
  assert.equal(supportOrder.appointmentId, "APT-SUPPORT-1");
  assert.equal(supportOrder.appointmentAssignmentRole, "support");
  assert.equal(supportOrder.parentWorkOrderId, "WO-APT-SUPPORT-1-1");
  assert.equal(supportOrder.supportAssignmentKind, "adhoc_rescue");
  assert.equal(supportOrder.supportPrimaryVanId, "VAN-1");
  assert.equal(supportOrder.vanId, "VAN-2");
  assert.equal(supportOrder.time, "13:30");
  assert.equal(supportOrder.appointmentEndTime, "14:30");
  assert.deepEqual(supportOrder.technicianIds, ["support-driver-date", "support-helper-date", "support-third-date"]);
  assert.equal(supportOrder.whatsappNotificationsEnabled, false);
  assert.deepEqual(supportOrder.notificationRecipients, []);
  assert.equal(supportOrder.customerCommunicationOwner, false);
  assert.equal(supportOrder.supportNonBillable, true);

  const lock = supportCapacityLock(DATE, "VAN-2", "13:30");
  const storedLock = db.read(`bookingCapacityLocks/${lock.id}`);
  assert.equal(storedLock.active, true);
  assert.equal(storedLock.appointmentId, "APT-SUPPORT-1");
  assert.equal(storedLock.vanId, "VAN-2");
  assert.equal(storedLock.slot, "13:30");
});

test("retrying the same support request is idempotent and does not append another support assignment", async () => {
  const { db, authority } = fixture();
  const first = await authority.addSupport(addInput());
  const second = await authority.addSupport(addInput());
  assert.equal(second.replayed, true);
  assert.equal(second.supportWorkOrderId, first.supportWorkOrderId);
  assert.equal(db.read("appointments/APT-SUPPORT-1").assignments.length, 2);
});

test("two and three consecutive support slots own the full interval without changing primary work", async () => {
  for (const requestedSlots of [2, 3]) {
    const { db, authority } = fixture();
    const before = structuredClone(db.read("workOrders/WO-APT-SUPPORT-1-1"));
    const result = await authority.addSupport(addInput({ requestedTime: "08:30", requestedSlots }));
    const order = result.supportWorkOrder;
    assert.equal(order.scheduledSlots, requestedSlots);
    assert.equal(order.appointmentDurationMinutes, requestedSlots * 60);
    assert.equal(order.appointmentEndTime, requestedSlots === 2 ? "10:30" : "11:30");
    assert.equal(order.airConditionerCount, 1);
    assert.equal(order.supportNonBillable, true);
    const appointment = db.read("appointments/APT-SUPPORT-1");
    assert.equal(appointment.assignments[1].slots, requestedSlots);
    assert.equal(appointment.capacityLockIds.length, 2 + requestedSlots);
    for (const slot of ["08:30", "09:30", "10:30"].slice(0, requestedSlots)) {
      assert.equal(db.read(`bookingCapacityLocks/${supportCapacityLock(DATE, "VAN-2", slot).id}`).active, true);
    }
    assert.deepEqual(db.read("workOrders/WO-APT-SUPPORT-1-1"), before);
  }
});

test("support never crosses lunch or the end of day", async () => {
  for (const [requestedTime, requestedSlots] of [["08:30", 4], ["10:30", 2], ["14:30", 3], ["15:30", 2]]) {
    const { db, authority } = fixture();
    const before = structuredClone([...db.store]);
    await assert.rejects(authority.addSupport(addInput({ requestedTime, requestedSlots })),
      error => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT);
    assert.deepEqual([...db.store], before);
  }
});

test("later occupied slots and foreign or same-appointment locks reject the whole support interval", async () => {
  for (const blocked of ["order", "foreign-lock", "own-lock"]) {
    const laterLock = supportCapacityLock(DATE, "VAN-2", "10:30");
    const extra = blocked === "order" ? {
      "workOrders/BUSY": { ...baseSeed()["workOrders/WO-APT-SUPPORT-1-1"], id: "BUSY", appointmentId: "BUSY-APT", vanId: "VAN-2", time: "10:30", scheduledSlots: 1, appointmentDurationMinutes: 60, appointmentEndTime: "11:30" },
    } : { [`bookingCapacityLocks/${laterLock.id}`]: { ...laterLock, active: true, appointmentId: blocked === "own-lock" ? "APT-SUPPORT-1" : "BUSY-APT" } };
    const { db, authority } = fixture(extra);
    const before = structuredClone([...db.store]);
    await assert.rejects(authority.addSupport(addInput({ requestedTime: "08:30", requestedSlots: 3 })),
      error => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT);
    assert.deepEqual([...db.store], before);
    if (blocked === "order") {
      assert.equal((await authority.addSupport(addInput({ requestedTime: "08:30", requestedSlots: 2 }))).success, true);
    }
  }
});

test("support duration validates whole-number bounds", async () => {
  for (const requestedSlots of [0, -1, 1.5, 7, "2", null, NaN]) {
    const { authority } = fixture();
    await assert.rejects(authority.addSupport(addInput({ requestedSlots })),
      error => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST);
  }
});

test("multi-slot support respects the supporting Van half-day boundary", async () => {
  const extra = { "vanHalfDaySchedules/support-rest": { vanId: "VAN-2", weekday: 4, active: true } };
  const { authority } = fixture(extra);
  const result = await authority.addSupport(addInput({ requestedTime: "10:30", requestedSlots: 2 }));
  assert.equal(result.supportWorkOrder.appointmentEndTime, "12:30");
  const unavailable = fixture(extra).authority;
  await assert.rejects(unavailable.addSupport(addInput({ requestedTime: "10:30", requestedSlots: 3 })),
    error => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT);
  await assert.rejects(unavailable.addSupport(addInput({ requestedTime: "13:30", requestedSlots: 2 })),
    error => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT);
});

test("multi-slot retries preserve duration and reject changed request details", async () => {
  const { db, authority } = fixture();
  const input = addInput({ requestedTime: "08:30", requestedSlots: 2 });
  const first = await authority.addSupport(input);
  assert.equal((await authority.addSupport(input)).supportWorkOrderId, first.supportWorkOrderId);
  for (const changes of [{ requestedSlots: 3 }, { requestedTime: "13:30" }, { reason: "Changed" }]) {
    await assert.rejects(authority.addSupport({ ...input, ...changes }), error => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT);
  }
  await assert.rejects(authority.addSupport({ ...input, requestId: "another-support-request", requestedSlots: 3 }), error => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT);
  assert.equal(db.read("appointments/APT-SUPPORT-1").assignments.length, 2);
});

test("historical support requires explicit acknowledgement", async () => {
  const { authority } = fixture({}, "2026-08-28T14:00:00.000Z");
  await assert.rejects(
    authority.addSupport(addInput()),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST && error.details?.reason === "backdating-confirmation-required",
  );
});

test("support cannot target the primary van", async () => {
  const { authority } = fixture();
  await assert.rejects(
    authority.addSupport(addInput({ targetVanId: "VAN-1" })),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST && /different from the primary Van/i.test(error.message),
  );
});

test("support refuses a confirmed appointment whose primary work is already completed", async () => {
  const { authority } = fixture({
    "workOrders/WO-APT-SUPPORT-1-1": {
      ...baseSeed()["workOrders/WO-APT-SUPPORT-1-1"],
      status: "Completada",
    },
  });
  await assert.rejects(
    authority.addSupport(addInput()),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST && /no active primary Work Order/i.test(error.message),
  );
});

test("support rejects a slot already occupied by another active work order", async () => {
  const { authority } = fixture({
    "workOrders/WO-OTHER-1": {
      id: "WO-OTHER-1",
      appointmentId: "APT-OTHER-1",
      clientId: "client-2",
      propertyId: "property-1",
      status: "Confirmada",
      date: DATE,
      time: "13:30",
      vanId: "VAN-2",
      scheduledSlots: 1,
      appointmentDurationMinutes: 60,
      appointmentAssignmentRole: "primary",
    },
  });
  await assert.rejects(
    authority.addSupport(addInput()),
    (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT && /no longer valid operating capacity/i.test(error.message),
  );
});

test("support rejects a concurrent active capacity lock owned by another appointment", async () => {
  const lock = supportCapacityLock(DATE, "VAN-2", "13:30");
  const { authority } = fixture({
    [`bookingCapacityLocks/${lock.id}`]: {
      ...lock,
      appointmentId: "APT-OTHER-LOCK",
      active: true,
    },
  });
  await assert.rejects(
    authority.addSupport(addInput()),
    (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT && /occupied concurrently/i.test(error.message),
  );
});

test("support respects the canonical company closure calendar", async () => {
  const { authority } = fixture({
    "calendarClosures/closed-2026-08-27": { id: "closed-2026-08-27", date: DATE, active: true, reason: "Company closure" },
  });
  await assert.rejects(
    authority.addSupport(addInput()),
    (error) => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED && error.details?.reason === "company-calendar-closed",
  );
});

// Reported case: plan tomorrow's first slot, keeping the following job intact.
test("Wednesday Van 3 supports Van 1 for one slot, using tomorrow's crew without duplicating work", async () => {
  const date = "2026-09-30";
  const seed = JSON.parse(JSON.stringify(baseSeed()).replaceAll(DATE, date).replaceAll("VAN-2", "VAN-3").replaceAll("Van 2", "Van 3"));
  const primary = seed["appointments/APT-SUPPORT-1"];
  primary.startTime = primary.assignments[0].time = "08:30";
  primary.endTime = primary.assignments[0].endTime = "12:30";
  const primaryOrder = seed["workOrders/WO-APT-SUPPORT-1-1"];
  Object.assign(primaryOrder, { time: "08:30", appointmentEndTime: "12:30", scheduledSlots: 4,
    appointmentDurationMinutes: 240, customerFacingDescription: "Two standard installations" });
  const nextJob = { id: "NEXT-VAN-3", date, time: "09:30", vanId: "VAN-3", status: "Confirmada",
    propertyId: "property-1", zone: "Santa Cruz", scheduledSlots: 1, appointmentDurationMinutes: 60 };
  seed["workOrders/NEXT-VAN-3"] = nextJob;
  const db = new FakeFirestore(seed);
  const authority = createAdhocSupportAuthority({ db, clock: () => new Date("2026-09-29T16:35:00Z"), serverTimestamp: () => "SERVER_TIMESTAMP" });
  const input = addInput({ requestedDate: date, requestedTime: "08:30", targetVanId: "VAN-3" });
  const result = await authority.addSupport(input);
  const support = db.read(`workOrders/${result.supportWorkOrderId}`);
  assert.equal(support.date, date);
  assert.equal(support.time, "08:30");
  assert.equal(support.appointmentEndTime, "09:30");
  assert.equal(support.scheduledSlots, 1);
  assert.equal(support.customerFacingDescription, "Two standard installations");
  assert.deepEqual(support.technicianIds, ["support-driver-date", "support-helper-date", "support-third-date"]);
  assert.equal(support.supportNonBillable, true);
  assert.equal(support.customerCommunicationOwner, false);
  assert.equal(support.whatsappNotificationsEnabled, false);
  assert.deepEqual(support.notificationRecipients, []);
  assert.deepEqual(db.read("workOrders/WO-APT-SUPPORT-1-1"), primaryOrder);
  assert.deepEqual(db.read("workOrders/NEXT-VAN-3"), nextJob);
  assert.deepEqual(db.read("appointments/APT-SUPPORT-1").assignments[0], primary.assignments[0]);
  assert.equal([...db.store.keys()].filter(key => key.startsWith("appointments/")).length, 1);
  const replay = await authority.addSupport(input);
  assert.equal(replay.replayed, true);
  assert.equal(db.read("appointments/APT-SUPPORT-1").assignments.length, 2);
  const lock = supportCapacityLock(date, "VAN-3", "08:30");
  assert.equal(db.read(`bookingCapacityLocks/${lock.id}`).appointmentId, primary.id);
});

test("future support must match the primary appointment date", async () => {
  const { authority } = fixture({}, "2026-08-26T14:00:00Z");
  await assert.rejects(authority.addSupport(addInput({ requestedDate: "2026-08-28" })),
    error => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED && /same canonical date/.test(error.message));
});

test("future support still respects closures and occupied capacity", async () => {
  for (const extra of [
    { "calendarClosures/future-closure": { date: DATE, active: true } },
    { "workOrders/future-job": { date: DATE, time: "13:30", vanId: "VAN-2", status: "Confirmada", scheduledSlots: 1, appointmentDurationMinutes: 60 } },
    { [`bookingCapacityLocks/${supportCapacityLock(DATE, "VAN-2", "13:30").id}`]: { active: true, appointmentId: "ANOTHER-APT" } },
    { "staffAbsences/future-absence": { staffId: "support-driver-date", fromDate: DATE, toDate: DATE, active: true } },
  ]) {
    const { db, authority } = fixture(extra, "2026-08-26T14:00:00Z");
    const before = JSON.stringify([...db.store]);
    await assert.rejects(authority.addSupport(addInput()), error => [BOOKING_ERROR_CODES.AVAILABILITY_CHANGED, BOOKING_ERROR_CODES.SLOT_CONFLICT].includes(error.code));
    assert.equal(JSON.stringify([...db.store]), before);
  }
});

test("invalid support dates are rejected before any write", async () => {
  const { db, authority } = fixture();
  for (const requestedDate of ["2026-09-31", "tomorrow", "2026-13-01"]) {
    await assert.rejects(authority.addSupport(addInput({ requestedDate })), error => error.details?.reason === "support-date-invalid");
  }
  assert.equal(db.read("appointments/APT-SUPPORT-1").assignments.length, 1);
});

const historyIntent = { bookingMode: "backdated", backdatingAcknowledged: true };

test("historical support uses the dated crew and audits the correction without reopening or billing the primary", async () => {
  const { confirmationEligible, reminderEligible } = require("./appointmentNotificationService");
  const { sameDayScheduleChangeRequired } = require("./technicianScheduleChangeService");
  for (const status of ["Completada", "Facturada", "Pagada"]) {
    const primaryOrder = { ...baseSeed()["workOrders/WO-APT-SUPPORT-1-1"], status };
    const primaryAppointment = { ...baseSeed()["appointments/APT-SUPPORT-1"], status: "completed" };
    const { db, authority } = fixture({
      "workOrders/WO-APT-SUPPORT-1-1": primaryOrder,
      "appointments/APT-SUPPORT-1": primaryAppointment,
      "invoices/HISTORY-INVOICE": { status: "paid", total: 100 },
      "employeeTimesheets/HISTORY-TIMESHEET": { workedMinutes: 480 },
    }, "2026-08-28T14:00:00Z");
    const input = addInput(historyIntent);
    const result = await authority.addSupport(input);
    const support = db.read(`workOrders/${result.supportWorkOrderId}`);
    assert.equal(support.backdated, true);
    assert.equal(support.bookingMode, "backdated");
    assert.equal(support.backdatingAcknowledged, true);
    assert.equal(support.workAlreadyPerformed, true);
    assert.equal(support.date, DATE);
    assert.equal(support.backdatedRecordedAtIso, "2026-08-28T14:00:00.000Z");
    assert.equal(support.backdatedRecordedBy, "office-1");
    assert.equal(support.backdatedRecordedByName, "Dispatcher");
    assert.deepEqual(support.technicianIds, ["support-driver-date", "support-helper-date", "support-third-date"]);
    assert.equal(support.supportNonBillable, true);
    assert.equal(confirmationEligible(support), false);
    assert.equal(reminderEligible(support), false);
    // Suppression remains explicit even when inspected with the work date as today.
    assert.equal(sameDayScheduleChangeRequired(null, support, { date: DATE, time: "14:00" }), false);
    const appointment = db.read("appointments/APT-SUPPORT-1");
    assert.equal(appointment.status, "completed");
    assert.equal(appointment.backdated, undefined);
    assert.deepEqual(appointment.assignments[0], primaryAppointment.assignments[0]);
    assert.equal(appointment.assignments[1].backdated, true);
    assert.equal(appointment.lifecycleHistory[0].workDate, DATE);
    assert.equal(appointment.lifecycleHistory[0].backdatedRecordedBy, "office-1");
    assert.deepEqual(db.read("workOrders/WO-APT-SUPPORT-1-1"), primaryOrder);
    assert.deepEqual(db.read("invoices/HISTORY-INVOICE"), { status: "paid", total: 100 });
    assert.deepEqual(db.read("employeeTimesheets/HISTORY-TIMESHEET"), { workedMinutes: 480 });
    assert.equal((await authority.addSupport(input)).replayed, true);
    assert.equal(db.read("appointments/APT-SUPPORT-1").assignments.length, 2);
  }
});

test("historical support cannot attach to cancelled/rescheduled/held appointments or cancelled primary work", async () => {
  for (const status of ["cancelled", "rescheduled", "temporary_hold"]) {
    const { db, authority } = fixture({ "appointments/APT-SUPPORT-1": { ...baseSeed()["appointments/APT-SUPPORT-1"], status } }, "2026-08-28T14:00:00Z");
    const before = JSON.stringify([...db.store]);
    await assert.rejects(authority.addSupport(addInput(historyIntent)), error => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST);
    assert.equal(JSON.stringify([...db.store]), before);
  }
  const { db, authority } = fixture({
    "workOrders/WO-APT-SUPPORT-1-1": { ...baseSeed()["workOrders/WO-APT-SUPPORT-1-1"], status: "Cancelada" },
    "workOrders/OLD-SUPPORT": { ...baseSeed()["workOrders/WO-APT-SUPPORT-1-1"], id: "OLD-SUPPORT", appointmentAssignmentRole: "support", vanId: "VAN-4" },
  }, "2026-08-28T14:00:00Z");
  const before = JSON.stringify([...db.store]);
  await assert.rejects(authority.addSupport(addInput(historyIntent)), error => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST && /eligible primary/.test(error.message));
  assert.equal(JSON.stringify([...db.store]), before);
});

test("historical support still rejects completed conflicting work, locks, closures and absent dated crew", async () => {
  for (const extra of [
    { "workOrders/finished-conflict": { date: DATE, time: "13:30", vanId: "VAN-2", status: "Completada", scheduledSlots: 1, appointmentDurationMinutes: 60 } },
    { [`bookingCapacityLocks/${supportCapacityLock(DATE, "VAN-2", "13:30").id}`]: { active: true, appointmentId: "OTHER" } },
    { "calendarClosures/history-closure": { date: DATE, active: true } },
    { "staffAbsences/history-absence": { staffId: "support-driver-date", fromDate: DATE, toDate: DATE, active: true } },
  ]) {
    const { db, authority } = fixture(extra, "2026-08-28T14:00:00Z");
    const before = JSON.stringify([...db.store]);
    await assert.rejects(authority.addSupport(addInput(historyIntent)), error => [BOOKING_ERROR_CODES.SLOT_CONFLICT, BOOKING_ERROR_CODES.AVAILABILITY_CHANGED].includes(error.code));
    assert.equal(JSON.stringify([...db.store]), before);
  }
});

test("historical support requires a reason and a complete acknowledgement", async () => {
  for (const intent of [{ bookingMode: "backdated" }, { backdatingAcknowledged: true }, { ...historyIntent, reason: "" }]) {
    const { db, authority } = fixture({}, "2026-08-28T14:00:00Z");
    const before = JSON.stringify([...db.store]);
    await assert.rejects(authority.addSupport(addInput(intent)), error => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST);
    assert.equal(JSON.stringify([...db.store]), before);
  }
});
