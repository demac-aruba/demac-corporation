const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FINAL_RESPONSE_TOOL,
  FINAL_TOOL_NAME,
  HANDOFF_QUEUES,
  createCustomerAgentRuntime,
  nativeInputMessages,
  normalizeCustomerTurn,
  validateFinalResponse,
  verifiedAppointmentFromTool,
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

function registry(invokeImpl = async (name) => ({ success: true, name })) {
  return {
    definitions: [
      { type: "function", name: "resolve_customer", description: "resolve", strict: true, parameters: { type: "object", additionalProperties: false, required: [], properties: {} } },
      { type: "function", name: "create_appointment", description: "book", strict: true, parameters: { type: "object", additionalProperties: false, required: [], properties: {} } },
      { type: "function", name: "get_appointment", description: "get", strict: true, parameters: { type: "object", additionalProperties: false, required: [], properties: {} } },
    ],
    invoke: invokeImpl,
  };
}

function rawBody(overrides = {}) {
  return {
    provider: "wacli",
    conversation: {
      id: "conv-1",
      contactPhone: "+2975600000",
      contactJid: "2975600000@s.whatsapp.net",
      chatTitle: "Richard",
      messages: [
        { id: "m0", direction: "outbound", text: "Buenas tardes" },
        { id: "m1", direction: "inbound", text: "Necesito servicio para dos aires" },
      ],
      customerTurn: { id: "m1", text: "Necesito servicio para dos aires" },
    },
    ...overrides,
  };
}

test("normalizes stable conversation and inbound message identity without interpreting language", () => {
  const normalized = normalizeCustomerTurn(rawBody());
  assert.equal(normalized.context.provider, "wacli");
  assert.equal(normalized.context.conversationId, "conv-1");
  assert.equal(normalized.context.inboundMessageId, "m1");
  assert.equal(normalized.latestText, "Necesito servicio para dos aires");
});

test("native input preserves user/assistant chronology", () => {
  const normalized = normalizeCustomerTurn(rawBody());
  assert.deepEqual(nativeInputMessages(normalized.conversation), [
    { role: "assistant", content: "Buenas tardes" },
    { role: "user", content: "Necesito servicio para dos aires" },
  ]);
});

test("verified appointment evidence only comes from booking/read tools", () => {
  assert.equal(verifiedAppointmentFromTool("create_appointment", { success: true, appointmentId: "APT-1" }), "APT-1");
  assert.equal(verifiedAppointmentFromTool("get_appointment", { success: true, appointmentId: "APT-2", appointment: { status: "confirmed" } }), "APT-2");
  assert.equal(verifiedAppointmentFromTool("get_appointment", { success: true, appointmentId: "APT-X", appointment: { status: "Cancelada" } }), "");
  assert.equal(verifiedAppointmentFromTool("resolve_customer", { success: true, appointmentId: "APT-FAKE" }), "");
});

test("final appointment confirmation is structurally rejected without verified evidence", () => {
  const bad = validateFinalResponse({
    message: "Su cita quedó confirmada.",
    outcome: "appointment_confirmed",
    language: "es",
    requiresHuman: false,
    appointmentId: "APT-FAKE",
    handoffQueue: "",
    handoffReason: "",
  }, new Set());
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "appointment_confirmation_requires_verified_appointment");

  const good = validateFinalResponse({
    message: "Su cita quedó confirmada.",
    outcome: "appointment_confirmed",
    language: "es",
    requiresHuman: false,
    appointmentId: "APT-REAL",
    handoffQueue: "",
    handoffReason: "",
  }, new Set(["APT-REAL"]));
  assert.equal(good.ok, true);
});

