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
    },
    "staffProfiles/primary-driver": { id: "primary-driver", name: "Miguel Reyes", active: true, availability: "Disponible", canDriveVan: true },
    "staffProfiles/primary-helper": { id: "primary-helper", name: "Alan Baquero", active: true, availability: "Disponible", canDriveVan: false },
    "staffProfiles/support-driver-default": { id: "support-driver-default", name: "Default Driver", active: true, availability: "Disponible", canDriveVan: true },
    "staffProfiles/support-helper-default": { id: "support-helper-default", name: "Default Helper", active: true, availability: "Disponible", canDriveVan: false },
    "staffProfiles/support-driver-date": { id: "support-driver-date", name: "Walter Gomez", active: true, availability: "Disponible", canDriveVan: true },
    "staffProfiles/support-helper-date": { id: "support-helper-date", name: "Goyo Perez", active: true, availability: "Disponible", canDriveVan: false },
    "dailyVanAssignments/VAN-2-2026-08-27": {
      id: "VAN-2-2026-08-27",
      date: DATE,
      vanId: "VAN-2",
      driverStaffId: "support-driver-date",
      helperStaffId: "support-helper-date",
      status: "Disponible",
    },
    "businessSettings/business-calendar": { id: "business-calendar", closedWeekdays: [0] },
    ...extra,
  };
}

function fixture(extra = {}) {
  const db = new FakeFirestore(baseSeed(extra));
  const authority = createAdhocSupportAuthority({
    db,
    clock: () => new Date("2026-08-27T14:00:00.000Z"),
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
  assert.deepEqual(appointment.assignments[1].technicianIds, ["support-driver-date", "support-helper-date"]);
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
  assert.deepEqual(supportOrder.technicianIds, ["support-driver-date", "support-helper-date"]);
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

test("support cannot target the primary van", async () => {
  const { authority } = fixture();
  await assert.rejects(
    authority.addSupport(addInput({ targetVanId: "VAN-1" })),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST && /different from the primary Van/i.test(error.message),
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
