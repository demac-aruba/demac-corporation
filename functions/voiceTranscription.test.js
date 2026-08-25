const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const {
  DEFAULT_CUSTOMER_VOICE_MAX_ATTEMPTS,
  configuredVoiceMaxAttempts,
  finalizeCustomerVoiceClaim,
  processingLeaseActive,
  safeTranscriptionAttempts,
  sameEligibilityValue,
} = require("./voiceTranscription");

class FakeRef {
  constructor(path) {
    this.path = path;
    this.id = path.split("/").pop();
  }
}

class FakeSnapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value !== undefined;
    this.value = value;
  }
  data() { return this.value; }
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(Object.entries(seed).map(([key, value]) => [key, { ...value }]));
  }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => new FakeSnapshot(ref, this.docs.get(ref.path)),
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const current = this.docs.get(write.ref.path) || {};
      this.docs.set(write.ref.path, write.merge ? { ...current, ...write.value } : { ...write.value });
    }
    return result;
  }
  read(path) { return this.docs.get(path); }
}

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

test("stale transcription worker cannot finalize after a newer claim replaces it", async () => {
  const ref = new FakeRef("whatsappMessages/MSG-VOICE-1");
  const db = new FakeDb({
    [ref.path]: {
      transcriptionStatus: "processing",
      transcriptionClaimId: "claim-new",
      transcriptionVersion: "voice-v1",
      rawTranscript: null,
    },
  });
  const written = await finalizeCustomerVoiceClaim(
    ref,
    "claim-old",
    "voice-v1",
    { transcriptionStatus: "completed", rawTranscript: "stale transcript" },
    db,
  );
  assert.equal(written, false);
  assert.equal(db.read(ref.path).transcriptionStatus, "processing");
  assert.equal(db.read(ref.path).rawTranscript, null);
  assert.equal(db.read(ref.path).transcriptionClaimId, "claim-new");
});

test("transcription finalization also rejects a stale processing version", async () => {
  const ref = new FakeRef("whatsappMessages/MSG-VOICE-2");
  const db = new FakeDb({
    [ref.path]: {
      transcriptionStatus: "processing",
      transcriptionClaimId: "claim-current",
      transcriptionVersion: "voice-v2",
      rawTranscript: null,
    },
  });
  const written = await finalizeCustomerVoiceClaim(
    ref,
    "claim-current",
    "voice-v1",
    { transcriptionStatus: "completed", rawTranscript: "old-version transcript" },
    db,
  );
  assert.equal(written, false);
  assert.equal(db.read(ref.path).transcriptionVersion, "voice-v2");
  assert.equal(db.read(ref.path).rawTranscript, null);
});

test("current transcription claim and version may finalize exactly once", async () => {
  const ref = new FakeRef("whatsappMessages/MSG-VOICE-3");
  const db = new FakeDb({
    [ref.path]: {
      transcriptionStatus: "processing",
      transcriptionClaimId: "claim-current",
      transcriptionVersion: "voice-v1",
      rawTranscript: null,
    },
  });
  const written = await finalizeCustomerVoiceClaim(
    ref,
    "claim-current",
    "voice-v1",
    { transcriptionStatus: "completed", rawTranscript: "Mi cita ta mañan" },
    db,
  );
  assert.equal(written, true);
  assert.equal(db.read(ref.path).transcriptionStatus, "completed");
  assert.equal(db.read(ref.path).rawTranscript, "Mi cita ta mañan");
});
