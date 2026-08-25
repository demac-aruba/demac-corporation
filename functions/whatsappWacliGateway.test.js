const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) {
  initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });
}

const {
  claimOutboundCommandWithDb,
  conversationIngressState,
  outboundQueueAccountMatches,
} = require("./whatsappWacliGateway");

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

class FakeCollection {
  constructor(db, name, filters = []) {
    this.db = db;
    this.name = name;
    this.filters = filters;
  }
  doc(id) { return new FakeRef(this.db, this.name, id); }
  where(field, operator, value) {
    assert.equal(operator, "==");
    return new FakeCollection(this.db, this.name, [...this.filters, { field, value }]);
  }
  async get() {
    const prefix = `${this.name}/`;
    const docs = [];
    for (const [key, value] of this.db.docs.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (!this.filters.every((filter) => value?.[filter.field] === filter.value)) continue;
      const id = key.slice(prefix.length);
      docs.push(new FakeSnapshot(new FakeRef(this.db, this.name, id), value));
    }
    return { docs };
  }
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(Object.entries(seed).map(([key, value]) => [key, { ...value }]));
  }
  collection(name) { return new FakeCollection(this, name); }
  async runTransaction(callback) {
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

function outbound(overrides = {}) {
  return {
    provider: "wacli",
    communicationAccountId: "demac-wa-corporate",
    outboundClass: "conversation_maya",
    status: "queued",
    conversationId: "COMM-1111111111111111111111111111111111111111",
    expectedOwnershipVersion: 0,
    expectedCustomerInputVersion: 3,
    to: "2975600000@s.whatsapp.net",
    text: "Customer-visible reply",
    createdAt: "2026-08-25T04:00:00.000Z",
    ...overrides,
  };
}

function aiConversation(overrides = {}) {
  return {
    provider: "wacli",
    communicationAccountId: "demac-wa-corporate",
    aiDisposition: "ai_active",
    ownerUserId: null,
    lockedByUserId: null,
    ownershipVersion: 0,
    customerInputVersion: 3,
    ...overrides,
  };
}

test("new inbound WhatsApp conversations start under AI ownership", () => {
  const state = conversationIngressState({ current: {}, exists: false, inbound: true });
  assert.deepEqual(state, {
    queue: "general",
    status: "new",
    owner: null,
    ownerUserId: null,
    routeReason: null,
    aiDisposition: "ai_active",
    lockedBy: null,
    lockedByUserId: null,
  });
});

test("existing semantic queue and AI ownership are preserved without text classification", () => {
  const state = conversationIngressState({
    exists: true,
    inbound: true,
    current: {
      queue: "finance",
      status: "waiting_customer",
      aiDisposition: "ai_active",
      routeReason: "Customer Agent routed payment question to Finance.",
    },
  });
  assert.equal(state.queue, "finance");
  assert.equal(state.status, "waiting_customer");
  assert.equal(state.aiDisposition, "ai_active");
  assert.equal(state.routeReason, "Customer Agent routed payment question to Finance.");
});

test("existing human ownership always wins over AI-first defaults", () => {
  const state = conversationIngressState({
    exists: true,
    inbound: true,
    current: {
      queue: "complaints",
      status: "escalated",
      aiDisposition: "ai_active",
      owner: "Operations",
      ownerUserId: "operator-1",
      lockedByUserId: "operator-1",
      routeReason: "Human complaint review",
    },
  });
  assert.equal(state.queue, "complaints");
  assert.equal(state.status, "escalated");
  assert.equal(state.aiDisposition, "human_active");
  assert.equal(state.ownerUserId, "operator-1");
  assert.equal(state.lockedByUserId, "operator-1");
});

test("paused or handoff-pending conversations are not silently reactivated", () => {
  assert.equal(conversationIngressState({
    exists: true,
    inbound: true,
    current: { aiDisposition: "ai_paused", queue: "technical", status: "waiting_demac" },
  }).aiDisposition, "ai_paused");
  assert.equal(conversationIngressState({
    exists: true,
    inbound: true,
    current: { aiDisposition: "handoff_pending", queue: "sales", status: "escalated" },
  }).aiDisposition, "handoff_pending");
});

test("new outbound-only conversations remain human-owned", () => {
  const state = conversationIngressState({ current: {}, exists: false, inbound: false });
  assert.equal(state.queue, "general");
  assert.equal(state.status, "waiting_customer");
  assert.equal(state.aiDisposition, "human_active");
});

test("outbound polling is strictly scoped to the bridge communication account", () => {
  assert.equal(outboundQueueAccountMatches({ communicationAccountId: "demac-wa-corporate" }, "DEMAC-WA-CORPORATE"), true);
  assert.equal(outboundQueueAccountMatches({ communicationAccountId: "demac-wa-test" }, "demac-wa-corporate"), false);
  assert.equal(outboundQueueAccountMatches({}, "demac-wa-corporate"), false);
});

test("actual poll claim blocks stale Maya command before it reaches the bridge", async () => {
  const queueId = "maya-stale";
  const conversationId = outbound().conversationId;
  const db = new FakeDb({
    [`whatsappOutboundQueue/${queueId}`]: outbound(),
    [`communicationConversations/${conversationId}`]: aiConversation({ customerInputVersion: 4 }),
  });
  const command = await claimOutboundCommandWithDb(db, "bridge-1", "demac-wa-corporate", Date.parse("2026-08-25T04:30:00.000Z"));
  assert.equal(command, null);
  const current = db.read(`whatsappOutboundQueue/${queueId}`);
  assert.equal(current.status, "failed");
  assert.equal(current.errorCode, "outbound_authorization_failed");
  assert.equal(current.authorizationReason, "stale-communication-epoch");
  assert.equal(current.authorizationEpochReason, "customer-input-version-changed");
});

test("actual poll claim blocks Maya command after human takeover", async () => {
  const queueId = "maya-human-takeover";
  const conversationId = outbound().conversationId;
  const db = new FakeDb({
    [`whatsappOutboundQueue/${queueId}`]: outbound(),
    [`communicationConversations/${conversationId}`]: aiConversation({
      aiDisposition: "human_active",
      ownerUserId: "operator-1",
      ownershipVersion: 1,
    }),
  });
  const command = await claimOutboundCommandWithDb(db, "bridge-1", "demac-wa-corporate", Date.parse("2026-08-25T04:30:00.000Z"));
  assert.equal(command, null);
  assert.equal(db.read(`whatsappOutboundQueue/${queueId}`).authorizationReason, "maya-sender-ownership-invalid");
});

test("actual poll claim returns a current Maya command and leases it exactly once", async () => {
  const queueId = "maya-current";
  const conversationId = outbound().conversationId;
  const db = new FakeDb({
    [`whatsappOutboundQueue/${queueId}`]: outbound(),
    [`communicationConversations/${conversationId}`]: aiConversation(),
  });
  const now = Date.parse("2026-08-25T04:30:00.000Z");
  const command = await claimOutboundCommandWithDb(db, "bridge-1", "demac-wa-corporate", now);
  assert.equal(command.queueId, queueId);
  assert.equal(command.communicationAccountId, "demac-wa-corporate");
  assert.ok(command.claimToken);
  const current = db.read(`whatsappOutboundQueue/${queueId}`);
  assert.equal(current.status, "processing");
  assert.equal(current.claimedBy, "bridge-1");
  const duplicate = await claimOutboundCommandWithDb(db, "bridge-2", "demac-wa-corporate", now + 1000);
  assert.equal(duplicate, null, "active outbound lease prevents duplicate bridge delivery");
});

test("transactional outbound remains independent from conversational ownership", async () => {
  const queueId = "transactional-current";
  const db = new FakeDb({
    [`whatsappOutboundQueue/${queueId}`]: outbound({
      outboundClass: "transactional",
      conversationId: null,
      expectedOwnershipVersion: undefined,
      expectedCustomerInputVersion: undefined,
    }),
  });
  const command = await claimOutboundCommandWithDb(db, "bridge-1", "demac-wa-corporate", Date.parse("2026-08-25T04:30:00.000Z"));
  assert.equal(command.queueId, queueId);
  assert.equal(db.read(`whatsappOutboundQueue/${queueId}`).status, "processing");
});

test("message direction follows the Wacli FromMe message contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "whatsappWacliGateway.js"), "utf8");
  assert.match(source, /const inbound = payload\.FromMe === false;/);
  assert.doesNotMatch(source, /const inbound = payload\.IsFromMe/);
  assert.match(source, /direction: inbound \? "inbound" : "outbound"/);
  assert.match(source, /role: inbound \? "customer" : "operator"/);
});

