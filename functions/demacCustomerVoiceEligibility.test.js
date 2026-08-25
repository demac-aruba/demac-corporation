const test = require("node:test");
const assert = require("node:assert/strict");

const { customerVoiceEligibilityDecision } = require("./demacCustomerVoiceEligibility");

const activation = "2026-08-24T20:00:00.000Z";
const settings = {
  voiceTranscriptionEnabled: true,
  voiceTranscriptionEnabledAt: activation,
  voiceHistoricalBackfillEnabled: false,
  voiceTranscriptionVersion: "customer-voice-v1",
};
const communicationSettings = { communicationAccountId: "demac-wa-corporate" };

function voice(overrides = {}) {
  return {
    direction: "inbound",
    mediaType: "audio",
    communicationAccountId: "demac-wa-corporate",
    provider: "wacli",
    channel: "whatsapp",
    chat: "2975600000@s.whatsapp.net",
    whatsappTimestamp: "2026-08-24T20:05:00.000Z",
    firstReceivedAt: "2026-08-24T20:05:01.000Z",
    ...overrides,
  };
}

function decide(message = voice(), policy = settings, transport = communicationSettings) {
  return customerVoiceEligibilityDecision({ message, settings: policy, communicationSettings: transport });
}

test("new inbound voice after activation is eligible", () => {
  const decision = decide();
  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, "eligible-new-inbound-voice");
  assert.equal(decision.transcriptionVersion, "customer-voice-v1");
});

test("outbound DEMAC audio can never initiate customer voice processing", () => {
  const decision = decide(voice({ direction: "outbound" }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "not-canonical-inbound");
});

test("historical audio present at activation is not eligible", () => {
  const decision = decide(voice({
    whatsappTimestamp: "2026-08-23T18:00:00.000Z",
    firstReceivedAt: "2026-08-23T18:00:01.000Z",
  }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "provider-message-before-activation");
});

test("historical provider replay after activation remains ineligible", () => {
  const decision = decide(voice({
    whatsappTimestamp: "2026-08-23T18:00:00.000Z",
    firstReceivedAt: "2026-08-24T20:05:01.000Z",
  }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "provider-message-before-activation");
});

test("uncertain customer audio age fails closed", () => {
  const decision = decide(voice({ whatsappTimestamp: null }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "timestamp-uncertain");
});

test("audio first seen before activation remains historical even if provider time is later", () => {
  const decision = decide(voice({ firstReceivedAt: "2026-08-24T19:59:59.000Z" }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "first-seen-before-activation");
});

test("cross-account voice fails closed", () => {
  const decision = decide(voice({ communicationAccountId: "demac-wa-other" }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "communication-account-not-active");
});

test("voice does not accept a duplicated communication account field from Maya policy settings", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voice(),
    settings: { ...settings, activeCommunicationAccountId: "demac-wa-corporate" },
    communicationSettings: {},
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "active-communication-account-not-configured");
});

test("same transcription version is idempotent", () => {
  const decision = decide(voice({
    transcriptionStatus: "completed",
    transcriptionVersion: "customer-voice-v1",
    rawTranscript: "Necesito cancelar mañana.",
  }));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "already-transcribed-current-version");
});

test("unsafe historical backfill setting fails closed instead of scanning old media", () => {
  const decision = decide(voice(), { ...settings, voiceHistoricalBackfillEnabled: true });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "historical-backfill-policy-unsafe");
});
