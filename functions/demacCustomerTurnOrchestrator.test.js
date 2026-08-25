const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const {
  DEFAULT_DEBOUNCE_MS,
  configuredDebounceMs,
  createCustomerTurnOrchestrator,
  eligibleAtMillis,
  latestDeferredTurn,
} = require("./demacCustomerTurnOrchestrator");

const CONVERSATION_ID = "COMM-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ACCOUNT_ID = "demac-wa-corporate";
const PHONE = "2975600000";

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

function settings(overrides = {}) {
  return {
    id: "customer-agent",
    enabled: true,
    observationEnabled: true,
    autoReplyEnabled: true,
    replyMode: "pilot",
    autoReplyAllowlist: [PHONE],
    debounceMs: 12_000,
    ...overrides,
  };
}

function seed(overrides = {}) {
  return {
    businessSettings: [
      settings(overrides.settings),
      { id: "whatsapp", communicationAccountId: ACCOUNT_ID },
    ],
    communicationConversations: [{
      id: CONVERSATION_ID,
      conversationId: CONVERSATION_ID,
      communicationAccountId: ACCOUNT_ID,
      provider: "wacli",
      channel: "whatsapp",
      phone: PHONE,
      chatJid: `${PHONE}@s.whatsapp.net`,
      customerInputVersion: overrides.customerInputVersion || 1,
      ownershipVersion: overrides.ownershipVersion ?? 0,
      aiDisposition: "ai_active",
      recentMessages: [],
    }],
    whatsappMessages: [],
    customerAgentInboundQueue: [],
  };
}

function inbound(id, version, receivedAtMs) {
  return {
    id,
    messageId: id,
    conversationId: CONVERSATION_ID,
    communicationAccountId: ACCOUNT_ID,
    provider: "wacli",
    channel: "whatsapp",
    direction: "inbound",
    phone: PHONE,
    chat: `${PHONE}@s.whatsapp.net`,
    text: `Message ${version}`,
    customerInputVersion: version,
    firstReceivedAt: { toMillis: () => receivedAtMs },
  };
}

