const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compactCanonicalOffer,
  loadCustomerConversationState,
  recordCustomerConversationOutcome,
  sessionIdentity,
  toolStatePatch,
  updateCustomerConversationStateAfterTool,
} = require("./demacCustomerConversationState");

class Snap {
  constructor(id, value) { this.id = id; this.value = value; this.exists = value !== undefined; }
  data() { return this.value; }
}
class Doc {
  constructor(db, collection, id) { this.db = db; this.collection = collection; this.id = id; }
  async get() { return new Snap(this.id, this.db.map(this.collection).get(this.id)); }
  async set(value, options) {
    const map = this.db.map(this.collection);
    const current = map.get(this.id);
    map.set(this.id, options?.merge ? { ...(current || {}), ...value } : value);
  }
}
class Coll {
  constructor(db, collection) { this.db = db; this.collection = collection; }
  doc(id) { return new Doc(this.db, this.collection, id); }
}
class Db {
  constructor(seed = {}) {
    this.maps = new Map();
    for (const [collection, items] of Object.entries(seed)) {
      const map = new Map();
      for (const item of items) {
        const { id, ...rest } = item;
        map.set(id, rest);
      }
      this.maps.set(collection, map);
    }
  }
  map(collection) {
    if (!this.maps.has(collection)) this.maps.set(collection, new Map());
    return this.maps.get(collection);
  }
  collection(collection) { return new Coll(this, collection); }
  read(collection, id) { return this.map(collection).get(id); }
}

function context(overrides = {}) {
  return {
    communicationAccountId: "demac-wa-corporate",
    channel: "whatsapp",
    provider: "wacli",
    conversationId: "COMM-1",
    ...overrides,
  };
}

test("session identity is stable and account scoped", () => {
  const first = sessionIdentity(context());
  const duplicate = sessionIdentity(context());
  const otherAccount = sessionIdentity(context({ communicationAccountId: "demac-wa-test" }));
  assert.equal(first.sessionId, duplicate.sessionId);
  assert.notEqual(first.sessionId, otherAccount.sessionId);
  assert.match(first.sessionId, /^CAS-[A-F0-9]{40}$/);
});

test("session identity fails closed without canonical account/provider/conversation", () => {
  assert.equal(sessionIdentity(context({ communicationAccountId: "" })), null);
  assert.equal(sessionIdentity(context({ provider: "" })), null);
  assert.equal(sessionIdentity({ communicationAccountId: "a", provider: "wacli", contactPhone: "2975600000" }), null);
  assert.equal(sessionIdentity({ communicationAccountId: "a", provider: "wacli", contactJid: "2975600000@s.whatsapp.net" }), null);
});

test("session stores only activeOfferId/version and loads offer canonically", async () => {
  const ctx = context();
  const id = sessionIdentity(ctx).sessionId;
  const db = new Db({
    customerAgentSessions: [{ id, activeOfferId: "OFR-1", activeOfferVersion: 2, customerId: "c1" }],
    bookingOffers: [{
      id: "OFR-1",
      version: 2,
      status: "open",
      expiresAt: "2099-01-01T00:00:00Z",
      request: { customerId: "c1", propertyId: "p1", workLines: [{ presetId: "standard_service", serviceId: "s1", quantity: 2 }] },
      options: [{ id: "o1", date: "2098-12-20", time: "13:30", address: "Wayaca 217" }],
    }],
  });
  const result = await loadCustomerConversationState({ db, context: ctx, now: new Date("2098-12-01T00:00:00Z") });
  assert.equal(result.session.activeOfferId, "OFR-1");
  assert.equal(result.activeOffer.id, "OFR-1");
  assert.equal(result.activeOffer.options[0].id, "o1");
  assert.equal("activeOffer" in db.read("customerAgentSessions", id), false);
});

test("expired canonical offer is cleared from session reference", async () => {
  const ctx = context();
  const id = sessionIdentity(ctx).sessionId;
  const db = new Db({
    customerAgentSessions: [{ id, activeOfferId: "OFR-old", activeOfferVersion: 1 }],
    bookingOffers: [{ id: "OFR-old", version: 1, status: "open", expiresAt: "2020-01-01T00:00:00Z", options: [] }],
  });
  const result = await loadCustomerConversationState({ db, context: ctx, now: new Date("2026-08-16T00:00:00Z") });
  assert.equal(result.activeOffer, null);
  assert.equal(result.session.activeOfferId, "");
  assert.equal(db.read("customerAgentSessions", id).activeOfferId, "");
});

