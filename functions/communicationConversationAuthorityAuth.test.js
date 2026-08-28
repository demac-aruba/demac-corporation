const test = require("node:test");
const assert = require("node:assert/strict");

const {
  COMMUNICATION_COMMAND_ACTIONS,
  createCommunicationConversationAuthority,
} = require("./communicationConversationAuthority");

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
  async get() { return this.db.snapshot(this); }
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(Object.entries(seed).map(([key, value]) => [key, { ...value }]));
  }
  collection(name) {
    return { doc: (id) => new FakeRef(this, name, id) };
  }
  snapshot(ref) {
    return new FakeSnapshot(ref, this.docs.get(ref.path));
  }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => this.snapshot(ref),
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const current = this.docs.get(write.ref.path) || {};
      this.docs.set(write.ref.path, write.merge ? { ...current, ...write.value } : { ...write.value });
    }
    return result;
  }
}

function authorityWith({ seed = {}, decoded = { uid: "user-1" }, verifyIdToken } = {}) {
  const db = new FakeDb(seed);
  const authority = createCommunicationConversationAuthority({
    db,
    verifyIdToken: verifyIdToken || (async () => decoded),
    clock: () => new Date("2026-08-25T05:30:00.000Z"),
  });
  return { db, authority };
}

function request({ method = "POST", authorization = "", body = {} } = {}) {
  return {
    method,
    headers: authorization ? { authorization } : {},
    body,
    get(name) {
      return name.toLowerCase() === "authorization" ? authorization : "";
    },
  };
}

test("communication authority handles preflight and wrong methods before authentication", async () => {
  const { authority } = authorityWith();
  assert.deepEqual(await authority.handle(request({ method: "OPTIONS" })), { status: 204, body: null });
  const getResult = await authority.handle(request({ method: "GET" }));
  assert.equal(getResult.status, 405);
  assert.equal(getResult.body.error.code, "method_not_allowed");
});

test("communication authority rejects a missing Firebase bearer token", async () => {
  const { authority } = authorityWith();
  const result = await authority.handle(request({
    body: { action: COMMUNICATION_COMMAND_ACTIONS.MARK_READ, data: { conversationId: "conv-1", requestId: "request-12345" } },
  }));
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, "unauthenticated");
});

test("communication authority rejects an invalid Firebase bearer token", async () => {
  const { authority } = authorityWith({
    verifyIdToken: async () => { throw new Error("invalid token"); },
  });
  const result = await authority.handle(request({
    authorization: "Bearer invalid-token",
    body: { action: COMMUNICATION_COMMAND_ACTIONS.MARK_READ, data: { conversationId: "conv-1", requestId: "request-12345" } },
  }));
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, "unauthenticated");
});

test("communication authority requires a canonical active user profile even when the token carries an allowed role", async () => {
  const { authority } = authorityWith({ decoded: { uid: "missing-user", role: "operations", email: "missing@example.com" } });
  const result = await authority.handle(request({
    authorization: "Bearer valid-token",
    body: { action: COMMUNICATION_COMMAND_ACTIONS.MARK_READ, data: { conversationId: "conv-1", requestId: "request-12345" } },
  }));
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, "permission_denied");
});

test("communication authority rejects inactive and unauthorized canonical profiles", async () => {
  for (const profile of [
    { active: false, role: "office_operator", name: "Inactive Operator" },
    { active: true, role: "technician", name: "Field Technician" },
  ]) {
    const { authority } = authorityWith({
      seed: { "users/user-1": profile },
      decoded: { uid: "user-1", role: "operations" },
    });
    const result = await authority.handle(request({
      authorization: "Bearer valid-token",
      body: { action: COMMUNICATION_COMMAND_ACTIONS.MARK_READ, data: { conversationId: "conv-1", requestId: "request-12345" } },
    }));
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, "permission_denied");
  }
});

test("communication authority accepts the canonical active profile role rather than a token role fallback", async () => {
  const { authority } = authorityWith({
    seed: { "users/user-1": { active: true, role: "office_operator", name: "Canonical Operator", email: "operator@example.com" } },
    decoded: { uid: "user-1", role: "technician", email: "token@example.com" },
  });
  const identity = await authority.authenticate(request({ authorization: "Bearer valid-token" }));
  assert.equal(identity.uid, "user-1");
  assert.equal(identity.role, "office_operator");
  assert.equal(identity.name, "Canonical Operator");
});

test("manager cannot assign a conversation to a profile that is not explicitly active", async () => {
  const { authority } = authorityWith({
    seed: {
      "communicationConversations/conv-1": {
        owner: "Operations",
        ownerUserId: "manager-1",
        lockedBy: "Operations",
        lockedByUserId: "manager-1",
        aiDisposition: "human_active",
        status: "assigned",
        ownershipVersion: 4,
        communicationAccountId: "demac-wa-corporate",
        provider: "wacli",
        chatJid: "2975600000@s.whatsapp.net",
      },
      "users/user-2": { role: "office_operator", name: "Not Explicitly Active" },
    },
  });
  await assert.rejects(
    authority.execute({
      action: COMMUNICATION_COMMAND_ACTIONS.ASSIGN,
      data: {
        conversationId: "conv-1",
        requestId: "request-assign-1",
        expectedOwnershipVersion: 4,
        target: { userId: "user-2" },
      },
      identity: { uid: "manager-1", name: "Operations", role: "operations" },
    }),
    (error) => error.code === "invalid_assignment",
  );
});