test("handoff requires a semantic queue and internal reason", () => {
  assert.deepEqual(HANDOFF_QUEUES, ["general", "scheduling", "sales", "finance", "technical", "complaints", "manager"]);
  const missingQueue = validateFinalResponse({
    message: "Voy a pasarle con nuestro equipo.",
    outcome: "handoff",
    language: "es",
    requiresHuman: true,
    appointmentId: "",
    handoffQueue: "",
    handoffReason: "Payment dispute needs review",
  });
  assert.equal(missingQueue.ok, false);
  assert.equal(missingQueue.code, "handoff_requires_valid_queue");

  const missingReason = validateFinalResponse({
    message: "Voy a pasarle con nuestro equipo.",
    outcome: "handoff",
    language: "es",
    requiresHuman: true,
    appointmentId: "",
    handoffQueue: "finance",
    handoffReason: "",
  });
  assert.equal(missingReason.ok, false);
  assert.equal(missingReason.code, "handoff_requires_reason");

  const valid = validateFinalResponse({
    message: "Voy a pasarle con nuestro equipo.",
    outcome: "handoff",
    language: "es",
    requiresHuman: true,
    appointmentId: "",
    handoffQueue: "finance",
    handoffReason: "Customer disputes the recorded payment balance.",
  });
  assert.equal(valid.ok, true);
});

test("non-handoff cannot hide human routing metadata", () => {
  const hiddenHuman = validateFinalResponse({
    message: "Le respondo normalmente.",
    outcome: "reply",
    language: "es",
    requiresHuman: true,
    appointmentId: "",
    handoffQueue: "finance",
    handoffReason: "Hidden routing",
  });
  assert.equal(hiddenHuman.ok, false);
  assert.equal(hiddenHuman.code, "requires_human_requires_handoff");
});

test("runtime can call multiple ERP tools and then finish one customer turn", async () => {
  const seenTools = [];
  const stateUpdates = [];
  const outcomes = [];
  const modelClient = scriptedModel([
    { output: [functionCall("resolve_customer", {})] },
    { output: [functionCall("resolve_customer", { second: true }, "call-2")] },
    { output: [functionCall(FINAL_TOOL_NAME, {
      message: "Ya encontré su información. ¿En qué dirección necesita el servicio?",
      outcome: "reply",
      language: "es",
      requiresHuman: false,
      appointmentId: "",
      handoffQueue: "",
      handoffReason: "",
    })] },
  ]);
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(async (name, args) => {
      seenTools.push({ name, args });
      return { success: true, resolved: true, customerId: "c1" };
    }),
    modelClient,
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: null }),
    stateUpdater: async (payload) => { stateUpdates.push(payload.toolName); },
    outcomeRecorder: async (payload) => { outcomes.push(payload.outcome); },
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.draft, "Ya encontré su información. ¿En qué dirección necesita el servicio?");
  assert.equal(result.metadata.outcome, "reply");
  assert.deepEqual(seenTools.map((item) => item.name), ["resolve_customer", "resolve_customer"]);
  assert.deepEqual(stateUpdates, ["resolve_customer", "resolve_customer"]);
  assert.deepEqual(outcomes, ["reply"]);
});

test("runtime refuses a model hallucinated confirmation and lets the model correct itself", async () => {
  let recorded = "";
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(),
    modelClient: scriptedModel([
      { output: [functionCall(FINAL_TOOL_NAME, {
        message: "Perfecto, su cita está confirmada.",
        outcome: "appointment_confirmed",
        language: "es",
        requiresHuman: false,
        appointmentId: "APT-NOT-REAL",
        handoffQueue: "",
        handoffReason: "",
      })] },
      { output: [functionCall(FINAL_TOOL_NAME, {
        message: "Todavía necesito crear la cita antes de confirmarla.",
        outcome: "reply",
        language: "es",
        requiresHuman: false,
        appointmentId: "",
        handoffQueue: "",
        handoffReason: "",
      }, "call-correct")] },
    ]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async ({ outcome }) => { recorded = outcome; },
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.outcome, "reply");
  assert.equal(recorded, "reply");
  assert.equal(result.metadata.toolCalls[0].code, "appointment_confirmation_requires_verified_appointment");
});

