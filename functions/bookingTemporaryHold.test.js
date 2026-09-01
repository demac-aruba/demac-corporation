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

function fixture() {
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