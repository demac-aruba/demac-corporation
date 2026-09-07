const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES,
  CUSTOMER_REQUESTED_CANCELLATION_REASON,
  compactAppointmentForChange,
  createCustomerAppointmentLifecycleTools,
  requireMutationContext,
} = require("./demacCustomerAppointmentLifecycleTools");
const { createCommunicationCaseService } = require("./demacCommunicationCaseService");
const { BOOKING_COLLECTIONS } = require("./bookingAuthorityFirestore");
const { orderBlocksCapacity } = require("./bookingSchedulingPrimitives");
const { createMayaGuardedBookingDb, mutationReceiptIdentity } = require("./demacCustomerAppointmentMutationGuard");
const { BookingAuthorityError } = require("./bookingAuthorityCore");

test("appointment lifecycle tools expose context read plus canonical cancel and reschedule commands", () => {
  assert.deepEqual(CUSTOMER_APPOINTMENT_LIFECYCLE_TOOL_NAMES, {
    GET_APPOINTMENT_CHANGE_CONTEXT: "get_appointment_change_context",
    CANCEL_APPOINTMENT: "cancel_appointment",
    RESCHEDULE_APPOINTMENT: "reschedule_appointment",
  });
});

test("appointment lifecycle mutation context fails closed without the exact inbound message identity", () => {
  assert.throws(
    () => requireMutationContext({ conversationId: "COMM-1" }),
    (error) => error instanceof BookingAuthorityError
      && error.details.conversationIdPresent === true
      && error.details.inboundMessageIdPresent === false,
  );
  assert.doesNotThrow(() => requireMutationContext({ conversationId: "COMM-1", inboundMessageId: "MSG-1" }));
});

test("appointment-change context exposes scheduling facts without technician/internal assignment details", () => {
  const compact = compactAppointmentForChange({
    id: "APT-1",
    customerId: "C-1",
    propertyId: "P-1",
    status: "confirmed",
    date: "2026-08-29",
    startTime: "09:30",
    endTime: "10:30",
    workLines: [{ id: "w1", presetId: "standard_service", serviceId: "s1", quantity: 1 }],
    constraints: { requestedDate: "2026-08-29" },
    assignments: [{ vanId: "van-1", technicianIds: ["secret-tech"] }],
  });
  assert.equal(compact.id, "APT-1");
  assert.equal(compact.workLines[0].presetId, "standard_service");
  assert.equal("assignments" in compact, false);
});

// Composition tests use the actual Case service, mutation guard, customer tools,
// Booking Authority cancellation and dispatch safety. Only persistence and the
// already-parsed Observer output are test doubles; no provider/model is called.
class Snapshot {
  constructor(ref, value) { this.ref = ref; this.id = ref.id; this.value = value; this.exists = value !== undefined; }
  data() { return this.exists ? { ...this.value } : undefined; }
}
class Ref {
  constructor(db, name, id) { this.db = db; this.name = name; this.id = id; this.path = `${name}/${id}`; }
  async get() { return this.db.snapshot(this); }
}
class Query {
  constructor(db, name, filters = [], max = Infinity) { this.db = db; this.name = name; this.filters = filters; this.max = max; }
  where(field, op, value) {
    assert.equal(op, "==");
    return new Query(this.db, this.name, [...this.filters, { field, value }], this.max);
  }
  limit(max) { return new Query(this.db, this.name, this.filters, max); }
  async get() { return this.db.query(this); }
}
class Collection extends Query { doc(id) { return new Ref(this.db, this.name, id); } }
class MemoryDb {
  constructor(seed) {
    this.docs = new Map();
    this.commits = 0;
    for (const [name, values] of Object.entries(seed)) for (const value of values) this.docs.set(`${name}/${value.id}`, { ...value });
  }
  collection(name) { return new Collection(this, name); }
  snapshot(ref) { return new Snapshot(ref, this.docs.get(ref.path)); }
  query(query) {
    const docs = [];
    for (const [path, value] of this.docs) {
      if (!path.startsWith(`${query.name}/`)) continue;
      if (!query.filters.every(({ field, value: expected }) => value[field] === expected)) continue;
      docs.push(this.snapshot(new Ref(this, query.name, path.slice(query.name.length + 1))));
    }
    return { docs: docs.slice(0, query.max) };
  }
  read(name, id) { return this.docs.get(`${name}/${id}`); }
  patch(name, id, patch) { this.docs.set(`${name}/${id}`, { ...this.read(name, id), ...patch }); }
  values(name) { return this.query(new Query(this, name)).docs.map((doc) => doc.data()); }
  async runTransaction(callback) {
    const writes = [];
    const result = await callback({
      get: async (target) => {
        assert.equal(writes.length, 0, "Firestore transactions must complete every read before writing");
        return target instanceof Query ? this.query(target) : this.snapshot(target);
      },
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
    });
    if (this.failNextCommit) { this.failNextCommit = false; throw new Error("simulated atomic commit failure"); }
    for (const { ref, value, merge } of writes) {
      this.docs.set(ref.path, merge ? { ...this.docs.get(ref.path), ...value } : { ...value });
    }
    this.commits += 1;
    return result;
  }
}

