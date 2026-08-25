const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const {
  canonicalVoiceRuntimeMessage,
  customerSemanticContent,
  messageMediaType,
} = require("./demacCustomerTurn");
const { mayaReplyDecision } = require("./demacCustomerAgentReplyPolicy");
const { cleanText } = require("./bookingSchedulingPrimitives");
const { createCustomerTurnOrchestrator } = require("./demacCustomerTurnOrchestrator");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const turnOrchestrator = createCustomerTurnOrchestrator({ database: db });

function conversationIdentity(message = {}) {
  return cleanText(message.conversationId, 300);
}

async function loadMayaReplySettings() {
  return (await turnOrchestrator.loadSettings()).settings;
}

async function loadCommunicationSettings() {
  return (await turnOrchestrator.loadSettings()).communicationSettings;
}

async function recordObservationState({ conversationId, decision }) {
  return turnOrchestrator.recordPolicyState({ conversationId, decision });
}

async function evaluateInboundPolicy(message = {}, policyContext = {}) {
  return turnOrchestrator.evaluateInboundPolicy(message, policyContext);
}

async function evaluateConversationPolicy(conversationId, conversation = {}) {
  const { settings, communicationSettings } = await turnOrchestrator.loadSettings();
  const decision = mayaReplyDecision({ conversation, settings, communicationSettings });
  await turnOrchestrator.recordPolicyState({ conversationId, decision });
  return decision;
}

function voiceTranscriptBecameReady(before = {}, after = {}) {
  if (!["audio", "voice"].includes(messageMediaType(after)) || after.direction !== "inbound") return false;
  const beforeTranscript = customerSemanticContent(before, 8_000);
  const afterTranscript = customerSemanticContent(after, 8_000);
  return after.transcriptionStatus === "completed" && Boolean(afterTranscript) && afterTranscript !== beforeTranscript;
}

function voiceTranscriptRuntimeMessage(message = {}) {
  return canonicalVoiceRuntimeMessage(message);
}

async function scheduleRuntimeMessage(messageId, message) {
  const result = await turnOrchestrator.scheduleInboundTurn({ messageId, message });
  if (!result.scheduled) {
    logger.info("Maya customer turn was not scheduled.", {
      messageId,
      conversationId: conversationIdentity(message) || null,
      reason: result.reason,
    });
  }
  return result;
}

exports.processCustomerAgentInbound = onDocumentCreated(
  {
    document: "whatsappMessages/{messageId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    retry: true,
    // Keep the existing secret attachment until the production deployment inventory
    // is deliberately cut over; the trigger itself only schedules the governed turn.
    secrets: [openAiApiKey],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const message = { id: snapshot.id, ...snapshot.data() };
    if (message.direction !== "inbound") return;
    const mediaType = messageMediaType(message);
    if (["audio", "voice"].includes(mediaType) && !customerSemanticContent(message, 8_000)) return;
    const runtimeMessage = ["audio", "voice"].includes(mediaType)
      ? voiceTranscriptRuntimeMessage(message)
      : message;
    if (!runtimeMessage) return;
    await scheduleRuntimeMessage(cleanText(message.messageId || snapshot.id, 300), runtimeMessage);
  },
);

exports.processCustomerAgentVoiceTranscript = onDocumentUpdated(
  {
    document: "whatsappMessages/{messageId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    retry: true,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!voiceTranscriptBecameReady(before, after)) return;
    const runtimeMessage = voiceTranscriptRuntimeMessage({ id: event.params.messageId, ...after });
    if (!runtimeMessage) return;
    await scheduleRuntimeMessage(cleanText(after.messageId || event.params.messageId, 300), runtimeMessage);
  },
);

exports.processCustomerAgentReactivation = onDocumentUpdated(
  {
    document: "communicationConversations/{conversationId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    retry: true,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (before.aiDisposition === "ai_active" || after.aiDisposition !== "ai_active") return;
    if (after.ownerUserId || after.lockedByUserId) return;
    const result = await turnOrchestrator.scheduleConversationReactivation(event.params.conversationId, after);
    if (!result.scheduled) {
      logger.info("Maya reactivation did not schedule a customer turn.", {
        conversationId: event.params.conversationId,
        reason: result.reason,
      });
    }
  },
);

module.exports.conversationIdentity = conversationIdentity;
module.exports.evaluateConversationPolicy = evaluateConversationPolicy;
module.exports.evaluateInboundPolicy = evaluateInboundPolicy;
module.exports.loadCommunicationSettings = loadCommunicationSettings;
module.exports.loadMayaReplySettings = loadMayaReplySettings;
module.exports.recordObservationState = recordObservationState;
module.exports.scheduleRuntimeMessage = scheduleRuntimeMessage;
module.exports.voiceTranscriptBecameReady = voiceTranscriptBecameReady;
module.exports.voiceTranscriptRuntimeMessage = voiceTranscriptRuntimeMessage;
