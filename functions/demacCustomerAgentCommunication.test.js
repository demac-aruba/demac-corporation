const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  LEASE_MS,
  automaticReplySupported,
  buildRuntimeBody,
  communicationMessageToRuntime,
  conversationIdentity,
  enqueueInbound,
  mayaOutboundReplayDecision,
  outboundDocumentId,
  outcomeConversationPatch,
  queueDocumentId,
  safeAttemptCount,
  semanticHandoffQueue,
  shouldRunAgent,
  whatsappMessageToRuntime,
} = require("./demacCustomerAgentCommunication");

const CONVERSATION_ID = "COMM-1111111111111111111111111111111111111111";

class FakeSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this._value = value;
    this.exists = value !== undefined;
  }
  data() { return this._value; }
}

class FakeRef {
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
    this.id = id;
    this.path = `${collectionName}/${id}`;
  }
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(Object.entries(seed).map(([key, value]) => [key, { ...value }]));
    this.transactionCount = 0;
  }
  collection(name) {
    return { doc: (id) => new FakeRef(this, name, id) };
  }
  async runTransaction(callback) {
    this.transactionCount += 1;
    const writes = [];
    const transaction = {
      get: async (ref) => new FakeSnapshot(ref, this.docs.get(ref.path)),
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const current = this.docs.get(write.ref.path) || {};
      this.docs.set(write.ref.path, write.merge ? { ...current, ...write.value } : { ...write.value });
    }
    return result;
  }
  read(path) { return this.docs.get(path); }
}

function inboundMessage(overrides = {}) {
  return {
    conversationId: CONVERSATION_ID,
    communicationAccountId: "demac-wa-corporate",
    provider: "wacli",
    direction: "inbound",
    customerInputVersion: 3,
    text: "Hola",
    ...overrides,
  };
}

test("automatic replies are explicitly enabled only for the current wacli sender", () => {
  assert.equal(automaticReplySupported("wacli"), true);
  assert.equal(automaticReplySupported("WACLI"), true);
  assert.equal(automaticReplySupported("meta"), false);
  assert.equal(automaticReplySupported(""), false);
});

test("agent runs only for explicitly AI-owned unclaimed conversations", () => {
  assert.equal(shouldRunAgent({ aiDisposition: "ai_active" }), true);
  assert.equal(shouldRunAgent({ aiDisposition: "human_active" }), false);
  assert.equal(shouldRunAgent({ aiDisposition: "handoff_pending" }), false);
  assert.equal(shouldRunAgent({ aiDisposition: "ai_active", ownerUserId: "operator-1" }), false);
  assert.equal(shouldRunAgent({ aiDisposition: "ai_active", lockedByUserId: "operator-1" }), false);
  assert.equal(shouldRunAgent({}), false);
});

test("conversation identity accepts only canonical Communication Center identity", () => {
  assert.equal(conversationIdentity({ conversationId: CONVERSATION_ID, chat: "2975600000@s.whatsapp.net" }), CONVERSATION_ID);
  assert.equal(conversationIdentity({ conversationId: "conv-1", phone: "2975600000" }), "");
  assert.equal(conversationIdentity({ chat: "2975600000@s.whatsapp.net", phone: "2975600000" }), "");
});

test("queue and outbound IDs are deterministic and distinct", () => {
  const queue1 = queueDocumentId(CONVERSATION_ID, "MSG-1");
  const queue2 = queueDocumentId(CONVERSATION_ID, "MSG-1");
  const outbound1 = outboundDocumentId(CONVERSATION_ID, "MSG-1");
  const outbound2 = outboundDocumentId(CONVERSATION_ID, "MSG-1");
  assert.equal(queue1, queue2);
  assert.equal(outbound1, outbound2);
  assert.notEqual(queue1, outbound1);
  assert.match(queue1, /^CAQ-[A-F0-9]{40}$/);
  assert.match(outbound1, /^AI-[A-F0-9]{40}$/);
});

test("communication messages map to native runtime directions", () => {
  assert.deepEqual(communicationMessageToRuntime({ id: "m1", role: "customer", text: "Hola" }), {
    id: "m1", direction: "inbound", text: "Hola",
  });
  assert.deepEqual(communicationMessageToRuntime({ id: "m2", role: "operator", text: "Buenas" }), {
    id: "m2", direction: "outbound", text: "Buenas",
  });
  assert.deepEqual(communicationMessageToRuntime({ id: "m3", role: "ai", text: "Claro" }), {
    id: "m3", direction: "outbound", text: "Claro",
  });
  assert.equal(communicationMessageToRuntime({ id: "m4", role: "internal_note", text: "private" }), null);
});

