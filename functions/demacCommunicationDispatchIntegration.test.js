const test = require("node:test");
const assert = require("node:assert/strict");

const { createCommunicationCaseService } = require("./demacCommunicationCaseService");
const { createTechnicianDailyScheduleService } = require("./technicianDailyScheduleService");

const CONVERSATION_ID = "COMM-1111111111111111111111111111111111111111";
const TEST_DATE = "2026-08-26";

class FakeSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this._value = value;
    this.exists = value !== undefined;
  }
  data() { return this.exists ? { ...this._value } : undefined; }
}

class FakeRef {
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
    this.id = id;
    this.path = `${collectionName}/${id}`;
  }
  async get() { return this.db.snapshot(this); }
}

class FakeQuery {
  constructor(db, collectionName, filters = [], max = Infinity) {
    this.db = db;
    this.collectionName = collectionName;
    this.filters = filters;
    this.max = max;
  }
  where(field, operator, value) {
    assert.equal(operator, "==");
    return new FakeQuery(this.db, this.collectionName, [...this.filters, { field, value }], this.max);
  }
  limit(max) {
    return new FakeQuery(this.db, this.collectionName, this.filters, max);
  }
  async get() {
    return { docs: this.db.documents(this.collectionName, this.filters).slice(0, this.max) };
  }
}

class FakeCollection extends FakeQuery {
  doc(id) { return new FakeRef(this.db, this.collectionName, id); }
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map();
    for (const [collectionName, values] of Object.entries(seed)) {
      for (const item of values) this.docs.set(`${collectionName}/${item.id}`, { ...item });
    }
  }
  collection(name) { return new FakeCollection(this, name); }
  snapshot(ref) { return new FakeSnapshot(ref, this.docs.get(ref.path)); }
  documents(collectionName, filters = []) {
    const prefix = `${collectionName}/`;
    const docs = [];
    for (const [path, value] of this.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      if (!filters.every((filter) => value?.[filter.field] === filter.value)) continue;
      docs.push(new FakeSnapshot(new FakeRef(this, collectionName, path.slice(prefix.length)), value));
    }
    return docs;
  }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => this.snapshot(ref),
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const current = this.docs.get(write.ref.path) || {};
      this.docs.set(write.ref.path, write.merge ? { ...current, ...write.value } : { ...write.value });
    }
    return result;
  }
  read(collectionName, id) { return this.docs.get(`${collectionName}/${id}`); }
  values(collectionName) { return this.documents(collectionName).map((snapshot) => snapshot.data()); }
}

function appointment(id, time, workOrderId) {
  return {
    id,
    customerId: "CUST-1",
    date: TEST_DATE,
    startTime: time,
    status: "scheduled",
    workOrderIds: [workOrderId],
  };
}

function workOrder(id, appointmentId, time) {
  return {
    id,
    appointmentId,
    clientId: "CUST-1",
    propertyId: "PROP-1",
    status: "Confirmada",
    date: TEST_DATE,
    time,
    vanId: "VAN-1",
    address: "Santa Cruz 54-C",
    appointmentDurationMinutes: 60,
  };
}

function baseSeed({ customerInputVersion = 7, multipleAppointments = false } = {}) {
  const appointments = [appointment("APT-1", "08:30", "WO-1")];
  const workOrders = [workOrder("WO-1", "APT-1", "08:30")];
  if (multipleAppointments) {
    appointments.push(appointment("APT-2", "10:30", "WO-2"));
    workOrders.push(workOrder("WO-2", "APT-2", "10:30"));
  }
  return {
    communicationConversations: [{
      id: CONVERSATION_ID,
      communicationAccountId: "demac-wa-corporate",
      provider: "wacli",
      phone: "2975600000",
      ownershipVersion: 2,
      customerInputVersion,
      aiDisposition: "ai_active",
    }],
    clients: [{ id: "CUST-1", name: "Customer One", phone: "2975600000", active: true }],
    appointments,
    workOrders,
    vans: [{ id: "VAN-1", name: "Van 1", active: true }],
    properties: [{ id: "PROP-1", address: "Santa Cruz 54-C", operationalZone: "Santa Cruz" }],
    staffProfiles: [],
  };
}

