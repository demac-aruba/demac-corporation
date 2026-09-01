const test = require("node:test");
const assert = require("node:assert/strict");
const { BOOKING_ERROR_CODES, canonicalAppointmentIdentity } = require("./bookingAuthorityCore");
const { createBookingAuthority } = require("./bookingAuthorityFirestore");
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
    this.db.write(this.key(), value, options);
  }
}

class FakeCollectionRef {
  constructor(db, name) { this.db = db; this.name = name; }
  doc(id) { return new FakeDocRef(this.db, this.name, id); }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.writes = []; this.readVersions = new Map(); }
  async get(ref) {
    const key = ref.key();
    if (!this.readVersions.has(key)) this.readVersions.set(key, this.db.version(key));
    return new FakeSnapshot(ref.id, this.db.store.get(key));
  }
  set(ref, value, options) { this.writes.push({ ref, value, options }); }
  commit() { return this.db.commit(this); }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.store = new Map(Object.entries(seed));
    this.versions = new Map([...this.store.keys()].map((key) => [key, 1]));
    this.commitTail = Promise.resolve();
    this.transactionAttempts = 0;
    this.transactionConflicts = 0;
    this.nextCommitError = null;
    this.nextCommitInspector = null;
  }
  collection(name) { return new FakeCollectionRef(this, name); }
  version(path) { return this.versions.get(path) || 0; }
  write(path, value, options) {
    const current = this.store.get(path);
    this.store.set(path, options?.merge ? { ...(current || {}), ...value } : value);
    this.versions.set(path, this.version(path) + 1);
  }
  failNextTransactionCommit(error = new Error("forced-transaction-failure"), inspector = null) {
    this.nextCommitError = error;
    this.nextCommitInspector = inspector;
  }
  async commit(transaction) {
    const previous = this.commitTail;
    let release;
    this.commitTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      for (const [path, version] of transaction.readVersions) {
        if (this.version(path) !== version) {
          const conflict = new Error("transaction-conflict");
          conflict.retryableTransactionConflict = true;
          throw conflict;
        }
      }
      if (this.nextCommitError) {
        const error = this.nextCommitError;
        const inspector = this.nextCommitInspector;
        this.nextCommitError = null;
        this.nextCommitInspector = null;
        if (typeof inspector === "function") inspector(transaction);
        throw error;
      }

      const nextStore = new Map(this.store);
      const nextVersions = new Map(this.versions);
      for (const { ref, value, options } of transaction.writes) {
        const path = ref.key();
        const current = nextStore.get(path);
        nextStore.set(path, options?.merge ? { ...(current || {}), ...value } : value);
        nextVersions.set(path, (nextVersions.get(path) || 0) + 1);
      }
      this.store = nextStore;
      this.versions = nextVersions;
    } finally {
      release();
    }
  }
  async runTransaction(callback) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      this.transactionAttempts += 1;
      const transaction = new FakeTransaction(this);
      try {
        const result = await callback(transaction);
        await transaction.commit();
        return result;
      } catch (error) {
        if (!error?.retryableTransactionConflict || attempt === 5) throw error;
        this.transactionConflicts += 1;
      }
    }
    throw new Error("transaction retry limit exceeded");
  }
  read(path) { return this.store.get(path); }
  paths(prefix) { return [...this.store.keys()].filter((path) => path.startsWith(prefix)).sort(); }
}

function overlapGate(parties = 2) {
  let arrivals = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals >= parties) release();
    await ready;
  };
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

const REMAINING_WORK_OWNED_SLOTS = ["08:30", "09:30", "10:30", "13:30"];
const REMAINING_WORK_LOCKS = REMAINING_WORK_OWNED_SLOTS.map((slot) => ({
  id: `RW-V2-${slot.replace(":", "")}`,
  date: "2026-09-02",
  vanId: "VAN-2",
  slot,
}));

