const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const { createCommunicationCaseService } = require("./demacCommunicationCaseService");
const { canonicalVoiceRuntimeMessage, customerSemanticContent } = require("./demacCustomerTurn");
const { createCustomerTurnOrchestrator } = require("./demacCustomerTurnOrchestrator");
const { customerVoiceEligibilityDecision } = require("./demacCustomerVoiceEligibility");

const ACCOUNT_ID = "demac-wa-corporate";
const CONVERSATION_ID = "COMM-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const PHONE = "2975600000";
const REMOTE_ID = `${PHONE}@s.whatsapp.net`;
const APPOINTMENT_DATE = "2026-08-26";

class Snapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this._value = value;
    this.exists = value !== undefined;
  }
  data() { return this.exists ? { ...this._value } : undefined; }
}

class Ref {
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
    this.id = id;
    this.path = `${collectionName}/${id}`;
  }
  async get() { return this.db.snapshot(this); }
  async set(value, options = {}) { this.db.write(this, value, options.merge === true); }
}

class Query {
  constructor(db, collectionName, filters = []) {
    this.db = db;
    this.collectionName = collectionName;
    this.filters = filters;
  }
  where(field, operator, value) {
    assert.equal(operator, "==");
    return new Query(this.db, this.collectionName, [...this.filters, { field, value }]);
  }
  async get() { return { docs: this.db.documents(this.collectionName, this.filters) }; }
}

class Collection extends Query {
  doc(id) { return new Ref(this.db, this.collectionName, id); }
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map();
    for (const [collectionName, values] of Object.entries(seed)) {
      for (const value of values) this.docs.set(`${collectionName}/${value.id}`, { ...value });
    }
  }
  collection(name) { return new Collection(this, name); }
  snapshot(ref) { return new Snapshot(ref, this.docs.get(ref.path)); }
  write(ref, value, merge) {
    const current = this.docs.get(ref.path) || {};
    this.docs.set(ref.path, merge ? { ...current, ...value } : { ...value });
  }
  documents(collectionName, filters = []) {
    const prefix = `${collectionName}/`;
    return [...this.docs.entries()]
      .filter(([path, value]) => path.startsWith(prefix) && filters.every((item) => value?.[item.field] === item.value))
      .map(([path, value]) => new Snapshot(new Ref(this, collectionName, path.slice(prefix.length)), value));
  }
  batch() {
    const writes = [];
    return {
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
      commit: async () => writes.forEach((write) => this.write(write.ref, write.value, write.merge)),
    };
  }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => this.snapshot(ref),
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
    };
    const result = await callback(transaction);
    writes.forEach((write) => this.write(write.ref, write.value, write.merge));
    return result;
  }
  read(collectionName, id) { return this.docs.get(`${collectionName}/${id}`); }
  values(collectionName) { return this.documents(collectionName).map((snapshot) => snapshot.data()); }
}

function conversation(overrides = {}) {
  return {
    id: CONVERSATION_ID,
    conversationId: CONVERSATION_ID,
    communicationAccountId: ACCOUNT_ID,
    provider: "wacli",
    channel: "whatsapp",
    remoteConversationId: REMOTE_ID,
    phone: PHONE,
    customerInputVersion: 1,
    ownershipVersion: 0,
    aiDisposition: "ai_active",
    ownerUserId: null,
    lockedByUserId: null,
    recentMessages: [],
    ...overrides,
  };
}

function voiceMessage(overrides = {}) {
  return {
    id: "MSG-VOICE-P0",
    messageId: "MSG-VOICE-P0",
    conversationId: CONVERSATION_ID,
    communicationAccountId: ACCOUNT_ID,
    provider: "wacli",
    channel: "whatsapp",
    remoteConversationId: REMOTE_ID,
    direction: "inbound",
    phone: PHONE,
    chat: REMOTE_ID,
    mediaType: "audio",
    text: "[Audio]",
    customerInputVersion: 1,
    firstReceivedAt: { toMillis: () => 40_000_000 },
    whatsappTimestamp: "2026-08-25T12:00:00.000Z",
    transcriptionStatus: "completed",
    rawTranscript: "Mi kier cancela mi cita.",
    transcript: "Mi kier cancela mi cita.",
    ...overrides,
  };
}

