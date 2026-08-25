const crypto = require("node:crypto");
const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { cleanText, hashId } = require("./bookingSchedulingPrimitives");
const { createMayaCustomerObserver, MAYA_OBSERVER_VERSION } = require("./demacCustomerObserver");
const { createCommunicationCaseService } = require("./demacCommunicationCaseService");
const {
  communicationEpochDecision,
  customerSemanticContent,
  messageMediaType,
  nonNegativeEpoch,
  positiveEpoch,
} = require("./demacCustomerTurn");
const {
  MAYA_SETTINGS_COLLECTION,
  MAYA_SETTINGS_DOCUMENT,
  mayaObservationDecision,
} = require("./demacCustomerAgentReplyPolicy");
const {
  COMMUNICATION_SETTINGS_COLLECTION,
  COMMUNICATION_SETTINGS_DOCUMENT,
} = require("./demacCommunicationIdentity");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const observer = createMayaCustomerObserver();
const cases = createCommunicationCaseService({ db });
const OBSERVER_LEASE_MS = 2 * 60 * 1000;

function safeDocumentId(value) {
  return String(value || "unknown").replaceAll("/", "_").replaceAll("#", "_").slice(0, 1200);
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function observerContent(message = {}) {
  return customerSemanticContent(message, 8_000);
}

function observerSourceFingerprint(message = {}, text = "") {
  return hashId(JSON.stringify({
    version: MAYA_OBSERVER_VERSION,
    messageId: cleanText(message.messageId || message.id, 300),
    transcriptionVersion: cleanText(message.transcriptionVersion, 80),
    customerInputVersion: positiveEpoch(message.customerInputVersion),
    text: cleanText(text, 8_000),
  }), 40);
}

function conversationDocumentId(message = {}) {
  return cleanText(message.conversationId, 300);
}

function observationLeaseActive(message = {}, fingerprint, now = Date.now()) {
  if (message.mayaObservationStatus !== "processing") return false;
  if (cleanText(message.mayaObservationFingerprint, 80) !== fingerprint) return false;
  const started = timestampMillis(message.mayaObservationStartedAt);
  return Boolean(started && started + OBSERVER_LEASE_MS > now);
}

async function claimObservation(messageRef, fingerprint) {
  const claimId = crypto.randomUUID();
  let result = { claimed: false, reason: "unknown" };
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(messageRef);
    if (!snapshot.exists) {
      result = { claimed: false, reason: "message-not-found" };
      return;
    }
    const current = snapshot.data() || {};
    if (
      current.mayaObservationStatus === "completed"
      && cleanText(current.mayaObservationFingerprint, 80) === fingerprint
    ) {
      result = { claimed: false, replayed: true, reason: "already-observed" };
      return;
    }
    if (observationLeaseActive(current, fingerprint)) {
      result = { claimed: false, reason: "observation-already-processing" };
      return;
    }
    transaction.set(messageRef, {
      mayaObservationStatus: "processing",
      mayaObservationVersion: MAYA_OBSERVER_VERSION,
      mayaObservationFingerprint: fingerprint,
      mayaObservationClaimId: claimId,
      mayaObservationStartedAt: FieldValue.serverTimestamp(),
      mayaObservationError: FieldValue.delete(),
    }, { merge: true });
    result = { claimed: true, claimId };
  });
  return result;
}

async function finalizeObservationClaim(messageRef, claimId, patch) {
  let written = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(messageRef);
    if (!snapshot.exists || cleanText(snapshot.data()?.mayaObservationClaimId, 120) !== claimId) return;
    transaction.set(messageRef, {
      ...patch,
      mayaObservationClaimId: FieldValue.delete(),
    }, { merge: true });
    written = true;
  });
  return written;
}

async function updateConversationIfCurrent({
  conversationRef,
  expectedOwnershipVersion,
  expectedCustomerInputVersion,
  patch,
}) {
  let result = { updated: false, reason: "unknown" };
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(conversationRef);
    if (!snapshot.exists) {
      result = { updated: false, reason: "communication-conversation-not-found" };
      return;
    }
    const epochDecision = communicationEpochDecision({
      conversation: snapshot.data() || {},
      expectedOwnershipVersion,
      expectedCustomerInputVersion,
    });
    if (!epochDecision.allowed) {
      result = { updated: false, reason: "stale-communication-epoch", epochReason: epochDecision.reason };
      return;
    }
    transaction.set(conversationRef, patch, { merge: true });
    result = { updated: true };
  });
  return result;
}

