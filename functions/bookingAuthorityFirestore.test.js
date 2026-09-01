const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  canonicalAppointmentIdentity,
} = require("./bookingAuthorityCore");
const { createBookingAuthority } = require("./bookingAuthorityFirestore");

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
      const tx = new FakeTransaction(this);
      try {
        const result = await callback(tx);
        await tx.commit();
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

function baseRequest() {
  return {
    customerId: "client-1",
    propertyId: "property-1",
    workLines: [{ presetId: "standard_service", serviceId: "service-1", quantity: 2 }],
    constraints: { preferredTime: "afternoon" },
  };
}

function option() {
  return {
    id: "opt-1",
    date: "2098-12-20",
    time: "13:30",
    endTime: "15:30",
    capacityEndTime: "16:30",
    address: "Wayaca 217",
    zone: "Oranjestad / Airport",
    presetId: "standard_service",
    presetLabel: "Servicio estándar",
    serviceId: "service-1",
    durationMinutesPerUnit: 60,
    quantity: 2,
    assignments: [{
      vanId: "VAN-2",
      vanName: "Van 2",
      technicianIds: ["tech-1", "tech-2"],
      quantity: 2,
      slots: 2,
      fullDay: false,
      capacityEndTime: "16:30",
    }],
  };
}

function provider(overrides = {}) {
  return {
    checkAvailability: async () => ({
      options: [option()],
      providerVersion: "test-provider-v1",
      metadata: { routeZone: "Oranjestad / Airport" },
    }),
    revalidateSelection: async ({ option: selected }) => ({ available: true, option: selected }),
    validateTransaction: async () => ({
      available: true,
      capacityLocks: [
        { id: "lock-v2-1330", date: "2098-12-20", vanId: "VAN-2", slot: "13:30" },
        { id: "lock-v2-1430", date: "2098-12-20", vanId: "VAN-2", slot: "14:30" },
      ],
    }),
    buildWorkOrders: async ({ appointment, option: selected, customer, property }) => ([{
      id: `WO-${appointment.appointmentId}-1`,
      clientId: customer.id,
      propertyId: property.id,
      serviceId: selected.serviceId,
      date: selected.date,
      time: selected.time,
      status: "Confirmada",
      technicianIds: selected.assignments[0].technicianIds,
      vanId: selected.assignments[0].vanId,
      address: selected.address,
      scheduledSlots: selected.assignments[0].slots,
      createdBy: "booking-authority",
    }]),
    ...overrides,
  };
}

function authorityFixture({ seed = {}, providerOverrides = {}, clock = () => new Date("2098-12-01T12:00:00.000Z") } = {}) {
  const db = new FakeFirestore({
    "clients/client-1": { name: "Richard", phone: "+2975600000" },
    "properties/property-1": { clientId: "client-1", address: "Wayaca 217" },
    ...seed,
  });
  const authority = createBookingAuthority({
    db,
    availabilityProvider: provider(providerOverrides),
    clock,
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { db, authority };
}

test("checkAvailability stores one canonical offer and replays the same inbound request", async () => {
  const { db, authority } = authorityFixture();
  const first = await authority.checkAvailability({
    request: baseRequest(),
    context: { inboundMessageId: "wamid-12345678" },
    actor: { source: "communication-center", id: "demac-agent" },
  });
  const second = await authority.checkAvailability({
    request: baseRequest(),
    context: { inboundMessageId: "wamid-12345678" },
  });

  assert.equal(first.available, true);
  assert.equal(first.replayed, false);
  assert.equal(first.offer.version, 1);
  assert.equal(first.offer.status, "open");
  assert.equal(first.options[0].capacityEndTime, "16:30");
  assert.equal(first.options[0].assignments[0].capacityEndTime, "16:30");
  assert.equal(second.replayed, true);
  assert.equal(second.offer.id, first.offer.id);
  assert.ok(db.read(`bookingOffers/${first.offer.id}`));
});

test("no-availability boundary preserves structured provider diagnostics without changing the public reason", async () => {
  const diagnostic = {
    version: 1,
    stage: "temporal",
    code: "START_TIME_PASSED",
    requested: { date: "2098-12-20", time: "13:30", primaryVanId: "VAN-2" },
    evaluated: { date: "2098-12-20", time: "14:00", timeZone: "America/Aruba" },
    resolvedWorkload: {
      quantity: 2,
      durationMinutes: 120,
      slots: 2,
      ownedSlots: ["13:30", "14:30"],
    },
    facts: {},
  };
  const { db, authority } = authorityFixture({
    providerOverrides: {
      checkAvailability: async () => ({
        options: [],
        reason: "required-primary-target-unavailable",
        metadata: { diagnostic, resolvedWorkload: diagnostic.resolvedWorkload },
      }),
    },
  });

  const result = await authority.checkAvailability({
    request: baseRequest(),
    context: { inboundMessageId: "wamid-no-availability-diagnostic" },
  });
  assert.equal(result.available, false);
  assert.equal(result.offer, null);
  assert.equal(result.reason, "required-primary-target-unavailable");
  assert.deepEqual(result.metadata.diagnostic, diagnostic);
  assert.deepEqual(result.metadata.resolvedWorkload.ownedSlots, ["13:30", "14:30"]);
  assert.equal([...db.store.keys()].some((path) => path.startsWith("bookingOffers/")), false);
});

test("createAppointment atomically creates appointment, work order, offer booking and capacity locks", async () => {
  const { db, authority } = authorityFixture();
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: "wamid-book-0001" } });
  const result = await authority.createAppointment({
    offerId: availability.offer.id,
    offerVersion: availability.offer.version,
    optionId: "opt-1",
    idempotencyKey: "conversation:c1:message:m1:create-appointment",
    actor: { source: "communication-center", id: "demac-agent", name: "DEMAC Agent" },
  });

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.match(result.appointmentId, /^APT-[A-F0-9]{20}$/);
  assert.deepEqual(result.workOrderIds, [`WO-${result.appointmentId}-1`]);
  const appointment = db.read(`appointments/${result.appointmentId}`);
  assert.equal(appointment.status, "confirmed");
  assert.equal(appointment.customerId, "client-1");
  assert.equal(appointment.propertyId, "property-1");
  assert.equal(appointment.endTime, "15:30");
  assert.equal(appointment.capacityEndTime, "16:30");
  assert.equal(appointment.assignments[0].capacityEndTime, "16:30");
  assert.equal(db.read(`workOrders/${result.workOrderIds[0]}`).appointmentId, result.appointmentId);
  assert.equal(db.read("bookingCapacityLocks/lock-v2-1330").appointmentId, result.appointmentId);
  assert.equal(db.read("bookingCapacityLocks/lock-v2-1430").appointmentId, result.appointmentId);
  const offer = db.read(`bookingOffers/${availability.offer.id}`);
  assert.equal(offer.status, "booked");
  assert.equal(offer.appointmentId, result.appointmentId);
});

