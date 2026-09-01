const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalAppointmentIdentity } = require("./bookingAuthorityCore");
const { createPartialCompletionAuthority } = require("./bookingPartialCompletion");

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
  write(path, value) { this.store.set(path, value); }
}

function seedAppointment() {
  return {
    id: "APT-PARTIAL-1",
    appointmentId: "APT-PARTIAL-1",
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
    workOrderIds: ["WO-APT-PARTIAL-1-1"],
    capacityLockIds: ["L0830", "L0930", "L1030", "L1330", "L1430", "L1530"],
    lifecycleHistory: [],
  };
}

function fixture() {
  const db = new FakeFirestore({
    "appointments/APT-PARTIAL-1": seedAppointment(),
    "workOrders/WO-APT-PARTIAL-1-1": {
      id: "WO-APT-PARTIAL-1-1",
      appointmentId: "APT-PARTIAL-1",
      status: "Confirmada",
      clientId: "client-1",
      propertyId: "property-1",
      date: "2026-08-31",
      time: "08:30",
      vanId: "VAN-2",
      airConditionerCount: 3,
      quantity: 3,
      appointmentDurationMinutes: 360,
      appointmentEndTime: "14:30",
      appointmentCapacityEndTime: "16:30",
      scheduledSlots: 6,
      appointmentWorkItems: [{ id: "work-1", presetId: "installation_standard", quantity: 3, durationMinutes: 360 }],
    },
    "bookingCapacityLocks/L0830": { appointmentId: "APT-PARTIAL-1", active: true, slot: "08:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L0930": { appointmentId: "APT-PARTIAL-1", active: true, slot: "09:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L1030": { appointmentId: "APT-PARTIAL-1", active: true, slot: "10:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L1330": { appointmentId: "APT-PARTIAL-1", active: true, slot: "13:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L1430": { appointmentId: "APT-PARTIAL-1", active: true, slot: "14:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingCapacityLocks/L1530": { appointmentId: "APT-PARTIAL-1", active: true, slot: "15:30", vanId: "VAN-2", date: "2026-08-31" },
    "bookingOffers/OFR-REMAINING": {
      id: "OFR-REMAINING",
      version: 1,
      request: {
        customerId: "client-1",
        propertyId: "property-1",
        workLines: [{ id: "remaining", presetId: "installation_standard", serviceId: "svc-install", quantity: 2 }],
        constraints: { requestedDate: "2026-09-02" },
      },
    },
  });

  const bookingAuthority = {
    async getAppointment(id) {
      const value = db.read(`appointments/${id}`);
      if (!value) throw new Error(`Missing appointment ${id}`);
      return { id, ...value };
    },
    async createAppointment({ idempotencyKey, context }) {
      const identity = canonicalAppointmentIdentity(idempotencyKey);
      const existing = db.read(`appointments/${identity.appointmentId}`);
      if (existing) {
        return { success: true, replayed: true, appointmentId: identity.appointmentId, appointment: existing, workOrderIds: existing.workOrderIds || [] };
      }
      const followUp = {
        id: identity.appointmentId,
        appointmentId: identity.appointmentId,
        customerId: "client-1",
        propertyId: "property-1",
        status: "confirmed",
        date: "2026-09-02",
        startTime: "08:30",
        assignments: [{ vanId: "VAN-2", role: "primary", time: "08:30", quantity: 2, slots: 4 }],
        workOrderIds: [`WO-${identity.appointmentId}-1`],
        sourcePartialAppointmentId: context.sourcePartialAppointmentId,
      };
      db.write(`appointments/${identity.appointmentId}`, followUp);
      db.write(`workOrders/WO-${identity.appointmentId}-1`, { appointmentId: identity.appointmentId, status: "Confirmada" });
      return { success: true, replayed: false, appointmentId: identity.appointmentId, appointment: followUp, workOrderIds: followUp.workOrderIds };
    },
  };

  const authority = createPartialCompletionAuthority({
    db,
    bookingAuthority,
    clock: () => new Date("2026-08-31T21:30:00.000Z"),
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { db, authority };
}

test("partial completion converts the original appointment to actual work and releases unused afternoon capacity", async () => {
  const { db, authority } = fixture();
  const result = await authority.recordPartialCompletion({
    appointmentId: "APT-PARTIAL-1",
    requestId: "partial-request-1",
    completedQuantity: 1,
    actualEndTime: "12:00",
    reason: "DEMAC operational reassignment",
    note: "Crew reassigned to another customer in the afternoon.",
    actor: { id: "owner-1", name: "Owner", source: "office-scheduling" },
  });

  assert.equal(result.success, true);
  assert.equal(result.outcome.plannedQuantity, 3);
  assert.equal(result.outcome.completedQuantity, 1);
  assert.equal(result.outcome.remainingQuantity, 2);
  assert.equal(result.outcome.remainingWorkStatus, "pending_schedule");
  assert.deepEqual(result.retainedCapacitySlots, ["08:30", "09:30", "10:30"]);
  assert.deepEqual(result.releasedCapacitySlots, ["13:30", "14:30", "15:30"]);

  const appointment = db.read("appointments/APT-PARTIAL-1");
  assert.equal(appointment.workLines[0].quantity, 1);
  assert.equal(appointment.endTime, "12:00");
  assert.equal(appointment.capacityEndTime, "12:00");
  assert.equal(appointment.assignments[0].quantity, 1);
  assert.equal(appointment.executionOutcome.remainingQuantity, 2);
  assert.deepEqual(appointment.capacityLockIds, ["L0830", "L0930", "L1030"]);

  const workOrder = db.read("workOrders/WO-APT-PARTIAL-1-1");
  assert.equal(workOrder.airConditionerCount, 1);
  assert.equal(workOrder.appointmentEndTime, "12:00");
  assert.equal(workOrder.appointmentCapacityEndTime, "12:00");
  assert.deepEqual(workOrder.scheduledSlots, ["08:30", "09:30", "10:30"]);
  assert.equal(workOrder.operationalOutcomeStatus, "partial");

  assert.equal(db.read("bookingCapacityLocks/L0830").active, true);
  assert.equal(db.read("bookingCapacityLocks/L1330").active, false);
  assert.equal(db.read("bookingCapacityLocks/L1530").active, false);
});

test("partial completion is idempotent for the same request and immutable for a different request", async () => {
  const { authority } = fixture();
  const input = {
    appointmentId: "APT-PARTIAL-1",
    requestId: "partial-request-1",
    completedQuantity: 1,
    actualEndTime: "12:00",
    reason: "DEMAC operational reassignment",
    actor: { id: "owner-1", name: "Owner" },
  };
  const first = await authority.recordPartialCompletion(input);
  const replay = await authority.recordPartialCompletion(input);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  await assert.rejects(() => authority.recordPartialCompletion({ ...input, requestId: "partial-request-2" }), /already recorded/i);
});

test("remaining work creates one deterministic follow-up appointment and links both records", async () => {
  const { db, authority } = fixture();
  await authority.recordPartialCompletion({
    appointmentId: "APT-PARTIAL-1",
    requestId: "partial-request-1",
    completedQuantity: 1,
    actualEndTime: "12:00",
    reason: "DEMAC operational reassignment",
    actor: { id: "owner-1", name: "Owner" },
  });

  const scheduled = await authority.scheduleRemainingWork({
    appointmentId: "APT-PARTIAL-1",
    requestId: "followup-request-1",
    offerId: "OFR-REMAINING",
    offerVersion: 1,
    optionId: "OPT-1",
    actor: { id: "owner-1", name: "Owner" },
  });
  assert.equal(scheduled.success, true);
  assert.ok(scheduled.followUpAppointmentId);

  const original = db.read("appointments/APT-PARTIAL-1");
  assert.equal(original.executionOutcome.remainingWorkStatus, "scheduled");
  assert.equal(original.executionOutcome.followUpAppointmentId, scheduled.followUpAppointmentId);
  assert.equal(db.read(`appointments/${scheduled.followUpAppointmentId}`).sourcePartialAppointmentId, "APT-PARTIAL-1");
  assert.equal(db.read(`workOrders/WO-${scheduled.followUpAppointmentId}-1`).sourcePartialAppointmentId, "APT-PARTIAL-1");

  const replay = await authority.scheduleRemainingWork({
    appointmentId: "APT-PARTIAL-1",
    requestId: "followup-request-2",
    offerId: "OFR-REMAINING",
    offerVersion: 1,
    optionId: "OPT-1",
    actor: { id: "owner-1", name: "Owner" },
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.followUpAppointmentId, scheduled.followUpAppointmentId);
});
