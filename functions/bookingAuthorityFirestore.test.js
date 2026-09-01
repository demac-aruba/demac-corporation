const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
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
  commit() { return Promise.all(this.writes.map(({ ref, value, options }) => ref.set(value, options))); }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.store = new Map(Object.entries(seed));
  }
  collection(name) { return new FakeCollectionRef(this, name); }
  async runTransaction(callback) {
    const tx = new FakeTransaction(this);
    const result = await callback(tx);
    await tx.commit();
    return result;
  }
  read(path) { return this.store.get(path); }
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

function authorityFixture({ seed = {}, providerOverrides = {} } = {}) {
  const db = new FakeFirestore({
    "clients/client-1": { name: "Richard", phone: "+2975600000" },
    "properties/property-1": { clientId: "client-1", address: "Wayaca 217" },
    ...seed,
  });
  const authority = createBookingAuthority({
    db,
    availabilityProvider: provider(providerOverrides),
    clock: () => new Date("2098-12-01T12:00:00.000Z"),
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