const CID = "COMM-2222222222222222222222222222222222222222";
const MID = "MSG-CANCEL-RECOVERY";
const AID = "APT-RECOVERY";
const ACCOUNT = "demac-wa-test";
const PHONE = "2975600000";
const DAY = "2026-09-08";
const CONTEXT = { conversationId: CID, inboundMessageId: MID };
const CANCEL_ARGS = { appointmentId: AID, reason: "", note: "" };

function recoverySeed() {
  return {
    businessSettings: [
      { id: "customer-agent", enabled: true, autoReplyEnabled: true, replyMode: "allowlist", autoReplyAllowlist: [PHONE], autoCancelEnabled: true, autoRescheduleEnabled: false },
      { id: "whatsapp", communicationAccountId: ACCOUNT },
    ],
    communicationConversations: [{ id: CID, communicationAccountId: ACCOUNT, provider: "wacli", channel: "whatsapp", remoteConversationId: `${PHONE}@s.whatsapp.net`, phone: PHONE, aiDisposition: "ai_active", ownershipVersion: 2, customerInputVersion: 7 }],
    customerAgentInboundQueue: [{ id: "CAQ-RECOVERY", conversationId: CID, messageId: MID, communicationAccountId: ACCOUNT, expectedOwnershipVersion: 2, expectedCustomerInputVersion: 7, status: "processing" }],
    clients: [{ id: "C-RECOVERY", name: "Controlled test customer", phone: PHONE, whatsapp: PHONE, active: true }],
    properties: [{ id: "P-RECOVERY", clientId: "C-RECOVERY", address: "Controlled test address", operationalZone: "Santa Cruz" }],
    appointments: [{ id: AID, customerId: "C-RECOVERY", propertyId: "P-RECOVERY", status: "confirmed", date: DAY, startTime: "08:30", endTime: "09:30", workLines: [{ id: "w1", presetId: "standard_service", serviceId: "s1", quantity: 1 }], workOrderIds: ["WO-RECOVERY"], capacityLockIds: ["LOCK-RECOVERY"], assignments: [{ vanId: "VAN-1", time: "08:30" }] }],
    workOrders: [{ id: "WO-RECOVERY", appointmentId: AID, clientId: "C-RECOVERY", propertyId: "P-RECOVERY", status: "Confirmada", date: DAY, time: "08:30", vanId: "VAN-1", appointmentDurationMinutes: 60 }],
    [BOOKING_COLLECTIONS.capacityLocks]: [{ id: "LOCK-RECOVERY", appointmentId: AID, active: true, date: DAY, slot: "08:30", vanId: "VAN-1" }],
  };
}

async function prepareRecovery({ observationPatch = {}, seedPatch = () => {} } = {}) {
  const seed = recoverySeed();
  seedPatch(seed);
  const db = new MemoryDb(seed);
  const observation = {
    intent: "cancellation", confidence: 0.97, summary: "Customer explicitly requests cancellation.", language: "es",
    requiresAttention: true, dispatchRisk: true, criticalValueAmbiguous: false, requestedDate: DAY, requestedTime: "08:30", reason: "", reasonAlreadyProvided: false,
    ...observationPatch,
  };
  const cases = createCommunicationCaseService({ db, clock: () => new Date("2026-09-07T23:00:00Z") });
  const detected = await cases.processObservation({
    communicationAccountId: ACCOUNT, conversationId: CID, conversation: db.read("communicationConversations", CID),
    message: { id: MID, messageId: MID, direction: "inbound", phone: PHONE, customerInputVersion: 7 },
    observation, expectedOwnershipVersion: 2, expectedCustomerInputVersion: 7,
  });
  // This is the projection written by the Observer communication adapter after
  // the real Case service returns; the mutation must independently reread Case.
  db.patch("communicationConversations", CID, {
    mayaLastObservedMessageId: MID, mayaCaseId: detected.caseId, mayaAttentionReason: detected.attentionReason || null,
    mayaInsight: { ...observation, caseId: detected.caseId, caseState: detected.state, appointmentId: detected.appointmentId, dispatchHoldActive: detected.dispatchHoldActive },
  });
  const tools = createCustomerAppointmentLifecycleTools({ db, schedulingProvider: {} });
  return { db, tools, detected };
}

