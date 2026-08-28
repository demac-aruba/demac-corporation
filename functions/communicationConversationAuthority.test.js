const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COMMUNICATION_COMMAND_ACTIONS,
  appendCommandReceipt,
  buildOwnershipPatch,
  commandRequestFingerprint,
  createCommunicationConversationAuthority,
  nextOwnershipVersion,
  outboundQueueId,
  requireCommandOwnershipVersion,
  requireExpectedOwnershipVersion,
} = require("./communicationConversationAuthority");

const owner = { uid: "user-1", name: "Yerika", role: "office_operator" };
const manager = { uid: "manager-1", name: "Operations", role: "operations" };

function conversation(overrides = {}) {
  return {
    owner: "Yerika",
    ownerUserId: "user-1",
    lockedBy: "Yerika",
    lockedByUserId: "user-1",
    aiDisposition: "human_active",
    status: "assigned",
    ownershipVersion: 4,
    communicationAccountId: "demac-wa-corporate",
    provider: "wacli",
    chatJid: "2975600000@s.whatsapp.net",
    commandRequestIds: [],
    commandRequestReceipts: [],
    ...overrides,
  };
}

class FakeSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this._value = value;
    this.exists = value !== undefined;
  }
  data() { return this.exists ? structuredClone(this._value) : undefined; }
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

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]));
  }
  collection(name) {
    return {
      doc: (id) => new FakeRef(this, name, id),
    };
  }
  snapshot(ref) {
    const value = this.docs.has(ref.path) ? this.docs.get(ref.path) : undefined;
    return new FakeSnapshot(ref, value);
  }
  mergeValue(current, patch) {
    const next = { ...(current || {}) };
    for (const [key, value] of Object.entries(patch || {})) next[key] = value;
    return next;
  }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => this.snapshot(ref),
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const current = this.docs.get(write.ref.path);
      this.docs.set(
        write.ref.path,
        structuredClone(write.merge ? this.mergeValue(current, write.value) : write.value),
      );
    }
    return result;
  }
  read(path) { return this.docs.get(path); }
}

function authorityWith(seed = {}) {
  const db = new FakeDb(seed);
  const authority = createCommunicationConversationAuthority({
    db,
    verifyIdToken: async () => ({ uid: "unused" }),
    clock: () => new Date("2026-08-25T04:30:00.000Z"),
  });
  return { db, authority };
}

function commandData(overrides = {}) {
  return {
    conversationId: "conv-1",
    requestId: "request-12345",
    expectedOwnershipVersion: 4,
    ...overrides,
  };
}

test("ownershipVersion is monotonic", () => {
  assert.equal(nextOwnershipVersion({}), 1);
  assert.equal(nextOwnershipVersion({ ownershipVersion: 4 }), 5);
});

test("human claim puts conversation under one sender authority", () => {
  const patch = buildOwnershipPatch({
    action: COMMUNICATION_COMMAND_ACTIONS.CLAIM,
    conversation: conversation({ owner: null, ownerUserId: null, lockedBy: null, lockedByUserId: null }),
    identity: owner,
    now: "2026-08-24T21:00:00.000Z",
  });
  assert.equal(patch.ownerUserId, "user-1");
  assert.equal(patch.lockedByUserId, "user-1");
  assert.equal(patch.aiDisposition, "human_active");
  assert.equal(patch.unread, 0);
});

test("non-manager cannot steal a conversation already owned by another operator", () => {
  assert.throws(() => buildOwnershipPatch({
    action: COMMUNICATION_COMMAND_ACTIONS.CLAIM,
    conversation: conversation({ owner: "Other", ownerUserId: "user-2" }),
    identity: owner,
    now: "2026-08-24T21:00:00.000Z",
  }), (error) => error.code === "conversation_already_owned");
});

