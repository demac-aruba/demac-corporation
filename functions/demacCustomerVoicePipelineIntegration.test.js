const test = require("node:test");
const assert = require("node:assert/strict");
const { getApps, initializeApp } = require("firebase-admin/app");

if (!getApps().length) initializeApp({ projectId: "demo-demac", storageBucket: "demo-demac.appspot.com" });

const { customerVoiceEligibilityDecision } = require("./demacCustomerVoiceEligibility");
const { transcribeStoredAudio } = require("./demacTranscriptionService");
const {
  voiceTranscriptBecameReady,
  voiceTranscriptRuntimeMessage,
} = require("./demacCustomerAgentAllowlistCommunication");
const {
  mayaBusinessActionDecision,
  mayaReplyDecision,
} = require("./demacCustomerAgentReplyPolicy");
const { buildRuntimeBody } = require("./demacCustomerAgentCommunication");

const CONVERSATION_ID = "COMM-2222222222222222222222222222222222222222";
const PHONE = "2975600140";

function storedAudio() {
  return {
    bucket() {
      return {
        file(storagePath) {
          assert.equal(storagePath, "communication/voice/MSG-VOICE-1.ogg");
          return {
            async getMetadata() { return [{ contentType: "audio/ogg" }]; },
            async download() { return [Buffer.from("fake-audio-bytes")]; },
          };
        },
      };
    },
  };
}

function inboundVoice(overrides = {}) {
  return {
    id: "MSG-VOICE-1",
    messageId: "MSG-VOICE-1",
    conversationId: CONVERSATION_ID,
    communicationAccountId: "demac-wa-corporate",
    provider: "wacli",
    channel: "whatsapp",
    remoteConversationId: `${PHONE}@s.whatsapp.net`,
    chat: `${PHONE}@s.whatsapp.net`,
    phone: PHONE,
    direction: "inbound",
    mediaType: "audio",
    storagePath: "communication/voice/MSG-VOICE-1.ogg",
    providerTimestamp: "2026-08-25T05:40:00.000Z",
    firstReceivedAt: "2026-08-25T05:40:01.000Z",
    customerInputVersion: 7,
    transcriptionStatus: "waiting_media",
    ...overrides,
  };
}

const voiceSettings = {
  voiceTranscriptionEnabled: true,
  voiceHistoricalBackfillEnabled: false,
  voiceTranscriptionEnabledAt: "2026-08-25T05:30:00.000Z",
  voiceTranscriptionVersion: "voice-v1",
};
const communicationSettings = { communicationAccountId: "demac-wa-corporate" };
const pilotSettings = {
  enabled: true,
  observationEnabled: true,
  autoReplyEnabled: true,
  replyMode: "pilot",
  autoReplyAllowlist: [PHONE],
  newContactAutoReplyEnabled: true,
  cancellationAutoReplyEnabled: true,
  rescheduleAutoReplyEnabled: true,
  autoCancelEnabled: false,
  autoRescheduleEnabled: false,
};

test("eligible new inbound voice reaches the same governed Maya runtime without enabling automatic cancellation", async () => {
  const before = inboundVoice();
  const eligibility = customerVoiceEligibilityDecision({
    message: before,
    settings: voiceSettings,
    communicationSettings,
  });
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reason, "eligible-new-inbound-voice");
  assert.equal(eligibility.transcriptionVersion, "voice-v1");

  let transcriptionRequests = 0;
  const transcription = await transcribeStoredAudio({
    storage: storedAudio(),
    storagePath: before.storagePath,
    apiKey: "test-api-key",
    prompt: "Preserve Aruba Papiamento exactly.",
    fetchImpl: async (url, options) => {
      transcriptionRequests += 1;
      assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-api-key");
      return {
        ok: true,
        status: 200,
        async json() { return { text: "Mi kier cancela mi cita pa mañan." }; },
      };
    },
  });
  assert.equal(transcriptionRequests, 1);
  assert.equal(transcription.transcript, "Mi kier cancela mi cita pa mañan.");
  assert.equal(transcription.storagePath, before.storagePath);
  assert.equal(transcription.contentType, "audio/ogg");

  const after = {
    ...before,
    transcriptionStatus: "completed",
    transcriptionVersion: eligibility.transcriptionVersion,
    rawTranscript: transcription.transcript,
  };
  assert.equal(voiceTranscriptBecameReady(before, after), true);

  const runtimeMessage = voiceTranscriptRuntimeMessage(after);
  assert.equal(runtimeMessage.id, before.id);
  assert.equal(runtimeMessage.customerInputVersion, 7);
  assert.equal(runtimeMessage.text, "Mi kier cancela mi cita pa mañan.");
  assert.equal(runtimeMessage.mayaInputModality, "voice_transcript");

  const reply = mayaReplyDecision({
    message: runtimeMessage,
    conversation: {
      communicationAccountId: "demac-wa-corporate",
      provider: "wacli",
      channel: "whatsapp",
      phone: PHONE,
    },
    settings: pilotSettings,
    communicationSettings,
  });
  assert.equal(reply.allowed, true);
  assert.equal(reply.reason, "allowlisted");

  const body = buildRuntimeBody({
    conversationId: CONVERSATION_ID,
    provider: "wacli",
    conversation: {
      communicationAccountId: "demac-wa-corporate",
      phone: PHONE,
      chatJid: `${PHONE}@s.whatsapp.net`,
      ownershipVersion: 2,
      customerInputVersion: 7,
      recentMessages: [],
    },
    inboundMessage: runtimeMessage,
  });
  assert.equal(body.conversationId, CONVERSATION_ID);
  assert.equal(body.ownershipVersion, 2);
  assert.equal(body.customerInputVersion, 7);
  assert.equal(body.inboundMessageId, "MSG-VOICE-1");
  assert.equal(body.conversation.customerTurn.text, "Mi kier cancela mi cita pa mañan.");
  assert.equal(body.conversation.customerTurn.customerInputVersion, 7);

  assert.deepEqual(
    mayaBusinessActionDecision({
      action: "cancel_appointment",
      settings: pilotSettings,
      ownershipAllowed: true,
    }),
    { allowed: false, reason: "auto-cancel-disabled" },
  );
});

test("pre-activation voice fails closed before shared transcription can be invoked", () => {
  const historical = inboundVoice({
    providerTimestamp: "2026-08-25T05:20:00.000Z",
    firstReceivedAt: "2026-08-25T05:20:01.000Z",
  });
  const eligibility = customerVoiceEligibilityDecision({
    message: historical,
    settings: voiceSettings,
    communicationSettings,
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "provider-message-before-activation");
});
