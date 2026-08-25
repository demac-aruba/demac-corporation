const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const { canonicalVoiceRuntimeMessage } = require("./demacCustomerTurn");
const { createCustomerTurnOrchestrator } = require("./demacCustomerTurnOrchestrator");

const CONVERSATION_ID = "COMM-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ACCOUNT_ID = "demac-wa-corporate";
const PHONE = "2975600000";
const REMOTE_ID = `${PHONE}@s.whatsapp.net`;

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
}

function baseConversation(overrides = {}) {
  return {
    id: CONVERSATION_ID,
    conversationId: CONVERSATION_ID,
    communicationAccountId: ACCOUNT_ID,
    provider: "wacli",
    channel: "whatsapp",
    remoteConversationId: REMOTE_ID,
    phone: PHONE,
    chatJid: REMOTE_ID,
    customerInputVersion: 1,
    ownershipVersion: 0,
    aiDisposition: "ai_active",
    ownerUserId: null,
    lockedByUserId: null,
    recentMessages: [],
    ...overrides,
  };
}

function settings() {
  return {
    id: "customer-agent",
    enabled: true,
    observationEnabled: true,
    autoReplyEnabled: true,
    replyMode: "pilot",
    autoReplyAllowlist: [PHONE],
    newContactAutoReplyEnabled: true,
    cancellationAutoReplyEnabled: true,
    rescheduleAutoReplyEnabled: true,
    debounceMs: 12_000,
  };
}

function seed(conversation = baseConversation()) {
  return {
    businessSettings: [settings(), { id: "whatsapp", communicationAccountId: ACCOUNT_ID }],
    communicationConversations: [conversation],
    whatsappMessages: [],
    customerAgentInboundQueue: [],
  };
}

function textMessage(id, version, at, text) {
  return {
    id,
    messageId: id,
    conversationId: CONVERSATION_ID,
    communicationAccountId: ACCOUNT_ID,
    provider: "wacli",
    channel: "whatsapp",
    remoteConversationId: REMOTE_ID,
    direction: "inbound",
    phone: PHONE,
    chat: REMOTE_ID,
    text,
    customerInputVersion: version,
    firstReceivedAt: { toMillis: () => at },
  };
}

function completedVoiceMessage(id, version, at, transcript) {
  return {
    ...textMessage(id, version, at, "[Audio]"),
    mediaType: "audio",
    transcriptionStatus: "completed",
    rawTranscript: transcript,
    transcript,
  };
}

function harness({ now, conversation = baseConversation() } = {}) {
  let clockNow = now;
  const db = new FakeDb(seed(conversation));
  const taskCalls = [];
  const observerCalls = [];
  const runtimeCalls = [];
  const taskQueue = {
    async enqueue(data, options) { taskCalls.push({ data, options }); },
  };
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
      runtimeCalls.push({ messageId, version: message.customerInputVersion, text: message.text || message.rawTranscript || message.transcript });
      await db.collection("customerAgentInboundQueue").doc(`Q-${messageId}`).set({ status: "processed" }, { merge: true });
      return { processed: true, messageId };
    },
  };
  const observerProcessor = async ({ messageId, message, expectedOwnershipVersion, expectedCustomerInputVersion }) => {
    observerCalls.push({
      messageId,
      text: message.text || message.rawTranscript || message.transcript,
      expectedOwnershipVersion,
      expectedCustomerInputVersion,
    });
    return { observed: true, observation: { intent: String(message.text || "").includes("reprograma") ? "reschedule" : "general_question" }, caseResult: { processed: false } };
  };
  const orchestrator = createCustomerTurnOrchestrator({
    database: db,
    taskQueue,
    observerProcessor,
    partyResolver: async () => ({ status: "new_contact", isNewContact: true, ambiguous: false, clientId: "" }),
    agentCommunication,
    clock: () => clockNow,
  });
  return {
    db,
    orchestrator,
    taskCalls,
    observerCalls,
    runtimeCalls,
    setNow(value) { clockNow = value; },
  };
}

async function persist(h, message) {
  await h.db.collection("whatsappMessages").doc(message.id).set(message);
}

async function setConversation(h, patch) {
  await h.db.collection("communicationConversations").doc(CONVERSATION_ID).set(patch, { merge: true });
}