function cancellationObservation(overrides = {}) {
  return {
    intent: "cancellation",
    confidence: 0.97,
    summary: "Customer wants to cancel the scheduled visit.",
    language: "pap-aw",
    requiresAttention: true,
    dispatchRisk: true,
    criticalValueAmbiguous: false,
    requestedDate: TEST_DATE,
    requestedTime: "08:30",
    reason: "Customer will not be available.",
    ...overrides,
  };
}

async function processCancellation(db, observation = cancellationObservation(), expectedCustomerInputVersion = 7) {
  const cases = createCommunicationCaseService({
    db,
    clock: () => new Date("2026-08-25T05:45:00.000Z"),
  });
  const conversation = db.read("communicationConversations", CONVERSATION_ID);
  return cases.processObservation({
    communicationAccountId: "demac-wa-corporate",
    conversationId: CONVERSATION_ID,
    conversation,
    message: {
      id: "MSG-CANCEL-1",
      messageId: "MSG-CANCEL-1",
      phone: "2975600000",
      customerInputVersion: expectedCustomerInputVersion,
    },
    observation,
    expectedOwnershipVersion: 2,
    expectedCustomerInputVersion,
  });
}

test("Observer cancellation output creates a case, protects dispatch, and removes held work from technician schedule", async () => {
  const db = new FakeDb(baseSeed());
  const result = await processCancellation(db);

  assert.equal(result.processed, true);
  assert.equal(result.state, "AWAITING_CUSTOMER_DECISION");
  assert.equal(result.appointmentId, "APT-1");
  assert.equal(result.dispatchHoldActive, true);

  const appointmentCurrent = db.read("appointments", "APT-1");
  assert.equal(appointmentCurrent.status, "scheduled", "dispatch safety must not create a second cancellation status");
  assert.equal(appointmentCurrent.dispatchHold.active, true);
  assert.equal(appointmentCurrent.dispatchHold.requestedAction, "cancellation");

  const workOrderCurrent = db.read("workOrders", "WO-1");
  assert.equal(workOrderCurrent.dispatchSafety, "do_not_dispatch");
  assert.equal(workOrderCurrent.dispatchHoldActive, true);
  assert.equal(workOrderCurrent.dispatchSafetySourceAppointmentId, "APT-1");

  const caseCurrent = db.values("communicationCases")[0];
  assert.equal(caseCurrent.state, "AWAITING_CUSTOMER_DECISION");
  assert.equal(caseCurrent.appointmentId, "APT-1");
  assert.equal(caseCurrent.dispatchHoldActive, true);

  const technician = createTechnicianDailyScheduleService({ db });
  const day = await technician.loadDay(TEST_DATE);
  assert.deepEqual(day.workOrders, [], "held work must not reach the technician dispatch projection");
});

test("stale customer-turn epoch suppresses case and dispatch mutations", async () => {
  const db = new FakeDb(baseSeed({ customerInputVersion: 8 }));
  const result = await processCancellation(db, cancellationObservation(), 7);

  assert.equal(result.processed, false);
  assert.equal(result.reason, "stale-communication-epoch");
  assert.equal(result.epochReason, "customer-input-version-changed");
  assert.equal(db.read("appointments", "APT-1").dispatchHold, undefined);
  assert.equal(db.read("workOrders", "WO-1").dispatchSafety, undefined);
  assert.equal(db.values("communicationCases").length, 0);
});

test("multiple plausible appointments require clarification and never apply a dispatch hold", async () => {
  const db = new FakeDb(baseSeed({ multipleAppointments: true }));
  const result = await processCancellation(db, cancellationObservation({ requestedDate: "", requestedTime: "" }));

  assert.equal(result.processed, true);
  assert.equal(result.state, "AWAITING_APPOINTMENT_CLARIFICATION");
  assert.equal(result.appointmentId, "");
  assert.equal(result.dispatchHoldActive, false);
  assert.equal(result.attentionReason, "multiple-plausible-appointments");
  assert.equal(db.read("appointments", "APT-1").dispatchHold, undefined);
  assert.equal(db.read("appointments", "APT-2").dispatchHold, undefined);
  assert.equal(db.read("workOrders", "WO-1").dispatchSafety, undefined);
  assert.equal(db.read("workOrders", "WO-2").dispatchSafety, undefined);

  const technician = createTechnicianDailyScheduleService({ db });
  const day = await technician.loadDay(TEST_DATE);
  assert.deepEqual(day.workOrders.map((item) => item.id).sort(), ["WO-1", "WO-2"]);
});