test("same idempotency key returns the same appointment without duplicate work orders", async () => {
  const { db, authority } = authorityFixture();
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: "wamid-book-0002" } });
  const input = {
    offerId: availability.offer.id,
    offerVersion: 1,
    optionId: "opt-1",
    idempotencyKey: "conversation:c1:message:m2:create-appointment",
  };
  const first = await authority.createAppointment(input);
  const second = await authority.createAppointment(input);

  assert.equal(second.replayed, true);
  assert.equal(second.appointmentId, first.appointmentId);
  const workOrderPaths = [...db.store.keys()].filter((path) => path.startsWith("workOrders/"));
  assert.equal(workOrderPaths.length, 1);
});

test("a missing idempotency record is repaired only for the exact original create payload", async () => {
  const { db, authority } = authorityFixture();
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: "wamid-idem-repair" } });
  const input = {
    offerId: availability.offer.id,
    offerVersion: availability.offer.version,
    optionId: "opt-1",
    idempotencyKey: "conversation:c1:message:idem-repair:create-appointment",
  };
  const created = await authority.createAppointment(input);
  const identity = canonicalAppointmentIdentity(input.idempotencyKey);
  db.store.delete(`bookingIdempotency/${identity.idempotencyKeyHash}`);

  const replay = await authority.createAppointment(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.appointmentId, created.appointmentId);
  assert.equal(db.read(`bookingIdempotency/${identity.idempotencyKeyHash}`).appointmentId, created.appointmentId);
  assert.equal(
    db.read(`bookingIdempotency/${identity.idempotencyKeyHash}`).createRequestFingerprint,
    db.read(`appointments/${created.appointmentId}`).createRequestFingerprint,
  );

  db.store.delete(`bookingIdempotency/${identity.idempotencyKeyHash}`);
  await assert.rejects(
    authority.createAppointment({ ...input, offerId: "OFR-DIFFERENT" }),
    (error) => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
  );
  await assert.rejects(
    authority.createAppointment({ ...input, createMode: "temporary_hold" }),
    (error) => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
  );
  assert.equal(db.read(`bookingIdempotency/${identity.idempotencyKeyHash}`), undefined);
});

