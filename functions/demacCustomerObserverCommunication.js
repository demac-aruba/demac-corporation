const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { cleanText, hashId } = require("./bookingSchedulingPrimitives");
const { createMayaCustomerObserver, MAYA_OBSERVER_VERSION } = require("./demacCustomerObserver");
const { createCommunicationCaseService } = require("./demacCommunicationCaseService");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
  mayaObservationDecision,
} = require("./demacCustomerAgentReplyPolicy");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const observer = createMayaCustomerObserver();
const cases = createCommunicationCaseService({ db });

function safeDocumentId(value) {
  return String(value || "unknown").replaceAll("/", "_").replaceAll("#", "_").slice(0, 1200);
}

function observerContent(message = {}) {
  const mediaType = cleanText(message.mediaType || message.type, 40).toLowerCase();
  if (["audio", "voice"].includes(mediaType)) {
    return cleanText(message.rawTranscript || message.transcript || message.normalizedTranscript, 8_000);
  }
  return cleanText(message.text || message.mediaCaption || message.reactionEmoji, 8_000);
}

function observerSourceFingerprint(message = {}, text = "") {
  return hashId(JSON.stringify({
    version: MAYA_OBSERVER_VERSION,
    messageId: cleanText(message.messageId || message.id, 300),
    transcriptionVersion: cleanText(message.transcriptionVersion, 80),
    text: cleanText(text, 8_000),
  }), 40);
}

function conversationDocumentId(message = {}) {
  return safeDocumentId(message.conversationId || message.chat || message.phone);
}

async function processObservedMessage({ messageId, message = {} } = {}) {
  if (message.direction !== "inbound") return { observed: false, reason: "not-canonical-inbound" };
  const text = observerContent(message);
  if (!text) return { observed: false, reason: "no-observer-content" };

  const settingsSnapshot = await db.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT).get();
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
  const conversationId = conversationDocumentId(message);
  if (!conversationId || conversationId === "unknown") return { observed: false, reason: "missing-conversation-identity" };
  const conversationRef = db.collection("communicationConversations").doc(conversationId);
  const conversationSnapshot = await conversationRef.get();
  const conversation = conversationSnapshot.exists ? conversationSnapshot.data() || {} : {};
  const decision = mayaObservationDecision({ message, conversation, settings });
  if (!decision.allowed) return { observed: false, reason: decision.reason };

  const fingerprint = observerSourceFingerprint(message, text);
  if (
    message.mayaObservationStatus === "completed"
    && cleanText(message.mayaObservationFingerprint, 80) === fingerprint
  ) {
    return { observed: true, replayed: true, reason: "already-observed" };
  }

  const messageRef = db.collection("whatsappMessages").doc(safeDocumentId(messageId));
  await messageRef.set({
    mayaObservationStatus: "processing",
    mayaObservationVersion: MAYA_OBSERVER_VERSION,
    mayaObservationFingerprint: fingerprint,
    mayaObservationStartedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    const observation = await observer.observe({ apiKey: openAiApiKey.value(), text });
    const caseResult = await cases.processObservation({
      communicationAccountId: decision.identity?.communicationAccountId,
      conversationId,
      conversation,
      message: { id: messageId, ...message },
      observation,
    });
    const operationalInsight = {
      intent: observation.intent,
      confidence: observation.confidence,
      summary: observation.summary,
      language: observation.language,
      requiresAttention: observation.requiresAttention,
      dispatchRisk: observation.dispatchRisk,
      caseId: caseResult.caseId || null,
      caseState: caseResult.state || null,
      appointmentId: caseResult.appointmentId || null,
      dispatchHoldActive: caseResult.dispatchHoldActive === true,
    };
    await messageRef.set({
      mayaObservationStatus: "completed",
      mayaObservationVersion: MAYA_OBSERVER_VERSION,
      mayaObservationFingerprint: fingerprint,
      mayaObservation: operationalInsight,
      mayaObservedAt: FieldValue.serverTimestamp(),
      mayaObservationError: FieldValue.delete(),
    }, { merge: true });
    await conversationRef.set({
      mayaObservationEnabled: true,
      mayaLastObservedMessageId: cleanText(message.messageId || messageId, 300),
      mayaLastObservedAt: FieldValue.serverTimestamp(),
      mayaInsight: operationalInsight,
      mayaAttentionRequired: operationalInsight.requiresAttention === true || Boolean(caseResult.attentionReason),
      mayaAttentionReason: caseResult.attentionReason || null,
      mayaCaseId: caseResult.caseId || null,
      mayaDispatchRisk: operationalInsight.dispatchRisk === true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { observed: true, replayed: false, observation, caseResult };
  } catch (error) {
    await messageRef.set({
      mayaObservationStatus: "failed",
      mayaObservationError: cleanText(error?.message || error, 500),
      mayaObservationFailedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await conversationRef.set({
      mayaAttentionRequired: true,
      mayaAttentionReason: "observer-failed",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

function transcriptBecameReady(before = {}, after = {}) {
  const mediaType = cleanText(after.mediaType || after.type, 40).toLowerCase();
  if (!["audio", "voice"].includes(mediaType)) return false;
  const beforeText = cleanText(before.rawTranscript || before.transcript || before.normalizedTranscript, 8_000);
  const afterText = cleanText(after.rawTranscript || after.transcript || after.normalizedTranscript, 8_000);
  return after.transcriptionStatus === "completed" && Boolean(afterText) && afterText !== beforeText;
}

exports.observeCustomerInboundMessage = onDocumentCreated(
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
    const mediaType = cleanText(message.mediaType || message.type, 40).toLowerCase();
    if (["audio", "voice"].includes(mediaType) && !observerContent(message)) return;
    await processObservedMessage({ messageId: snapshot.id, message });
  },
);

exports.observeCustomerVoiceTranscript = onDocumentUpdated(
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
    if (!transcriptBecameReady(before, after)) return;
    await processObservedMessage({ messageId: event.params.messageId, message: { id: event.params.messageId, ...after } });
  },
);

module.exports.conversationDocumentId = conversationDocumentId;
module.exports.observerContent = observerContent;
module.exports.observerSourceFingerprint = observerSourceFingerprint;
module.exports.processObservedMessage = processObservedMessage;
module.exports.transcriptBecameReady = transcriptBecameReady;