function assertStillBooked(db) {
  assert.equal(db.read("appointments", AID).status, "confirmed");
  assert.equal(db.read("workOrders", "WO-RECOVERY").status, "Confirmada");
  assert.equal(db.read(BOOKING_COLLECTIONS.capacityLocks, "LOCK-RECOVERY").active, true);
  assert.equal(db.values("customerAgentMutationReceipts").length, 0);
}

test("explicit request -> real P0 dispatch hold -> canonical cancellation -> free capacity -> resolved Case, without a customer reason", async () => {
  const { db, tools, detected } = await prepareRecovery();
  assert.equal(detected.state, "AWAITING_CUSTOMER_DECISION");
  assert.equal(detected.dispatchHoldActive, true);
  assertStillBooked(db);
  const context = await tools.getAppointmentChangeContext({}, CONTEXT);
  assert.equal(context.appointmentId, AID);
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.appointment.status, "cancelled");
  assert.equal(db.read("appointments", AID).cancellationReason, CUSTOMER_REQUESTED_CANCELLATION_REASON);
  assert.equal(db.read("appointments", AID).dispatchHold.active, false);
  assert.equal(db.read("workOrders", "WO-RECOVERY").status, "Cancelada");
  assert.equal(orderBlocksCapacity(db.read("workOrders", "WO-RECOVERY")), false);
  assert.equal(db.read(BOOKING_COLLECTIONS.capacityLocks, "LOCK-RECOVERY").active, false);
  assert.equal(db.read("communicationCases", detected.caseId).state, "RESOLVED_CANCELLED");
  assert.equal(db.read("communicationCases", detected.caseId).dispatchHoldActive, false);
  assert.equal(db.read("communicationCases", detected.caseId).resolution.sourceMessageId, MID);
  assert.equal(db.values("customerAgentMutationReceipts").length, 1);
  assert.equal(db.values("whatsappOutboundQueue").length, 0, "this lifecycle test must never send a WhatsApp message");
});

test("duplicate cancellation replays canonical proof without another lifecycle event or capacity write", async () => {
  const { db, tools } = await prepareRecovery();
  assert.equal((await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT)).success, true);
  const commits = db.commits;
  const historyLength = db.read("appointments", AID).lifecycleHistory.length;
  const replay = await tools.invoke("cancel_appointment", { ...CANCEL_ARGS, reason: "Same customer request, reworded" }, CONTEXT);
  assert.equal(replay.success, true);
  assert.equal(replay.replayed, true);
  assert.equal(db.commits, commits);
  assert.equal(db.read("appointments", AID).lifecycleHistory.length, historyLength);
  assert.equal(db.values("customerAgentMutationReceipts").length, 1);
});

test("allowlist removal after observation prevents the actual cancellation and capacity release", async () => {
  const { db, tools } = await prepareRecovery();
  db.patch("businessSettings", "customer-agent", { autoReplyAllowlist: [] });
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, false);
  assertStillBooked(db);
});

test("human takeover or a newer customer message blocks the actual lifecycle transaction", async () => {
  for (const patch of [
    { ownerUserId: "operator-1", aiDisposition: "human_active", ownershipVersion: 3 },
    { customerInputVersion: 8 },
    { ownershipVersion: 4, ownerUserId: "", aiDisposition: "ai_active" },
  ]) {
    const { db, tools } = await prepareRecovery();
    db.patch("communicationConversations", CID, patch);
    const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
    assert.equal(result.success, false, JSON.stringify(patch));
    assertStillBooked(db);
  }
});

