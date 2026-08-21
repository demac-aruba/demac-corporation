const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const customerAgentCommunication = require("./demacCustomerAgentCommunication");
const { mayaReplyDecision } = require("./demacCustomerAgentReplyPolicy");
const { cleanText } = require("./bookingSchedulingPrimitives");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

const MAYA_SETTINGS_COLLECTION = "businessSettings";
const MAYA_SETTINGS_DOCUMENT = "customer-agent";

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function conversationIdentity(message = {}) {
  return cleanText(message.chat || message.conversationId || message.phone, 300);
}

async function loadMayaReplySettings() {
  const snapshot = await db.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT).get();
  return snapshot.exists ? snapshot.data() || {} : {};
}

async function recordObservationState({ conversationId, decision }) {
  if (!conversationId) return;
  try {
    await db.collection("communicationConversations").doc(safeDocumentId(conversationId)).set({
      mayaMode: decision.allowed ? "test_active" : "observe_only",
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

async function evaluateInboundPolicy(message = {}) {
  const settings = await loadMayaReplySettings();
  const decision = mayaReplyDecision({ message, settings });
  const conversationId = conversationIdentity(message);
  await recordObservationState({ conversationId, decision });
  return { decision, conversationId };
}

async function evaluateConversationPolicy(conversationId, conversation = {}) {
  const settings = await loadMayaReplySettings();
  const decision = mayaReplyDecision({ conversation, settings });
  await recordObservationState({ conversationId, decision });
  return decision;
}

exports.processCustomerAgentInbound = onDocumentCreated(
  {
    document: "whatsappMessages/{messageId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    retry: true,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const message = { id: snapshot.id, ...snapshot.data() };
    if (!message || message.direction !== "inbound") return;

    const { decision } = await evaluateInboundPolicy(message);
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
      message,
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
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (before.aiDisposition === "ai_active" || after.aiDisposition !== "ai_active") return;
    if (after.ownerUserId || after.lockedByUserId) return;

    const decision = await evaluateConversationPolicy(event.params.conversationId, after);
    if (!decision.allowed) {
      logger.info("Maya conversation reactivation stayed in observe-only mode because the phone is not allowlisted.", {
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