test("raw WhatsApp voice mapping uses completed transcript and never audio placeholder", () => {
  assert.deepEqual(whatsappMessageToRuntime({
    messageId: "MSG-VOICE-1",
    direction: "inbound",
    mediaType: "audio",
    text: "[Audio]",
    transcriptionStatus: "completed",
    rawTranscript: "Necesito servicio",
    customerInputVersion: 4,
  }), {
    id: "MSG-VOICE-1",
    direction: "inbound",
    text: "Necesito servicio",
    customerInputVersion: 4,
  });
  assert.equal(whatsappMessageToRuntime({
    messageId: "MSG-VOICE-2",
    direction: "inbound",
    mediaType: "audio",
    text: "[Audio]",
    rawTranscript: "No debe usarse todavía",
  }), null);
});

test("runtime body carries exact communication epochs for every guarded runtime stage", () => {
  const body = buildRuntimeBody({
    conversationId: CONVERSATION_ID,
    provider: "wacli",
    conversation: {
      communicationAccountId: "demac-wa-corporate",
      phone: "2975600000",
      chatJid: "2975600000@s.whatsapp.net",
      customer: "Richard",
      ownershipVersion: 0,
      customerInputVersion: 2,
      recentMessages: [
        { id: "m0", role: "operator", text: "Buenas tardes" },
      ],
    },
    inboundMessage: {
      messageId: "MSG-1",
      conversationId: CONVERSATION_ID,
      communicationAccountId: "demac-wa-corporate",
      direction: "inbound",
      text: "Necesito servicio para dos aires",
      customerInputVersion: 2,
    },
  });
  assert.equal(body.conversationId, CONVERSATION_ID);
  assert.equal(body.communicationAccountId, "demac-wa-corporate");
  assert.equal(body.inboundMessageId, "MSG-1");
  assert.equal(body.ownershipVersion, 0);
  assert.equal(body.customerInputVersion, 2);
  assert.deepEqual(body.conversation.messages, [
    { id: "m0", direction: "outbound", text: "Buenas tardes" },
    { id: "MSG-1", direction: "inbound", text: "Necesito servicio para dos aires", customerInputVersion: 2 },
  ]);
  assert.equal(body.conversation.customerTurn.text, "Necesito servicio para dos aires");
  assert.equal(body.conversation.customerTurn.ownershipVersion, 0);
  assert.equal(body.conversation.customerTurn.customerInputVersion, 2);
});

test("runtime body fails closed on noncanonical identity or missing autonomous epochs", () => {
  assert.throws(() => buildRuntimeBody({
    conversationId: "2975600000@s.whatsapp.net",
    conversation: {},
    inboundMessage: { direction: "inbound", text: "Hola", customerInputVersion: 1 },
  }), /canonical Communication Center conversation ID/i);
  assert.throws(() => buildRuntimeBody({
    conversationId: CONVERSATION_ID,
    conversation: { communicationAccountId: "demac-wa-corporate", ownershipVersion: 0 },
    inboundMessage: { direction: "inbound", text: "Hola" },
  }), /positive customerInputVersion/i);
  assert.throws(() => buildRuntimeBody({
    conversationId: CONVERSATION_ID,
    conversation: { communicationAccountId: "demac-wa-corporate", customerInputVersion: 1 },
    inboundMessage: { direction: "inbound", text: "Hola", customerInputVersion: 1 },
  }), /ownershipVersion/i);
});

test("malformed retry counters fail to zero instead of disabling retry limits", () => {
  assert.equal(safeAttemptCount("not-a-number"), 0);
  assert.equal(safeAttemptCount(-1), 0);
  assert.equal(safeAttemptCount(3), 3);
});

test("enqueue uses a transaction and cannot reset an active processing lease", async () => {
  const messageId = "MSG-ACTIVE";
  const queueId = queueDocumentId(CONVERSATION_ID, messageId);
  const processingStartedAt = new Date(Date.now() - Math.floor(LEASE_MS / 2)).toISOString();
  const db = new FakeDb({
    [`customerAgentInboundQueue/${queueId}`]: {
      id: queueId,
      conversationId: CONVERSATION_ID,
      messageId,
      customerInputVersion: 3,
      status: "processing",
      processingStartedAt,
      leaseOwnerId: "worker-active",
      attempts: 1,
    },
  });
  const result = await enqueueInbound({ messageId, message: inboundMessage() }, db);
  assert.equal(result.completed, true);
  assert.equal(result.processing, true);
  assert.equal(db.transactionCount, 1);
  assert.equal(db.read(`customerAgentInboundQueue/${queueId}`).status, "processing");
  assert.equal(db.read(`customerAgentInboundQueue/${queueId}`).leaseOwnerId, "worker-active");
});

