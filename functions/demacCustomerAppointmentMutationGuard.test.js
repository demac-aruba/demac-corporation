const test = require("node:test");
const assert = require("node:assert/strict");

const {
  appointmentWorkflowContextFromConversation,
  mayaAppointmentMutationDecisionInTransaction,
  mutationReceiptIdentity,
  mutationReplayDecision,
  rescheduleScopeDecision,
} = require("./demacCustomerAppointmentMutationGuard");

const CONVERSATION_ID = "COMM-1111111111111111111111111111111111111111";
const MESSAGE_ID = "MSG-1";
const APPOINTMENT_ID = "APT-1";
const OFFER_ID = "OFR-1";
const CANONICAL_WORK_LINES = [{ id: "work-1", presetId: "standard_service", serviceId: "s1", quantity: 1 }];

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
  querySnapshot(query) {
    const prefix = `${query.collectionName}/`;
    const docs = [];
    for (const [path, value] of this.docs.entries()) {
      if (!path.startsWith(prefix)) continue;
      if (!query.filters.every((filter) => value?.[filter.field] === filter.value)) continue;
      docs.push(new FakeSnapshot(new FakeRef(this, query.collectionName, path.slice(prefix.length)), value));
    }
    return { docs: docs.slice(0, query.max) };
  }
  transaction() {
    return {
      get: async (target) => target instanceof FakeQuery ? this.querySnapshot(target) : this.snapshot(target),
    };
  }
}

function seed({
  autoCancelEnabled = false,
  autoRescheduleEnabled = false,
  autoReplyEnabled = true,
  autoReplyAllowlist = ["2975600000"],
  replyMode = "allowlist",
  ownerUserId = "",
  aiDisposition = "ai_active",
  ownershipVersion = 3,
  customerInputVersion = 8,
  receiptOwnershipVersion = 3,
  receiptCustomerInputVersion = 8,
  communicationAccountId = "demac-wa-corporate",
  activeCommunicationAccountId = "demac-wa-corporate",
  workflow = "cancellation",
  workflowAppointmentId = APPOINTMENT_ID,
  observedMessageId = MESSAGE_ID,
  caseState = "APPOINTMENT_MATCHED",
  confidence = 0.97,
  dispatchHoldActive = caseState === "AWAITING_CUSTOMER_DECISION",
  attentionReason = "",
  appointmentWorkLines = CANONICAL_WORK_LINES,
  offerWorkLines = CANONICAL_WORK_LINES,
} = {}) {
  return {
    businessSettings: [
      {
        id: "customer-agent",
        enabled: true,
        autoReplyEnabled,
        replyMode,
        autoReplyAllowlist,
        autoCancelEnabled,
        autoRescheduleEnabled,
      },
      {
        id: "whatsapp",
        communicationAccountId: activeCommunicationAccountId,
      },
    ],
    communicationConversations: [{
      id: CONVERSATION_ID,
      communicationAccountId,
      provider: "wacli",
      channel: "whatsapp",
      phone: "2975600000",
      remoteConversationId: "2975600000@s.whatsapp.net",
      ownerUserId,
      aiDisposition,
      ownershipVersion,
      customerInputVersion,
      mayaLastObservedMessageId: observedMessageId,
      mayaCaseId: "CASE-1",
      mayaAttentionReason: attentionReason,
      mayaInsight: {
        intent: workflow,
        appointmentId: workflowAppointmentId,
        caseId: "CASE-1",
        caseState,
        confidence,
        dispatchHoldActive,
      },
    }],
    communicationCases: [{
      id: "CASE-1",
      caseType: "appointment_change",
      communicationAccountId,
      conversationId: CONVERSATION_ID,
      lastSourceMessageId: observedMessageId,
      appointmentId: workflowAppointmentId,
      customerId: "C-1",
      intent: workflow,
      state: caseState,
      confidence,
      dispatchHoldActive,
      attentionReason,
    }],
    customerAgentInboundQueue: [{
      id: "CAQ-1",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      communicationAccountId,
      expectedOwnershipVersion: receiptOwnershipVersion,
      expectedCustomerInputVersion: receiptCustomerInputVersion,
      customerInputVersion: receiptCustomerInputVersion,
      status: "processing",
    }],
    appointments: [{
      id: APPOINTMENT_ID,
      appointmentId: APPOINTMENT_ID,
      customerId: "C-1",
      propertyId: "P-1",
      status: "confirmed",
      workLines: appointmentWorkLines,
      dispatchHold: { active: dispatchHoldActive, caseId: "CASE-1" },
    }],
    bookingOffers: [{
      id: OFFER_ID,
      request: {
        customerId: "C-1",
        propertyId: "P-1",
        workLines: offerWorkLines,
      },
    }],
  };
}

