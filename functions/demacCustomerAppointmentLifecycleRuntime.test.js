const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FINAL_TOOL_NAME,
  createCustomerAgentRuntime,
  validateFinalResponse,
  verifiedAppointmentLifecycleFromTool,
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

function registry(invokeImpl) {
  return {
    definitions: [
      { type: "function", name: "cancel_appointment", description: "cancel", strict: true, parameters: { type: "object", additionalProperties: false, required: [], properties: {} } },
      { type: "function", name: "reschedule_appointment", description: "reschedule", strict: true, parameters: { type: "object", additionalProperties: false, required: [], properties: {} } },
    ],
    invoke: invokeImpl,
  };
}

function rawBody(text = "Quiero cancelar mi cita") {
  return {
    provider: "wacli",
    conversation: {
      id: "conv-lifecycle",
      contactPhone: "+2975600000",
      contactJid: "2975600000@s.whatsapp.net",
      messages: [{ id: "m1", direction: "inbound", text }],
      customerTurn: { id: "m1", text },
    },
  };
}

function finalArgs(outcome, appointmentId, message) {
  return {
    message,
    outcome,
    language: "es",
    requiresHuman: false,
    appointmentId,
    handoffQueue: "",
    handoffReason: "",
  };
}

test("lifecycle proof accepts only canonical tool results with the expected state", () => {
  assert.deepEqual(verifiedAppointmentLifecycleFromTool("cancel_appointment", {
    success: true,
    appointmentId: "APT-1",
    appointment: { status: "cancelled" },
  }), { appointmentId: "APT-1", outcome: "appointment_cancelled" });
  assert.equal(verifiedAppointmentLifecycleFromTool("cancel_appointment", {
    success: true,
    appointmentId: "APT-1",
    appointment: { status: "confirmed" },
  }), null);

  assert.deepEqual(verifiedAppointmentLifecycleFromTool("reschedule_appointment", {
    success: true,
    appointmentId: "APT-2",
    changeKind: "customer_reschedule",
    appointment: { status: "confirmed" },
  }), { appointmentId: "APT-2", outcome: "appointment_rescheduled" });
  assert.equal(verifiedAppointmentLifecycleFromTool("reschedule_appointment", {
    success: true,
    appointmentId: "APT-2",
    changeKind: "operational_move",
    appointment: { status: "confirmed" },
  }), null);
});

test("customer-facing cancellation confirmation is rejected without canonical cancellation proof", () => {
  const bad = validateFinalResponse(
    finalArgs("appointment_cancelled", "APT-1", "Su cita quedó cancelada."),
    new Set(),
    new Set(),
    new Set(),
    new Set(),
    new Set(),
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "appointment_cancellation_requires_verified_cancellation");

  const good = validateFinalResponse(
    finalArgs("appointment_cancelled", "APT-1", "Su cita quedó cancelada."),
    new Set(),
    new Set(),
    new Set(),
    new Set(["APT-1"]),
    new Set(),
  );
  assert.equal(good.ok, true);
});

test("customer-facing reschedule confirmation is rejected without canonical reschedule proof", () => {
  const bad = validateFinalResponse(
    finalArgs("appointment_rescheduled", "APT-2", "Su cita quedó movida para el viernes."),
    new Set(),
    new Set(),
    new Set(),
    new Set(),
    new Set(),
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "appointment_reschedule_requires_verified_reschedule");

  const good = validateFinalResponse(
    finalArgs("appointment_rescheduled", "APT-2", "Su cita quedó movida para el viernes."),
    new Set(),
    new Set(),
    new Set(),
    new Set(),
    new Set(["APT-2"]),
  );
  assert.equal(good.ok, true);
});

test("runtime rejects a hallucinated cancellation and lets Maya correct to a pending request", async () => {
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(async () => ({ success: false, error: { code: "invalid_request", details: { authorizationReason: "auto-cancel-disabled" } } })),
    modelClient: scriptedModel([
      { output: [functionCall("cancel_appointment", { appointmentId: "APT-1", reason: "Customer unavailable", note: "" })] },
      { output: [functionCall(FINAL_TOOL_NAME, finalArgs("appointment_cancelled", "APT-1", "Listo, su cita quedó cancelada."))] },
      { output: [functionCall(FINAL_TOOL_NAME, finalArgs("reply", "", "Recibí su solicitud de cancelación. Todavía está pendiente de confirmación."), "call-correct")] },
    ]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.outcome, "reply");
  assert.equal(result.metadata.appointmentCancelled, false);
  assert.equal(result.metadata.toolCalls.some((item) => item.code === "appointment_cancellation_requires_verified_cancellation"), true);
});

test("runtime confirms cancellation only after canonical lifecycle proof", async () => {
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(async (name) => name === "cancel_appointment"
      ? { success: true, appointmentId: "APT-1", appointment: { id: "APT-1", status: "cancelled" } }
      : { success: false }),
    modelClient: scriptedModel([
      { output: [functionCall("cancel_appointment", { appointmentId: "APT-1", reason: "Customer unavailable", note: "" })] },
      { output: [functionCall(FINAL_TOOL_NAME, finalArgs("appointment_cancelled", "APT-1", "Perfecto. Su cita quedó cancelada."))] },
    ]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody(), apiKey: "test" });
  assert.equal(result.metadata.outcome, "appointment_cancelled");
  assert.equal(result.metadata.appointmentId, "APT-1");
  assert.equal(result.metadata.appointmentCancelled, true);
});

test("runtime confirms reschedule only after canonical lifecycle proof", async () => {
  const runtime = createCustomerAgentRuntime({
    db: new FakeDb(),
    registry: registry(async (name) => name === "reschedule_appointment"
      ? {
        success: true,
        appointmentId: "APT-2",
        changeKind: "customer_reschedule",
        appointment: { id: "APT-2", status: "confirmed", date: "2026-08-28", startTime: "09:30" },
      }
      : { success: false }),
    modelClient: scriptedModel([
      { output: [functionCall("reschedule_appointment", {
        appointmentId: "APT-2",
        offerId: "OFR-2",
        offerVersion: 1,
        optionId: "OPT-2",
        reason: "Customer requested Friday",
        note: "",
      })] },
      { output: [functionCall(FINAL_TOOL_NAME, finalArgs("appointment_rescheduled", "APT-2", "Perfecto. Su cita quedó reagendada."))] },
    ]),
    stateLoader: async () => ({ session: { status: "AI_ACTIVE" }, activeOffer: null }),
    stateUpdater: async () => {},
    outcomeRecorder: async () => {},
    primaryModel: "test-model",
    fallbackModel: "",
  });
  const result = await runtime.runTurn({ rawBody: rawBody("Quiero mover mi cita"), apiKey: "test" });
  assert.equal(result.metadata.outcome, "appointment_rescheduled");
  assert.equal(result.metadata.appointmentId, "APT-2");
  assert.equal(result.metadata.appointmentRescheduled, true);
});