test("terminal failed inbound queue item cannot be resurrected by provider replay", async () => {
  const messageId = "MSG-FAILED";
  const queueId = queueDocumentId(CONVERSATION_ID, messageId);
  const db = new FakeDb({
    [`customerAgentInboundQueue/${queueId}`]: {
      id: queueId,
      conversationId: CONVERSATION_ID,
      messageId,
      customerInputVersion: 3,
      status: "failed",
      attempts: 5,
    },
  });
  const result = await enqueueInbound({ messageId, message: inboundMessage() }, db);
  assert.equal(result.completed, true);
  assert.equal(db.read(`customerAgentInboundQueue/${queueId}`).status, "failed");
  assert.equal(db.read(`customerAgentInboundQueue/${queueId}`).attempts, 5);
});

test("expired processing lease may be deliberately recovered without losing retry count", async () => {
  const messageId = "MSG-EXPIRED";
  const queueId = queueDocumentId(CONVERSATION_ID, messageId);
  const db = new FakeDb({
    [`customerAgentInboundQueue/${queueId}`]: {
      id: queueId,
      conversationId: CONVERSATION_ID,
      messageId,
      customerInputVersion: 3,
      status: "processing",
      processingStartedAt: new Date(Date.now() - LEASE_MS - 1000).toISOString(),
      leaseOwnerId: "worker-expired",
      attempts: 2,
    },
  });
  const result = await enqueueInbound({ messageId, message: inboundMessage() }, db);
  assert.equal(result.completed, false);
  const current = db.read(`customerAgentInboundQueue/${queueId}`);
  assert.equal(current.status, "queued");
  assert.equal(current.attempts, 2);
});

test("Maya outbound replay is accepted only for the exact same command and live/sent lifecycle", () => {
  const expected = {
    communicationAccountId: "demac-wa-corporate",
    conversationId: CONVERSATION_ID,
    sourceInboundMessageId: "MSG-1",
    to: "2975600000@s.whatsapp.net",
    text: "Claro, podemos ayudar.",
    expectedOwnershipVersion: 0,
    expectedCustomerInputVersion: 3,
  };
  const existing = {
    provider: "wacli",
    outboundClass: "conversation_maya",
    status: "processing",
    ...expected,
  };
  assert.equal(mayaOutboundReplayDecision({ existing, expected }).allowed, true);
  assert.equal(mayaOutboundReplayDecision({ existing: { ...existing, status: "sent" }, expected }).allowed, true);
  assert.equal(mayaOutboundReplayDecision({ existing: { ...existing, text: "Different text" }, expected }).reason, "outbound-command-conflict");
  assert.equal(mayaOutboundReplayDecision({ existing: { ...existing, status: "failed" }, expected }).reason, "outbound-terminal-failure");
  assert.equal(mayaOutboundReplayDecision({ existing: { ...existing, status: "mystery" }, expected }).reason, "outbound-status-not-replayable");
});

test("normal agent result returns conversation to waiting_customer under AI ownership", () => {
  const patch = outcomeConversationPatch({
    metadata: { outcome: "reply", requiresHuman: false, appointmentId: "" },
  });
  assert.equal(patch.aiDisposition, "ai_active");
  assert.equal(patch.status, "waiting_customer");
  assert.equal(patch.agentLastOutcome, "reply");
  assert.equal(patch.agentLastHandoffQueue, null);
  assert.equal(patch.agentLastHandoffReason, null);
});

test("semantic handoff requests human attention without fabricating human ownership", () => {
  const patch = outcomeConversationPatch({
    metadata: {
      outcome: "handoff",
      requiresHuman: true,
      appointmentId: "APT-1",
      handoffQueue: "finance",
      handoffReason: "Customer disputes payment allocation for an open invoice.",
    },
  });
  assert.equal(patch.aiDisposition, "handoff_pending");
  assert.equal(patch.status, "escalated");
  assert.equal(patch.queue, "finance");
  assert.equal(patch.routeReason, "Customer disputes payment allocation for an open invoice.");
  assert.equal(patch.agentLastHandoffQueue, "finance");
  assert.equal(patch.agentLastAppointmentId, "APT-1");
});

test("Communication Center validates queue contract without interpreting customer language", () => {
  assert.equal(semanticHandoffQueue("technical"), "technical");
  assert.equal(semanticHandoffQueue("complaints"), "complaints");
  assert.equal(semanticHandoffQueue("commercial_vip"), "manager");
  assert.equal(semanticHandoffQueue("invented-queue"), "manager");
  assert.equal(semanticHandoffQueue(""), "manager");
});

test("internal Customer Agent module is a service and no longer declares parallel Firestore triggers", () => {
  const source = fs.readFileSync(path.join(__dirname, "demacCustomerAgentCommunication.js"), "utf8");
  assert.doesNotMatch(source, /onDocumentCreated|onDocumentUpdated/);
  assert.doesNotMatch(source, /exports\.processCustomerAgentInbound\s*=/);
  assert.doesNotMatch(source, /exports\.processCustomerAgentReactivation\s*=/);
});
