const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mayaAppointmentMutationDecisionInTransaction,
} = require("./demacCustomerAppointmentMutationGuard");

const CONVERSATION_ID = "COMM-1111111111111111111111111111111111111111";
const MESSAGE_ID = "MSG-1";

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
  ownerUserId = "",
  aiDisposition = "ai_active",
  ownershipVersion = 3,
  customerInputVersion = 8,
  receiptOwnershipVersion = 3,
  receiptCustomerInputVersion = 8,
  communicationAccountId = "demac-wa-corporate",
  activeCommunicationAccountId = "demac-wa-corporate",
} = {}) {
  return {
    businessSettings: [
      {
        id: "customer-agent",
        enabled: true,
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
      remoteConversationId: "2975600000@s.whatsapp.net",
      ownerUserId,
      aiDisposition,
      ownershipVersion,
      customerInputVersion,
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
  };
}

async function decide(options, action = "cancel_appointment") {
  const db = new FakeDb(seed(options));
  return mayaAppointmentMutationDecisionInTransaction({
    db,
    transaction: db.transaction(),
    action,
    context: { conversationId: CONVERSATION_ID, inboundMessageId: MESSAGE_ID },
  });
}

test("auto-cancel is fail-closed even while Maya owns the conversation", async () => {
  const decision = await decide({ autoCancelEnabled: false });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "auto-cancel-disabled");
});

test("auto-cancel may commit only with active account, Maya ownership, current epoch and enabled flag", async () => {
  const decision = await decide({ autoCancelEnabled: true });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "auto-cancel-enabled");
  assert.equal(decision.ownershipVersion, 3);
  assert.equal(decision.customerInputVersion, 8);
});

test("auto-reschedule has an independent feature flag", async () => {
  const off = await decide({ autoRescheduleEnabled: false }, "reschedule_appointment");
  assert.equal(off.allowed, false);
  assert.equal(off.reason, "auto-reschedule-disabled");
  const on = await decide({ autoRescheduleEnabled: true }, "reschedule_appointment");
  assert.equal(on.allowed, true);
  assert.equal(on.reason, "auto-reschedule-enabled");
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
