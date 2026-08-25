const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const {
  OBSERVER_LEASE_MS,
  observationLeaseActive,
  observerContent,
  observerSourceFingerprint,
  transcriptBecameReady,
} = require("./demacCustomerObserverCommunication");

test("Observer processing lease suppresses concurrent duplicate execution", () => {
  const now = Date.parse("2026-08-25T03:00:00.000Z");
  const fingerprint = "fingerprint-1";
  assert.equal(observationLeaseActive({
    mayaObservationStatus: "processing",
    mayaObservationFingerprint: fingerprint,
    mayaObservationStartedAt: { toMillis: () => now - 1_000 },
  }, fingerprint, now), true);
  assert.equal(observationLeaseActive({
    mayaObservationStatus: "processing",
    mayaObservationFingerprint: fingerprint,
    mayaObservationStartedAt: { toMillis: () => now - OBSERVER_LEASE_MS - 1 },
  }, fingerprint, now), false);
});

test("Observer fingerprint changes when current-turn epoch changes", () => {
  const base = {
    messageId: "MSG-1",
    transcriptionVersion: "voice-v1",
    customerInputVersion: 4,
  };
  assert.notEqual(
    observerSourceFingerprint(base, "Cancela mi cita"),
    observerSourceFingerprint({ ...base, customerInputVersion: 5 }, "Cancela mi cita"),
  );
});

test("voice Observer consumes only completed transcript provenance", () => {
  const before = {
    direction: "inbound",
    mediaType: "audio",
    transcriptionStatus: "processing",
    rawTranscript: "Cancela mi cita",
  };
  const after = {
    ...before,
    transcriptionStatus: "completed",
  };
  assert.equal(observerContent(before), "");
  assert.equal(observerContent(after), "Cancela mi cita");
  assert.equal(transcriptBecameReady(before, after), true);
});

test("Observer remains a service stage and cannot regain its own Firestore wake-up triggers", () => {
  const source = fs.readFileSync(path.join(__dirname, "demacCustomerObserverCommunication.js"), "utf8");
  assert.doesNotMatch(source, /onDocumentCreated|onDocumentUpdated/);
  assert.doesNotMatch(source, /exports\.observeCustomerInboundMessage|exports\.observeCustomerVoiceTranscript/);

  const bootstrap = fs.readFileSync(path.join(__dirname, "bootstrap.js"), "utf8");
  assert.doesNotMatch(bootstrap, /customerObserverCommunication/);
  assert.match(bootstrap, /processCustomerAgentTurnWakeup:\s*customerTurnOrchestrator\.processCustomerAgentTurnWakeup/);
});
