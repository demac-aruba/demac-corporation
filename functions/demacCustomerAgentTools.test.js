const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CUSTOMER_AGENT_TOOL_DEFINITIONS,
  createCustomerAgentTools,
  derivedBookingIdempotencyKey,
} = require("./demacCustomerAgentTools");

function snapshot(items) {
  return {
    docs: items.map((item) => ({
      id: item.id,
      data: () => {
        const { id, ...rest } = item;
        return rest;
      },
    })),
  };
}

class FakeQuery {
  constructor(items) { this.items = items; }
  where(field, operation, value) {
    assert.equal(operation, "==");
    return new FakeQuery(this.items.filter((item) => item[field] === value));
  }
  async get() { return snapshot(this.items); }
}

class FakeDb {
  constructor({ clients = [], properties = [] } = {}) {
    this.data = { clients, properties };
  }
  collection(name) { return new FakeQuery(this.data[name] || []); }
}

function fakeAuthority(overrides = {}) {
  return {
    checkAvailability: async (payload) => ({
      success: true,
      available: true,
      offer: { id: "OFR-1", version: 1 },
      options: [],
      payload,
    }),
    createAppointment: async () => ({ success: true, appointmentId: "APT-ABC", workOrderIds: ["WO-1"] }),
    getAppointment: async (id) => ({ id, appointmentId: id, status: "confirmed" }),
    ...overrides,
  };
}

test("exposes five small stable tool definitions", () => {
  assert.deepEqual(
    CUSTOMER_AGENT_TOOL_DEFINITIONS.map((item) => item.name),
    ["resolve_customer", "resolve_property", "check_availability", "create_appointment", "get_appointment"],
  );
  assert.ok(CUSTOMER_AGENT_TOOL_DEFINITIONS.every((item) => item.strict === true));
});

test("resolves customer by Aruba phone without asking again", async () => {
  const db = new FakeDb({ clients: [{ id: "c1", name: "Richard", phone: "+297 560 0000", active: true }] });
  const tools = createCustomerAgentTools({ db, bookingAuthority: fakeAuthority(), schedulingProvider: {} });
  const result = await tools.resolveCustomer({ contactPhone: "560-0000" });
  assert.equal(result.resolved, true);
  assert.equal(result.customerId, "c1");
  assert.equal(result.matchType, "phone");
});

test("does not guess when phone maps to multiple customers", async () => {
  const db = new FakeDb({
    clients: [
      { id: "c1", name: "A", phone: "5600000" },
      { id: "c2", name: "B", whatsapp: "+2975600000" },
    ],
  });
  const tools = createCustomerAgentTools({ db, bookingAuthority: fakeAuthority(), schedulingProvider: {} });
  const result = await tools.resolveCustomer({ contactPhone: "+2975600000" });
  assert.equal(result.resolved, false);
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 2);
});

test("resolves correct property by address similarity", async () => {
  const db = new FakeDb({
    properties: [
      { id: "p1", clientId: "c1", address: "Wayaca 217", active: true },
      { id: "p2", clientId: "c1", address: "Palm Beach 10", active: true },
    ],
  });
  const tools = createCustomerAgentTools({ db, bookingAuthority: fakeAuthority(), schedulingProvider: {} });
  const result = await tools.resolveProperty({ customerId: "c1", address: "Wayaca #217" });
  assert.equal(result.resolved, true);
  assert.equal(result.propertyId, "p1");
});

test("one existing property resolves when address is not supplied", async () => {
  const db = new FakeDb({ properties: [{ id: "p1", clientId: "c1", address: "Wayaca 217" }] });
  const tools = createCustomerAgentTools({ db, bookingAuthority: fakeAuthority(), schedulingProvider: {} });
  const result = await tools.resolveProperty({ customerId: "c1", address: "" });
  assert.equal(result.resolved, true);
  assert.equal(result.matchType, "single-property");
});

test("booking idempotency is derived from stable conversation and inbound message", () => {
  const first = derivedBookingIdempotencyKey(
    { provider: "wacli", conversationId: "conv-1", inboundMessageId: "msg-1" },
    { offerId: "OFR-1", optionId: "opt-1" },
  );
  const second = derivedBookingIdempotencyKey(
    { provider: "wacli", conversationId: "conv-1", inboundMessageId: "msg-1" },
    { offerId: "OFR-1", optionId: "opt-1" },
  );
  assert.equal(first, second);
  assert.match(first, /conv-1:msg-1:create_appointment:OFR-1:opt-1/);
});

test("create appointment requires a real appointmentId", async () => {
  let seenKey = "";
  const goodAuthority = fakeAuthority({
    createAppointment: async (input) => {
      seenKey = input.idempotencyKey;
      return { success: true, appointmentId: "APT-REAL", workOrderIds: ["WO-1"] };
    },
  });
  const tools = createCustomerAgentTools({ db: new FakeDb(), bookingAuthority: goodAuthority, schedulingProvider: {} });
  const result = await tools.createAppointment(
    { offerId: "OFR-1", offerVersion: 1, optionId: "opt-1" },
    { conversationId: "conv-1", inboundMessageId: "msg-1" },
  );
  assert.equal(result.appointmentId, "APT-REAL");
  assert.match(seenKey, /conv-1:msg-1/);

  const badTools = createCustomerAgentTools({
    db: new FakeDb(),
    bookingAuthority: fakeAuthority({ createAppointment: async () => ({ success: true, appointmentId: "" }) }),
    schedulingProvider: {},
  });
  await assert.rejects(
    () => badTools.createAppointment(
      { offerId: "OFR-1", offerVersion: 1, optionId: "opt-1" },
      { conversationId: "conv-1", inboundMessageId: "msg-1" },
    ),
    /canonical appointmentId/,
  );
});

test("invoke returns typed structured error instead of prose exception", async () => {
  const tools = createCustomerAgentTools({ db: new FakeDb(), bookingAuthority: fakeAuthority(), schedulingProvider: {} });
  const result = await tools.invoke(
    "create_appointment",
    { offerId: "OFR-1", offerVersion: 1, optionId: "opt-1" },
    { conversationId: "conv-1" },
  );
  assert.equal(result.success, false);
  assert.equal(result.error.code, "invalid_idempotency_key");
});
