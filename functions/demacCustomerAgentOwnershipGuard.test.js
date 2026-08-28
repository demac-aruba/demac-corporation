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

test("ownership guard can stop the turn before the model runs without mutating session state", async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  let outcomeWrites = 0;
  const runtime = createCustomerAgentRuntime(dependencies({
    registry: registry(async () => { toolCalls += 1; return { success: true }; }),
    modelClient: async () => { modelCalls += 1; return { output: [] }; },
    executionGuard: async ({ phase }) => ({
      allowed: false,
      code: "human_takeover",
      reason: `Human ownership detected at ${phase}`,
    }),
    outcomeRecorder: async () => { outcomeWrites += 1; },
  }));

  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.draft, "");
  assert.equal(result.metadata.humanActive, true);
  assert.equal(result.metadata.ownershipChanged, true);
  assert.equal(result.metadata.ownershipCode, "human_takeover");
  assert.equal(modelCalls, 0);
  assert.equal(toolCalls, 0);
  assert.equal(outcomeWrites, 0, "stale guard suppression must not mutate the canonical session");
});

test("ownership guard is checked immediately before every ERP business tool without stale outcome writes", async () => {
  const phases = [];
  let toolCalls = 0;
  let modelCalls = 0;
  let outcomeWrites = 0;
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
    outcomeRecorder: async () => { outcomeWrites += 1; },
  }));

  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.humanActive, true);
  assert.equal(modelCalls, 1);
  assert.equal(toolCalls, 0);
  assert.equal(outcomeWrites, 0, "a guard failure before a business tool cannot write stale session state");
  assert.deepEqual(phases, [
    "before_model:-",
    "before_business_tool:resolve_customer",
  ]);
});

test("ownership guard is checked again before a customer response is released without stale outcome writes", async () => {
  let checks = 0;
  let outcomeWrites = 0;
  const runtime = createCustomerAgentRuntime(dependencies({
    modelClient: async () => ({ output: [functionCall(FINAL_TOOL_NAME, {
      message: "Claro, le ayudo.",
      outcome: "reply",
      language: "es",
      requiresHuman: false,
      appointmentId: "",
      handoffQueue: "",
      handoffReason: "",
    })] }),
    executionGuard: async ({ phase }) => {
      checks += 1;
      return phase === "before_final_response"
        ? { allowed: false, code: "human_takeover", reason: "Operator claimed conversation." }
        : { allowed: true };
    },
    outcomeRecorder: async () => { outcomeWrites += 1; },
  }));

  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.draft, "");
  assert.equal(result.metadata.humanActive, true);
  assert.equal(result.metadata.ownershipCode, "human_takeover");
  assert.equal(checks, 2);
  assert.equal(outcomeWrites, 0, "a stale final response cannot mutate session state");
});

test("a current semantic handoff still records exactly one canonical outcome", async () => {
  let outcomeWrites = 0;
  let recorded = null;
  const runtime = createCustomerAgentRuntime(dependencies({
    modelClient: async () => ({ output: [functionCall(FINAL_TOOL_NAME, {
      message: "Le voy a conectar con un especialista.",
      outcome: "handoff",
      language: "es",
      requiresHuman: true,
      appointmentId: "",
      handoffQueue: "general",
      handoffReason: "Customer requested a human.",
    })] }),
    executionGuard: async () => ({ allowed: true }),
    outcomeRecorder: async (payload) => {
      outcomeWrites += 1;
      recorded = payload;
    },
  }));

  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.draft, "Le voy a conectar con un especialista.");
  assert.equal(result.metadata.outcome, "handoff");
  assert.equal(result.metadata.requiresHuman, true);
  assert.equal(outcomeWrites, 1);
  assert.equal(recorded.outcome, "handoff");
  assert.equal(recorded.handoffQueue, "general");
  assert.equal(recorded.handoffReason, "Customer requested a human.");
});
