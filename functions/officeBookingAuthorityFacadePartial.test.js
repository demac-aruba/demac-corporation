const test = require("node:test");
const assert = require("node:assert/strict");
const { createOfficeBookingAuthorityFacade } = require("./officeBookingAuthorityFacade");

class FakeSnapshot {
  constructor(id, value) {
    this.id = id;
    this._value = value;
    this.exists = value !== undefined;
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
  async get() { return new FakeSnapshot(this.id, this.db.store.get(this.key())); }
  async set(value, options) {
    const current = this.db.store.get(this.key());
    this.db.store.set(this.key(), options?.merge ? { ...(current || {}), ...value } : value);
  }
}

class FakeCollectionRef {
  constructor(db, name) { this.db = db; this.name = name; }
  doc(id) { return new FakeDocRef(this.db, this.name, id); }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(ref) { return ref.get(); }
  set(ref, value, options) { this.writes.push({ ref, value, options }); }
  async commit() { for (const write of this.writes) await write.ref.set(write.value, write.options); }
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

function seed() {
  return {
    "users/owner-1": { role: "owner", active: true, name: "Owner" },
    "appointments/APT-PARTIAL-FACADE": {
      id: "APT-PARTIAL-FACADE",
      appointmentId: "APT-PARTIAL-FACADE",
      customerId: "client-1",
      propertyId: "property-1",
      status: "confirmed",
      date: "2026-08-31",
      startTime: "08:30",
      endTime: "14:30",
      capacityEndTime: "16:30",
      workLines: [{ id: "work-1", presetId: "installation_standard", serviceId: "svc-install", quantity: 3 }],
      workItems: [{ id: "work-1", presetId: "installation_standard", serviceId: "svc-install", label: "Standard Installation", quantity: 3, durationMinutes: 360, durationMinutesPerUnit: 120 }],
      assignments: [{ vanId: "VAN-2", role: "primary", time: "08:30", endTime: "14:30", capacityEndTime: "16:30", quantity: 3, slots: 6 }],
      primaryVanId: "VAN-2",
      workOrderIds: ["WO-APT-PARTIAL-FACADE-1"],
      capacityLockIds: ["L0830", "L0930", "L1030", "L1330", "L1430", "L1530"],
      lifecycleHistory: [],
    },
    "workOrders/WO-APT-PARTIAL-FACADE-1": {
      appointmentId: "APT-PARTIAL-FACADE",
      status: "Confirmada",
      airConditionerCount: 3,
      quantity: 3,
      appointmentDurationMinutes: 360,
      appointmentEndTime: "14:30",
      appointmentCapacityEndTime: "16:30",
      scheduledSlots: 6,
      appointmentWorkItems: [{ id: "work-1", presetId: "installation_standard", quantity: 3, durationMinutes: 360 }],
    },
    "bookingCapacityLocks/L0830": { appointmentId: "APT-PARTIAL-FACADE", active: true, slot: "08:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L0930": { appointmentId: "APT-PARTIAL-FACADE", active: true, slot: "09:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L1030": { appointmentId: "APT-PARTIAL-FACADE", active: true, slot: "10:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L1330": { appointmentId: "APT-PARTIAL-FACADE", active: true, slot: "13:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L1430": { appointmentId: "APT-PARTIAL-FACADE", active: true, slot: "14:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L1530": { appointmentId: "APT-PARTIAL-FACADE", active: true, slot: "15:30", vanId: "VAN-2", date: "2026-08-31" },
  };
}

test("production facade routes record_partial_completion through the partial lifecycle wrapper", async () => {
  const db = new FakeFirestore(seed());
  const facade = createOfficeBookingAuthorityFacade({
    db,
    verifyIdToken: async () => ({ uid: "owner-1", name: "Owner" }),
  });

  const result = await facade.handle({
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: {
      action: "record_partial_completion",
      data: {
        appointmentId: "APT-PARTIAL-FACADE",
        requestId: "facade-partial-request-1",
        completedQuantity: 1,
        actualEndTime: "12:00",
        reason: "DEMAC operational reassignment",
        note: "Crew reassigned after lunch.",
      },
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.outcome.plannedQuantity, 3);
  assert.equal(result.body.outcome.completedQuantity, 1);
  assert.equal(result.body.outcome.remainingQuantity, 2);
  assert.deepEqual(result.body.releasedCapacitySlots, ["13:30", "14:30", "15:30"]);
  assert.equal(db.read("appointments/APT-PARTIAL-FACADE").executionOutcome.status, "partial");
});