async function processObservedMessage({ messageId, message = {} } = {}) {
  if (message.direction !== "inbound") return { observed: false, reason: "not-canonical-inbound" };
  const text = observerContent(message);
  if (!text) return { observed: false, reason: "no-observer-content" };

  const conversationId = conversationDocumentId(message);
  if (!conversationId) return { observed: false, reason: "missing-canonical-conversation-id" };
  const [settingsSnapshot, communicationSettingsSnapshot, conversationSnapshot] = await Promise.all([
    db.collection(MAYA_SETTINGS_COLLECTION).doc(MAYA_SETTINGS_DOCUMENT).get(),
    db.collection(COMMUNICATION_SETTINGS_COLLECTION).doc(COMMUNICATION_SETTINGS_DOCUMENT).get(),
    db.collection("communicationConversations").doc(conversationId).get(),
  ]);
  if (!conversationSnapshot.exists) return { observed: false, reason: "canonical-conversation-not-materialized" };

  const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
  const communicationSettings = communicationSettingsSnapshot.exists ? communicationSettingsSnapshot.data() || {} : {};
  const conversation = conversationSnapshot.data() || {};
  const decision = mayaObservationDecision({ message, conversation, settings, communicationSettings });
  if (!decision.allowed) return { observed: false, reason: decision.reason };

  const expectedOwnershipVersion = nonNegativeEpoch(conversation.ownershipVersion);
  const expectedCustomerInputVersion = positiveEpoch(message.customerInputVersion);
  const fingerprint = observerSourceFingerprint(message, text);
  const messageRef = db.collection("whatsappMessages").doc(safeDocumentId(messageId));
  const claim = await claimObservation(messageRef, fingerprint);
  if (!claim.claimed) {
    return { observed: claim.replayed === true, replayed: claim.replayed === true, reason: claim.reason };
  }
  const conversationRef = db.collection("communicationConversations").doc(conversationId);

  try {
    const observation = await observer.observe({ apiKey: openAiApiKey.value(), text });
    let caseResult = { processed: false, reason: "stale-communication-epoch" };
    if (expectedOwnershipVersion !== null && expectedCustomerInputVersion !== null) {
      caseResult = await cases.processObservation({
        communicationAccountId: decision.identity?.communicationAccountId,
        conversationId,
        conversation,
        message: { id: messageId, ...message },
        observation,
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
      });
    }
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
    const conversationUpdate = expectedOwnershipVersion !== null && expectedCustomerInputVersion !== null
      ? await updateConversationIfCurrent({
        conversationRef,
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
        patch: {
          mayaObservationEnabled: true,
          mayaLastObservedMessageId: cleanText(message.messageId || messageId, 300),
          mayaLastObservedAt: FieldValue.serverTimestamp(),
          mayaInsight: operationalInsight,
          mayaAttentionRequired: operationalInsight.requiresAttention === true || Boolean(caseResult.attentionReason),
          mayaAttentionReason: caseResult.attentionReason || null,
          mayaCaseId: caseResult.caseId || null,
          mayaDispatchRisk: operationalInsight.dispatchRisk === true,
          updatedAt: FieldValue.serverTimestamp(),
        },
      })
      : { updated: false, reason: "stale-communication-epoch", epochReason: "observer-epoch-missing" };
    const suppressedReason = caseResult.reason === "stale-communication-epoch"
      ? caseResult.epochReason || caseResult.reason
      : conversationUpdate.reason === "stale-communication-epoch"
        ? conversationUpdate.epochReason || conversationUpdate.reason
        : "";
    const finalized = await finalizeObservationClaim(messageRef, claim.claimId, {
      mayaObservationStatus: "completed",
      mayaObservationVersion: MAYA_OBSERVER_VERSION,
      mayaObservationFingerprint: fingerprint,
      mayaObservation: operationalInsight,
      mayaObservationOperationalSuppressedReason: suppressedReason || null,
      mayaObservedAt: FieldValue.serverTimestamp(),
      mayaObservationError: FieldValue.delete(),
    });
    if (!finalized) return { observed: false, reason: "observer-claim-superseded" };
    return { observed: true, replayed: false, observation, caseResult, conversationUpdate };
  } catch (error) {
    await finalizeObservationClaim(messageRef, claim.claimId, {
      mayaObservationStatus: "failed",
      mayaObservationError: cleanText(error?.message || error, 500),
      mayaObservationFailedAt: FieldValue.serverTimestamp(),
    });
    if (expectedOwnershipVersion !== null && expectedCustomerInputVersion !== null) {
      await updateConversationIfCurrent({
        conversationRef,
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
        patch: {
          mayaAttentionRequired: true,
          mayaAttentionReason: "observer-failed",
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
    throw error;
  }
}

function transcriptBecameReady(before = {}, after = {}) {
  if (!["audio", "voice"].includes(messageMediaType(after))) return false;
  const beforeText = observerContent(before);
  const afterText = observerContent(after);
  return after.transcriptionStatus === "completed" && Boolean(afterText) && afterText !== beforeText;
}

// Service-only module: Firestore wake-up ownership belongs to the deferred customer-turn
// orchestrator. Keeping Observer as a service prevents parallel trigger families from
// independently racing Case/Dispatch and Reply Policy for the same customer turn.
module.exports.OBSERVER_LEASE_MS = OBSERVER_LEASE_MS;
module.exports.claimObservation = claimObservation;
module.exports.conversationDocumentId = conversationDocumentId;
module.exports.finalizeObservationClaim = finalizeObservationClaim;
module.exports.observationLeaseActive = observationLeaseActive;
module.exports.observerContent = observerContent;
module.exports.observerSourceFingerprint = observerSourceFingerprint;
module.exports.processObservedMessage = processObservedMessage;
module.exports.transcriptBecameReady = transcriptBecameReady;
module.exports.updateConversationIfCurrent = updateConversationIfCurrent;
