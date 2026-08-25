const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const {
  customerVoiceUpdateMayChangeEligibility,
  sameEligibilityValue,
} = require("./voiceTranscription");

function timestamp(ms) {
  return { toMillis: () => ms };
}

test("equivalent Firestore timestamps do not retrigger voice eligibility by object identity", () => {
  assert.equal(sameEligibilityValue("firstReceivedAt", timestamp(1000), timestamp(1000)), true);
  assert.equal(sameEligibilityValue("firstIngestedAt", timestamp(2000), timestamp(2000)), true);
  assert.equal(sameEligibilityValue("firstReceivedAt", timestamp(1000), timestamp(1001)), false);
});

test("metadata rewrite with equal timestamp values does not wake voice transcription", () => {
  const before = {
    direction: "inbound",
    mediaType: "audio",
    communicationAccountId: "demac-wa-corporate",
    firstReceivedAt: timestamp(1000),
    firstIngestedAt: timestamp(1000),
    mediaUrl: "https://example.invalid/audio.ogg",
    transcriptionStatus: "waiting_media",
    transcriptionVersion: "customer-voice-v1",
  };
  const after = {
    ...before,
    firstReceivedAt: timestamp(1000),
    firstIngestedAt: timestamp(1000),
  };
  assert.equal(customerVoiceUpdateMayChangeEligibility(before, after), false);
});

test("a real media or eligibility field change still wakes voice processing", () => {
  const before = {
    direction: "inbound",
    mediaType: "voice",
    communicationAccountId: "demac-wa-corporate",
    firstReceivedAt: timestamp(1000),
    firstIngestedAt: timestamp(1000),
    mediaUrl: "",
    transcriptionStatus: "waiting_media",
    transcriptionVersion: "customer-voice-v1",
  };
  assert.equal(customerVoiceUpdateMayChangeEligibility(before, { ...before, mediaUrl: "https://example.invalid/audio.ogg" }), true);
});
