const test = require("node:test");
const assert = require("node:assert/strict");
const { createBookingAppointmentLifecycle } = require("./bookingAuthorityAppointmentLifecycle");
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

const recipient = {
  id: "client-client-1",
  recipientType: "client",
  sourceId: "client-1",
  name: "Customer",
  whatsapp: "+2975600000",
  sendConfirmation: true,
  sendReminder: true,
};

function workItem(quantity = 1) {
  return {
    id: "work-1",
    presetId: "standard_service",
    serviceId: "service-1",
    label: "Standard service",
    quantity,
    durationMinutes: quantity * 60,
    durationMinutesPerUnit: 60,
    durationMode: "per_unit",
  };
}

function holdAppointment() {
  return {
    id: "APT-HOLD-1",
    appointmentId: "APT-HOLD-1",
    customerId: "client-1",
    propertyId: "property-1",
    offerId: "OFR-HOLD-ORIGINAL",
    offerVersion: 1,
    selectedOptionId: "OPT-HOLD-ORIGINAL",
    status: "temporary_hold",
    date: "2098-12-20",
    startTime: "13:30",
    endTime: "14:30",
    workLines: [{ id: "work-1", presetId: "standard_service", serviceId: "service-1", quantity: 1 }],
    workItems: [workItem(1)],
    constraints: { requestedDate: "2098-12-20", requestedTime: "13:30" },
    assignments: [{
      vanId: "VAN-2",
      vanName: "Van 2",
      technicianIds: ["tech-a", "tech-b"],
      quantity: 1,
      durationMinutes: 60,
      slots: 1,
      fullDay: false,
      time: "13:30",
      endTime: "14:30",
      role: "primary",
    }],
    primaryVanId: "VAN-2",
    notificationRecipients: [recipient],
    workOrderIds: ["WO-APT-HOLD-1-1"],
    capacityLockIds: ["lock-v2-1330"],
    lifecycleHistory: [],
  };
}

function newOption() {
  return {
    id: "OPT-HOLD-NEW",
    date: "2098-12-22",
    time: "14:30",
    endTime: "15:30",
    address: "Wayaca 217",
    zone: "Oranjestad",
    presetId: "standard_service",
    presetLabel: "Standard service",
    serviceId: "service-1",
    durationMinutesPerUnit: 60,
    durationMode: "per_unit",
    quantity: 1,
    workItems: [workItem(1)],
    assignments: [{
      vanId: "VAN-3",
      vanName: "Van 3",
      technicianIds: ["tech-c", "tech-d"],
      quantity: 1,
      durationMinutes: 60,
      slots: 1,
      fullDay: false,
      time: "14:30",
      endTime: "15:30",
      role: "primary",
    }],
  };
}

function openRescheduleOffer() {
  const option = newOption();
  return {
    id: "OFR-HOLD-RESCHEDULE",
    version: 1,
    status: "open",
    expiresAt: "2098-12-31T23:59:59.000Z",
    request: {
      customerId: "client-1",
      propertyId: "property-1",
      workLines: [{ id: "work-1", presetId: "standard_service", serviceId: "service-1", quantity: 1 }],
      constraints: { requestedDate: option.date, requestedTime: option.time },
    },
    options: [option],
  };
}