test("human owner can return conversation to Maya but ownership remains explicit", () => {
  const patch = buildOwnershipPatch({
    action: COMMUNICATION_COMMAND_ACTIONS.RETURN_TO_MAYA,
    conversation: conversation(),
    identity: owner,
    now: "2026-08-24T21:00:00.000Z",
  });
  assert.equal(patch.ownerUserId, null);
  assert.equal(patch.lockedByUserId, null);
  assert.equal(patch.aiDisposition, "ai_active");
});

test("manager can close an owned conversation and Maya stays paused", () => {
  const patch = buildOwnershipPatch({
    action: COMMUNICATION_COMMAND_ACTIONS.CLOSE,
    conversation: conversation(),
    identity: manager,
    now: "2026-08-24T21:00:00.000Z",
  });
  assert.equal(patch.status, "resolved");
  assert.equal(patch.aiDisposition, "ai_paused");
  assert.equal(patch.ownerUserId, null);
});

test("stale expected ownership version is rejected before command commit", () => {
  assert.throws(
    () => requireExpectedOwnershipVersion(conversation(), 3),
    (error) => error.code === "ownership_version_changed",
  );
  assert.doesNotThrow(() => requireExpectedOwnershipVersion(conversation(), 4));
});

test("high-impact communication commands require an explicit ownership epoch", () => {
  assert.throws(
    () => requireCommandOwnershipVersion(COMMUNICATION_COMMAND_ACTIONS.SEND_REPLY, conversation(), undefined),
    (error) => error.code === "ownership_version_required",
  );
  assert.throws(
    () => requireCommandOwnershipVersion(COMMUNICATION_COMMAND_ACTIONS.CLAIM, conversation(), 3),
    (error) => error.code === "ownership_version_changed",
  );
  assert.doesNotThrow(() => requireCommandOwnershipVersion(COMMUNICATION_COMMAND_ACTIONS.MARK_READ, conversation(), undefined));
});

test("command request fingerprint binds idempotency to the actual command intent", () => {
  const first = commandRequestFingerprint(COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS, {
    expectedOwnershipVersion: 4,
    status: "waiting_customer",
  });
  const duplicate = commandRequestFingerprint(COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS, {
    expectedOwnershipVersion: 4,
    status: "waiting_customer",
  });
  const changed = commandRequestFingerprint(COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS, {
    expectedOwnershipVersion: 4,
    status: "escalated",
  });
  assert.equal(first, duplicate);
  assert.notEqual(first, changed);
});

test("bounded command receipts replace the same request id instead of duplicating it", () => {
  const first = { requestId: "request-12345", action: "claim_conversation", fingerprint: "a", ownershipVersion: 5 };
  const replacement = { ...first, fingerprint: "b" };
  assert.deepEqual(appendCommandReceipt([first], replacement), [replacement]);
});

test("outbound command id is stable and account-scoped", () => {
  const first = outboundQueueId({
    conversationId: "conv-1",
    communicationAccountId: "demac-wa-corporate",
    commandRequestId: "request-123",
  });
  const duplicate = outboundQueueId({
    conversationId: "conv-1",
    communicationAccountId: "demac-wa-corporate",
    commandRequestId: "request-123",
  });
  const otherAccount = outboundQueueId({
    conversationId: "conv-1",
    communicationAccountId: "demac-wa-test",
    commandRequestId: "request-123",
  });
  assert.equal(first, duplicate);
  assert.notEqual(first, otherAccount);
});

test("execute replays the same ownership command without incrementing ownership twice", async () => {
  const { db, authority } = authorityWith({
    "communicationConversations/conv-1": conversation({ owner: null, ownerUserId: null, lockedBy: null, lockedByUserId: null, aiDisposition: "ai_active" }),
  });
  const data = commandData();
  const first = await authority.execute({ action: COMMUNICATION_COMMAND_ACTIONS.CLAIM, data, identity: owner });
  const second = await authority.execute({ action: COMMUNICATION_COMMAND_ACTIONS.CLAIM, data, identity: owner });
  assert.equal(first.ownershipVersion, 5);
  assert.equal(second.replayed, true);
  assert.equal(second.ownershipVersion, 5);
  assert.equal(db.read("communicationConversations/conv-1").ownershipVersion, 5);
  assert.equal(db.read("communicationConversations/conv-1").commandRequestReceipts.length, 1);
});

