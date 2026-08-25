const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const customerAgentCommunication = require("./demacCustomerAgentCommunication");
const {
  canonicalVoiceRuntimeMessage,
  customerSemanticContent,
  messageMediaType,
} = require("./demacCustomerTurn");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
  mayaReplyDecision,
} = require("./demacCustomerAgentReplyPolicy");
const {
  COMMUNICATION_SETTINGS_COLLECTION,
  COMMUNICATION_SETTINGS_DOCUMENT,
} = require("./demacCommunicationIdentity");
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
  return cleanText(message.conversationId, 300);
}

async function loadMayaReplySettings() {
  const snapshot = await db.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT).get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

async function loadCommunicationSettings() {
  const snapshot = await db.collection(COMMUNICATION_SETTINGS_COLLECTION).doc(COMMUNICATION_SETTINGS_DOCUMENT).get();
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
  const [settings, communicationSettings] = await Promise.all([
    loadMayaReplySettings(),
    loadCommunicationSettings(),
  ]);
  const conversationId = conversationIdentity(message);
  if (!conversationId) {
    return {
      decision: { allowed: false, reason: "missing-canonical-conversation-id" },
      conversationId: "",
      conversation: {},
      settings,
      communicationSettings,
    };
  }
  const conversationSnapshot = await db.collection("communicationConversations").doc(conversationId).get();
  const conversation = conversationSnapshot.exists ? conversationSnapshot.data() || {} : {};
  const decision = mayaReplyDecision({
    message,
    conversation,
    settings,
    communicationSettings,
    isNewContact: policyContext.isNewContact === true,
    authorizedWorkflow: cleanText(policyContext.authorizedWorkflow, 80),
  });
  await recordObservationState({ conversationId, decision });
  return { decision, conversationId, conversation, settings, communicationSettings };
}

async function evaluateConversationPolicy(conversationId, conversation = {}) {
  const [settings, communicationSettings] = await Promise.all([
    loadMayaReplySettings(),
    loadCommunicationSettings(),
  ]);
  const decision = mayaReplyDecision({ conversation, settings, communicationSettings });
  await recordObservationState({ conversationId, decision });
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
    const mediaType = messageMediaType(message);
    if (["audio", "voice"].includes(mediaType) && !customerSemanticContent(message, 8_000)) return;

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
module.exports.loadCommunicationSettings = loadCommunicationSettings;
module.exports.loadMayaReplySettings = loadMayaReplySettings;
module.exports.voiceTranscriptBecameReady = voiceTranscriptBecameReady;
module.exports.voiceTranscriptRuntimeMessage = voiceTranscriptRuntimeMessage;
