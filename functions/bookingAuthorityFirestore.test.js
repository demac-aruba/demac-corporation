const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
} = require("./bookingAuthorityCore");
const { BOOKING_CREATE_MODES, createBookingAuthority } = require("./bookingAuthorityFirestore");

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

function authorityFixture({ seed = {}, providerOverrides = {}, Database = FakeFirestore } = {}) {
  const db = new Database({
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

test("backdated offer intent is persisted, revalidated and audited on the confirmed appointment", async () => {
  const { db, authority } = authorityFixture({
    providerOverrides: {
      checkAvailability: async () => ({
        options: [option()],
        providerVersion: "test-provider-backdated",
        metadata: {
          bookingMode: "backdated",
          backdatingAcknowledged: true,
          workAlreadyPerformed: true,
        },
      }),
      buildWorkOrders: async ({ appointment, option: selected, customer, property, context }) => ([{
        id: `WO-${appointment.appointmentId}-1`,
        clientId: customer.id,
        propertyId: property.id,
        date: selected.date,
        time: selected.time,
        status: "Confirmada",
        vanId: selected.assignments[0].vanId,
        scheduledSlots: selected.assignments[0].slots,
        bookingMode: context.bookingMode,
        backdated: true,
        whatsappNotificationsEnabled: false,
        notificationRecipients: context.notificationRecipients,
      }]),
    },
  });
  const intent = { channel: "office", bookingMode: "backdated", backdatingAcknowledged: true };
  const availability = await authority.checkAvailability({
    request: baseRequest(),
    context: { ...intent, requestKey: "office-backdated-offer-1" },
  });
  const result = await authority.createAppointment({
    offerId: availability.offer.id,
    offerVersion: 1,
    optionId: "opt-1",
    idempotencyKey: "office:backdated:create:appointment:1",
    actor: { source: "office-scheduling", id: "office-user-1" },
    context: intent,
  });

  assert.equal(availability.offer.metadata.bookingMode, "backdated");
  const appointment = db.read(`appointments/${result.appointmentId}`);
  assert.equal(appointment.status, "confirmed");
  assert.equal(appointment.bookingMode, "backdated");
  assert.equal(appointment.backdated, true);
  assert.equal(appointment.backdatingAcknowledged, true);
  assert.equal(appointment.workAlreadyPerformed, true);
  assert.equal(appointment.createdBy, "office-user-1");
  assert.deepEqual(appointment.notificationRecipients, []);
  assert.equal(appointment.backdatedRecordedAtIso, "2098-12-01T12:00:00.000Z");
  const workOrder = db.read(`workOrders/${result.workOrderIds[0]}`);
  assert.equal(workOrder.bookingMode, "backdated");
  assert.equal(workOrder.whatsappNotificationsEnabled, false);
  assert.deepEqual(workOrder.notificationRecipients, []);
});

test("backdated create rejects missing commit-time acknowledgement and temporary holds", async () => {
  const { authority } = authorityFixture({
    providerOverrides: {
      checkAvailability: async () => ({
        options: [option()],
        metadata: { bookingMode: "backdated", backdatingAcknowledged: true },
      }),
    },
  });
  const availability = await authority.checkAvailability({
    request: baseRequest(),
    context: {
      channel: "office",
      bookingMode: "backdated",
      backdatingAcknowledged: true,
      requestKey: "office-backdated-offer-2",
    },
  });
  const baseCreate = {
    offerId: availability.offer.id,
    offerVersion: 1,
    optionId: "opt-1",
    idempotencyKey: "office:backdated:create:appointment:2",
  };

  await assert.rejects(
    authority.createAppointment({ ...baseCreate, context: { channel: "office" } }),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST
      && error.details.reason === "backdating-intent-mismatch",
  );
  await assert.rejects(
    authority.createAppointment({
      ...baseCreate,
      idempotencyKey: "office:backdated:hold:appointment:2",
      createMode: BOOKING_CREATE_MODES.TEMPORARY_HOLD,
      context: { channel: "office", bookingMode: "backdated", backdatingAcknowledged: true },
    }),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST
      && error.details.reason === "backdating-temporary-hold-not-allowed",
  );
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

test('booking references and upload claims commit with ordinary appointments; exact replay is preserved', async () => {
  const { db, authority } = authorityFixture({ seed: {
    'users/office-1': { active: true, role: 'office' },
    'bookingReferenceUploads/reference-001': { status: 'ready', uploadedBy: 'office-1', expiresAt: '2099-01-01T00:00:00Z', storagePath: 'booking-references/office-1/reference-001', kind: 'image', fileName: 'equipment.jpg', mimeType: 'image/jpeg', size: 10 },
  } });
  const availability = await authority.checkAvailability({ request: baseRequest() });
  const input = { offerId: availability.offer.id, offerVersion: availability.offer.version, optionId: 'opt-1',
    idempotencyKey: 'office:references:create-appointment', actor: { source: 'office-scheduling', id: 'office-1' },
    context: { visitReferences: { notes: 'Kitchen unit', files: [{ id: 'reference-001', description: 'Drain leak' }] } } };
  const first = await authority.createAppointment(input);
  assert.equal(db.read(`appointments/${first.appointmentId}`).visitReferences.files[0].description, 'Drain leak');
  assert.equal(db.read('bookingReferenceUploads/reference-001').appointmentId, first.appointmentId);
  assert.equal((await authority.createAppointment(input)).replayed, true);
  await assert.rejects(authority.createAppointment({ ...input, context: { visitReferences: { notes: 'Different' } } }), /different booking request/);
});

test('invalid reference claim rejects appointment and capacity writes together', async () => {
  const { db, authority } = authorityFixture({ seed: { 'users/office-1': { active: true, role: 'office' } } });
  const availability = await authority.checkAvailability({ request: baseRequest() });
  await assert.rejects(authority.createAppointment({ offerId: availability.offer.id, offerVersion: 1, optionId: 'opt-1',
    idempotencyKey: 'office:invalid-references:create-appointment', actor: { source: 'office-scheduling', id: 'office-1' },
    context: { visitReferences: { files: [{ id: 'missing-file-001' }] } } }), /missing or incomplete/);
  assert.equal([...db.store.keys()].some(key => key.startsWith('appointments/')), false);
  assert.equal([...db.store.keys()].some(key => key.startsWith('bookingCapacityLocks/')), false);
});

const { TransactionalFirestore } = require('./test-support/transactionalFirestore');
function chargedBookingFixture() {
  return authorityFixture({ Database: TransactionalFirestore, seed: { 'users/office': { role: 'office', active: true, name: 'Synthetic office' } } });
}
async function chargedRequest(authority, changes = {}) {
  const availability = await authority.checkAvailability({ request: baseRequest(), context: { inboundMessageId: 'charged-offer-id' } });
  return { offerId: availability.offer.id, offerVersion: availability.offer.version, optionId: 'opt-1', idempotencyKey: 'charged-booking-request', actor: { source: 'office-scheduling', id: 'office' }, context: { charges: { lines: [{ id: 'work', label: 'Synthetic service', quantity: 2, unitPrice: '125', reason: 'Agreed price' }], payment: { method: 'cash', amount: '100' } } }, ...changes };
}
test('ordinary appointment, initial estimate and receipt commit together and exact replay never doubles deposit', async () => {
  const { db, authority } = chargedBookingFixture(); const request = await chargedRequest(authority);
  const result = await authority.createAppointment(request); const replay = await authority.createAppointment(request);
  assert.equal(replay.replayed, true); assert.equal(result.appointment.jobCharges.originalEstimate.totalCents, 25000);
  assert.equal([...db.store.keys()].filter(key => key.startsWith('payments/')).length, 1);
  assert.equal(result.appointment.jobCharges.receivedCents, 10000); assert.equal(result.workOrderIds.length, 1);
  await assert.rejects(authority.createAppointment({ ...request, context: { charges: { ...request.context.charges, payment: { method: 'cash', amount: '101' } } } }), error => error.code === BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT);
  db.write('users/office', { role: 'office', active: false });
  await assert.rejects(authority.createAppointment(request), error => error.code === 'permission_denied');
});
test('invalid deposit prevents appointment/work orders/locks/receipts from being partially committed', async () => {
  const { db, authority } = chargedBookingFixture(); const request = await chargedRequest(authority);
  const before = [...db.store]; request.context.charges.payment = { method: 'transfer', amount: '100', reference: '' };
  await assert.rejects(authority.createAppointment(request), error => error.code === 'payment_reference');
  assert.deepEqual([...db.store], before);
});
test('temporary hold can save projection but rejects deposit atomically', async () => {
  const { db, authority } = chargedBookingFixture(); const request = await chargedRequest(authority, { createMode: BOOKING_CREATE_MODES.TEMPORARY_HOLD });
  const before = [...db.store]; await assert.rejects(authority.createAppointment(request), error => error.code === 'payment_hold'); assert.deepEqual([...db.store], before);
  delete request.context.charges.payment; const result = await authority.createAppointment(request);
  assert.equal(result.appointment.status, 'temporary_hold'); assert.equal(result.appointment.jobCharges.receivedCents, 0);
});