async function decide(options = {}, action = "cancel_appointment", mutate = () => {}) {
  const workflow = action === "reschedule_appointment" ? "reschedule" : "cancellation";
  const records = seed({ workflow, ...options });
  mutate(records);
  const db = new FakeDb(records);
  return mayaAppointmentMutationDecisionInTransaction({
    db,
    transaction: db.transaction(),
    action,
    context: {
      conversationId: CONVERSATION_ID,
      inboundMessageId: MESSAGE_ID,
      requestedAppointmentId: options.requestedAppointmentId || APPOINTMENT_ID,
      requestedOfferId: options.requestedOfferId || (action === "reschedule_appointment" ? OFFER_ID : ""),
    },
  });
}

test("current appointment workflow context is bound to the exact observed inbound message", () => {
  const current = appointmentWorkflowContextFromConversation(seed().communicationConversations[0], MESSAGE_ID);
  assert.equal(current.valid, true);
  assert.equal(current.appointmentId, APPOINTMENT_ID);
  const stale = appointmentWorkflowContextFromConversation(seed().communicationConversations[0], "MSG-OLDER");
  assert.equal(stale.valid, false);
  assert.equal(stale.reason, "appointment-workflow-not-current");
});

test("auto-cancel is fail-closed even while Maya owns the conversation", async () => {
  const decision = await decide({ autoCancelEnabled: false });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "auto-cancel-disabled");
});

test("auto-cancel may commit only with active account, Maya ownership, current epoch, exact case appointment and enabled flag", async () => {
  const decision = await decide({ autoCancelEnabled: true });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "auto-cancel-enabled");
  assert.equal(decision.ownershipVersion, 3);
  assert.equal(decision.customerInputVersion, 8);
  assert.equal(decision.appointmentId, APPOINTMENT_ID);
  assert.equal(decision.caseId, "CASE-1");
});

test("auto-reschedule has an independent feature flag and matching case workflow", async () => {
  const off = await decide({ autoRescheduleEnabled: false }, "reschedule_appointment");
  assert.equal(off.allowed, false);
  assert.equal(off.reason, "auto-reschedule-disabled");
  const on = await decide({ autoRescheduleEnabled: true }, "reschedule_appointment");
  assert.equal(on.allowed, true);
  assert.equal(on.reason, "auto-reschedule-enabled");
});

test("model cannot mutate a different appointment than the Communication Case correlated", async () => {
  const decision = await decide({ autoCancelEnabled: true, requestedAppointmentId: "APT-WRONG" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "appointment-workflow-context-mismatch");
});

test("cancellation action cannot consume a reschedule workflow or vice versa", async () => {
  const decision = await decide({ autoCancelEnabled: true, workflow: "reschedule" }, "cancel_appointment");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "appointment-workflow-action-mismatch");
});

