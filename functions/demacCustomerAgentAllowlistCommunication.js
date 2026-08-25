const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const customerAgentCommunication = require("./demacCustomerAgentCommunication");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
  mayaReplyDecision,
} = require("./demacCustomerAgentReplyPolicy");
const { cleanText } = require("./bookingSchedulingPrimitives");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function conversationIdentity(message = {}) {
  return cleanText(message.conversationId || message.chat || message.phone, 300);
}

async function loadMayaReplySettings() {
  const snapshot = await db.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT).get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

async function recordObservationState({ conversationId, decision }) {
  if (!conversationId) return;
  try {
    await db.collection("communicationConversations").doc(safeDocumentId(conversationId)).set({
      mayaMode: decision.allowed ? "pilot_active" : "observe_only",
      mayaAutoReplyAllowed: decision.allowed,
      mayaAutoReplyDecisionReason: decision.reason,
      mayaAutoReplyPolicyCheckedAt: FieldValue.serverTimestamp(),
      mayaAutoReplyPolicyCheckedAtIso: new Date().toISOString(),
    }, { merge: true });
  } catch (error) {
    logger.warn("Could not persist Maya observation policy state; message remains stored in Communication Center.", {
      conversationId,
      errorMessage: error?.message || String(error),
    });
  }
}

async function evaluateInboundPolicy(message = {}, policyContext = {}) {
  const settings = await loadMayaReplySettings();
  const conversationId = conversationIdentity(message);
  const conversationSnapshot = conversationId
    ? await db.collection("communicationConversations").doc(safeDocumentId(conversationId)).get()
    : null;
  const conversation = conversationSnapshot?.exists ? conversationSnapshot.data() || {} : {};
  const decision = mayaReplyDecision({
    message,
    conversation,
    settings,
    isNewContact: policyContext.isNewContact === true,
    authorizedWorkflow: cleanText(policyContext.authorizedWorkflow, 80),
  });
  await recordObservationState({ conversationId, decision });
  return { decision, conversationId, conversation, settings };
}

async function evaluateConversationPolicy(conversationId, conversation = {}) {
  const settings = await loadMayaReplySettings();
  const decision = mayaReplyDecision({ conversation, settings });
  await recordObservationState({ conversationId, decision });
  return decision;
}

function voiceTranscriptBecameReady(before = {}, after = {}) {
  const mediaType = cleanText(after.mediaType || after.type, 40).toLowerCase();
  if (!["audio", "voice"].includes(mediaType) || after.direction !== "inbound") return false;
  const beforeTranscript = cleanText(before.rawTranscript || before.transcript, 8_000);
  const afterTranscript = cleanText(after.rawTranscript || after.transcript, 8_000);
  return after.transcriptionStatus === "completed" && Boolean(afterTranscript) && afterTranscript !== beforeTranscript;
}

function voiceTranscriptRuntimeMessage(message = {}) {
  const transcript = cleanText(message.rawTranscript || message.transcript, 8_000);
  if (!transcript) return null;
  return {
    ...message,
    text: transcript,
    mediaCaption: "",
    mayaInputModality: "voice_transcript",
  };
}

exports.processCustomerAgentInbound = onDocumentCreated(
  {
    document: "whatsappMessages/{messageId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    retry: true,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const message = { id: snapshot.id, ...snapshot.data() };
    if (!message || message.direction !== "inbound") return;
    const mediaType = cleanText(message.mediaType || message.type, 40).toLowerCase();
    if (["audio", "voice"].includes(mediaType) && !cleanText(message.rawTranscript || message.transcript, 8_000)) {
      return;
    }

    const runtimeMessage = ["audio", "voice"].includes(mediaType)
      ? voiceTranscriptRuntimeMessage(message)
      : message;
    if (!runtimeMessage) return;
    const { decision } = await evaluateInboundPolicy(runtimeMessage);
    if (!decision.allowed) {
      logger.info("Maya observed inbound WhatsApp message without replying.", {
        messageId: cleanText(message.messageId || snapshot.id, 300),
        phone: decision.phone || null,
        reason: decision.reason,
      });
      return;
    }

    await customerAgentCommunication.processQueueEvent({
      messageId: cleanText(message.messageId || snapshot.id, 300),
      message: runtimeMessage,
    });
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
    const { decision } = await evaluateInboundPolicy(runtimeMessage);
    if (!decision.allowed) {
      logger.info("Maya understood customer voice but Reply Policy kept it observe-only.", {
        messageId: cleanText(after.messageId || event.params.messageId, 300),
        phone: decision.phone || null,
        reason: decision.reason,
      });
      return;
    }
    await customerAgentCommunication.processQueueEvent({
      messageId: cleanText(after.messageId || event.params.messageId, 300),
      message: runtimeMessage,
    });
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

    const decision = await evaluateConversationPolicy(event.params.conversationId, after);
    if (!decision.allowed) {
      logger.info("Maya conversation reactivation stayed in observe-only mode because Reply Policy blocked it.", {
        conversationId: event.params.conversationId,
        phone: decision.phone || null,
        reason: decision.reason,
      });
      return;
    }

    await customerAgentCommunication.reactivateConversation(event.params.conversationId, after);
  },
);

module.exports.MAYA_SETTINGS_COLLECTION = MAYA_SETTINGS_COLLECTION;
module.exports.MAYA_SETTINGS_DOCUMENT = MAYA_SETTINGS_DOCUMENT;
module.exports.conversationIdentity = conversationIdentity;
module.exports.evaluateConversationPolicy = evaluateConversationPolicy;
module.exports.evaluateInboundPolicy = evaluateInboundPolicy;
module.exports.loadMayaReplySettings = loadMayaReplySettings;
module.exports.voiceTranscriptBecameReady = voiceTranscriptBecameReady;
module.exports.voiceTranscriptRuntimeMessage = voiceTranscriptRuntimeMessage;
