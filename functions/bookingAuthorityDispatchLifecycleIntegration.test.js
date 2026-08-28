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
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
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

function heldAppointment() {
  return {
    id: "APT-1",
    appointmentId: "APT-1",
    customerId: "client-1",
    propertyId: "property-1",
    status: "confirmed",
    date: "2098-12-20",
    startTime: "08:30",
    endTime: "09:30",
    assignments: [{ vanId: "VAN-1", time: "08:30", quantity: 1, slots: 1 }],
    primaryVanId: "VAN-1",
    workOrderIds: ["WO-1"],
    capacityLockIds: ["LOCK-OLD"],
    lifecycleHistory: [],
    dispatchHold: {
      active: true,
      reason: "customer_change_unresolved",
      caseId: "COMMCASE-1",
      requestedAction: "reschedule",
      sourceMessageIds: ["MSG-1"],
    },
    dispatchSafetyHistory: [],
  };
}

function rescheduleOption() {
  return {
    id: "OPT-1",
    date: "2098-12-22",
    time: "13:30",
    endTime: "14:30",
    address: "Santa Cruz 54 C",
    zone: "Santa Cruz",
    presetId: "standard_service",
    presetLabel: "Standard service",
    serviceId: "service-1",
    durationMinutesPerUnit: 60,
    quantity: 1,
    assignments: [{ vanId: "VAN-2", vanName: "Van 2", technicianIds: [], quantity: 1, slots: 1, fullDay: false, time: "13:30" }],
  };
}

function bookingOffer() {
  const selected = rescheduleOption();
  return {
    id: "OFR-1",
    version: 1,
    status: "open",
    expiresAt: "2098-12-31T23:59:59.000Z",
    request: {
      customerId: "client-1",
      propertyId: "property-1",
      workLines: [{ id: "work-1", presetId: "standard_service", serviceId: "service-1", quantity: 1 }],
      constraints: { requestedDate: selected.date },
    },
    options: [selected],
  };
}

function fixture(extra = {}) {
  const db = new FakeFirestore({
    "appointments/APT-1": heldAppointment(),
    "workOrders/WO-1": {
      appointmentId: "APT-1",
      status: "Confirmada",
      date: "2098-12-20",
      time: "08:30",
      vanId: "VAN-1",
      dispatchSafety: "do_not_dispatch",
      dispatchHoldActive: true,
      dispatchHoldCaseId: "COMMCASE-1",
      dispatchHoldReason: "customer_change_unresolved",
    },
    "bookingCapacityLocks/LOCK-OLD": { appointmentId: "APT-1", active: true, date: "2098-12-20", vanId: "VAN-1", slot: "08:30" },
    "clients/client-1": { name: "Customer" },
    "properties/property-1": { clientId: "client-1", address: "Santa Cruz 54 C" },
    ...extra,
  });
  const provider = {
    async revalidateSelection({ option }) { return { available: true, option }; },
    async validateTransaction({ option }) {
      return { available: true, capacityLocks: [{ id: "LOCK-NEW", date: option.date, vanId: "VAN-2", slot: "13:30" }] };
    },
    async buildWorkOrders({ appointment, option, request, customer, property }) {
      return [{
        id: "WO-1",
        appointmentId: appointment.appointmentId,
        clientId: customer.id,
        propertyId: property.id,
        serviceId: option.serviceId,
        date: option.date,
        time: option.time,
        status: "Confirmada",
        vanId: option.assignments[0].vanId,
        appointmentPresetId: request.workLines[0].presetId,
        appointmentAssignmentRole: "primary",
        airConditionerCount: 1,
        appointmentDurationMinutes: 60,
      }];
    },
  };
  return {
    db,
    lifecycle: createBookingAppointmentLifecycle({
      db,
      schedulingProvider: provider,
      clock: () => new Date("2098-12-01T12:00:00.000Z"),
      serverTimestamp: () => "SERVER_TIMESTAMP",
    }),
  };
}

test("canonical cancellation resolves an active Maya dispatch hold but remains do_not_dispatch because the appointment is cancelled", async () => {
  const { db, lifecycle } = fixture();
  const result = await lifecycle.cancelAppointment({
    appointmentId: "APT-1",
    reason: "Customer confirmed cancellation",
    actor: { id: "office-1", name: "Office" },
  });

  assert.equal(result.success, true);
  const appointment = db.read("appointments/APT-1");
  assert.equal(appointment.status, "cancelled");
  assert.equal(appointment.dispatchHold.active, false);
  assert.equal(appointment.dispatchHold.resolution, "booking_cancelled");

  const workOrder = db.read("workOrders/WO-1");
  assert.equal(workOrder.status, "Cancelada");
  assert.equal(workOrder.dispatchSafety, "do_not_dispatch");
  assert.equal(workOrder.dispatchHoldActive, false);
  assert.equal(workOrder.dispatchHoldReason, "appointment-cancelled");
});

test("successful canonical reschedule resolves an active Maya dispatch hold and derives the moved work as ready", async () => {
  const { db, lifecycle } = fixture({ "bookingOffers/OFR-1": bookingOffer() });
  const result = await lifecycle.rescheduleAppointment({
    appointmentId: "APT-1",
    offerId: "OFR-1",
    offerVersion: 1,
    optionId: "OPT-1",
    reason: "Customer accepted the new appointment",
    actor: { id: "office-1", name: "Office" },
  });

  assert.equal(result.success, true);
  const appointment = db.read("appointments/APT-1");
  assert.equal(appointment.status, "confirmed");
  assert.equal(appointment.date, "2098-12-22");
  assert.equal(appointment.dispatchHold.active, false);
  assert.equal(appointment.dispatchHold.resolution, "booking_rescheduled");

  const workOrder = db.read("workOrders/WO-1");
  assert.equal(workOrder.status, "Confirmada");
  assert.equal(workOrder.date, "2098-12-22");
  assert.equal(workOrder.dispatchSafety, "ready");
  assert.equal(workOrder.dispatchHoldActive, false);
  assert.equal(workOrder.dispatchHoldReason, null);
});
