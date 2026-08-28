const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OBSERVATION_TOOL,
  createMayaCustomerObserver,
  observationFromResponse,
} = require("./demacCustomerObserver");

function response(argumentsObject) {
  return {
    output: [{
      type: "function_call",
      name: OBSERVATION_TOOL.name,
      call_id: "obs-1",
      arguments: JSON.stringify(argumentsObject),
    }],
  };
}

test("observer records cancellation semantics without customer reply content", () => {
  const observation = observationFromResponse(response({
    intent: "cancellation",
    confidence: 0.97,
    language: "es",
    summary: "Cliente solicita cancelar la cita de mañana.",
    requiresAttention: true,
    dispatchRisk: true,
    reasonAlreadyProvided: false,
    reason: "",
    appointmentReference: "mañana",
    requestedDate: "",
    requestedTime: "",
    criticalValueAmbiguous: false,
  }));
  assert.equal(observation.intent, "cancellation");
  assert.equal(observation.dispatchRisk, true);
  assert.equal(observation.confidence, 0.97);
  assert.equal(Object.hasOwn(observation, "customerReply"), false);
});

test("ambiguous cancellation is preserved as ambiguous instead of irreversible authorization", () => {
  const observation = observationFromResponse(response({
    intent: "cancellation",
    confidence: 0.54,
    language: "es",
    summary: "El cliente parece considerar cancelar mañana.",
    requiresAttention: true,
    dispatchRisk: true,
    reasonAlreadyProvided: false,
    reason: "",
    appointmentReference: "mañana",
    requestedDate: "",
    requestedTime: "",
    criticalValueAmbiguous: true,
  }));
  assert.equal(observation.criticalValueAmbiguous, true);
  assert.equal(observation.confidence, 0.54);
});

test("Aruba Papiamento remains pap-aw", async () => {
  const observer = createMayaCustomerObserver({
    modelClient: async () => response({
      intent: "booking_request",
      confidence: 0.95,
      language: "pap-aw",
      summary: "Cliente kier hasi un cita pa airco cu no ta fria.",
      requiresAttention: false,
      dispatchRisk: false,
      reasonAlreadyProvided: true,
      reason: "airco no ta fria",
      appointmentReference: "",
      requestedDate: "",
      requestedTime: "",
      criticalValueAmbiguous: false,
    }),
  });
  const observation = await observer.observe({ apiKey: "test", text: "Bon dia, mi kier hasi un cita." });
  assert.equal(observation.language, "pap-aw");
  assert.equal(observation.intent, "booking_request");
});

test("observer fails if model does not provide exactly one structured observation", () => {
  assert.throws(() => observationFromResponse({ output: [] }), /exactly one observation/i);
});