function caseSeed() {
  return {
    communicationConversations: [conversation()],
    clients: [{ id: "CUST-1", name: "Customer One", phone: PHONE, active: true }],
    contacts: [],
    appointments: [{
      id: "APT-1",
      customerId: "CUST-1",
      date: APPOINTMENT_DATE,
      startTime: "08:30",
      status: "scheduled",
      workOrderIds: ["WO-1"],
    }],
    workOrders: [{
      id: "WO-1",
      appointmentId: "APT-1",
      clientId: "CUST-1",
      status: "Confirmada",
      date: APPOINTMENT_DATE,
      time: "08:30",
    }],
  };
}

function cancellationObservation(overrides = {}) {
  return {
    intent: "cancellation",
    confidence: 0.98,
    summary: "Customer wants to cancel the scheduled visit.",
    language: "pap-aw",
    requiresAttention: true,
    dispatchRisk: true,
    criticalValueAmbiguous: false,
    requestedDate: APPOINTMENT_DATE,
    requestedTime: "08:30",
    reason: "Customer will not be available.",
    ...overrides,
  };
}

async function processVoiceCancellation({ db, observation, clock }) {
  const service = createCommunicationCaseService({ db, clock });
  const message = voiceMessage();
  return service.processObservation({
    communicationAccountId: ACCOUNT_ID,
    conversationId: CONVERSATION_ID,
    conversation: db.read("communicationConversations", CONVERSATION_ID),
    message,
    observation,
    expectedOwnershipVersion: 0,
    expectedCustomerInputVersion: 1,
  });
}

function orchestratorHarness() {
  let now = 40_000_000;
  const db = new FakeDb({
    businessSettings: [{
      id: "customer-agent",
      enabled: true,
      observationEnabled: true,
      autoReplyEnabled: true,
      replyMode: "pilot",
      autoReplyAllowlist: [PHONE],
      newContactAutoReplyEnabled: true,
      debounceMs: 12_000,
    }, { id: "whatsapp", communicationAccountId: ACCOUNT_ID }],
    communicationConversations: [conversation()],
    whatsappMessages: [],
    customerAgentInboundQueue: [],
  });
  const taskCalls = [];
  const runtimeCalls = [];
  const agentCommunication = {
    AGENT_QUEUE_COLLECTION: "customerAgentInboundQueue",
    async enqueueInbound({ messageId, message }, database) {
      const ref = database.collection("customerAgentInboundQueue").doc(`Q-${messageId}`);
      const current = database.read("customerAgentInboundQueue", `Q-${messageId}`) || {};
      if (["processed", "coalesced", "skipped_policy", "skipped_human", "failed"].includes(current.status)) {
        return { ref, queueId: ref.id, conversationId: message.conversationId, completed: true, processing: false };
      }
      await ref.set({
        id: ref.id,
        conversationId: message.conversationId,
        communicationAccountId: message.communicationAccountId,
        provider: message.provider,
        messageId,
        customerInputVersion: message.customerInputVersion,
        status: "queued",
      }, { merge: true });
      return { ref, queueId: ref.id, conversationId: message.conversationId, completed: false, processing: false };
    },
    shouldRunAgent(current) {
      return current.aiDisposition === "ai_active" && !current.ownerUserId && !current.lockedByUserId;
    },
    latestCustomerMessage(current) {
      return [...(current.recentMessages || [])].reverse().find((item) => item.role === "customer") || null;
    },
    async processQueueEvent({ messageId, message }) {
      runtimeCalls.push({ messageId, version: message.customerInputVersion });
      await db.collection("customerAgentInboundQueue").doc(`Q-${messageId}`).set({ status: "processed" }, { merge: true });
      return { processed: true, messageId };
    },
  };
  const orchestrator = createCustomerTurnOrchestrator({
    database: db,
    taskQueue: { async enqueue(data, options) { taskCalls.push({ data, options }); } },
    observerProcessor: async () => ({ observed: true, observation: { intent: "general_question" }, caseResult: { processed: false } }),
    partyResolver: async () => ({ status: "new_contact", isNewContact: true, ambiguous: false, clientId: "" }),
    agentCommunication,
    clock: () => now,
  });
  return { db, orchestrator, taskCalls, runtimeCalls, setNow(value) { now = value; } };
}

