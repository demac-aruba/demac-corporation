const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appointmentStillOwnsLock,
  assertDetailsEditKeepsPlacement,
  createBookingAppointmentLifecycle,
  normalizeChangeKind,
  scheduleChangeNeedsCustomerFollowUp,
} = require("./bookingAuthorityAppointmentLifecycle");
const { officeReviewDocumentId } = require("./fieldOperationsOfficeReview");
const { initialVisitDocumentId } = require("./fieldOperationsAuthorityWorkVisit");
const projectSeed = () => ({ id: "PROJECT-1", assignments: [{ projectId: "PROJECT-1", phaseId: "PHASE-1",
  appointmentId: "APT-LIVE-1", workOrderId: "WO-APT-LIVE-1-1", actualHours: 0,
  unitsCompleted: 0, status: "Scheduled" }] });

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
  where(field, operator, value) {
    assert.equal(operator, "==");
    return new FakeQuery(this.db, this.name, field, value);
  }
}

class FakeQuery {
  constructor(db, collection, field, value, max = Infinity) {
    Object.assign(this, { db, collection, field, value, max });
  }
  limit(max) { return new FakeQuery(this.db, this.collection, this.field, this.value, max); }
  async get() {
    if (this.db.failQueries.has(`${this.collection}.${this.field}`)) throw new Error("Commercial query unavailable");
    const prefix = `${this.collection}/`;
    const docs = [...this.db.store.entries()]
      .filter(([path, record]) => path.startsWith(prefix) && record?.[this.field] === this.value)
      .slice(0, this.max)
      .map(([path, record]) => new FakeSnapshot(path.slice(prefix.length), record));
    return { empty: docs.length === 0, docs };
  }
}

class FakeTransaction {
  constructor(db) { this.db = db; this.writes = []; }
  async get(ref) { return ref.get(); }
  set(ref, value, options) { this.writes.push({ ref, value, options }); }
  async commit() { for (const write of this.writes) { await write.ref.set(write.value, write.options); this.db.writes += 1; } }
}

