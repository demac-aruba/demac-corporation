const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const {
  voiceTranscriptBecameReady,
  voiceTranscriptRuntimeMessage,
} = require("./demacCustomerAgentAllowlistCommunication");

function voice(overrides = {}) {
  return {
    id: "MSG-VOICE-1",
    messageId: "MSG-VOICE-1",
    conversationId: "COMM-1111111111111111111111111111111111111111",
    communicationAccountId: "demac-wa-corporate",
    provider: "wacli",
    channel: "whatsapp",
    direction: "inbound",
    mediaType: "audio",
    text: "[Audio]",
    customerInputVersion: 7,
    transcriptionStatus: "processing",
    ...overrides,
  };
}

test("customer voice adapter never treats outbound audio as a new customer turn", () => {
  const before = voice({ direction: "outbound", transcriptionStatus: "processing" });
  const after = voice({
    direction: "outbound",
    transcriptionStatus: "completed",
    rawTranscript: "Internal outbound note",
  });
  assert.equal(voiceTranscriptBecameReady(before, after), false);
});

test("customer voice adapter does not retrigger before completion or for the same completed transcript", () => {
  const processing = voice({ rawTranscript: "Cancela mi cita" });
  assert.equal(voiceTranscriptBecameReady(voice(), processing), false);

  const completed = voice({ transcriptionStatus: "completed", rawTranscript: "Cancela mi cita" });
  assert.equal(voiceTranscriptBecameReady(completed, { ...completed }), false);
});

test("completed customer voice reuses the original canonical message and current-turn epoch", () => {
  const before = voice();
  const after = voice({
    transcriptionStatus: "completed",
    rawTranscript: "Mi kier cambia mi cita pa mañan.",
  });
  assert.equal(voiceTranscriptBecameReady(before, after), true);

  const runtimeMessage = voiceTranscriptRuntimeMessage(after);
  assert.equal(runtimeMessage.id, "MSG-VOICE-1");
  assert.equal(runtimeMessage.messageId, "MSG-VOICE-1");
  assert.equal(runtimeMessage.conversationId, after.conversationId);
  assert.equal(runtimeMessage.communicationAccountId, "demac-wa-corporate");
  assert.equal(runtimeMessage.customerInputVersion, 7);
  assert.equal(runtimeMessage.direction, "inbound");
  assert.equal(runtimeMessage.text, "Mi kier cambia mi cita pa mañan.");
  assert.equal(runtimeMessage.mediaCaption, "");
  assert.equal(runtimeMessage.mayaInputModality, "voice_transcript");
});