test("overlapping create submits retry transactionally and commit one canonical graph", async () => {
  const gate = overlapGate(2);
  let transactionValidations = 0;
  const { db, authority } = authorityFixture({
    providerOverrides: {
      validateTransaction: async () => {
        transactionValidations += 1;
        await gate();
        return {
          available: true,
          capacityLocks: [
            { id: "lock-v2-1330", date: "2098-12-20", vanId: "VAN-2", slot: "13:30" },
            { id: "lock-v2-1430", date: "2098-12-20", vanId: "VAN-2", slot: "14:30" },
          ],
        };
      },
    },
  });
  const availability = await authority.checkAvailability({
    request: baseRequest(),
    context: { inboundMessageId: "wamid-book-concurrent" },
  });
  const input = {
    offerId: availability.offer.id,
    offerVersion: availability.offer.version,
    optionId: "opt-1",
    idempotencyKey: "conversation:c1:message:concurrent:create-appointment",
  };

  const results = await Promise.all([
    authority.createAppointment(input),
    authority.createAppointment(input),
  ]);

  assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(new Set(results.map((result) => result.appointmentId)).size, 1);
  assert.equal(transactionValidations, 2, "both initial transaction attempts overlapped before one retried");
  assert.equal(db.transactionConflicts, 1);
  assert.equal(db.transactionAttempts, 3);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("appointments/")).length, 1);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("workOrders/")).length, 1);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("bookingCapacityLocks/")).length, 2);
  assert.equal([...db.store.keys()].filter((path) => path.startsWith("bookingIdempotency/")).length, 1);
  const appointment = db.read(`appointments/${results[0].appointmentId}`);
  assert.deepEqual(new Set(appointment.capacityLockIds), new Set(["lock-v2-1330", "lock-v2-1430"]));
});

test("refuses booking when property no longer belongs to customer", async () => {
  const { authority } = authorityFixture({ seed: { "properties/property-1": { clientId: "client-OTHER", address: "Wayaca 217" } } });
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: "wamid-book-0003" } });

  await assert.rejects(
    authority.createAppointment({
      offerId: availability.offer.id,
      offerVersion: 1,
      optionId: "opt-1",
      idempotencyKey: "conversation:c1:message:m3:create-appointment",
    }),
    (error) => error instanceof BookingAuthorityError && error.code === BOOKING_ERROR_CODES.PROPERTY_CUSTOMER_MISMATCH,
  );
});

test("refuses booking when scheduling revalidation says the option changed", async () => {
  const { authority } = authorityFixture({ providerOverrides: { revalidateSelection: async () => ({ available: false, reason: "van unavailable" }) } });
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: "wamid-book-0004" } });

  await assert.rejects(
    authority.createAppointment({
      offerId: availability.offer.id,
      offerVersion: 1,
      optionId: "opt-1",
      idempotencyKey: "conversation:c1:message:m4:create-appointment",
    }),
    (error) => error.code === BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
  );
});