class FakeFirestore {
  constructor(seed = {}) { this.store = new Map(Object.entries(seed)); this.writes = 0; this.failQueries = new Set(); }
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

function option(overrides = {}) {
  return {
    id: "OPT-NEW",
    date: "2098-12-22",
    time: "13:30",
    endTime: "15:30",
    capacityEndTime: "16:30",
    address: "Santa Cruz 54 C",
    zone: "Santa Cruz",
    presetId: "standard_service",
    presetLabel: "Standard service",
    serviceId: "service-1",
    durationMinutesPerUnit: 60,
    quantity: 2,
    assignments: [{ vanId: "VAN-2", vanName: "Van 2", technicianIds: [], quantity: 2, slots: 2, fullDay: false, time: "13:30", endTime: "15:30", capacityEndTime: "16:30" }],
    ...overrides,
  };
}

function request(requestedDate = "2098-12-22") {
  return {
    customerId: "client-1",
    propertyId: "property-1",
    workLines: [{ id: "work-1", presetId: "standard_service", serviceId: "service-1", quantity: 2 }],
    constraints: { requestedDate },
  };
}

function openOffer(selectedOption = option()) {
  return {
    id: "OFR-RESCHEDULE-1",
    version: 1,
    status: "open",
    expiresAt: "2098-12-31T23:59:59.000Z",
    request: request(selectedOption.date),
    options: [selectedOption],
  };
}

function operationalOffer() {
  return openOffer(option({ date: "2098-12-20" }));
}

function fixture(extra = {}) {
  const db = new FakeFirestore({
    "appointments/APT-LIVE-1": appointmentSeed(),
    "workOrders/WO-APT-LIVE-1-1": {
      appointmentId: "APT-LIVE-1",
      status: "Confirmada",
      date: "2098-12-20",
      time: "08:30",
      vanId: "VAN-1",
      whatsappNotificationsEnabled: true,
      notificationRecipients: [{ id: "client-1", sendConfirmation: true, sendReminder: true }],
      confirmationNotifications: { queueIds: ["confirmation-existing"] },
      reminderNotifications: { queueIds: ["reminder-existing"] },
      invoiceState: { status: "pending" },
    },
    "bookingCapacityLocks/lock-old-0830": { appointmentId: "APT-LIVE-1", active: true, date: "2098-12-20", vanId: "VAN-1", slot: "08:30" },
    "bookingCapacityLocks/lock-old-0930": { appointmentId: "APT-LIVE-1", active: true, date: "2098-12-20", vanId: "VAN-1", slot: "09:30" },
    "clients/client-1": { name: "Christian" },
    "properties/property-1": { clientId: "client-1", address: "Santa Cruz 54 C" },
    ...extra,
  });
  const provider = {
    revalidationCalls: 0,
    async revalidateSelection({ option: selected }) {
      this.revalidationCalls += 1;
      return { available: true, option: selected };
    },
    async validateTransaction({ option: selected }) {
      return {
        available: true,
        capacityLocks: [
          { id: "lock-new-1330", date: selected.date, vanId: "VAN-2", slot: "13:30" },
          { id: "lock-new-1430", date: selected.date, vanId: "VAN-2", slot: "14:30" },
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
  return { db, lifecycle, provider };
}

test("operational move and details edit classification preserve their lifecycle semantics", () => {
  assert.equal(normalizeChangeKind("operational_move"), "operational_move");
  assert.equal(normalizeChangeKind("details_edited"), "details_edited");
  assert.equal(normalizeChangeKind("something_else"), "customer_reschedule");
  assert.equal(scheduleChangeNeedsCustomerFollowUp("details_edited", {
    dateKey: "2098-12-20", primaryStart: "08:30", primaryVanId: "VAN-1",
  }, {
    dateKey: "2098-12-20", primaryStart: "08:30", primaryVanId: "VAN-1",
  }), false);
  assert.equal(scheduleChangeNeedsCustomerFollowUp("operational_move", {
    dateKey: "2098-12-20", primaryStart: "08:30", primaryVanId: "VAN-1",
  }, {
    dateKey: "2098-12-20", primaryStart: "08:30", primaryVanId: "VAN-2",
  }), false);
  assert.equal(scheduleChangeNeedsCustomerFollowUp("operational_move", {
    dateKey: "2098-12-20", primaryStart: "08:30", primaryVanId: "VAN-1",
  }, {
    dateKey: "2098-12-20", primaryStart: "09:30", primaryVanId: "VAN-2",
  }), true);
  assert.equal(scheduleChangeNeedsCustomerFollowUp("customer_reschedule", {
    dateKey: "2098-12-20", primaryStart: "08:30",
  }, {
    dateKey: "2098-12-20", primaryStart: "08:30",
  }), true);
});

test('a later canonical reschedule clears the current overtime estimate but preserves the historical acceptance', async () => {
  const acceptance = { accepted: true, capacityEnd: '17:30' };
  const { db, lifecycle } = fixture({
    'appointments/APT-LIVE-1': { ...appointmentSeed(), operationalMoveOvertime: acceptance, lifecycleHistory: [{ kind: 'operational_move', possibleOvertime: acceptance }] },
    'bookingOffers/OFR-RESCHEDULE-1': openOffer(),
  });
  const result = await lifecycle.rescheduleAppointment({ appointmentId: 'APT-LIVE-1', offerId: 'OFR-RESCHEDULE-1', offerVersion: 1, optionId: 'OPT-NEW', reason: 'Return to ordinary schedule', actor: { id: 'owner-1' } });
  assert.equal(result.appointment.operationalMoveOvertime, null);
  assert.equal(db.read('appointments/APT-LIVE-1').operationalMoveOvertime, null);
  assert.equal(db.read('workOrders/WO-APT-LIVE-1-1').operationalMoveOvertime, null);
  assert.deepEqual(db.read('appointments/APT-LIVE-1').lifecycleHistory[0].possibleOvertime, acceptance);
});

test("details edit may change workload but never date, start time, or primary Van", () => {
  assert.doesNotThrow(() => assertDetailsEditKeepsPlacement(appointmentSeed(), {
    date: "2098-12-20",
    time: "08:30",
    endTime: "11:30",
    assignments: [{ vanId: "VAN-1", time: "08:30", slots: 3 }],
  }));
  assert.throws(() => assertDetailsEditKeepsPlacement(appointmentSeed(), {
    date: "2098-12-20",
    time: "09:30",
    assignments: [{ vanId: "VAN-1", time: "09:30", slots: 2 }],
  }), /not its date, start time, or primary van/i);
  assert.throws(() => assertDetailsEditKeepsPlacement(appointmentSeed(), {
    date: "2098-12-20",
    time: "08:30",
    assignments: [{ vanId: "VAN-2", time: "08:30", slots: 2 }],
  }), /not its date, start time, or primary van/i);
});

test("capacity-lock ownership ignores cancelled or detached stale locks", () => {
  assert.equal(appointmentStillOwnsLock({ status: "confirmed", capacityLockIds: ["L1"] }, "L1"), true);
  assert.equal(appointmentStillOwnsLock({ status: "confirmed", capacityLockIds: [] }, "L1"), false);
  assert.equal(appointmentStillOwnsLock({ status: "cancelled", capacityLockIds: ["L1"] }, "L1"), false);
  assert.equal(appointmentStillOwnsLock(null, "L1"), false);
});

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

test("Project-linked cancellation blocks independent commercial evidence but leaves regular cancellation unchanged", async () => {
  const invoice = { workOrderId: "WO-APT-LIVE-1-1", status: "paid" };
  const regular = fixture({ "invoices/INV-1": invoice });
  assert.equal((await regular.lifecycle.cancelAppointment({ appointmentId: "APT-LIVE-1", reason: "Customer cancelled" })).success, true);

  const claim = { projectId: "PROJECT-1", appointmentId: "APT-LIVE-1" };
  const scenarios = [
    ["invoices/INV-1", invoice],
    ["payments/PAY-1", { appointmentId: "APT-LIVE-1", status: "allocated" }],
    ["fieldBillingCandidates/FBC-1", { workOrderId: "WO-APT-LIVE-1-1" }],
    [`fieldOfficeReviews/${officeReviewDocumentId("WO-APT-LIVE-1-1")}`, { status: "approved" }],
    [`fieldOfficeReviews/${officeReviewDocumentId("WO-APT-LIVE-1-1")}`, { status: "pending" }],
    [`fieldOfficeReviews/${officeReviewDocumentId("WO-APT-LIVE-1-1")}`, { status: "returned" }],
    ["workVisits/VISIT-1", { workOrderId: "WO-APT-LIVE-1-1", status: "in_progress" }],
    ["workVisits/VISIT-1", { appointmentId: "APT-LIVE-1", status: "pending" }],
    [`workVisits/${initialVisitDocumentId("WO-APT-LIVE-1-1")}`, { status: "not_started" }],
  ];
  for (const [path, record] of scenarios) {
    const { db, lifecycle } = fixture({ "projectBookingClaims/APT-LIVE-1": claim,
      "projectRecords/PROJECT-1": projectSeed(), [path]: record });
    await assert.rejects(() => lifecycle.cancelAppointment({ appointmentId: "APT-LIVE-1", reason: "Correct historical Project slots" }), /commercial|financial|Field|execution/i, path);
    assert.equal(db.read("appointments/APT-LIVE-1").status, "confirmed", path);
    assert.equal(db.read("workOrders/WO-APT-LIVE-1-1").status, "Confirmada", path);
    assert.equal(db.read("bookingCapacityLocks/lock-old-0830").active, true, path);
    assert.equal(db.writes, 0, path);
  }
});

test("Project cancellation rejects executed Work Order status and timestamps even without a Visit document", async () => {
  const claim = { projectId: "PROJECT-1", appointmentId: "APT-LIVE-1" };
  for (const patch of [{ status: "En proceso" }, { actualStartedAt: "2098-12-20T12:30:00.000Z" },
    { actualCompletedAt: "2098-12-20T15:30:00.000Z" }, { workAlreadyPerformed: true }]) {
    const { db, lifecycle } = fixture({ "projectBookingClaims/APT-LIVE-1": claim,
      "projectRecords/PROJECT-1": projectSeed() });
    db.store.set("workOrders/WO-APT-LIVE-1-1", { ...db.read("workOrders/WO-APT-LIVE-1-1"), ...patch });
    await assert.rejects(() => lifecycle.cancelAppointment({ appointmentId: "APT-LIVE-1", reason: "Correct Project slots" }), /Field execution/i);
    assert.equal(db.writes, 0);
    assert.equal(db.read("appointments/APT-LIVE-1").status, "confirmed");
  }
});

test("Project cancellation checks direct Project identity, fails closed on query outage, and replays without another write", async () => {
  const appointment = { ...appointmentSeed(), projectId: "PROJECT-1" };
  const claim = { projectId: "PROJECT-1", appointmentId: "APT-LIVE-1" };
  const { db, lifecycle } = fixture({
    "appointments/APT-LIVE-1": appointment,
    "projectBookingClaims/APT-LIVE-1": claim,
    "projectRecords/PROJECT-1": projectSeed(),
  });
  db.failQueries.add("invoices.workOrderId");
  await assert.rejects(() => lifecycle.cancelAppointment({ appointmentId: "APT-LIVE-1", reason: "Correct Project slots" }), /Commercial query unavailable/);
  assert.equal(db.writes, 0);
  assert.equal(db.read("appointments/APT-LIVE-1").status, "confirmed");
  db.failQueries.clear();
  const result = await lifecycle.cancelAppointment({ appointmentId: "APT-LIVE-1", reason: "Correct Project slots" });
  assert.equal(result.replayed, false);
  const writes = db.writes;
  db.store.set("invoices/INV-LATER", { workOrderId: "WO-APT-LIVE-1-1", status: "paid" });
  db.failQueries.add("invoices.workOrderId");
  const replay = await lifecycle.cancelAppointment({ appointmentId: "APT-LIVE-1", reason: "Correct Project slots" });
  assert.equal(replay.replayed, true);
  assert.equal(db.writes, writes);

  const inconsistent = fixture({ "appointments/APT-LIVE-1": appointment });
  await assert.rejects(() => inconsistent.lifecycle.cancelAppointment({ appointmentId: "APT-LIVE-1", reason: "Correct Project slots" }), /identity.*reconciled/i);
  assert.equal(inconsistent.db.writes, 0);
});

test("customer reschedule revalidates capacity and preserves Work Order fields owned by other domains", async () => {
  const { db, lifecycle, provider } = fixture({ "bookingOffers/OFR-RESCHEDULE-1": openOffer() });
  const result = await lifecycle.rescheduleAppointment({
    appointmentId: "APT-LIVE-1",
    offerId: "OFR-RESCHEDULE-1",
    offerVersion: 1,
    optionId: "OPT-NEW",
    reason: "Customer requested another date",
    actor: { id: "owner-1", name: "Owner" },
  });
  assert.equal(result.success, true);
  assert.equal(provider.revalidationCalls, 1);
  assert.equal(result.appointmentId, "APT-LIVE-1");
  assert.equal(result.changeKind, "customer_reschedule");
  assert.equal(result.customerNotificationRecommended, true);
  const appointment = db.read("appointments/APT-LIVE-1");
  assert.equal(appointment.date, "2098-12-22");
  assert.equal(appointment.startTime, "13:30");
  assert.equal(appointment.endTime, "15:30");
  assert.equal(appointment.capacityEndTime, "16:30");
  assert.equal(appointment.assignments[0].capacityEndTime, "16:30");
  assert.equal(result.appointment.capacityEndTime, "16:30");
  assert.equal(appointment.primaryVanId, "VAN-2");
  assert.equal(appointment.lastScheduleChangeKind, "customer_reschedule");
  const workOrder = db.read("workOrders/WO-APT-LIVE-1-1");
  assert.equal(workOrder.date, "2098-12-22");
  assert.equal(workOrder.vanId, "VAN-2");
  assert.equal(workOrder.whatsappNotificationsEnabled, true);
  assert.deepEqual(workOrder.notificationRecipients, [{ id: "client-1", sendConfirmation: true, sendReminder: true }]);
  assert.deepEqual(workOrder.confirmationNotifications, { queueIds: ["confirmation-existing"] });
  assert.deepEqual(workOrder.reminderNotifications, { queueIds: ["reminder-existing"] });
  assert.deepEqual(workOrder.invoiceState, { status: "pending" });
  assert.equal(db.read("bookingCapacityLocks/lock-old-0830").active, false);
  assert.equal(db.read("bookingCapacityLocks/lock-new-1330").active, true);
  assert.equal(db.read("bookingCapacityLocks/lock-new-1330").appointmentId, "APT-LIVE-1");
  assert.equal(db.read("bookingOffers/OFR-RESCHEDULE-1").appointmentId, "APT-LIVE-1");
});

test("operational drag uses its server-created offer directly and skips duplicate provider revalidation", async () => {
  const { db, lifecycle, provider } = fixture({ "bookingOffers/OFR-RESCHEDULE-1": operationalOffer() });
  const result = await lifecycle.rescheduleAppointment({
    appointmentId: "APT-LIVE-1",
    offerId: "OFR-RESCHEDULE-1",
    offerVersion: 1,
    optionId: "OPT-NEW",
    reason: "Operational move",
    changeKind: "operational_move",
    actor: { id: "owner-1", name: "Owner" },
  });
  assert.equal(result.success, true);
  assert.equal(provider.revalidationCalls, 0);
  assert.equal(db.read("appointments/APT-LIVE-1").date, "2098-12-20");
  assert.equal(db.read("appointments/APT-LIVE-1").primaryVanId, "VAN-2");
  assert.equal(db.read("bookingCapacityLocks/lock-new-1330").active, true);
});

test("operational drag refuses an offer whose date no longer matches the canonical appointment date", async () => {
  const { lifecycle, provider } = fixture({ "bookingOffers/OFR-RESCHEDULE-1": openOffer() });
  await assert.rejects(
    () => lifecycle.rescheduleAppointment({
      appointmentId: "APT-LIVE-1",
      offerId: "OFR-RESCHEDULE-1",
      offerVersion: 1,
      optionId: "OPT-NEW",
      reason: "Operational move",
      changeKind: "operational_move",
      actor: { id: "owner-1", name: "Owner" },
    }),
    /appointment date changed/i,
  );
  assert.equal(provider.revalidationCalls, 0);
});

test("rescheduling heals an active capacity lock detached from its previous appointment", async () => {
  const { db, lifecycle, provider } = fixture({
    "bookingOffers/OFR-RESCHEDULE-1": operationalOffer(),
    "appointments/APT-STALE": { appointmentId: "APT-STALE", status: "confirmed", capacityLockIds: [] },
    "bookingCapacityLocks/lock-new-1330": { appointmentId: "APT-STALE", active: true, date: "2098-12-20", vanId: "VAN-2", slot: "13:30" },
  });
  const result = await lifecycle.rescheduleAppointment({
    appointmentId: "APT-LIVE-1",
    offerId: "OFR-RESCHEDULE-1",
    offerVersion: 1,
    optionId: "OPT-NEW",
    reason: "Operational move",
    changeKind: "operational_move",
    actor: { id: "owner-1", name: "Owner" },
  });
  assert.equal(result.success, true);
  assert.equal(provider.revalidationCalls, 0);
  assert.equal(db.read("bookingCapacityLocks/lock-new-1330").appointmentId, "APT-LIVE-1");
  assert.equal(db.read("bookingCapacityLocks/lock-new-1330").active, true);
});

test("rescheduling still blocks capacity genuinely owned by another active appointment", async () => {
  const { lifecycle } = fixture({
    "bookingOffers/OFR-RESCHEDULE-1": operationalOffer(),
    "appointments/APT-OTHER": { appointmentId: "APT-OTHER", status: "confirmed", capacityLockIds: ["lock-new-1330"] },
    "bookingCapacityLocks/lock-new-1330": { appointmentId: "APT-OTHER", active: true, date: "2098-12-20", vanId: "VAN-2", slot: "13:30" },
  });
  await assert.rejects(
    () => lifecycle.rescheduleAppointment({
      appointmentId: "APT-LIVE-1",
      offerId: "OFR-RESCHEDULE-1",
      offerVersion: 1,
      optionId: "OPT-NEW",
      reason: "Operational move",
      changeKind: "operational_move",
      actor: { id: "owner-1", name: "Owner" },
    }),
    /owned by another active appointment/i,
  );
});

test('dwelling lifecycle preserves frozen destination and rejects a neighboring dwelling offer', async () => {
  const locationSnapshot = { dwellingId: 'dw-1', locationLabel: 'Synthetic property · Apartment 1', accessContact: { name: 'Original contact' } };
  const previous = { ...appointmentSeed(), dwellingId: 'dw-1', locationSnapshot };
  const offer = { ...openOffer(), request: { ...request(), dwellingId: 'dw-1' } };
  const { db, lifecycle } = fixture({ 'appointments/APT-LIVE-1': previous, 'bookingOffers/OFR-RESCHEDULE-1': offer });
  await lifecycle.rescheduleAppointment({ appointmentId: 'APT-LIVE-1', offerId: offer.id, offerVersion: 1, optionId: 'OPT-NEW', reason: 'Synthetic reschedule', actor: { id: 'owner-1' } });
  assert.equal(db.read('appointments/APT-LIVE-1').dwellingId, 'dw-1');
  assert.deepEqual(db.read('appointments/APT-LIVE-1').locationSnapshot, locationSnapshot);
  const wrong = fixture({ 'appointments/APT-LIVE-1': previous, 'bookingOffers/OFR-RESCHEDULE-1': { ...offer, request: { ...offer.request, dwellingId: 'dw-neighbor' } } });
  await assert.rejects(() => wrong.lifecycle.rescheduleAppointment({ appointmentId: 'APT-LIVE-1', offerId: offer.id, offerVersion: 1, optionId: 'OPT-NEW', reason: 'Wrong dwelling', actor: { id: 'owner-1' } }), /no longer matches/i);
  assert.deepEqual(wrong.db.read('appointments/APT-LIVE-1'), previous);
});

test('legacy appointment stays unclassified when property gains independent dwellings', async () => {
  const { db, lifecycle } = fixture({
    'properties/property-1': { clientId: 'client-1', address: 'Synthetic address', hasIndependentDwellings: true },
    'bookingOffers/OFR-RESCHEDULE-1': openOffer(),
  });
  await lifecycle.rescheduleAppointment({ appointmentId: 'APT-LIVE-1', offerId: 'OFR-RESCHEDULE-1', offerVersion: 1, optionId: 'OPT-NEW', reason: 'Legacy reschedule', actor: { id: 'owner-1' } });
  assert.equal(db.read('appointments/APT-LIVE-1').dwellingId, undefined);
  await lifecycle.cancelAppointment({ appointmentId: 'APT-LIVE-1', reason: 'Legacy cancellation', actor: { id: 'owner-1' } });
  assert.equal(db.read('appointments/APT-LIVE-1').status, 'cancelled');
  assert.equal(db.read('appointments/APT-LIVE-1').dwellingId, undefined);
});