function fixture(extra = {}, providerOverrides = {}) {
  const db = new FakeFirestore({
    "appointments/APT-HOLD-1": holdAppointment(),
    "workOrders/WO-APT-HOLD-1-1": {
      id: "WO-APT-HOLD-1-1",
      appointmentId: "APT-HOLD-1",
      clientId: "client-1",
      propertyId: "property-1",
      status: "Reserva temporal",
      date: "2098-12-20",
      time: "13:30",
      vanId: "VAN-2",
      appointmentAssignmentRole: "primary",
      whatsappNotificationsEnabled: false,
      notificationRecipients: [],
    },
    "bookingCapacityLocks/lock-v2-1330": {
      appointmentId: "APT-HOLD-1",
      active: true,
      date: "2098-12-20",
      vanId: "VAN-2",
      slot: "13:30",
    },
    "bookingOffers/OFR-HOLD-ORIGINAL": {
      id: "OFR-HOLD-ORIGINAL",
      status: "held",
      appointmentId: "APT-HOLD-1",
    },
    "clients/client-1": { name: "Customer", phone: "+2975600000" },
    "properties/property-1": { clientId: "client-1", address: "Wayaca 217", operationalZone: "Oranjestad" },
    ...extra,
  });
  const provider = {
    async revalidateSelection({ option }) { return { available: true, option }; },
    async validateTransaction({ option }) {
      const assignment = option.assignments[0];
      return {
        available: true,
        capacityLocks: [{
          id: option.id === "OPT-HOLD-NEW" ? "lock-v3-1430" : "lock-v2-1330",
          date: option.date,
          vanId: assignment.vanId,
          slot: assignment.time || option.time,
        }],
      };
    },
    async buildWorkOrders(args) { return buildWorkOrders(args); },
    ...providerOverrides,
  };
  const lifecycle = createBookingAppointmentLifecycle({
    db,
    schedulingProvider: provider,
    clock: () => new Date("2098-12-01T12:00:00.000Z"),
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { db, lifecycle, provider };
}

test("confirming a temporary hold keeps its capacity and activates customer communication only on the primary Work Order", async () => {
  const { db, lifecycle } = fixture();
  const result = await lifecycle.confirmTemporaryHold({
    appointmentId: "APT-HOLD-1",
    actor: { id: "office-1", name: "Office" },
  });

  assert.equal(result.success, true);
  assert.equal(result.replayed, false);
  assert.equal(db.read("appointments/APT-HOLD-1").status, "confirmed");
  assert.ok(db.read("appointments/APT-HOLD-1").confirmedAtIso);
  assert.equal(db.read("appointments/APT-HOLD-1").lifecycleHistory.at(-1).kind, "hold_confirmed");
  const workOrder = db.read("workOrders/WO-APT-HOLD-1-1");
  assert.equal(workOrder.status, "Confirmada");
  assert.equal(workOrder.whatsappNotificationsEnabled, true);
  assert.equal(workOrder.notificationRecipients.length, 1);
  assert.ok(workOrder.confirmedAt);
  assert.equal(db.read("bookingCapacityLocks/lock-v2-1330").active, true);
  assert.equal(db.read("bookingCapacityLocks/lock-v2-1330").appointmentId, "APT-HOLD-1");
  assert.equal(db.read("bookingOffers/OFR-HOLD-ORIGINAL").status, "booked");

  const replay = await lifecycle.confirmTemporaryHold({ appointmentId: "APT-HOLD-1" });
  assert.equal(replay.replayed, true);
});

test("temporary hold confirmation fails closed if the hold lost a reserved capacity lock", async () => {
  const { lifecycle } = fixture({
    "bookingCapacityLocks/lock-v2-1330": {
      appointmentId: "APT-OTHER",
      active: true,
      date: "2098-12-20",
      vanId: "VAN-2",
      slot: "13:30",
    },
  });
  await assert.rejects(
    lifecycle.confirmTemporaryHold({ appointmentId: "APT-HOLD-1" }),
    /no longer owns all reserved capacity/i,
  );
});

test("rescheduling a temporary hold moves its locks but keeps it held and silent", async () => {
  const { db, lifecycle } = fixture({
    "bookingOffers/OFR-HOLD-RESCHEDULE": openRescheduleOffer(),
  });
  const result = await lifecycle.rescheduleAppointment({
    appointmentId: "APT-HOLD-1",
    offerId: "OFR-HOLD-RESCHEDULE",
    offerVersion: 1,
    optionId: "OPT-HOLD-NEW",
    reason: "Customer needs another date",
    changeKind: "customer_reschedule",
  });

  assert.equal(result.success, true);
  assert.equal(result.customerNotificationRecommended, false);
  const appointment = db.read("appointments/APT-HOLD-1");
  assert.equal(appointment.status, "temporary_hold");
  assert.equal(appointment.date, "2098-12-22");
  assert.equal(appointment.primaryVanId, "VAN-3");
  const workOrder = db.read("workOrders/WO-APT-HOLD-1-1");
  assert.equal(workOrder.status, "Reserva temporal");
  assert.equal(workOrder.whatsappNotificationsEnabled, false);
  assert.deepEqual(workOrder.notificationRecipients, []);
  assert.equal(db.read("bookingCapacityLocks/lock-v2-1330").active, false);
  assert.equal(db.read("bookingCapacityLocks/lock-v3-1430").active, true);
  assert.equal(db.read("bookingCapacityLocks/lock-v3-1430").appointmentId, "APT-HOLD-1");
  assert.equal(db.read("bookingOffers/OFR-HOLD-RESCHEDULE").status, "held");
});