test("execute rejects reuse of one request id for a different command intent", async () => {
  const { authority } = authorityWith({
    "communicationConversations/conv-1": conversation(),
  });
  await authority.execute({
    action: COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS,
    data: commandData({ status: "waiting_customer" }),
    identity: owner,
  });
  await assert.rejects(
    authority.execute({
      action: COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS,
      data: commandData({ status: "escalated" }),
      identity: owner,
    }),
    (error) => error.code === "request_id_conflict",
  );
});

test("generic status update cannot bypass the dedicated close transition", async () => {
  const { db, authority } = authorityWith({
    "communicationConversations/conv-1": conversation(),
  });
  await assert.rejects(
    authority.execute({
      action: COMMUNICATION_COMMAND_ACTIONS.UPDATE_STATUS,
      data: commandData({ status: "resolved" }),
      identity: owner,
    }),
    (error) => error.code === "status_transition_required",
  );
  assert.equal(db.read("communicationConversations/conv-1").status, "assigned");
  assert.equal(db.read("communicationConversations/conv-1").aiDisposition, "human_active");
});

test("manager assignment uses canonical operator identity rather than caller supplied display name", async () => {
  const { db, authority } = authorityWith({
    "communicationConversations/conv-1": conversation(),
    "users/user-2": { active: true, role: "office_operator", name: "Canonical Operator", email: "canonical@example.com" },
  });
  await authority.execute({
    action: COMMUNICATION_COMMAND_ACTIONS.ASSIGN,
    data: commandData({ target: { userId: "user-2", name: "Spoofed Name" } }),
    identity: manager,
  });
  const current = db.read("communicationConversations/conv-1");
  assert.equal(current.ownerUserId, "user-2");
  assert.equal(current.owner, "Canonical Operator");
  assert.equal(current.lockedBy, "Canonical Operator");
});

test("human send atomically creates an epoch-bound human outbound and replays from command receipt", async () => {
  const { db, authority } = authorityWith({
    "communicationConversations/conv-1": conversation(),
  });
  const data = commandData({ text: "Hello from DEMAC" });
  const first = await authority.execute({ action: COMMUNICATION_COMMAND_ACTIONS.SEND_REPLY, data, identity: owner });
  assert.ok(first.queueId);
  const queued = db.read(`whatsappOutboundQueue/${first.queueId}`);
  assert.equal(queued.outboundClass, "conversation_human");
  assert.equal(queued.expectedOwnershipVersion, 4);
  assert.equal(queued.communicationAccountId, "demac-wa-corporate");
  const replay = await authority.execute({ action: COMMUNICATION_COMMAND_ACTIONS.SEND_REPLY, data, identity: owner });
  assert.equal(replay.replayed, true);
  assert.equal(replay.queueId, first.queueId);
});

test("orphan deterministic outbound document cannot masquerade as a successful replay", async () => {
  const seedConversation = conversation();
  const queueId = outboundQueueId({
    conversationId: "conv-1",
    communicationAccountId: seedConversation.communicationAccountId,
    commandRequestId: "request-12345",
  });
  const { authority } = authorityWith({
    "communicationConversations/conv-1": seedConversation,
    [`whatsappOutboundQueue/${queueId}`]: { id: queueId, status: "queued", provider: "wacli" },
  });
  await assert.rejects(
    authority.execute({
      action: COMMUNICATION_COMMAND_ACTIONS.SEND_REPLY,
      data: commandData({ text: "Hello from DEMAC" }),
      identity: owner,
    }),
    (error) => error.code === "outbound_queue_conflict",
  );
});