test("P0 #1: Sunday-night cancellation protects the next dispatch without permanently cancelling the appointment", async () => {
  const db = new FakeDb(caseSeed());
  const sundayNightAruba = () => new Date("2026-08-24T03:30:00.000Z");
  const result = await processVoiceCancellation({ db, observation: cancellationObservation(), clock: sundayNightAruba });

  assert.equal(result.processed, true);
  assert.equal(result.dispatchHoldActive, true);
  assert.equal(result.state, "AWAITING_CUSTOMER_DECISION");
  const appointment = db.read("appointments", "APT-1");
  assert.equal(appointment.status, "scheduled", "Observer safety cannot become permanent cancellation authority");
  assert.equal(appointment.dispatchHold.active, true);
  assert.equal(appointment.dispatchHold.requestedAction, "cancellation");
  assert.equal(db.read("workOrders", "WO-1").dispatchSafety, "do_not_dispatch");
});

test("P0 #20: the same newly completed inbound audio delivered three times executes one customer runtime turn", async () => {
  const h = orchestratorHarness();
  const voice = canonicalVoiceRuntimeMessage(voiceMessage());
  assert.ok(voice);
  await h.db.collection("whatsappMessages").doc(voice.id).set(voice);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const scheduled = await h.orchestrator.scheduleInboundTurn({ messageId: voice.id, message: voice });
    assert.equal(scheduled.scheduled, true);
  }

  assert.equal(h.db.values("customerAgentInboundQueue").length, 1, "duplicate audio wakeups must converge on one queue identity");
  h.setNow(40_012_000);
  const result = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(result.processed, true);
  assert.equal(h.runtimeCalls.length, 1);
  assert.deepEqual(h.runtimeCalls[0], { messageId: voice.id, version: 1 });
  const duplicateWake = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(duplicateWake.processed, false);
  assert.equal(h.runtimeCalls.length, 1);
});

test("P0 #23: ambiguous audio cancellation creates attention state but performs no irreversible or dispatch-hold mutation", async () => {
  const db = new FakeDb(caseSeed());
  const result = await processVoiceCancellation({
    db,
    observation: cancellationObservation({ criticalValueAmbiguous: true, summary: "Audio cancellation is ambiguous." }),
    clock: () => new Date("2026-08-25T13:00:00.000Z"),
  });

  assert.equal(result.processed, true);
  assert.equal(result.state, "AWAITING_APPOINTMENT_CLARIFICATION");
  assert.equal(result.attentionReason, "critical-value-ambiguous");
  assert.equal(result.dispatchHoldActive, false);
  const appointment = db.read("appointments", "APT-1");
  assert.equal(appointment.status, "scheduled");
  assert.equal(appointment.dispatchHold, undefined);
  assert.equal(db.read("workOrders", "WO-1").dispatchSafety, undefined);
});

test("P0 #27: failed transcription remains non-semantic and cannot become Maya customer intent", () => {
  const failed = voiceMessage({
    transcriptionStatus: "failed",
    rawTranscript: "",
    transcript: "",
    transcriptionError: "provider unavailable",
  });
  assert.equal(customerSemanticContent(failed), "");
  assert.equal(canonicalVoiceRuntimeMessage(failed), null);
});

test("P0 #29: missing voice activation cutoff fails closed", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voiceMessage({
      transcriptionStatus: undefined,
      rawTranscript: undefined,
      transcript: undefined,
      firstReceivedAt: "2026-08-25T12:00:01.000Z",
    }),
    settings: {
      voiceTranscriptionEnabled: true,
      voiceHistoricalBackfillEnabled: false,
      voiceTranscriptionVersion: "customer-voice-v1",
    },
    communicationSettings: { communicationAccountId: ACCOUNT_ID },
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "voice-activation-time-not-configured");
});