test("unclear customer intent cannot become a cancellation", async () => {
  const { db, tools, detected } = await prepareRecovery({ observationPatch: { criticalValueAmbiguous: true } });
  assert.equal(detected.state, "AWAITING_APPOINTMENT_CLARIFICATION");
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, false);
  assertStillBooked(db);
});

test("two plausible appointments cannot be guessed even when the model supplies one id", async () => {
  const { db, tools, detected } = await prepareRecovery({
    observationPatch: { requestedDate: "", requestedTime: "" },
    seedPatch: (seed) => seed.appointments.push({ ...seed.appointments[0], id: "APT-OTHER", startTime: "10:30", workOrderIds: [], capacityLockIds: [] }),
  });
  assert.equal(detected.state, "AWAITING_APPOINTMENT_CLARIFICATION");
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, false);
  assertStillBooked(db);
  assert.equal(db.read("appointments", "APT-OTHER").status, "confirmed");
});

test("a changed canonical Case defeats a stale, apparently valid conversation projection", async () => {
  const { db, tools, detected } = await prepareRecovery();
  db.patch("communicationCases", detected.caseId, { lastSourceMessageId: "MSG-NEWER" });
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, false);
  assertStillBooked(db);
});

test("commit failure leaves appointment, work order, hold, capacity, Case and receipt unmodified", async () => {
  const { db, tools, detected } = await prepareRecovery();
  const beforeCase = db.read("communicationCases", detected.caseId);
  db.failNextCommit = true;
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, false);
  assertStillBooked(db);
  assert.equal(db.read("appointments", AID).dispatchHold.active, true);
  assert.deepEqual(db.read("communicationCases", detected.caseId), beforeCase);
});

test("a callback without exact canonical success proof cannot resolve the Case or save partial writes", async () => {
  const { db, detected } = await prepareRecovery();
  const context = { ...CONTEXT, requestedAppointmentId: AID };
  const mutationReceipt = mutationReceiptIdentity("cancel_appointment", CANCEL_ARGS, context);
  const guarded = createMayaGuardedBookingDb({ db, action: "cancel_appointment", context, mutationReceipt });
  await assert.rejects(guarded.runTransaction(async (transaction) => {
    transaction.set(db.collection("appointments").doc(AID), { status: "cancelled" }, { merge: true });
    return { success: true, appointment: { id: "APT-WRONG", status: "cancelled" } };
  }), (error) => error instanceof BookingAuthorityError && error.details.authorizationReason === "canonical-lifecycle-proof-missing");
  assertStillBooked(db);
  assert.equal(db.read("communicationCases", detected.caseId).state, "AWAITING_CUSTOMER_DECISION");
});

test("a single appointment does not override a contradictory or unresolved cancellation date/time", async () => {
  for (const observationPatch of [
    { requestedDate: "2026-09-09" },
    { requestedTime: "10:30" },
    { requestedDate: "next Tuesday" },
    { requestedTime: "8:30 PM" },
  ]) {
    const { db, tools, detected } = await prepareRecovery({ observationPatch });
    assert.equal(detected.state, "AWAITING_APPOINTMENT_CLARIFICATION", JSON.stringify(observationPatch));
    assert.equal(detected.dispatchHoldActive, false);
    const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
    assert.equal(result.success, false);
    assertStillBooked(db);
  }
});

test("a clear cancellation without date/time still resolves the only upcoming appointment", async () => {
  const { db, tools } = await prepareRecovery({ observationPatch: { requestedDate: "", requestedTime: "" } });
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(db.read("appointments", AID).status, "cancelled");
});

test("a capacity lock reassigned after observation cannot be released by the cancelled appointment", async () => {
  const { db, tools } = await prepareRecovery();
  db.patch(BOOKING_COLLECTIONS.capacityLocks, "LOCK-RECOVERY", { appointmentId: "APT-OTHER" });
  const before = new Map(db.docs);
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, false);
  assert.equal(result.error.details.authorizationReason, "cancellation-capacity-link-mismatch");
  assert.deepEqual(db.docs, before);
});