test("check availability patch references canonical offer without duplicating options", () => {
  const patch = toolStatePatch("check_availability", {}, {
    success: true,
    available: true,
    offer: {
      id: "OFR-1",
      version: 3,
      request: { customerId: "c1", propertyId: "p1", workLines: [{ presetId: "standard_service", serviceId: "s1", quantity: 2 }] },
      options: [{ id: "o1" }],
    },
  });
  assert.deepEqual(patch, {
    activeOfferId: "OFR-1",
    activeOfferVersion: 3,
    customerId: "c1",
    propertyId: "p1",
    presetId: "standard_service",
    serviceId: "s1",
    quantity: 2,
  });
  assert.equal("options" in patch, false);
});

test("appointment success clears active offer and stores appointment id", () => {
  assert.deepEqual(toolStatePatch("create_appointment", {}, { success: true, appointmentId: "APT-1" }), {
    appointmentId: "APT-1",
    activeOfferId: "",
    activeOfferVersion: 0,
  });
});

test("state updates persist canonical communication identity", async () => {
  const db = new Db();
  const ctx = context({ inboundMessageId: "MSG-1" });
  await updateCustomerConversationStateAfterTool({ db, context: ctx, toolName: "resolve_customer", result: { success: true, resolved: true, customerId: "c1" } });
  await updateCustomerConversationStateAfterTool({ db, context: ctx, toolName: "resolve_property", result: { success: true, resolved: true, propertyId: "p1" } });
  const state = db.read("customerAgentSessions", sessionIdentity(ctx).sessionId);
  assert.equal(state.customerId, "c1");
  assert.equal(state.propertyId, "p1");
  assert.equal(state.lastInboundMessageId, "MSG-1");
  assert.equal(state.communicationAccountId, "demac-wa-corporate");
  assert.equal(state.conversationId, "COMM-1");
});

test("terminal handoff outcome stores semantic routing state without changing Communication Center ownership", async () => {
  const db = new Db();
  const ctx = context();
  await recordCustomerConversationOutcome({
    db,
    context: ctx,
    outcome: "handoff",
    language: "es",
    requiresHuman: true,
    handoffQueue: "finance",
    handoffReason: "Customer disputes payment allocation.",
  });
  const state = db.read("customerAgentSessions", sessionIdentity(ctx).sessionId);
  assert.equal(state.status, "HUMAN_ACTIVE");
  assert.equal(state.requiresHuman, true);
  assert.equal(state.lastOutcome, "handoff");
  assert.equal(state.handoffQueue, "finance");
  assert.equal(state.handoffReason, "Customer disputes payment allocation.");
});

test("non-handoff outcome clears stale semantic routing state", async () => {
  const ctx = context();
  const id = sessionIdentity(ctx).sessionId;
  const db = new Db({ customerAgentSessions: [{ id, status: "HUMAN_ACTIVE", requiresHuman: true, handoffQueue: "complaints", handoffReason: "Old complaint" }] });
  await recordCustomerConversationOutcome({ db, context: ctx, outcome: "reply", language: "es", requiresHuman: false });
  const state = db.read("customerAgentSessions", id);
  assert.equal(state.status, "AI_ACTIVE");
  assert.equal(state.requiresHuman, false);
  assert.equal(state.handoffQueue, "");
  assert.equal(state.handoffReason, "");
});

test("compact offer exposes only booking facts needed for reasoning", () => {
  const offer = compactCanonicalOffer({
    id: "OFR-1",
    version: 1,
    status: "open",
    expiresAt: "2099-01-01",
    secret: "x",
    request: { customerId: "c1", propertyId: "p1", workLines: [{ id: "w1", presetId: "p", serviceId: "s", quantity: 1 }] },
    options: [{ id: "o1", date: "2098-01-01", time: "08:30", assignments: [{ technicianIds: ["secret"] }] }],
  });
  assert.equal(offer.secret, undefined);
  assert.equal(offer.options[0].assignments, undefined);
  assert.equal(offer.request.customerId, "c1");
});