test("gateway creates canonical account-scoped message identity before persistence", () => {
  const source = fs.readFileSync(path.join(__dirname, "whatsappWacliGateway.js"), "utf8");
  assert.match(source, /wacliCanonicalIdentity\(\{ communicationAccountId, chat, providerMessageId \}\)/);
  assert.match(source, /persistCanonicalMessage\(\{/);
  assert.doesNotMatch(source, /whatsappMessages"\)\.doc\(safeDocumentId\(messageId\)\)\.set/);
});

test("gateway requires the authenticated bridge account boundary before webhook media poll and ack work", () => {
  const source = fs.readFileSync(path.join(__dirname, "whatsappWacliGateway.js"), "utf8");
  const matches = source.match(/requireBoundCommunicationAccount\(request\)/g) || [];
  assert.ok(matches.length >= 4, `expected account binding on four connector endpoints, found ${matches.length}`);
});

test("gateway contains no language keyword router or operator auto-assignment", () => {
  const source = fs.readFileSync(path.join(__dirname, "whatsappWacliGateway.js"), "utf8");
  assert.doesNotMatch(source, /function\s+inferQueue\b/);
  assert.doesNotMatch(source, /function\s+chooseAvailableOperator\b/);
  assert.doesNotMatch(source, /communicationOperatorPresence/);
  assert.doesNotMatch(source, /Auto-routed from/);
});