test("changed work-order identity or execution status blocks cancellation without overwriting that work", async () => {
  for (const patch of [
    { appointmentId: "APT-OTHER" },
    { clientId: "C-OTHER" },
    { propertyId: "P-OTHER" },
    { status: "En progreso" },
    { status: "Completada" },
    { status: "unrecognized-state" },
  ]) {
    const { db, tools } = await prepareRecovery();
    db.patch("workOrders", "WO-RECOVERY", patch);
    const before = new Map(db.docs);
    const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
    assert.equal(result.success, false, JSON.stringify(patch));
    assert.deepEqual(db.docs, before);
  }
});

test("incomplete or missing cancellation links require review instead of creating partial records", async () => {
  for (const damage of [
    (db) => db.docs.delete("workOrders/WO-RECOVERY"),
    (db) => db.docs.delete(`${BOOKING_COLLECTIONS.capacityLocks}/LOCK-RECOVERY`),
    (db) => db.patch("appointments", AID, { workOrderIds: [] }),
    (db) => db.patch("appointments", AID, { capacityLockIds: ["invalid/path"] }),
    (db) => db.patch(BOOKING_COLLECTIONS.capacityLocks, "LOCK-RECOVERY", { active: false }),
  ]) {
    const { db, tools } = await prepareRecovery();
    damage(db);
    const before = new Map(db.docs);
    const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
    assert.equal(result.success, false);
    assert.deepEqual(db.docs, before);
  }
});

test("a multi-work-order cancellation releases all and only its verified capacity links", async () => {
  const { db, tools } = await prepareRecovery({ seedPatch: (seed) => {
    seed.appointments[0].workOrderIds.push("WO-SUPPORT");
    seed.appointments[0].capacityLockIds.push("LOCK-SUPPORT");
    seed.workOrders.push({ ...seed.workOrders[0], id: "WO-SUPPORT", vanId: "VAN-2" });
    seed[BOOKING_COLLECTIONS.capacityLocks].push({ ...seed[BOOKING_COLLECTIONS.capacityLocks][0], id: "LOCK-SUPPORT", vanId: "VAN-2" });
    seed[BOOKING_COLLECTIONS.capacityLocks].push({ id: "LOCK-UNRELATED", appointmentId: "APT-UNRELATED", active: true, date: DAY, vanId: "VAN-3", slot: "08:30" });
  } });
  const result = await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(db.read("workOrders", "WO-SUPPORT").status, "Cancelada");
  assert.equal(db.read(BOOKING_COLLECTIONS.capacityLocks, "LOCK-SUPPORT").active, false);
  assert.equal(db.read(BOOKING_COLLECTIONS.capacityLocks, "LOCK-RECOVERY").active, false);
  assert.equal(db.read(BOOKING_COLLECTIONS.capacityLocks, "LOCK-UNRELATED").active, true);
});

test("missing or tampered execution receipts cannot bypass canonical completion proof", async () => {
  const { db } = await prepareRecovery();
  const context = { ...CONTEXT, requestedAppointmentId: AID };
  const valid = mutationReceiptIdentity("cancel_appointment", CANCEL_ARGS, context);
  for (const mutationReceipt of [
    null,
    { ...valid, requestFingerprint: "tampered" },
    { ...valid, action: "reschedule_appointment" },
    { ...valid, conversationId: "OTHER" },
    { ...valid, appointmentId: "APT-OTHER" },
  ]) {
    assert.throws(() => createMayaGuardedBookingDb({ db, action: "cancel_appointment", context, mutationReceipt }),
      (error) => error instanceof BookingAuthorityError && error.details.authorizationReason === "canonical-mutation-receipt-required");
  }
  assertStillBooked(db);
});

test("a retry reaching the transaction after Case resolution takes the execution-replay path without running the callback", async () => {
  const { db, tools } = await prepareRecovery();
  assert.equal((await tools.invoke("cancel_appointment", CANCEL_ARGS, CONTEXT)).success, true);
  const context = { ...CONTEXT, requestedAppointmentId: AID };
  const mutationReceipt = mutationReceiptIdentity("cancel_appointment", CANCEL_ARGS, context);
  const guarded = createMayaGuardedBookingDb({ db, action: "cancel_appointment", context, mutationReceipt });
  let called = false;
  const before = new Map(db.docs);
  await assert.rejects(guarded.runTransaction(async () => { called = true; return { success: false }; }),
    (error) => error instanceof BookingAuthorityError && error.details.mayaMutationReplay === true);
  assert.equal(called, false);
  assert.deepEqual(db.docs, before);
});