function remainingWorkOption() {
  return {
    id: "OPT-1",
    date: "2026-09-02",
    time: "08:30",
    endTime: "12:30",
    capacityEndTime: "14:30",
    address: "Wayaca 217",
    zone: "Oranjestad / Airport",
    presetId: "installation_standard",
    presetLabel: "Standard Installation",
    serviceId: "svc-install",
    durationMinutesPerUnit: 120,
    durationMode: "per_unit",
    quantity: 2,
    workItems: [{
      id: "remaining",
      presetId: "installation_standard",
      serviceId: "svc-install",
      label: "Standard Installation",
      quantity: 2,
      durationMinutes: 240,
      durationMinutesPerUnit: 120,
      durationMode: "per_unit",
    }],
    assignments: [{
      vanId: "VAN-2",
      vanName: "Van 2",
      technicianIds: ["tech-1", "tech-2"],
      driverStaffId: "tech-1",
      helperStaffId: "tech-2",
      role: "primary",
      time: "08:30",
      endTime: "12:30",
      capacityEndTime: "14:30",
      quantity: 2,
      slots: 4,
      durationMinutes: 240,
      ownedSlots: [...REMAINING_WORK_OWNED_SLOTS],
    }],
  };
}

function canonicalRemainingWorkFixture({ transactionGate = null } = {}) {
  const { db } = fixture();
  const option = remainingWorkOption();
  db.write("clients/client-1", { id: "client-1", name: "Richard" });
  db.write("properties/property-1", { id: "property-1", clientId: "client-1", address: "Wayaca 217" });
  db.write("bookingOffers/OFR-REMAINING", {
    id: "OFR-REMAINING",
    version: 1,
    status: "open",
    expiresAt: "2026-09-03T23:59:59.000Z",
    request: {
      customerId: "client-1",
      propertyId: "property-1",
      workLines: [{ id: "remaining", presetId: "installation_standard", serviceId: "svc-install", quantity: 2 }],
      constraints: { requestedDate: "2026-09-02" },
    },
    options: [option],
  });

  const availabilityProvider = {
    async revalidateSelection({ option: selected }) {
      return { available: true, option: selected };
    },
    async validateTransaction({ option: selected }) {
      if (transactionGate) await transactionGate();
      return {
        available: true,
        option: selected,
        capacityLocks: REMAINING_WORK_LOCKS.map((lock) => ({ ...lock })),
      };
    },
    async buildWorkOrders({ appointment, option: selected, customer, property }) {
      const assignment = selected.assignments[0];
      return [{
        id: `WO-${appointment.appointmentId}-1`,
        appointmentId: appointment.appointmentId,
        clientId: customer.id,
        propertyId: property.id,
        status: "Confirmada",
        date: selected.date,
        time: selected.time,
        vanId: assignment.vanId,
        technicianIds: assignment.technicianIds,
        scheduledSlots: [...assignment.ownedSlots],
        appointmentDurationMinutes: assignment.durationMinutes,
        appointmentEndTime: selected.endTime,
        appointmentCapacityEndTime: selected.capacityEndTime,
      }];
    },
  };
  const clock = () => new Date("2026-08-31T21:30:00.000Z");
  const bookingAuthority = createBookingAuthority({
    db,
    availabilityProvider,
    clock,
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  const authority = createPartialCompletionAuthority({
    db,
    bookingAuthority,
    clock,
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { db, authority, bookingAuthority };
}

async function recordFixturePartialCompletion(authority) {
  return authority.recordPartialCompletion({
    appointmentId: "APT-PARTIAL-1",
    requestId: "partial-request-1",
    completedQuantity: 1,
    actualEndTime: "12:00",
    reason: "DEMAC operational reassignment",
    actor: { id: "owner-1", name: "Owner" },
  });
}

function remainingWorkScheduleInput(requestId = "followup-request-1") {
  return {
    appointmentId: "APT-PARTIAL-1",
    requestId,
    offerId: "OFR-REMAINING",
    offerVersion: 1,
    optionId: "OPT-1",
    actor: { id: "owner-1", name: "Owner" },
  };
}

function snapshotStore(db) {
  return [...db.store.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => [path, JSON.parse(JSON.stringify(value))]);
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

test("partial completion rejects terminal Work Orders without mutating appointment, order, or locks", async (t) => {
  for (const status of ["Completada", "Facturada", "Pagada"]) {
    await t.test(status, async () => {
      const { db, authority } = fixture();
      const workOrderPath = "workOrders/WO-APT-PARTIAL-1-1";
      db.write(workOrderPath, { ...db.read(workOrderPath), status });
      const before = snapshotStore(db);

      await assert.rejects(
        () => recordFixturePartialCompletion(authority),
        (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST
          && error.details?.reason === "partial-completion-terminal-work-order",
      );

      assert.deepEqual(snapshotStore(db), before);
    });
  }
});

test("partial completion is idempotent for the same request and immutable for a different request", async () => {
  const { db, authority } = fixture();
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
  assert.equal(db.read("appointments/APT-PARTIAL-1").executionOutcome.recordRequestFingerprint.length, 40);

  const beforeConflict = snapshotStore(db);
  await assert.rejects(
    () => authority.recordPartialCompletion({ ...input, completedQuantity: 2 }),
    (error) => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT
      && error.details?.reason === "partial-completion-payload-conflict",
  );
  assert.deepEqual(snapshotStore(db), beforeConflict);

  await assert.rejects(() => authority.recordPartialCompletion({ ...input, requestId: "partial-request-2" }), /already recorded/i);
});

test("remaining work creates one deterministic follow-up appointment and links both records", async () => {
  const { db, authority } = canonicalRemainingWorkFixture();
  await recordFixturePartialCompletion(authority);

  const scheduled = await authority.scheduleRemainingWork(remainingWorkScheduleInput());
  assert.equal(scheduled.success, true);
  assert.ok(scheduled.followUpAppointmentId);

  const original = db.read("appointments/APT-PARTIAL-1");
  assert.equal(original.executionOutcome.remainingWorkStatus, "scheduled");
  assert.equal(original.executionOutcome.followUpAppointmentId, scheduled.followUpAppointmentId);
  assert.equal(db.read(`appointments/${scheduled.followUpAppointmentId}`).sourcePartialAppointmentId, "APT-PARTIAL-1");
  assert.equal(db.read(`workOrders/WO-${scheduled.followUpAppointmentId}-1`).sourcePartialAppointmentId, "APT-PARTIAL-1");

  const replay = await authority.scheduleRemainingWork(remainingWorkScheduleInput("followup-request-2"));
  assert.equal(replay.replayed, true);
  assert.equal(replay.followUpAppointmentId, scheduled.followUpAppointmentId);
});

test("remaining work repairs a historical follow-up created before the atomic-link protocol", async () => {
  const { db, authority, bookingAuthority } = canonicalRemainingWorkFixture();
  await recordFixturePartialCompletion(authority);
  const idempotencyKey = "office:partial-followup:APT-PARTIAL-1:v1";
  const legacyCreated = await bookingAuthority.createAppointment({
    offerId: "OFR-REMAINING",
    offerVersion: 1,
    optionId: "OPT-1",
    idempotencyKey,
    actor: { id: "legacy-owner", name: "Legacy Owner" },
    context: { channel: "office", officeRequestId: "legacy-followup-request" },
  });
  assert.equal(db.read("appointments/APT-PARTIAL-1").executionOutcome.remainingWorkStatus, "pending_schedule");

  const repaired = await authority.scheduleRemainingWork(remainingWorkScheduleInput("repair-followup-request"));
  assert.equal(repaired.replayed, true);
  assert.equal(repaired.followUpAppointmentId, legacyCreated.appointmentId);
  assert.equal(db.read("appointments/APT-PARTIAL-1").executionOutcome.followUpAppointmentId, legacyCreated.appointmentId);
  assert.equal(db.read(`appointments/${legacyCreated.appointmentId}`).sourcePartialAppointmentId, "APT-PARTIAL-1");
  assert.equal(db.read(`workOrders/WO-${legacyCreated.appointmentId}-1`).sourcePartialAppointmentId, "APT-PARTIAL-1");
});

test("remaining work refuses to link a deterministic appointment owned by another payload", async (t) => {
  const mutations = [
    ["another original", (appointment) => ({ ...appointment, sourcePartialAppointmentId: "APT-FOREIGN" })],
    ["another customer", (appointment) => ({ ...appointment, customerId: "client-foreign" })],
    ["another property", (appointment) => ({ ...appointment, propertyId: "property-foreign" })],
    ["another remaining workload", (appointment) => ({
      ...appointment,
      workLines: [{ ...appointment.workLines[0], quantity: 99 }],
    })],
    ["another offer", (appointment) => ({ ...appointment, offerId: "OFR-FOREIGN" })],
    ["another offer version", (appointment) => ({ ...appointment, offerVersion: 2 })],
    ["another option", (appointment) => ({ ...appointment, selectedOptionId: "OPT-FOREIGN" })],
  ];

  for (const [label, mutate] of mutations) {
    await t.test(label, async () => {
      const { db, authority, bookingAuthority } = canonicalRemainingWorkFixture();
      await recordFixturePartialCompletion(authority);
      const legacyCreated = await bookingAuthority.createAppointment({
        offerId: "OFR-REMAINING",
        offerVersion: 1,
        optionId: "OPT-1",
        idempotencyKey: "office:partial-followup:APT-PARTIAL-1:v1",
        actor: { id: "legacy-owner", name: "Legacy Owner" },
        context: { channel: "office", officeRequestId: "legacy-followup-request" },
      });
      const followUpPath = `appointments/${legacyCreated.appointmentId}`;
      db.write(followUpPath, mutate(db.read(followUpPath)));
      const beforeConflict = snapshotStore(db);

      await assert.rejects(
        () => authority.scheduleRemainingWork(remainingWorkScheduleInput("foreign-followup-request")),
        (error) => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT
          && error.details?.reason === "remaining-work-follow-up-conflict",
      );

      assert.deepEqual(snapshotStore(db), beforeConflict);
      assert.equal(db.read("appointments/APT-PARTIAL-1").executionOutcome.remainingWorkStatus, "pending_schedule");
    });
  }
});

test("remaining-work follow-up owns exactly the intended capacity lock ids and slots", async () => {
  const { db, authority } = canonicalRemainingWorkFixture();
  await recordFixturePartialCompletion(authority);

  const scheduled = await authority.scheduleRemainingWork(remainingWorkScheduleInput());
  const expectedLockIds = REMAINING_WORK_LOCKS.map((lock) => lock.id);
  const followUp = db.read(`appointments/${scheduled.followUpAppointmentId}`);
  const workOrderId = `WO-${scheduled.followUpAppointmentId}-1`;
  const workOrder = db.read(`workOrders/${workOrderId}`);

  assert.deepEqual(followUp.capacityLockIds, expectedLockIds);
  assert.equal(followUp.assignments[0].slots, 4);
  assert.deepEqual(followUp.assignments[0].ownedSlots, REMAINING_WORK_OWNED_SLOTS);
  assert.deepEqual(workOrder.scheduledSlots, REMAINING_WORK_OWNED_SLOTS);
  assert.deepEqual(
    db.paths("bookingCapacityLocks/RW-")
      .map((path) => ({ path, value: db.read(path) })),
    REMAINING_WORK_LOCKS.map((lock) => ({
      path: `bookingCapacityLocks/${lock.id}`,
      value: {
        ...lock,
        appointmentId: scheduled.followUpAppointmentId,
        active: true,
        createdAtIso: "2026-08-31T21:30:00.000Z",
        updatedAtIso: "2026-08-31T21:30:00.000Z",
        createdAt: "SERVER_TIMESTAMP",
        updatedAt: "SERVER_TIMESTAMP",
      },
    })),
  );
});

test("concurrent remaining-work scheduling converges on one follow-up without duplicate locks", async () => {
  const { db, authority } = canonicalRemainingWorkFixture({ transactionGate: overlapGate(2) });
  await recordFixturePartialCompletion(authority);

  const [first, second] = await Promise.all([
    authority.scheduleRemainingWork(remainingWorkScheduleInput("followup-concurrent-request-1")),
    authority.scheduleRemainingWork(remainingWorkScheduleInput("followup-concurrent-request-2")),
  ]);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.followUpAppointmentId, first.followUpAppointmentId);
  assert.ok(db.transactionConflicts >= 1);
  assert.deepEqual(db.paths("appointments/"), [
    "appointments/APT-PARTIAL-1",
    `appointments/${first.followUpAppointmentId}`,
  ].sort());
  assert.deepEqual(db.paths("workOrders/"), [
    "workOrders/WO-APT-PARTIAL-1-1",
    `workOrders/WO-${first.followUpAppointmentId}-1`,
  ].sort());
  assert.deepEqual(
    db.paths("bookingCapacityLocks/RW-"),
    REMAINING_WORK_LOCKS.map((lock) => `bookingCapacityLocks/${lock.id}`).sort(),
  );
  for (const lock of REMAINING_WORK_LOCKS) {
    assert.equal(db.read(`bookingCapacityLocks/${lock.id}`).appointmentId, first.followUpAppointmentId);
  }
});

test("failure after the atomic remaining-work link is staged restores the byte-equivalent snapshot", async () => {
  const { db, authority } = canonicalRemainingWorkFixture();
  await recordFixturePartialCompletion(authority);
  const beforeFailure = snapshotStore(db);
  const identity = canonicalAppointmentIdentity("office:partial-followup:APT-PARTIAL-1:v1");
  let inspectedAtomicWriteSet = false;
  db.failNextTransactionCommit(new Error("forced remaining-work commit failure"), (transaction) => {
    const writes = new Map(transaction.writes.map(({ ref, value }) => [ref.key(), value]));
    assert.equal(
      writes.get("appointments/APT-PARTIAL-1")?.executionOutcome?.remainingWorkStatus,
      "scheduled",
      "the original link must be staged inside the create transaction",
    );
    assert.equal(
      writes.get(`appointments/${identity.appointmentId}`)?.sourcePartialAppointmentId,
      "APT-PARTIAL-1",
      "the follow-up relationship must be staged in the same write set",
    );
    assert.equal(
      writes.get(`workOrders/WO-${identity.appointmentId}-1`)?.sourcePartialAppointmentId,
      "APT-PARTIAL-1",
      "the Work Order relationship must be staged in the same write set",
    );
    assert.ok(writes.has(`bookingIdempotency/${identity.idempotencyKeyHash}`));
    assert.ok(REMAINING_WORK_LOCKS.every((lock) => writes.has(`bookingCapacityLocks/${lock.id}`)));
    assert.equal(writes.get("bookingOffers/OFR-REMAINING")?.status, "booked");
    inspectedAtomicWriteSet = true;
  });

  await assert.rejects(
    () => authority.scheduleRemainingWork(remainingWorkScheduleInput("followup-rollback-request-1")),
    /forced remaining-work commit failure/,
  );

  assert.equal(inspectedAtomicWriteSet, true);
  assert.deepEqual(snapshotStore(db), beforeFailure);
  assert.equal(db.read(`appointments/${identity.appointmentId}`), undefined);
  assert.equal(db.read(`workOrders/WO-${identity.appointmentId}-1`), undefined);
  assert.equal(db.read(`bookingIdempotency/${identity.idempotencyKeyHash}`), undefined);
  assert.deepEqual(db.paths("bookingCapacityLocks/RW-"), []);
  assert.equal(db.read("bookingOffers/OFR-REMAINING").status, "open");
  assert.equal(db.read("appointments/APT-PARTIAL-1").executionOutcome.remainingWorkStatus, "pending_schedule");
});
