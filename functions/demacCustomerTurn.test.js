const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalRuntimeMessage,
  canonicalVoiceRuntimeMessage,
  communicationEpochDecision,
  customerSemanticContent,
  nonNegativeEpoch,
  positiveEpoch,
} = require("./demacCustomerTurn");

test("voice placeholder is never treated as customer intent before transcription", () => {
  const message = {
    direction: "inbound",
    mediaType: "audio",
    text: "[Audio]",
    transcriptionStatus: "waiting_media",
  };
  assert.equal(customerSemanticContent(message), "");
  assert.equal(canonicalRuntimeMessage(message), null);
});

test("voice transcript without completed provenance remains non-semantic", () => {
  const message = {
    direction: "inbound",
    mediaType: "voice",
    rawTranscript: "Cancela mi cita.",
    customerInputVersion: 3,
  };
  assert.equal(customerSemanticContent(message), "");
  assert.equal(canonicalVoiceRuntimeMessage(message), null);
});

test("completed voice transcript is the semantic content of the original message", () => {
  const message = {
    id: "MSG-VOICE-1",
    messageId: "MSG-VOICE-1",
    direction: "inbound",
    mediaType: "voice",
    text: "[Audio]",
    transcriptionStatus: "completed",
    rawTranscript: "Necesito cambiar la cita para mañana.",
    customerInputVersion: 7,
  };
  assert.equal(customerSemanticContent(message), "Necesito cambiar la cita para mañana.");
  assert.deepEqual(canonicalRuntimeMessage(message), {
    id: "MSG-VOICE-1",
    direction: "inbound",
    text: "Necesito cambiar la cita para mañana.",
    customerInputVersion: 7,
  });
  assert.equal(canonicalVoiceRuntimeMessage(message).mayaInputModality, "voice_transcript");
});

test("missing, zero, and malformed customer input epochs never become autonomous turn versions", () => {
  assert.equal(positiveEpoch(undefined), null);
  assert.equal(positiveEpoch(null), null);
  assert.equal(positiveEpoch(""), null);
  assert.equal(positiveEpoch(0), null);
  assert.equal(positiveEpoch("not-a-version"), null);
  assert.equal(positiveEpoch(1), 1);
  assert.equal(nonNegativeEpoch(0), 0);
  assert.equal(nonNegativeEpoch(""), null);
  assert.deepEqual(canonicalRuntimeMessage({
    id: "M-1",
    direction: "inbound",
    type: "text",
    text: "Hola",
    customerInputVersion: null,
  }), {
    id: "M-1",
    direction: "inbound",
    text: "Hola",
  });
});

test("exact communication epochs allow the current Maya turn", () => {
  assert.deepEqual(communicationEpochDecision({
    conversation: { ownershipVersion: 0, customerInputVersion: 4 },
    expectedOwnershipVersion: 0,
    expectedCustomerInputVersion: 4,
  }), {
    allowed: true,
    reason: "communication-epochs-current",
    ownershipVersion: 0,
    customerInputVersion: 4,
  });
});

test("takeover-return remains stale because ownership version changed", () => {
  const decision = communicationEpochDecision({
    conversation: { ownershipVersion: 6, customerInputVersion: 4, aiDisposition: "ai_active" },
    expectedOwnershipVersion: 4,
    expectedCustomerInputVersion: 4,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "ownership-version-changed");
});

test("newer customer input invalidates the older turn", () => {
  const decision = communicationEpochDecision({
    conversation: { ownershipVersion: 2, customerInputVersion: 9 },
    expectedOwnershipVersion: 2,
    expectedCustomerInputVersion: 8,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "customer-input-version-changed");
});

test("missing expected or current epochs fail closed", () => {
  assert.equal(communicationEpochDecision({
    conversation: { ownershipVersion: 0, customerInputVersion: 1 },
    expectedCustomerInputVersion: 1,
  }).reason, "expected-ownership-version-missing");
  assert.equal(communicationEpochDecision({
    conversation: { ownershipVersion: 0, customerInputVersion: 1 },
    expectedOwnershipVersion: 0,
  }).reason, "expected-customer-input-version-missing");
  assert.equal(communicationEpochDecision({
    conversation: { ownershipVersion: 0, customerInputVersion: 0 },
    expectedOwnershipVersion: 0,
    expectedCustomerInputVersion: 1,
  }).reason, "current-customer-input-version-missing");
});

test("non-voice customer messages keep canonical text caption or reaction semantics", () => {
  assert.equal(customerSemanticContent({ direction: "inbound", type: "text", text: "Hola" }), "Hola");
  assert.equal(customerSemanticContent({ direction: "inbound", type: "image", mediaCaption: "Este es el aire" }), "Este es el aire");
  assert.equal(customerSemanticContent({ direction: "inbound", type: "reaction", reactionEmoji: "👍" }), "👍");
});

test("outbound voice remains conversation context only when it has explicit outbound text", () => {
  assert.deepEqual(canonicalRuntimeMessage({
    id: "OUT-1",
    direction: "outbound",
    mediaType: "audio",
    text: "Te envío la nota.",
  }), {
    id: "OUT-1",
    direction: "outbound",
    text: "Te envío la nota.",
  });
});
