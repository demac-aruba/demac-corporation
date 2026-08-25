const test = require("node:test");
const assert = require("node:assert/strict");

const { customerVoiceEligibilityDecision } = require("./demacCustomerVoiceEligibility");

const activation = "2026-08-24T20:00:00.000Z";
const settings = {
  activeCommunicationAccountId: "demac-wa-corporate",
  voiceTranscriptionEnabled: true,
  voiceTranscriptionEnabledAt: activation,
  voiceHistoricalBackfillEnabled: false,
  voiceTranscriptionVersion: "customer-voice-v1",
};

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

test("new inbound voice after activation is eligible", () => {
  const decision = customerVoiceEligibilityDecision({ message: voice(), settings });
  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, "eligible-new-inbound-voice");
  assert.equal(decision.transcriptionVersion, "customer-voice-v1");
});

test("outbound DEMAC audio can never initiate customer voice processing", () => {
  const decision = customerVoiceEligibilityDecision({ message: voice({ direction: "outbound" }), settings });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "not-canonical-inbound");
});

test("historical audio present at activation is not eligible", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voice({
      whatsappTimestamp: "2026-08-23T18:00:00.000Z",
      firstReceivedAt: "2026-08-23T18:00:01.000Z",
    }),
    settings,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "provider-message-before-activation");
});

test("historical provider replay after activation remains ineligible", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voice({
      whatsappTimestamp: "2026-08-23T18:00:00.000Z",
      firstReceivedAt: "2026-08-24T20:05:01.000Z",
    }),
    settings,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "provider-message-before-activation");
});

test("uncertain customer audio age fails closed", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voice({ whatsappTimestamp: null }),
    settings,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "timestamp-uncertain");
});

test("audio first seen before activation remains historical even if provider time is later", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voice({ firstReceivedAt: "2026-08-24T19:59:59.000Z" }),
    settings,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "first-seen-before-activation");
});

test("cross-account voice fails closed", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voice({ communicationAccountId: "demac-wa-other" }),
    settings,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "communication-account-not-active");
});

test("same transcription version is idempotent", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voice({
      transcriptionStatus: "completed",
      transcriptionVersion: "customer-voice-v1",
      rawTranscript: "Necesito cancelar mañana.",
    }),
    settings,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "already-transcribed-current-version");
});

test("unsafe historical backfill setting fails closed instead of scanning old media", () => {
  const decision = customerVoiceEligibilityDecision({
    message: voice(),
    settings: { ...settings, voiceHistoricalBackfillEnabled: true },
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "historical-backfill-policy-unsafe");
});