function harness({ now = 1_000_000, autoReplyEnabled = true, observerHook = null } = {}) {
  let clockNow = now;
  const db = new FakeDb(seed({ settings: { autoReplyEnabled } }));
  const taskCalls = [];
  const observerCalls = [];
  const runtimeCalls = [];
  const taskQueue = {
    async enqueue(data, options) { taskCalls.push({ data, options }); },
  };
  const agentCommunication = {
    AGENT_QUEUE_COLLECTION: "customerAgentInboundQueue",
    async enqueueInbound({ messageId, message, reactivate = false }, database) {
      const ref = database.collection("customerAgentInboundQueue").doc(`Q-${messageId}`);
      const current = database.read("customerAgentInboundQueue", `Q-${messageId}`) || {};
      if (["processed", "coalesced", "skipped_policy", "failed"].includes(current.status)) {
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
        reactivated: reactivate,
      }, { merge: true });
      return { ref, queueId: ref.id, conversationId: message.conversationId, completed: false, processing: false };
    },
    shouldRunAgent(conversation) {
      return conversation.aiDisposition === "ai_active" && !conversation.ownerUserId && !conversation.lockedByUserId;
    },
    latestCustomerMessage(conversation) {
      return [...(conversation.recentMessages || [])].reverse().find((item) => item.role === "customer") || null;
    },
    async processQueueEvent({ messageId, message }) {
      runtimeCalls.push({ messageId, version: message.customerInputVersion });
      await db.collection("customerAgentInboundQueue").doc(`Q-${messageId}`).set({ status: "processed" }, { merge: true });
      return { processed: true, messageId };
    },
  };
  const observerProcessor = async (args) => {
    observerCalls.push({
      messageId: args.messageId,
      expectedOwnershipVersion: args.expectedOwnershipVersion,
      expectedCustomerInputVersion: args.expectedCustomerInputVersion,
    });
    if (observerHook) await observerHook({ db, args });
    return { observed: true, observation: { intent: "general_question" } };
  };
  const orchestrator = createCustomerTurnOrchestrator({
    database: db,
    taskQueue,
    observerProcessor,
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

async function persistMessage(h, message) {
  await h.db.collection("whatsappMessages").doc(message.id).set(message);
}

async function setConversationVersion(h, version) {
  await h.db.collection("communicationConversations").doc(CONVERSATION_ID).set({ customerInputVersion: version }, { merge: true });
}

test("debounce defaults to 12 seconds and rejects configuration outside the approved 10-15 second window", () => {
  assert.equal(configuredDebounceMs({}), DEFAULT_DEBOUNCE_MS);
  assert.equal(configuredDebounceMs({ debounceMs: 10_000 }), 10_000);
  assert.equal(configuredDebounceMs({ debounceMs: 15_000 }), 15_000);
  assert.equal(configuredDebounceMs({ debounceMs: 9_999 }), DEFAULT_DEBOUNCE_MS);
  assert.equal(configuredDebounceMs({ debounceMs: 15_001 }), DEFAULT_DEBOUNCE_MS);
});

test("eligibleAt is derived from immutable first-received time rather than trigger execution time", () => {
  const message = inbound("MSG-1", 1, 2_000_000);
  assert.equal(eligibleAtMillis({ message, settings: { debounceMs: 12_000 }, now: 9_000_000 }), 2_012_000);
});

test("latest deferred customer input wins even when an older task wakes first", async () => {
  const start = 1_000_000;
  const h = harness({ now: start });
  const first = inbound("MSG-1", 1, start);
  await persistMessage(h, first);
  await setConversationVersion(h, 1);
  await h.orchestrator.scheduleInboundTurn({ messageId: first.id, message: first });

  const second = inbound("MSG-2", 2, start + 6_000);
  await persistMessage(h, second);
  await setConversationVersion(h, 2);
  h.setNow(start + 6_000);
  await h.orchestrator.scheduleInboundTurn({ messageId: second.id, message: second });

  const selected = latestDeferredTurn([
    { id: "Q-MSG-1", ...h.db.read("customerAgentInboundQueue", "Q-MSG-1") },
    { id: "Q-MSG-2", ...h.db.read("customerAgentInboundQueue", "Q-MSG-2") },
  ]);
  assert.equal(selected.messageId, "MSG-2");

  h.setNow(start + 12_000);
  const early = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(early.processed, false);
  assert.equal(early.reason, "turn-not-eligible-yet");
  assert.equal(h.observerCalls.length, 0);
  assert.equal(h.runtimeCalls.length, 0);
  assert.ok(h.taskCalls.length >= 3, "early wake must schedule the latest turn for its own eligibleAt");

  h.setNow(start + 18_000);
  const final = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(final.processed, true);
  assert.deepEqual(h.observerCalls, [{ messageId: "MSG-2", expectedOwnershipVersion: 0, expectedCustomerInputVersion: 2 }]);
  assert.deepEqual(h.runtimeCalls, [{ messageId: "MSG-2", version: 2 }]);
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-1").status, "coalesced");
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-2").status, "processed");
});

test("Observer always runs before Reply Policy can suppress the customer-facing runtime", async () => {
  const start = 2_000_000;
  const h = harness({ now: start, autoReplyEnabled: false });
  const message = inbound("MSG-OBSERVE", 1, start);
  await persistMessage(h, message);
  await setConversationVersion(h, 1);
  await h.orchestrator.scheduleInboundTurn({ messageId: message.id, message });
  h.setNow(start + 12_000);

  const result = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(result.processed, false);
  assert.equal(result.reason, "reply-policy-blocked:auto-reply-disabled");
  assert.equal(h.observerCalls.length, 1);
  assert.equal(h.runtimeCalls.length, 0);
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-OBSERVE").status, "skipped_policy");
});

test("a newer customer input arriving during Observer suppresses the stale runtime turn", async () => {
  const start = 3_000_000;
  const h = harness({
    now: start,
    observerHook: async ({ db }) => {
      await db.collection("communicationConversations").doc(CONVERSATION_ID).set({ customerInputVersion: 2 }, { merge: true });
    },
  });
  const message = inbound("MSG-STALE", 1, start);
  await persistMessage(h, message);
  await setConversationVersion(h, 1);
  await h.orchestrator.scheduleInboundTurn({ messageId: message.id, message });
  h.setNow(start + 12_000);

  const result = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(result.processed, false);
  assert.equal(result.reason, "stale-communication-epoch-after-observer");
  assert.equal(result.epochReason, "customer-input-version-changed");
  assert.equal(h.observerCalls.length, 1);
  assert.equal(h.runtimeCalls.length, 0);
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-STALE").status, "coalesced");
});

test("human takeover during debounce invalidates the pending turn before Observer or Runtime", async () => {
  const start = 3_500_000;
  const h = harness({ now: start });
  const message = inbound("MSG-TAKEOVER", 1, start);
  await persistMessage(h, message);
  await setConversationVersion(h, 1);
  const scheduled = await h.orchestrator.scheduleInboundTurn({ messageId: message.id, message });
  assert.equal(scheduled.ownershipVersion, 0);

  await h.db.collection("communicationConversations").doc(CONVERSATION_ID).set({
    ownershipVersion: 1,
    ownerUserId: "operator-1",
    lockedByUserId: "operator-1",
    aiDisposition: "human_active",
  }, { merge: true });
  h.setNow(start + 12_000);

  const result = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(result.processed, false);
  assert.equal(result.reason, "stale-communication-epoch-before-debounce-wakeup");
  assert.equal(result.epochReason, "ownership-version-changed");
  assert.equal(result.status, "skipped_human");
  assert.equal(h.observerCalls.length, 0);
  assert.equal(h.runtimeCalls.length, 0);
});

test("takeover then return cannot revive the old deferred epoch without a fresh reactivation schedule", async () => {
  const start = 3_750_000;
  const h = harness({ now: start });
  const message = inbound("MSG-TAKEOVER-RETURN", 1, start);
  await persistMessage(h, message);
  await setConversationVersion(h, 1);
  await h.orchestrator.scheduleInboundTurn({ messageId: message.id, message });

  await h.db.collection("communicationConversations").doc(CONVERSATION_ID).set({
    ownershipVersion: 2,
    ownerUserId: null,
    lockedByUserId: null,
    aiDisposition: "ai_active",
  }, { merge: true });
  h.setNow(start + 12_000);

  const result = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(result.processed, false);
  assert.equal(result.epochReason, "ownership-version-changed");
  assert.equal(h.observerCalls.length, 0);
  assert.equal(h.runtimeCalls.length, 0);
});

test("duplicate task wake after a processed turn cannot execute Runtime twice", async () => {
  const start = 4_000_000;
  const h = harness({ now: start });
  const message = inbound("MSG-ONCE", 1, start);
  await persistMessage(h, message);
  await setConversationVersion(h, 1);
  await h.orchestrator.scheduleInboundTurn({ messageId: message.id, message });
  h.setNow(start + 12_000);

  const first = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  const duplicate = await h.orchestrator.wakeConversationTurn({ conversationId: CONVERSATION_ID });
  assert.equal(first.processed, true);
  assert.equal(duplicate.processed, false);
  assert.equal(duplicate.reason, "no-deferred-turn");
  assert.equal(h.runtimeCalls.length, 1);
});

test("reactivation creates a fresh deferred eligibility window instead of immediate processing", async () => {
  const start = 5_000_000;
  const h = harness({ now: start });
  const message = inbound("MSG-REACTIVATE", 3, start - 60_000);
  await persistMessage(h, message);
  await h.db.collection("communicationConversations").doc(CONVERSATION_ID).set({
    customerInputVersion: 3,
    ownershipVersion: 4,
    recentMessages: [{ id: message.id, role: "customer", customerInputVersion: 3 }],
  }, { merge: true });

  const result = await h.orchestrator.scheduleConversationReactivation(CONVERSATION_ID, h.db.read("communicationConversations", CONVERSATION_ID));
  assert.equal(result.scheduled, true);
  assert.equal(result.ownershipVersion, 4);
  assert.equal(result.eligibleAtMs, start + 12_000);
  assert.equal(h.runtimeCalls.length, 0);
  assert.equal(h.db.read("customerAgentInboundQueue", "Q-MSG-REACTIVATE").status, "deferred");
});
