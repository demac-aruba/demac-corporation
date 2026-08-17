const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FINAL_TOOL_NAME,
  createCustomerAgentRuntime,
  validateFinalResponse,
  verifiedReservationFromTool,
} = require("./demacCustomerAgentRuntimeV1");

class FakeDb {
  collection() { return {}; }
}

function functionCall(name, args, callId = `call-${name}`) {
  return { type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) };
}

function scriptedModel(responses) {
  const queue = [...responses];
  return async () => {
    if (!queue.length) throw new Error("No scripted response remains.");
    return queue.shift();
  };
}

function reservationRegistry(invokeImpl) {
  return {
    definitions: [
      {
        type: "function",
        name: "create_product_reservation",
        description: "reserve",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["productId", "customerId", "quantity"],
          properties: {
            productId: { type: "string" },
            customerId: { type: "string" },
            quantity: { type: "integer" },
          },
        },
      },
    ],
    invoke: invokeImpl,
  };
}

function rawBody() {
  return {
    provider: "wacli",
    conversation: {
      id: "conv-1",
      contactPhone: "+2975600000",
      messages: [{ id: "m1", direction: "inbound", text: "Sí, resérvame ese aire." }],
      customerTurn: { id: "m1", text: "Sí, resérvame ese aire." },
    },
  };
}

function finalArgs(outcome, message) {
  return {
    message,
    outcome,
    language: "es",
    requiresHuman: false,
    appointmentId: "",
    handoffQueue: "",
    handoffReason: "",
  };
}

test("reservation proof only comes from canonical reservation tools with valid status", () => {
  assert.deepEqual(
    verifiedReservationFromTool("create_product_reservation", {
      success: true,
      reservationId: "RSV-1",
      reservation: { reservationId: "RSV-1", status: "active" },
    }),
    { reservationId: "RSV-1", status: "active" },
  );
  assert.deepEqual(
    verifiedReservationFromTool("release_product_reservation", {
      success: true,
      reservationId: "RSV-1",
      reservation: { reservationId: "RSV-1", status: "released" },
    }),
    { reservationId: "RSV-1", status: "released" },
  );
  assert.equal(verifiedReservationFromTool("get_product_stock", { success: true, reservationId: "RSV-FAKE" }), null);
  assert.equal(verifiedReservationFromTool("create_product_reservation", { success: false, reservationId: "RSV-FAKE" }), null);
});

test("product reservation confirmation is structurally rejected without exactly one verified active reservation", () => {
  const none = validateFinalResponse(finalArgs("product_reserved", "Ya está reservado."), new Set(), new Set(), new Set());
  assert.equal(none.ok, false);
  assert.equal(none.code, "product_reservation_requires_verified_active_reservation");

  const ambiguous = validateFinalResponse(
    finalArgs("product_reserved", "Ya está reservado."),
    new Set(),
    new Set(["RSV-1", "RSV-2"]),
    new Set(),
  );
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, "product_reservation_requires_verified_active_reservation");

  const good = validateFinalResponse(
    finalArgs("product_reserved", "Ya está reservado."),
    new Set(),
    new Set(["RSV-REAL"]),
    new Set(),
  );
  assert.equal(good.ok, true);
  assert.equal(good.final.reservationId, "RSV-REAL");
});

test("release confirmation requires exactly one verified released reservation", () => {
  const bad = validateFinalResponse(
    finalArgs("product_reservation_released", "La reserva fue liberada."),
    new Set(),
    new Set(),
    new Set(),
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "product_release_requires_verified_released_reservation");

  const good = validateFinalResponse(
    finalArgs("product_reservation_released", "La reserva fue liberada."),
    new Set(),
    new Set(),
    new Set(["RSV-REAL"]),
  );
  assert.equal(good.ok, true);
  assert.equal(good.final.reservationId, "RSV-REAL");
});

test("runtime refuses a hallucinated reservation then accepts a corrected normal reply", async () => {
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: reservationRegistry(async () => ({ success: true })),
    modelClient: scriptedModel([
      { output: [functionCall(FINAL_TOOL_NAME, finalArgs("product_reserved", "Perfecto, ya quedó reservado."))] },
      { output: [functionCall(FINAL_TOOL_NAME, finalArgs("reply", "Todavía necesito crear la reserva antes de confirmarla."), "call-correct")] },
    ]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE", customerId: "c1" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.outcome, "reply");
  assert.equal(result.metadata.reservationId, "");
  assert.equal(result.metadata.toolCalls[0].code, "product_reservation_requires_verified_active_reservation");
});

test("runtime confirms a reservation only after authority-backed tool evidence", async () => {
  let recorded = null;
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: reservationRegistry(async (name) => {
      assert.equal(name, "create_product_reservation");
      return {
        success: true,
        reservationId: "RSV-REAL",
        reservation: { reservationId: "RSV-REAL", status: "active", productId: "p18", quantity: 1 },
      };
    }),
    modelClient: scriptedModel([
      { output: [functionCall("create_product_reservation", { productId: "p18", customerId: "c1", quantity: 1 })] },
      { output: [functionCall(FINAL_TOOL_NAME, finalArgs("product_reserved", "Perfecto. Su aire quedó reservado."))] },
    ]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE", customerId: "c1" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async (payload) => { recorded = payload; },
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.outcome, "product_reserved");
  assert.equal(result.metadata.reservationId, "RSV-REAL");
  assert.equal(result.metadata.productReserved, true);
  assert.equal(recorded.reservationId, "RSV-REAL");
  assert.equal(result.metadata.toolCalls[0].reservationId, "RSV-REAL");
});
