const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const {
  DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS,
  configuredVoiceMaxAttempts,
  processingLeaseActive,
  safeTranscriptionAttempts,
  sameEligibilityValue,
} = require("./voiceTranscription");

test("invalid voice max-attempt configuration falls back to bounded default", () => {
  assert.equal(configuredVoiceMaxAttempts(undefined), DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS);
  assert.equal(configuredVoiceMaxAttempts("not-a-number"), DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS);
  assert.equal(configuredVoiceMaxAttempts(0), DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS);
  assert.equal(configuredVoiceMaxAttempts(999), DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS);
  assert.equal(configuredVoiceMaxAttempts(5), 5);
});

test("malformed stored transcription attempts cannot disable the retry cap", () => {
  assert.equal(safeTranscriptionAttempts("bad"), 0);
  assert.equal(safeTranscriptionAttempts(-1), 0);
  assert.equal(safeTranscriptionAttempts(2), 2);
});

test("processing lease suppresses duplicate transcription only while current", () => {
  const now = Date.parse("2026-08-25T03:00:00.000Z");
  const current = {
    transcriptionStatus: "processing",
    transcriptionVersion: "voice-v1",
    transcriptionStartedAt: { toMillis: () => now - 60_000 },
  };
  assert.equal(processingLeaseActive(current, "voice-v1", now), true);
  assert.equal(processingLeaseActive({
    ...current,
    transcriptionStartedAt: { toMillis: () => now - (11 * 60_000) },
  }, "voice-v1", now), false);
  assert.equal(processingLeaseActive(current, "voice-v2", now), false);
});

test("equivalent Firestore timestamp objects do not retrigger voice eligibility", () => {
  const at = Date.parse("2026-08-25T03:00:00.000Z");
  assert.equal(sameEligibilityValue(
    "firstReceivedAt",
    { toMillis: () => at },
    { toMillis: () => at },
  ), true);
});
