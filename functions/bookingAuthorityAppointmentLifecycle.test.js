const test = require("node:test");
const assert = require("node:assert/strict");
const { createBookingAppointmentLifecycle } = require("./bookingAuthorityAppointmentLifecycle");

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

function appointmentSeed() {
  return {
    id: "APT-LIVE-1",
    appointmentId: "APT-LIVE-1",
    customerId: "client-1",
    propertyId: "property-1",
    status: "confirmed",
    date: "2098-12-20",
    startTime: "08:30",
    endTime: "10:30",
    assignments: [{ vanId: "VAN-1", time: "08:30", quantity: 2, slots: 2 }],
    primaryVanId: "VAN-1",
    workOrderIds: ["WO-APT-LIVE-1-1"],
    capacityLockIds: ["lock-old-0830", "lock-old-0930"],
    lifecycleHistory: [],
  };
}

function option() {
  return {
    id: "OPT-NEW",
    date: "2098-12-22",
    time: "13:30",
    endTime: "15:30",
    address: "Santa Cruz 54 C",
    zone: "Santa Cruz",
    presetId: "standard_service",
    presetLabel: "Standard service",
    serviceId: "service-1",
    durationMinutesPerUnit: 60,
    quantity: 2,
    assignments: [{ vanId: "VAN-2", vanName: "Van 2", technicianIds: [], quantity: 2, slots: 2, fullDay: false, time: "13:30" }],
  };
}

function request() {
  return {
    customerId: "client-1",
    propertyId: "property-1",
    workLines: [{ id: "work-1", presetId: "standard_service", serviceId: "service-1", quantity: 2 }],
    constraints: { requestedDate: "2098-12-22" },
  };
}

function fixture(extra = {}) {
  const db = new FakeFirestore({
    "appointments/APT-LIVE-1": appointmentSeed(),
    "workOrders/WO-APT-LIVE-1-1": { appointmentId: "APT-LIVE-1", status: "Confirmada", date: "2098-12-20", time: "08:30", vanId: "VAN-1" },
    "bookingCapacityLocks/lock-old-0830": { appointmentId: "APT-LIVE-1", active: true, date: "2098-12-20", vanId: "VAN-1", slot: "08:30" },
    "bookingCapacityLocks/lock-old-0930": { appointmentId: "APT-LIVE-1", active: true, date: "2098-12-20", vanId: "VAN-1", slot: "09:30" },
    "clients/client-1": { name: "Christian" },
    "properties/property-1": { clientId: "client-1", address: "Santa Cruz 54 C" },
    ...extra,
  });
  const provider = {
    async revalidateSelection({ option: selected }) { return { available: true, option: selected }; },
    async validateTransaction() {
      return {
        available: true,
        capacityLocks: [
          { id: "lock-new-1330", date: "2098-12-22", vanId: "VAN-2", slot: "13:30" },
          { id: "lock-new-1430", date: "2098-12-22", vanId: "VAN-2", slot: "14:30" },
        ],
      };
    },
    async buildWorkOrders({ appointment, option: selected, request: selectedRequest, customer, property }) {
      return [{
        id: `WO-${appointment.appointmentId}-1`,
        appointmentId: appointment.appointmentId,
        clientId: customer.id,
        propertyId: property.id,
        serviceId: selected.serviceId,
        date: selected.date,
        time: selected.time,
        status: "Confirmada",
        vanId: selected.assignments[0].vanId,
        appointmentPresetId: selectedRequest.workLines[0].presetId,
        appointmentAssignmentRole: "primary",
        airConditionerCount: selected.assignments[0].quantity,
        appointmentDurationMinutes: 120,
      }];
    },
  };
  const lifecycle = createBookingAppointmentLifecycle({
    db,
    schedulingProvider: provider,
    clock: () => new Date("2098-12-01T12:00:00.000Z"),
    serverTimestamp: () => "SERVER_TIMESTAMP",
  });
  return { db, lifecycle };
}

test("cancelling an appointment releases capacity and cancels linked work orders atomically", async () => {
  const { db, lifecycle } = fixture();
  const result = await lifecycle.cancelAppointment({
    appointmentId: "APT-LIVE-1",
    reason: "Customer cancelled service",
    actor: { id: "owner-1", name: "Owner" },
  });
  assert.equal(result.success, true);
  assert.equal(db.read("appointments/APT-LIVE-1").status, "cancelled");
  assert.equal(db.read("workOrders/WO-APT-LIVE-1-1").status, "Cancelada");
  assert.equal(db.read("bookingCapacityLocks/lock-old-0830").active, false);
  assert.equal(db.read("bookingCapacityLocks/lock-old-0930").active, false);
});

test("rescheduling preserves appointment identity and swaps work orders plus capacity locks", async () => {
  const openOffer = {
    id: "OFR-RESCHEDULE-1",
    version: 1,
    status: "open",
    expiresAt: "2098-12-31T23:59:59.000Z",
    request: request(),
    options: [option()],
  };
  const { db, lifecycle } = fixture({ "bookingOffers/OFR-RESCHEDULE-1": openOffer });
  const result = await lifecycle.rescheduleAppointment({
    appointmentId: "APT-LIVE-1",
    offerId: "OFR-RESCHEDULE-1",
    offerVersion: 1,
    optionId: "OPT-NEW",
    reason: "Customer requested another date",
    actor: { id: "owner-1", name: "Owner" },
  });
  assert.equal(result.success, true);
  assert.equal(result.appointmentId, "APT-LIVE-1");
  const appointment = db.read("appointments/APT-LIVE-1");
  assert.equal(appointment.date, "2098-12-22");
  assert.equal(appointment.startTime, "13:30");
  assert.equal(appointment.primaryVanId, "VAN-2");
  assert.equal(db.read("workOrders/WO-APT-LIVE-1-1").date, "2098-12-22");
  assert.equal(db.read("workOrders/WO-APT-LIVE-1-1").vanId, "VAN-2");
  assert.equal(db.read("bookingCapacityLocks/lock-old-0830").active, false);
  assert.equal(db.read("bookingCapacityLocks/lock-new-1330").active, true);
  assert.equal(db.read("bookingCapacityLocks/lock-new-1330").appointmentId, "APT-LIVE-1");
  assert.equal(db.read("bookingOffers/OFR-RESCHEDULE-1").appointmentId, "APT-LIVE-1");
});
