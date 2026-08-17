const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FINAL_TOOL_NAME,
  createCustomerAgentRuntime,
} = require("./demacCustomerAgentRuntimeV1");

class FakeDb {
  collection() { return {}; }
}

function functionCall(name, args = {}, callId = `call-${name}`) {
  return { type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) };
}

function rawBody() {
  return {
    provider: "wacli",
    conversation: {
      id: "conv-ownership",
      contactPhone: "+2975600000",
      messages: [{ id: "m1", direction: "inbound", text: "Quiero agendar servicio" }],
      customerTurn: { id: "m1", text: "Quiero agendar servicio" },
    },
  };
}

function registry(invoke) {
  return {
    definitions: [
      {
        type: "function",
        name: "resolve_customer",
        description: "resolve",
        strict: true,
        parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
      },
    ],
    invoke,
  };
}

function dependencies(overrides = {}) {
  return {
    db: new FakeDb(),
    registry: registry(async () => ({ success: true })),
    modelClient: async () => ({ output: [] }),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
    ...overrides,
  };
}

test("ownership guard can stop the turn before the model runs", async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  let recorded = null;
  const runtime = createCustomerAgentRuntime(dependencies({
    registry: registry(async () => { toolCalls += 1; return { success: true }; }),
    modelClient: async () => { modelCalls += 1; return { output: [] }; },
    executionGuard: async ({ phase }) => ({
      allowed: false,
      code: "human_takeover",
      reason: `Human ownership detected at ${phase}`,
    }),
    outcomeRecorder: async (payload) => { recorded = payload; },
  }));

  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.draft, "");
  assert.equal(result.metadata.humanActive, true);
  assert.equal(result.metadata.ownershipChanged, true);
  assert.equal(result.metadata.ownershipCode, "human_takeover");
  assert.equal(modelCalls, 0);
  assert.equal(toolCalls, 0);
  assert.equal(recorded.outcome, "handoff");
  assert.equal(recorded.requiresHuman, true);
});

test("ownership guard is checked immediately before every ERP business tool", async () => {
  const phases = [];
  let toolCalls = 0;
  let modelCalls = 0;
  const runtime = createCustomerAgentRuntime(dependencies({
    registry: registry(async () => { toolCalls += 1; return { success: true }; }),
    modelClient: async () => {
      modelCalls += 1;
      return { output: [functionCall("resolve_customer")] };
    },
    executionGuard: async ({ phase, toolName }) => {
      phases.push(`${phase}:${toolName || "-"}`);
      if (phase === "before_business_tool") {
        return { allowed: false, code: "human_takeover", reason: "Operator claimed conversation." };
      }
      return { allowed: true };
    },
  }));

  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.humanActive, true);
  assert.equal(modelCalls, 1);
  assert.equal(toolCalls, 0);
  assert.deepEqual(phases, [
    "before_model:-",
    "before_business_tool:resolve_customer",
  ]);
});

test("ownership guard is checked again before a customer response is released", async () => {
  let checks = 0;
  const runtime = createCustomerAgentRuntime(dependencies({
    modelClient: async () => ({ output: [functionCall(FINAL_TOOL_NAME, {
      message: "Claro, le ayudo.",
      outcome: "reply",
      language: "es",
      requiresHuman: false,
      appointmentId: "",
    })] }),
    executionGuard: async ({ phase }) => {
      checks += 1;
      return phase === "before_final_response"
        ? { allowed: false, code: "human_takeover", reason: "Operator claimed conversation." }
        : { allowed: true };
    },
  }));

  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.draft, "");
  assert.equal(result.metadata.humanActive, true);
  assert.equal(result.metadata.ownershipCode, "human_takeover");
  assert.equal(checks, 2);
});
