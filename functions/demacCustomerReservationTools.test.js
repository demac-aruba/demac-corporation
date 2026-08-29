const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CUSTOMER_RESERVATION_TOOL_DEFINITIONS,
  createCustomerReservationTools,
  stableReservationIdempotencyKey,
} = require("./demacCustomerReservationTools");

const fakeDb = { collection() { return {}; } };

function context(overrides = {}) {
  return {
    provider: "wacli",
    conversationId: "conv-1",
    inboundMessageId: "msg-1",
    actor: { source: "demac-customer-agent", id: "agent", name: "DEMAC Customer Agent" },
    ...overrides,
  };
}

test("defines create, get and release as strict reservation tools", () => {
  assert.deepEqual(CUSTOMER_RESERVATION_TOOL_DEFINITIONS.map((item) => item.name), [
    "create_product_reservation",
    "get_product_reservation",
    "release_product_reservation",
  ]);
  assert.ok(CUSTOMER_RESERVATION_TOOL_DEFINITIONS.every((item) => item.strict));
  assert.deepEqual(CUSTOMER_RESERVATION_TOOL_DEFINITIONS[0].parameters.required, ["productId", "customerId", "sourceLocationId", "quantity"]);
});

test("reservation idempotency is stable for the same inbound customer turn and independent of model arguments", () => {
  const first = stableReservationIdempotencyKey(context());
  const second = stableReservationIdempotencyKey(context());
  assert.equal(first, second);
  assert.match(first, /^customer-agent\|wacli\|conv-1\|msg-1\|create-product-reservation$/);
  assert.equal(stableReservationIdempotencyKey(context({ inboundMessageId: "msg-2" })).includes("msg-2"), true);
});

test("create reservation passes canonical inbound identity to the authority", async () => {
  let seen = null;
  const authority = {
    createReservation: async (payload) => {
      seen = payload;
      return { success: true, reservationId: "RSV-1", reservation: { reservationId: "RSV-1", status: "active" } };
    },
  };
  const tools = createCustomerReservationTools({ db: fakeDb, reservationAuthority: authority });
  const result = await tools.createProductReservation({ productId: "p12", customerId: "c1", sourceLocationId: "WH-MAIN", quantity: 2 }, context());
  assert.equal(result.success, true);
  assert.equal(result.reservationId, "RSV-1");
  assert.equal(seen.productId, "p12");
  assert.equal(seen.customerId, "c1");
  assert.equal(seen.sourceLocationId, "WH-MAIN");
  assert.equal(seen.quantity, 2);
  assert.equal(seen.idempotencyKey, "customer-agent|wacli|conv-1|msg-1|create-product-reservation");
  assert.equal(seen.context.inboundMessageId, "msg-1");
});

test("create reservation fails closed without stable inbound identity", async () => {
  let called = false;
  const tools = createCustomerReservationTools({
    db: fakeDb,
    reservationAuthority: { createReservation: async () => { called = true; return { success: true }; } },
  });
  const result = await tools.createProductReservation(
    { productId: "p12", customerId: "c1", sourceLocationId: "WH-MAIN", quantity: 1 },
    { provider: "wacli", conversationId: "conv-1" },
  );
  assert.equal(result.success, false);
  assert.equal(result.error.code, "stable_reservation_identity_required");
  assert.equal(called, false);
});

test("authority errors preserve their canonical error code", async () => {
  const error = new Error("Policy missing");
  error.code = "reservation_policy_not_configured";
  error.details = { policyId: "commercial-sales-reservation-policy" };
  const tools = createCustomerReservationTools({
    db: fakeDb,
    reservationAuthority: { createReservation: async () => { throw error; } },
  });
  const result = await tools.createProductReservation({ productId: "p12", customerId: "c1", sourceLocationId: "WH-MAIN", quantity: 1 }, context());
  assert.equal(result.success, false);
  assert.equal(result.error.code, "reservation_policy_not_configured");
  assert.equal(result.error.details.policyId, "commercial-sales-reservation-policy");
});

test("get and release return exact authority reservation state", async () => {
  const authority = {
    getReservation: async (reservationId) => ({ reservationId, status: "active", productId: "p12", quantity: 1 }),
    releaseReservation: async ({ reservationId, reason, actor }) => ({
      success: true,
      reservationId,
      replayed: false,
      reservation: { reservationId, status: "released", releaseReason: reason, releasedById: actor.id },
    }),
  };
  const tools = createCustomerReservationTools({ db: fakeDb, reservationAuthority: authority });
  const current = await tools.getProductReservation({ reservationId: "RSV-1" });
  assert.equal(current.success, true);
  assert.equal(current.reservationId, "RSV-1");
  assert.equal(current.status, "active");

  const released = await tools.releaseProductReservation({ reservationId: "RSV-1", reason: "Customer cancelled" }, context());
  assert.equal(released.success, true);
  assert.equal(released.reservation.status, "released");
  assert.equal(released.reservation.releaseReason, "Customer cancelled");
  assert.equal(released.reservation.releasedById, "agent");
});
