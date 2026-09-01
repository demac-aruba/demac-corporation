const test = require("node:test");
const assert = require("node:assert/strict");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const {
  OPERATIONAL_MOVE_VERSION,
  createOperationalMoveAuthority,
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
      customerId: "c1",
      propertyId: "p1",
      address: "Wayaca 217",
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
    "staffProfiles/tech-1": { id: "tech-1", active: true, availability: "Disponible", canDriveVan: true },
    "staffProfiles/tech-2": { id: "tech-2", active: true, availability: "Disponible" },
    "staffProfiles/tech-3": { id: "tech-3", active: true, availability: "Disponible", canDriveVan: true },
    "staffProfiles/tech-4": { id: "tech-4", active: true, availability: "Disponible" },
    "clients/c1": { id: "c1", name: "Test Customer" },
    "properties/p1": { id: "p1", clientId: "c1", address: "Wayaca 217", operationalZone: "Oranjestad" },
    "bookingCapacityLocks/OLD-1": { appointmentId: "APT-1", active: true },
    "bookingCapacityLocks/OLD-2": { appointmentId: "APT-1", active: true },
    "bookingCapacityLocks/OLD-3": { appointmentId: "APT-1", active: true },
    ...extra,
  };
}

function fixture(extra = {}, clock = () => new Date("2026-08-18T12:00:00.000Z")) {
  const db = new FakeFirestore(baseSeed(extra));
  const authority = createOperationalMoveAuthority({
    db,
    clock,
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

test("operational capacity ignores cancelled/rescheduled canonical work orders exactly like LIVE scheduling", () => {
  assert.equal(OPERATIONAL_MOVE_VERSION, 5);
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

test("half-day and maintenance metadata fail closed for a manual drag destination", async () => {
  const { authority } = fixture({
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
  await assert.rejects(
    () => authority.moveAppointment(moveInput()),
    (error) => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED
      && error.details.reason === "van-unavailable",
  );
});

test("operational move canonicalizes time and cannot bypass the Aruba clock with 8:30", async () => {
  const { db, authority } = fixture({}, () => new Date("2026-08-18T13:00:00.000Z"));
  const before = structuredClone(db.read("appointments/APT-1"));
  await assert.rejects(
    authority.moveAppointment(moveInput({ requestedTime: "8:30", requestId: "drag-past-noncanonical" })),
    (error) => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
  );
  assert.deepEqual(db.read("appointments/APT-1"), before);
});

test("operational move rejects terminal work and leaves the canonical graph unchanged", async () => {
  const { db, authority } = fixture({
    "workOrders/WO-1": { ...baseSeed()["workOrders/WO-1"], status: "Facturada" },
  });
  const before = Object.fromEntries([...db.store.entries()].map(([key, value]) => [key, structuredClone(value)]));
  await assert.rejects(
    authority.moveAppointment(moveInput({ requestId: "drag-terminal-work-order" })),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST && error.details?.reason === "terminal-work-order",
  );
  assert.deepEqual(Object.fromEntries(db.store), before);
});

test("operational move never releases an old lock now owned by another appointment", async () => {
  const { db, authority } = fixture({
    "appointments/APT-OTHER-OLD-LOCK": {
      appointmentId: "APT-OTHER-OLD-LOCK",
      status: "confirmed",
      capacityLockIds: ["OLD-1"],
    },
    "bookingCapacityLocks/OLD-1": { appointmentId: "APT-OTHER-OLD-LOCK", active: true },
  });
  await authority.moveAppointment(moveInput({ requestId: "drag-stale-old-lock-owner" }));
  assert.deepEqual(db.read("bookingCapacityLocks/OLD-1"), {
    appointmentId: "APT-OTHER-OLD-LOCK",
    active: true,
  });
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

test("active unlinked work order blocks the move transaction fail-closed", async () => {
  const { authority } = fixture({
    "workOrders/WO-UNLINKED": {
      id: "WO-UNLINKED",
      status: "Pendiente",
      date: "2026-08-18",
      time: "13:30",
      vanId: "VAN-2",
      scheduledSlots: 3,
    },
  });
  await assert.rejects(
    () => authority.moveAppointment(moveInput()),
    (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT
      && error.details.reason === "work-order-conflict",
  );
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

test("an active foreign lock owned by its canonical appointment cannot be stolen", async () => {
  const occupiedLockId = `BAL-${require("node:crypto").createHash("sha256").update("2026-08-18|VAN-2|13:30").digest("hex").slice(0, 32).toUpperCase()}`;
  const { db, authority } = fixture({
    [`bookingCapacityLocks/${occupiedLockId}`]: { appointmentId: "APT-OWNER", active: true },
    "appointments/APT-OWNER": {
      id: "APT-OWNER",
      appointmentId: "APT-OWNER",
      status: "confirmed",
      capacityLockIds: [occupiedLockId],
    },
  });

  await assert.rejects(
    () => authority.moveAppointment(moveInput()),
    (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT
      && error.details.appointmentId === "APT-OWNER"
      && error.details.vanId === "VAN-2"
      && error.details.slot === "13:30",
  );
  assert.equal(db.read(`bookingCapacityLocks/${occupiedLockId}`).appointmentId, "APT-OWNER");
  assert.equal(db.read("appointments/APT-1").primaryVanId, "VAN-1");
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

test("a move uses continuous elapsed time without inventing post-lunch locks", async () => {
  const lunchMove = fixture();
  const result = await lunchMove.authority.moveAppointment(moveInput({ requestedTime: "09:30" }));
  assert.equal(result.success, true);
  assert.equal(lunchMove.db.read("appointments/APT-1").endTime, "12:30");
  assert.equal(lunchMove.db.read("workOrders/WO-1").appointmentEndTime, "12:30");
  assert.equal(lunchMove.db.read("appointments/APT-1").capacityLockIds.length, 2);

  const tooLate = fixture();
  await assert.rejects(
    () => tooLate.authority.moveAppointment(moveInput({ requestId: "drag-test-67890", requestedTime: "14:30" })),
    (error) => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED && error.details.reason === "outside-operational-window",
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

test("the same request id with a different destination is an idempotency conflict", async () => {
  const { db, authority } = fixture();
  await authority.moveAppointment(moveInput());

  await assert.rejects(
    () => authority.moveAppointment(moveInput({ requestedTime: "14:30" })),
    (error) => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
  );
  assert.equal(db.read("appointments/APT-1").primaryVanId, "VAN-2");
  assert.equal(db.read("appointments/APT-1").startTime, "13:30");
  assert.equal(db.read("appointments/APT-1").lifecycleHistory.length, 1);
});

test("retrying an older move after a newer move never reverses the newer placement", async () => {
  const { db, authority } = fixture();
  const first = moveInput();
  await authority.moveAppointment(first);
  await authority.moveAppointment(moveInput({
    requestId: "drag-test-second-67890",
    targetVanId: "VAN-1",
  }));

  const replay = await authority.moveAppointment(first);
  assert.equal(replay.replayed, true);
  assert.equal(db.read("appointments/APT-1").primaryVanId, "VAN-1");
  assert.equal(db.read("appointments/APT-1").startTime, "13:30");
  assert.equal(db.read("appointments/APT-1").lifecycleHistory.length, 2);
});

test("a no-op move still binds its request identity to that exact target", async () => {
  const { db, authority } = fixture();
  const noOp = moveInput({
    requestId: "drag-no-op-12345",
    requestedTime: "08:30",
    targetVanId: "VAN-1",
  });
  const result = await authority.moveAppointment(noOp);
  assert.equal(result.replayed, true);

  await assert.rejects(
    () => authority.moveAppointment({ ...noOp, requestedTime: "13:30", targetVanId: "VAN-2" }),
    (error) => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
  );
  assert.equal(db.read("appointments/APT-1").primaryVanId, "VAN-1");
  assert.equal(db.read("appointments/APT-1").startTime, "08:30");
});