test("final transaction validation receives a fresh clock instead of the preflight timestamp", async () => {
  const clockValues = [
    new Date("2098-12-01T12:00:00.000Z"),
    new Date("2098-12-01T12:02:00.000Z"),
    new Date("2098-12-01T12:04:00.000Z"),
  ];
  let clockIndex = 0;
  let transactionNow = null;
  const sameDayOption = {
    ...option(),
    date: "2098-12-01",
    time: "08:03",
    endTime: "10:03",
  };
  const { authority } = authorityFixture({
    clock: () => clockValues[Math.min(clockIndex++, clockValues.length - 1)],
    providerOverrides: {
      checkAvailability: async () => ({
        options: [sameDayOption],
        providerVersion: "test-provider-v1",
        metadata: {},
      }),
      validateTransaction: async ({ now }) => {
        transactionNow = now;
        return { available: false, reason: "selected-time-passed" };
      },
    },
  });
  const availability = await authority.checkAvailability({
    request: baseRequest(),
    context: { inboundMessageId: "wamid-fresh-clock" },
  });

  await assert.rejects(
    authority.createAppointment({
      offerId: availability.offer.id,
      offerVersion: 1,
      optionId: "opt-1",
      idempotencyKey: "conversation:c1:message:fresh-clock:create-appointment",
    }),
    (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT
      && error.details.reason === "selected-time-passed",
  );
  assert.equal(transactionNow.toISOString(), "2098-12-01T12:04:00.000Z");
});

test("capacity lock owned by another appointment blocks the transaction", async () => {
  const { authority } = authorityFixture({
    seed: {
      "bookingCapacityLocks/lock-v2-1330": {
        appointmentId: "APT-OTHER",
        active: true,
        date: "2098-12-20",
        vanId: "VAN-2",
        slot: "13:30",
      },
      "appointments/APT-OTHER": {
        appointmentId: "APT-OTHER",
        status: "confirmed",
        capacityLockIds: ["lock-v2-1330"],
      },
    },
  });
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: "wamid-book-0005" } });

  await assert.rejects(
    authority.createAppointment({
      offerId: availability.offer.id,
      offerVersion: 1,
      optionId: "opt-1",
      idempotencyKey: "conversation:c1:message:m5:create-appointment",
    }),
    (error) => error.code === BOOKING_ERROR_CODES.SLOT_CONFLICT,
  );
});

test("an orphaned active capacity lock is reclaimed instead of becoming a second authority", async () => {
  const { db, authority } = authorityFixture({
    seed: {
      "bookingCapacityLocks/lock-v2-1330": {
        appointmentId: "APT-MISSING",
        active: true,
        date: "2098-12-20",
        vanId: "VAN-2",
        slot: "13:30",
      },
    },
  });
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: "wamid-orphan-lock" } });
  const created = await authority.createAppointment({
    offerId: availability.offer.id,
    offerVersion: 1,
    optionId: "opt-1",
    idempotencyKey: "conversation:c1:message:orphan-lock:create-appointment",
  });
  assert.equal(db.read("bookingCapacityLocks/lock-v2-1330").appointmentId, created.appointmentId);
  assert.equal(db.read("bookingCapacityLocks/lock-v2-1330").active, true);
});

test("getAppointment returns the canonical ERP appointment", async () => {
  const { authority } = authorityFixture();
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: "wamid-book-0006" } });
  const created = await authority.createAppointment({
    offerId: availability.offer.id,
    offerVersion: 1,
    optionId: "opt-1",
    idempotencyKey: "conversation:c1:message:m6:create-appointment",
  });
  const fetched = await authority.getAppointment(created.appointmentId);
  assert.equal(fetched.appointmentId, created.appointmentId);
  assert.equal(fetched.status, "confirmed");
});