test("runtime allows confirmation only after create_appointment returns a real appointmentId", async () => {
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(async (name) => {
      if (name === "create_appointment") return { success: true, appointmentId: "APT-REAL", workOrderIds: ["WO-1"] };
      return { success: true };
    }),
    modelClient: scriptedModel([
      { output: [functionCall("create_appointment", { offerId: "OFR-1", offerVersion: 1, optionId: "opt-1" })] },
      { output: [functionCall(FINAL_TOOL_NAME, {
        message: "Perfecto. Su cita quedó confirmada.",
        outcome: "appointment_confirmed",
        language: "es",
        requiresHuman: false,
        appointmentId: "APT-REAL",
        handoffQueue: "",
        handoffReason: "",
      })] },
    ]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: { id: "OFR-1" } }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.outcome, "appointment_confirmed");
  assert.equal(result.metadata.appointmentId, "APT-REAL");
  assert.equal(result.metadata.appointmentCreated, true);
});

test("get_appointment can provide evidence for a confirmation answer", async () => {
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(async (name) => name === "get_appointment"
      ? { success: true, appointmentId: "APT-OLD", appointment: { id: "APT-OLD", status: "confirmed" } }
      : { success: true }),
    modelClient: scriptedModel([
      { output: [functionCall("get_appointment", { appointmentId: "APT-OLD" })] },
      { output: [functionCall(FINAL_TOOL_NAME, {
        message: "Sí, la cita está confirmada en nuestro sistema.",
        outcome: "appointment_confirmed",
        language: "es",
        requiresHuman: false,
        appointmentId: "APT-OLD",
        handoffQueue: "",
        handoffReason: "",
      })] },
    ]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE", appointmentId: "APT-OLD" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.appointmentId, "APT-OLD");
});

test("handoff records semantic queue and reason and returns a customer reply", async () => {
  let recorded = null;
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(),
    modelClient: scriptedModel([{ output: [functionCall(FINAL_TOOL_NAME, {
      message: "Voy a pasar su conversación a nuestro equipo para revisar el reclamo.",
      outcome: "handoff",
      language: "es",
      requiresHuman: true,
      appointmentId: "",
      handoffQueue: "complaints",
      handoffReason: "Customer reports a repeat cooling complaint after recent service.",
    })] }]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async (payload) => { recorded = payload; },
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.requiresHuman, true);
  assert.equal(result.metadata.handoffQueue, "complaints");
  assert.equal(result.metadata.handoffReason, "Customer reports a repeat cooling complaint after recent service.");
  assert.equal(recorded.requiresHuman, true);
  assert.equal(recorded.outcome, "handoff");
  assert.equal(recorded.handoffQueue, "complaints");
  assert.equal(recorded.handoffReason, result.metadata.handoffReason);
});

test("HUMAN_ACTIVE conversations do not call the model or business tools", async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(async () => { toolCalls += 1; return { success: true }; }),
    modelClient: async () => { modelCalls += 1; throw new Error("should not call"); },
    stateLoader: async () => ({ session: { status: "HUMAN_ACTIVE", appointmentId: "", handoffQueue: "technical", handoffReason: "Existing technical handoff" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.humanActive, true);
  assert.equal(result.metadata.handoffQueue, "technical");
  assert.equal(modelCalls, 0);
  assert.equal(toolCalls, 0);
});

test("runtime final tool is included beside one unified business registry", () => {
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(),
    modelClient: async () => ({}),
    primaryModel: "test-model",
    fallbackModel: "",
  });
  assert.deepEqual(runtime.toolDefinitions.map((item) => item.name), [
    "resolve_customer",
    "create_appointment",
    "get_appointment",
    FINAL_TOOL_NAME,
  ]);
  assert.equal(runtime.toolDefinitions.at(-1).strict, true);
  assert.deepEqual(FINAL_RESPONSE_TOOL.parameters.required, [
    "message", "outcome", "language", "requiresHuman", "appointmentId", "handoffQueue", "handoffReason",
  ]);
});