test("human takeover blocks a lifecycle mutation even when autonomy is enabled", async () => {
  const decision = await decide({ autoCancelEnabled: true, ownerUserId: "operator-1", aiDisposition: "human_active" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "human-owner-present");
});

test("takeover and return-to-Maya cannot revive a stale model decision", async () => {
  const decision = await decide({
    autoCancelEnabled: true,
    ownershipVersion: 5,
    receiptOwnershipVersion: 3,
    ownerUserId: "",
    aiDisposition: "ai_active",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "ownership-version-changed");
});

test("a newer customer message invalidates the older turn mutation", async () => {
  const decision = await decide({
    autoCancelEnabled: true,
    customerInputVersion: 9,
    receiptCustomerInputVersion: 8,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "customer-input-version-changed");
});

test("cross-account mutation attempts fail closed", async () => {
  const decision = await decide({
    autoCancelEnabled: true,
    communicationAccountId: "demac-wa-other",
    activeCommunicationAccountId: "demac-wa-corporate",
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "communication-account-not-active");
});

test("reschedule preserves exact canonical customer, property and workload", async () => {
  const changedScope = await decide({
    autoRescheduleEnabled: true,
    offerWorkLines: [{ id: "work-1", presetId: "standard_service", serviceId: "s1", quantity: 2 }],
  }, "reschedule_appointment");
  assert.equal(changedScope.allowed, false);
  assert.equal(changedScope.reason, "reschedule-workload-changed");

  assert.equal(rescheduleScopeDecision(
    { customerId: "C-1", propertyId: "P-1", workLines: CANONICAL_WORK_LINES },
    { request: { customerId: "C-1", propertyId: "P-1", workLines: CANONICAL_WORK_LINES } },
  ).allowed, true);
});

test("reschedule mutation receipt replays only while canonical appointment still matches exact committed option", () => {
  const context = { conversationId: CONVERSATION_ID, inboundMessageId: MESSAGE_ID };
  const args = {
    appointmentId: APPOINTMENT_ID,
    offerId: OFFER_ID,
    offerVersion: 2,
    optionId: "OPT-2",
    reason: "Customer requested another day",
    note: "",
  };
  const expected = mutationReceiptIdentity("reschedule_appointment", args, context);
  const receipt = { ...expected, status: "committed" };
  const appointment = {
    id: APPOINTMENT_ID,
    status: "confirmed",
    offerId: OFFER_ID,
    offerVersion: 2,
    selectedOptionId: "OPT-2",
    lastScheduleChangeKind: "customer_reschedule",
  };
  assert.equal(mutationReplayDecision({ receipt, expected, appointment }).allowed, true);
  assert.equal(mutationReplayDecision({ receipt, expected, appointment: { ...appointment, selectedOptionId: "OPT-LATER" } }).allowed, false);
});

test("retry wording may change without changing the material mutation fingerprint", () => {
  const context = { conversationId: CONVERSATION_ID, inboundMessageId: MESSAGE_ID };
  const first = mutationReceiptIdentity("cancel_appointment", {
    appointmentId: APPOINTMENT_ID,
    reason: "Customer unavailable",
    note: "Original wording",
  }, context);
  const rewritten = mutationReceiptIdentity("cancel_appointment", {
    appointmentId: APPOINTMENT_ID,
    reason: "Client cannot attend",
    note: "Different wording on retry",
  }, context);
  assert.equal(first.requestFingerprint, rewritten.requestFingerprint);
  const receipt = { ...first, status: "committed" };
  const appointment = { id: APPOINTMENT_ID, status: "cancelled" };
  assert.equal(mutationReplayDecision({ receipt, expected: rewritten, appointment }).allowed, true);
});

test("same Maya turn cannot replay a materially different reschedule mutation", () => {
  const context = { conversationId: CONVERSATION_ID, inboundMessageId: MESSAGE_ID };
  const first = mutationReceiptIdentity("reschedule_appointment", {
    appointmentId: APPOINTMENT_ID,
    offerId: OFFER_ID,
    offerVersion: 2,
    optionId: "OPT-1",
    reason: "Customer request",
    note: "",
  }, context);
  const changed = mutationReceiptIdentity("reschedule_appointment", {
    appointmentId: APPOINTMENT_ID,
    offerId: OFFER_ID,
    offerVersion: 2,
    optionId: "OPT-2",
    reason: "Customer request",
    note: "",
  }, context);
  const receipt = { ...first, status: "committed" };
  const appointment = {
    id: APPOINTMENT_ID,
    status: "confirmed",
    offerId: OFFER_ID,
    offerVersion: 2,
    selectedOptionId: "OPT-1",
    lastScheduleChangeKind: "customer_reschedule",
  };
  const decision = mutationReplayDecision({ receipt, expected: changed, appointment });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "mutation-idempotency-conflict");
});

test("explicit cancellation may consume P0's pending dispatch-hold state with exact canonical evidence", async () => {
  const decision = await decide({ autoCancelEnabled: true, caseState: "AWAITING_CUSTOMER_DECISION" });
  assert.equal(decision.allowed, true);
});

test("a pending reschedule is not consent to select a new time", async () => {
  const decision = await decide({ autoRescheduleEnabled: true, caseState: "AWAITING_CUSTOMER_DECISION" }, "reschedule_appointment");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "appointment-workflow-context-incomplete");
});

test("an ambiguous or weak cancellation cannot inherit the pending-state exception", async () => {
  for (const options of [
    { confidence: 0.5 },
    { dispatchHoldActive: false },
    { attentionReason: "critical-value-ambiguous" },
    { caseState: "AWAITING_APPOINTMENT_CLARIFICATION" },
  ]) {
    const decision = await decide({ autoCancelEnabled: true, caseState: "AWAITING_CUSTOMER_DECISION", ...options });
    assert.equal(decision.allowed, false, JSON.stringify(options));
  }
});

test("removing the pilot phone before the transaction blocks cancellation and reschedule", async () => {
  for (const action of ["cancel_appointment", "reschedule_appointment"]) {
    const decision = await decide({ autoCancelEnabled: true, autoRescheduleEnabled: true, autoReplyAllowlist: [] }, action);
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "phone-not-allowlisted");
  }
});

test("pilot workflow reply exceptions cannot authorize a non-allowlisted appointment mutation", async () => {
  const decision = await decide({ autoCancelEnabled: true, replyMode: "pilot", autoReplyAllowlist: [] }, "cancel_appointment", (records) => {
    records.businessSettings[0].cancellationAutoReplyEnabled = true;
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "mutation-phone-not-allowlisted");
});

test("the global reply kill switch also blocks appointment mutations", async () => {
  const decision = await decide({ autoCancelEnabled: true, autoReplyEnabled: false });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "auto-reply-disabled");
});

test("a conversation projection is insufficient when the canonical Case is missing", async () => {
  const decision = await decide({ autoCancelEnabled: true }, "cancel_appointment", (records) => {
    records.communicationCases = [];
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "canonical-appointment-case-missing");
});

test("canonical Case must still match account, customer, conversation, source turn, appointment and state", async () => {
  for (const patch of [
    { communicationAccountId: "another-account" },
    { conversationId: "another-conversation" },
    { lastSourceMessageId: "MSG-OLDER" },
    { appointmentId: "APT-OTHER" },
    { intent: "reschedule" },
    { state: "RESOLVED_CUSTOMER_WITHDREW_CHANGE" },
    { caseType: "complaint" },
    { customerId: "C-OTHER" },
    { attentionReason: "needs-human" },
    { confidence: 0.2 },
  ]) {
    const decision = await decide({ autoCancelEnabled: true }, "cancel_appointment", (records) => {
      Object.assign(records.communicationCases[0], patch);
    });
    assert.equal(decision.allowed, false, JSON.stringify(patch));
  }
});

test("a pending cancellation requires a still-active hold belonging to its exact Case", async () => {
  for (const hold of [{ active: false, caseId: "CASE-1" }, { active: true, caseId: "CASE-OTHER" }]) {
    const decision = await decide({ autoCancelEnabled: true, caseState: "AWAITING_CUSTOMER_DECISION" }, "cancel_appointment", (records) => {
      records.appointments[0].dispatchHold = hold;
    });
    assert.equal(decision.allowed, false);
  }
});

test("completed or already-started work is not silently cancelled as a future appointment", async () => {
  for (const status of ["completed", "in_progress", "cancelled"]) {
    const decision = await decide({ autoCancelEnabled: true }, "cancel_appointment", (records) => {
      records.appointments[0].status = status;
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "appointment-not-open-for-customer-change");
  }
});
