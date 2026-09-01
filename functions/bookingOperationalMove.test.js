const test = require("node:test");
const assert = require("node:assert/strict");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const {
  OPERATIONAL_MOVE_VERSION,
  createOperationalMoveAuthority,
  manualOccupiedSlots,
  workOrderBlocksOperationalCapacity,
} = require("./bookingOperationalMove");

class FakeDocSnapshot {
  constructor(id, value) {
    this.id = id;
    this._value = value;
    this.exists = value !== undefined;
  }
  data() { return this._value; }
}

class FakeQuerySnapshot {
  constructor(docs) { this.docs = docs; }
}

class FakeDocRef {
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
    this.id = id;
  }
  key() { return `${this.collectionName}/${this.id}`; }
  async get() { return new FakeDocSnapshot(this.id, this.db.store.get(this.key())); }
  async set(value, options) {
    const current = this.db.store.get(this.key());
    this.db.store.set(this.key(), options?.merge ? { ...(current || {}), ...value } : value);
  }
}

class FakeQuery {
  constructor(db, collectionName, filters = []) {
    this.db = db;
    this.collectionName = collectionName;
    this.filters = filters;
  }
  where(field, op, value) {
    if (op !== "==") throw new Error(`Unsupported fake query operator: ${op}`);
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, value }]);
  }
  async get() {
    const prefix = `${this.collectionName}/`;
    const docs = [];
    for (const [key, value] of this.db.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (this.filters.every((filter) => value?.[filter.field] === filter.value)) {
        docs.push(new FakeDocSnapshot(id, value));
      }
    }
    return new FakeQuerySnapshot(docs);
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(db, name) { super(db, name); this.name = name; }
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

function baseSeed(extra = {}) {
  return {
    "appointments/APT-1": {
      id: "APT-1",
      appointmentId: "APT-1",
      status: "confirmed",
      date: "2026-08-18",
      startTime: "08:30",
      endTime: "11:30",
      primaryVanId: "VAN-1",
      assignments: [{ vanId: "VAN-1", vanName: "Van 1", time: "08:30", endTime: "11:30", quantity: 3, slots: 3, role: "primary" }],
      workOrderIds: ["WO-1"],
      capacityLockIds: ["OLD-1", "OLD-2", "OLD-3"],
      lifecycleHistory: [],
    },
    "workOrders/WO-1": {
      id: "WO-1",
      appointmentId: "APT-1",
      appointmentAssignmentRole: "primary",
      appointmentEndTime: "11:30",
      status: "Confirmada",
      date: "2026-08-18",
      time: "08:30",
      vanId: "VAN-1",
      scheduledSlots: 3,
      appointmentDurationMinutes: 180,
      airConditionerCount: 3,
    },
    "vans/VAN-1": { id: "VAN-1", name: "Van 1", active: true, responsibleStaffId: "tech-1", regularHelperId: "tech-2" },
    "vans/VAN-2": { id: "VAN-2", name: "Van 2", active: true, responsibleStaffId: "tech-3", regularHelperId: "tech-4" },
    "bookingCapacityLocks/OLD-1": { appointmentId: "APT-1", active: true },
    "bookingCapacityLocks/OLD-2": { appointmentId: "APT-1", active: true },
    "bookingCapacityLocks/OLD-3": { appointmentId: "APT-1", active: true },
    ...extra,
  };
}

function fixture(extra = {}) {
  const db = new FakeFirestore(baseSeed(extra));
  const authority = createOperationalMoveAuthority({
    db,
    clock: () => new Date("2026-08-18T22:40:00.000Z"),
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { db, authority };
}

function moveInput(overrides = {}) {
  return {
    appointmentId: "APT-1",
    requestId: "drag-test-12345",
    requestedDate: "2026-08-18",
    requestedTime: "13:30",
    targetVanId: "VAN-2",
    reason: "Drag-and-drop operational move",
    note: "VAN-1 08:30 → VAN-2 13:30",
    actor: { id: "owner-1", name: "Christian", source: "office-scheduling" },
    ...overrides,
  };
}

test("manual dispatch capacity preserves owned spots across lunch", () => {
  assert.equal(OPERATIONAL_MOVE_VERSION, 4);
  assert.deepEqual(manualOccupiedSlots("2026-08-18", "08:30", 3), ["08:30", "09:30", "10:30"]);
  assert.deepEqual(manualOccupiedSlots("2026-08-18", "13:30", 3), ["13:30", "14:30", "15:30"]);
  assert.deepEqual(manualOccupiedSlots("2026-08-18", "09:30", 3), ["09:30", "10:30", "13:30"]);
  assert.deepEqual(manualOccupiedSlots("2026-08-22", "13:30", 3), ["13:30", "14:30", "15:30"]);
  assert.deepEqual(manualOccupiedSlots("2026-08-23", "13:30", 1), []);
});

test("operational capacity ignores cancelled/rescheduled canonical work orders exactly like LIVE scheduling", () => {
  assert.equal(workOrderBlocksOperationalCapacity({ appointmentId: "A", status: "Confirmada" }), true);
  assert.equal(workOrderBlocksOperationalCapacity({ appointmentId: "A", status: "cancelled" }), false);
  assert.equal(workOrderBlocksOperationalCapacity({ appointmentId: "A", status: "Canceled" }), false);
  assert.equal(workOrderBlocksOperationalCapacity({ appointmentId: "A", status: "Cancelada" }), false);
  assert.equal(workOrderBlocksOperationalCapacity({ appointmentId: "A", status: "Reprogramada" }), false);
  assert.equal(workOrderBlocksOperationalCapacity({ status: "Confirmada" }), false);
});

test("three-slot LIVE drag moves directly to an open Van 2 afternoon block in one transaction", async () => {
  const { db, authority } = fixture();
  const result = await authority.moveAppointment(moveInput());
  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(result.appointmentId, "APT-1");
  const appointment = db.read("appointments/APT-1");
  assert.equal(appointment.primaryVanId, "VAN-2");
  assert.equal(appointment.startTime, "13:30");
  assert.equal(appointment.endTime, "16:30");
  assert.equal(appointment.assignments[0].slots, 3);
  assert.deepEqual(appointment.assignments[0].technicianIds, ["tech-3", "tech-4"]);
  assert.equal(appointment.lifecycleHistory.length, 1);
  assert.equal(appointment.customerNotificationRecommended, true);
  const workOrder = db.read("workOrders/WO-1");
  assert.equal(workOrder.vanId, "VAN-2");
  assert.equal(workOrder.time, "13:30");
  assert.equal(workOrder.appointmentEndTime, "16:30");
  assert.equal(workOrder.scheduledSlots, 3);
  assert.equal(db.read("bookingCapacityLocks/OLD-1").active, false);
  assert.equal(appointment.capacityLockIds.length, 3);
  for (const lockId of appointment.capacityLockIds) {
    assert.equal(db.read(`bookingCapacityLocks/${lockId}`).appointmentId, "APT-1");
    assert.equal(db.read(`bookingCapacityLocks/${lockId}`).active, true);
  }
});

test("half-day and maintenance metadata do not hide an otherwise free manual drag destination", async () => {
  const { db, authority } = fixture({
    "vanHalfDaySchedules/TUE-V2": { id: "TUE-V2", active: true, vanId: "VAN-2", weekday: 2 },
    "dailyVanAssignments/2026-08-18-V2": {
      id: "2026-08-18-V2",
      date: "2026-08-18",
      vanId: "VAN-2",
      status: "Mantenimiento",
      driverStaffId: "tech-3",
      helperStaffId: "tech-4",
    },
  });
  const result = await authority.moveAppointment(moveInput());
  assert.equal(result.success, true);
  assert.equal(db.read("appointments/APT-1").primaryVanId, "VAN-2");
  assert.equal(db.read("appointments/APT-1").startTime, "13:30");
});

test("hidden cancelled work order does not reject a visually open LIVE target", async () => {
  const { db, authority } = fixture({
    "workOrders/WO-CANCELLED": {
      id: "WO-CANCELLED",
      appointmentId: "APT-CANCELLED",
      status: "cancelled",
      date: "2026-08-18",
      time: "13:30",
      vanId: "VAN-2",
      scheduledSlots: 3,
    },
  });
  const result = await authority.moveAppointment(moveInput());
  assert.equal(result.success, true);
  assert.equal(db.read("appointments/APT-1").primaryVanId, "VAN-2");
});

test("detached stale capacity lock is healed instead of becoming a second hidden rule", async () => {
  const staleLockId = `BAL-${require("node:crypto").createHash("sha256").update("2026-08-18|VAN-2|13:30").digest("hex").slice(0, 32).toUpperCase()}`;
  const { db, authority } = fixture({
    [`bookingCapacityLocks/${staleLockId}`]: { appointmentId: "APT-ORPHAN", active: true },
  });
  const result = await authority.moveAppointment(moveInput());
  assert.equal(result.success, true);
  assert.equal(db.read(`bookingCapacityLocks/${staleLockId}`).appointmentId, "APT-1");
});

test("real canonical occupied work still blocks the move transaction", async () => {
  const { authority } = fixture({
    "workOrders/WO-OTHER": {
      id: "WO-OTHER",
      appointmentId: "APT-OTHER",
      status: "Confirmada",
      date: "2026-08-18",
      time: "14:30",
      vanId: "VAN-2",
      scheduledSlots: 1,
    },
  });
  await assert.rejects(
    () => authority.moveAppointment(moveInput()),
    (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT && error.details.reason === "work-order-conflict",
  );
});

test("lunch does not reduce moved capacity ownership, while the real end stays continuous", async () => {
  const lunchMove = fixture();
  const result = await lunchMove.authority.moveAppointment(moveInput({ requestedTime: "09:30" }));
  assert.equal(result.success, true);
  assert.equal(lunchMove.db.read("appointments/APT-1").endTime, "12:30");
  assert.equal(lunchMove.db.read("workOrders/WO-1").appointmentEndTime, "12:30");
  assert.equal(lunchMove.db.read("appointments/APT-1").capacityLockIds.length, 3);

  const tooLate = fixture();
  await assert.rejects(
    () => tooLate.authority.moveAppointment(moveInput({ requestId: "drag-test-67890", requestedTime: "14:30" })),
    (error) => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED && error.details.reason === "target-outside-visible-capacity",
  );
});

test("same request id is idempotent and does not append duplicate lifecycle history", async () => {
  const { db, authority } = fixture();
  const first = await authority.moveAppointment(moveInput());
  const second = await authority.moveAppointment(moveInput());
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.replayed, true);
  assert.equal(db.read("appointments/APT-1").lifecycleHistory.length, 1);
});
