const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOOKING_CREATE_MODES,
  createBookingAuthority,
} = require("./bookingAuthorityFirestore");
const { buildWorkOrders } = require("./bookingAuthorityWorkOrders");

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
  }
  collection(name) { return new FakeCollectionRef(this, name); }
  version(path) { return this.versions.get(path) || 0; }
  write(path, value, options) {
    const current = this.store.get(path);
    this.store.set(path, options?.merge ? { ...(current || {}), ...value } : value);
    this.versions.set(path, this.version(path) + 1);
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
      for (const { ref, value, options } of transaction.writes) this.write(ref.key(), value, options);
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

function request() {
  return {
    customerId: "client-1",
    propertyId: "property-1",
    workLines: [{ id: "work-1", presetId: "standard_service", serviceId: "service-1", quantity: 1 }],
    constraints: { requestedDate: "2098-12-20", requestedTime: "13:30" },
  };
}

function option() {
  return {
    id: "opt-hold-1",
    date: "2098-12-20",
    time: "13:30",
    endTime: "14:30",
    address: "Wayaca 217",
    zone: "Oranjestad",
    presetId: "standard_service",
    presetLabel: "Servicio estándar",
    serviceId: "service-1",
    durationMinutesPerUnit: 60,
    durationMode: "per_unit",
    quantity: 1,
    workItems: [{
      id: "work-1",
      presetId: "standard_service",
      serviceId: "service-1",
      label: "Servicio estándar",
      quantity: 1,
      durationMinutes: 60,
      durationMinutesPerUnit: 60,
      durationMode: "per_unit",
    }],
    assignments: [{
      vanId: "VAN-2",
      vanName: "Van 2",
      technicianIds: ["tech-1", "tech-2"],
      quantity: 1,
      durationMinutes: 60,
      slots: 1,
      fullDay: false,
      time: "13:30",
      endTime: "14:30",
      role: "primary",
    }],
  };
}

function fixture(providerOverrides = {}) {
  const db = new FakeFirestore({
    "clients/client-1": { name: "Richard", phone: "+2975600000" },
    "properties/property-1": { clientId: "client-1", address: "Wayaca 217", operationalZone: "Oranjestad" },
  });
  const selected = option();
  const provider = {
    checkAvailability: async () => ({ options: [selected], providerVersion: "hold-test-v1" }),
    revalidateSelection: async () => ({ available: true, option: selected }),
    validateTransaction: async () => ({
      available: true,
      capacityLocks: [{ id: "lock-v2-1330", date: selected.date, vanId: "VAN-2", slot: "13:30" }],
    }),
    buildWorkOrders,
    ...providerOverrides,
  };
  const authority = createBookingAuthority({
    db,
    availabilityProvider: provider,
    clock: () => new Date("2098-12-01T12:00:00.000Z"),
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { authority, db };
}

test("temporary hold creation atomically owns capacity without becoming a confirmed customer appointment", async () => {
  const { authority, db } = fixture();
  const recipient = {
    id: "client-client-1",
    recipientType: "client",
    sourceId: "client-1",
    name: "Richard",
    whatsapp: "+2975600000",
    sendConfirmation: true,
    sendReminder: true,
  };
  const availability = await authority.checkAvailability({
    request: request(),
    context: { requestKey: "office-hold-check-1", notificationRecipients: [recipient] },
  });
  const result = await authority.createAppointment({
    offerId: availability.offer.id,
    offerVersion: availability.offer.version,
    optionId: "opt-hold-1",
    idempotencyKey: "office-user:hold:create:1",
    createMode: BOOKING_CREATE_MODES.TEMPORARY_HOLD,
    context: { channel: "office" },
  });

  assert.equal(result.success, true);
  assert.equal(result.createMode, "temporary_hold");
  const appointment = db.read(`appointments/${result.appointmentId}`);
  assert.equal(appointment.status, "temporary_hold");
  assert.equal(appointment.holdPolicy, "manual-confirm-or-cancel");
  assert.equal(appointment.confirmedAtIso, undefined);
  assert.equal(appointment.notificationRecipients.length, 1, "recipient intent is frozen on the canonical hold for later confirmation");

  const workOrder = db.read(`workOrders/${result.workOrderIds[0]}`);
  assert.equal(workOrder.status, "Reserva temporal");
  assert.equal(workOrder.whatsappNotificationsEnabled, false);
  assert.deepEqual(workOrder.notificationRecipients, []);
  assert.equal(workOrder.confirmedAt, undefined);
  assert.ok(workOrder.heldAt);

  const lock = db.read("bookingCapacityLocks/lock-v2-1330");
  assert.equal(lock.active, true);
  assert.equal(lock.appointmentId, result.appointmentId);
  const offer = db.read(`bookingOffers/${availability.offer.id}`);
  assert.equal(offer.status, "held");
  assert.equal(offer.appointmentId, result.appointmentId);
});

test("temporary hold creation is idempotent and never duplicates capacity or work orders", async () => {
  const { authority, db } = fixture();
  const availability = await authority.checkAvailability({ request: request(), context: { requestKey: "office-hold-check-2" } });
  const input = {
    offerId: availability.offer.id,
    offerVersion: availability.offer.version,
    optionId: "opt-hold-1",
    idempotencyKey: "office-user:hold:create:2",
    createMode: BOOKING_CREATE_MODES.TEMPORARY_HOLD,
  };
  const first = await authority.createAppointment(input);
  const second = await authority.createAppointment(input);

  assert.equal(second.replayed, true);
  assert.equal(second.appointmentId, first.appointmentId);
  assert.equal(second.createMode, "temporary_hold");
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("appointments/")).length, 1);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("workOrders/")).length, 1);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("bookingCapacityLocks/")).length, 1);
});

test("overlapping hold submits retry transactionally and create one hold, Work Order and lock set", async () => {
  const gate = overlapGate(2);
  let transactionValidations = 0;
  const { authority, db } = fixture({
    validateTransaction: async () => {
      transactionValidations += 1;
      await gate();
      return {
        available: true,
        capacityLocks: [{ id: "lock-v2-1330", date: "2098-12-20", vanId: "VAN-2", slot: "13:30" }],
      };
    },
  });
  const availability = await authority.checkAvailability({
    request: request(),
    context: { requestKey: "office-hold-concurrent" },
  });
  const input = {
    offerId: availability.offer.id,
    offerVersion: availability.offer.version,
    optionId: "opt-hold-1",
    idempotencyKey: "office-user:hold:create:concurrent",
    createMode: BOOKING_CREATE_MODES.TEMPORARY_HOLD,
  };

  const results = await Promise.all([
    authority.createAppointment(input),
    authority.createAppointment(input),
  ]);

  assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(new Set(results.map((result) => result.appointmentId)).size, 1);
  assert.equal(transactionValidations, 2);
  assert.equal(db.transactionConflicts, 1);
  assert.equal(db.transactionAttempts, 3);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("appointments/")).length, 1);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("workOrders/")).length, 1);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("bookingCapacityLocks/")).length, 1);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("bookingIdempotency/")).length, 1);
  const appointment = db.read(`appointments/${results[0].appointmentId}`);
  assert.equal(appointment.status, BOOKING_CREATE_MODES.TEMPORARY_HOLD);
  assert.deepEqual(appointment.capacityLockIds, ["lock-v2-1330"]);
  assert.equal(db.read("bookingCapacityLocks/lock-v2-1330").appointmentId, results[0].appointmentId);
});