test("P0: voice cancellation followed by reschedule text six seconds later executes only the reschedule turn", async () => {
  const start = 10_000_000;
  const h = harness({ now: start });
  const voiceStored = completedVoiceMessage("MSG-VOICE-CANCEL", 1, start, "Mi kier cancela mi cita.");
  const voiceRuntime = canonicalVoiceRuntimeMessage(voiceStored);
  assert.ok(voiceRuntime);
  await persist(h, voiceRuntime);
  await setConversation(h, { customerInputVersion: 1 });
  assert.equal((await h.orchestrator.scheduleInboundTurn({ messageId: voiceRuntime.id, message: voiceRuntime })).scheduled, true);

  const text = textMessage("MSG-TEXT-RESCHEDULE", 2, start + 6_000, "No, mi kier reprograma e cita pa otro dia.");
  await persist(h, text);
  await setConversation(h, { customerInputVersion: 2 });
  h.setNow(start + 6_000);
  assert.equal((await h.orchestrator.scheduleInboundTurn({ messageId: text.id, message: text })).scheduled, true);

  h.setNow(start + 12_000);
  const early = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(early.processed, false);
  assert.equal(early.reason, "turn-not-eligible-yet");
  assert.equal(h.observerCalls.length, 0);
  assert.equal(h.runtimeCalls.length, 0);

  h.setNow(start + 18_000);
  const final = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(final.processed, true);
  assert.deepEqual(h.observerCalls.map((item) => item.messageId), ["MSG-TEXT-RESCHEDULE"]);
  assert.deepEqual(h.runtimeCalls.map((item) => item.messageId), ["MSG-TEXT-RESCHEDULE"]);
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-VOICE-CANCEL").status, "coalesced");
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-TEXT-RESCHEDULE").status, "processed");
});

test("P0: human takeover during transcription may preserve the derived transcript but never reaches Maya Runtime", async () => {
  const start = 20_000_000;
  const humanConversation = baseConversation({
    ownershipVersion: 1,
    customerInputVersion: 1,
    aiDisposition: "human_active",
    ownerUserId: "operator-1",
    lockedByUserId: "operator-1",
  });
  const h = harness({ now: start, conversation: humanConversation });
  const voiceRuntime = canonicalVoiceRuntimeMessage(completedVoiceMessage(
    "MSG-VOICE-AFTER-TAKEOVER",
    1,
    start,
    "Mi kier cancela mi cita.",
  ));
  assert.ok(voiceRuntime);
  await persist(h, voiceRuntime);

  const scheduled = await h.orchestrator.scheduleInboundTurn({ messageId: voiceRuntime.id, message: voiceRuntime });
  assert.equal(scheduled.scheduled, true);
  assert.equal(scheduled.ownershipVersion, 1);
  h.setNow(start + 12_000);
  const result = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(result.processed, false);
  assert.equal(result.reason, "human-active-after-observer");
  assert.equal(h.observerCalls.length, 1, "Observer may still analyze the completed transcript");
  assert.equal(h.runtimeCalls.length, 0, "human ownership must block customer-facing Runtime");
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-VOICE-AFTER-TAKEOVER").status, "skipped_human");
});

test("P0: an old voice transcript completing after newer text cannot schedule stale customer work", async () => {
  const start = 30_000_000;
  const h = harness({ now: start, conversation: baseConversation({ customerInputVersion: 2 }) });
  const newerText = textMessage("MSG-NEWER-TEXT", 2, start, "Mi kier reprograma e cita.");
  await persist(h, newerText);
  assert.equal((await h.orchestrator.scheduleInboundTurn({ messageId: newerText.id, message: newerText })).scheduled, true);

  const staleVoiceRuntime = canonicalVoiceRuntimeMessage(completedVoiceMessage(
    "MSG-OLD-VOICE",
    1,
    start - 3_000,
    "Mi kier cancela mi cita.",
  ));
  assert.ok(staleVoiceRuntime);
  await persist(h, staleVoiceRuntime);
  const staleSchedule = await h.orchestrator.scheduleInboundTurn({ messageId: staleVoiceRuntime.id, message: staleVoiceRuntime });
  assert.equal(staleSchedule.scheduled, false);
  assert.equal(staleSchedule.reason, "stale-customer-turn-before-schedule");
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-OLD-VOICE"), undefined);

  h.setNow(start + 12_000);
  const result = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(result.processed, true);
  assert.deepEqual(h.observerCalls.map((item) => item.messageId), ["MSG-NEWER-TEXT"]);
  assert.deepEqual(h.runtimeCalls.map((item) => item.messageId), ["MSG-NEWER-TEXT"]);
});
