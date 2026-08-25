const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalRuntimeMessage,
  canonicalVoiceRuntimeMessage,
  customerSemanticContent,
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
    customerInputVersion: null,
  });
});
