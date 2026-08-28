const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  canonicalConversationDocumentId,
  communicationIdentityDecision,
  resolveCommunicationAccountId,
} = require("./demacCommunicationIdentity");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const INGRESS_METADATA_VERSION = 3;

function ingressIdentityFromMessage(message = {}) {
  const raw = message.raw && typeof message.raw === "object" ? message.raw : {};
  const communicationAccountId = resolveCommunicationAccountId({ message, payload: raw });
  const remoteConversationId = cleanText(message.remoteConversationId || message.chat || raw.Chat, 300);
  const provider = cleanText(message.provider || "wacli", 40).toLowerCase();
  const channel = cleanText(message.channel || "whatsapp", 40).toLowerCase();
  const decision = communicationIdentityDecision({
    message: {
      ...message,
      communicationAccountId,
      remoteConversationId,
      provider,
      channel,
    },
  });
  return { communicationAccountId, remoteConversationId, provider, channel, decision };
}

function expectedCanonicalConversationId(identity = {}) {
  if (identity.decision?.valid !== true) return "";
  return canonicalConversationDocumentId({
    message: {
      communicationAccountId: identity.communicationAccountId,
      remoteConversationId: identity.remoteConversationId,
      provider: identity.provider,
      channel: identity.channel,
    },
  });
}

function conversationVerificationDecision({ identity = {}, conversationId = "", conversationExists = false, conversation = {} } = {}) {
  if (!conversationExists) return { valid: false, reason: "canonical-conversation-missing" };
  const expectedConversationId = expectedCanonicalConversationId(identity);
  const actualConversationId = cleanText(conversationId, 300);
  if (!expectedConversationId || !actualConversationId || actualConversationId !== expectedConversationId) {
    return { valid: false, reason: "canonical-conversation-id-mismatch" };
  }
  const messageAccount = cleanText(identity.communicationAccountId, 180).toLowerCase();
  const conversationAccount = cleanText(conversation.communicationAccountId, 180).toLowerCase();
  if (messageAccount && conversationAccount && messageAccount !== conversationAccount) {
    return { valid: false, reason: "communication-account-conflict" };
  }
  const messageRemote = cleanText(identity.remoteConversationId, 300);
  const conversationRemote = cleanText(conversation.remoteConversationId, 300);
  if (messageRemote && conversationRemote && messageRemote !== conversationRemote) {
    return { valid: false, reason: "remote-conversation-conflict" };
  }
  return { valid: identity.decision?.valid === true, reason: identity.decision?.valid ? "verified" : identity.decision?.reason || "identity-unverified" };
}

exports.stampCommunicationMessageFirstSeen = onDocumentCreated(
  {
    document: "whatsappMessages/{messageId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const message = { id: snapshot.id, ...snapshot.data() };
    const identity = ingressIdentityFromMessage(message);
    const conversationId = cleanText(message.conversationId, 300);
    const messagePatch = {
      firstReceivedAt: message.firstReceivedAt || FieldValue.serverTimestamp(),
      firstIngestedAtIso: cleanText(message.firstIngestedAtIso, 120) || new Date().toISOString(),
      ingressMetadataVersion: INGRESS_METADATA_VERSION,
      remoteConversationId: identity.remoteConversationId || null,
      ...(identity.communicationAccountId ? { communicationAccountId: identity.communicationAccountId } : {}),
      communicationIdentityStatus: identity.decision.valid ? "verified" : identity.decision.reason,
    };

    if (!conversationId || conversationId.includes("/")) {
      await snapshot.ref.set({
        ...messagePatch,
        communicationIdentityStatus: conversationId ? "invalid-canonical-conversation-id" : "missing-canonical-conversation-id",
      }, { merge: true });
      return;
    }

    const conversationRef = db.collection("communicationConversations").doc(conversationId);
    await db.runTransaction(async (transaction) => {
      const conversationSnapshot = await transaction.get(conversationRef);
      const conversation = conversationSnapshot.exists ? conversationSnapshot.data() || {} : {};
      const verification = conversationVerificationDecision({
        identity,
        conversationId,
        conversationExists: conversationSnapshot.exists,
        conversation,
      });
      transaction.set(snapshot.ref, {
        ...messagePatch,
        conversationId,
        communicationIdentityStatus: verification.reason,
      }, { merge: true });
      if (conversationSnapshot.exists && verification.valid) {
        transaction.set(conversationRef, {
          communicationIdentityStatus: "verified",
          communicationIdentityVerifiedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });
  },
);

module.exports.INGRESS_METADATA_VERSION = INGRESS_METADATA_VERSION;
module.exports.conversationVerificationDecision = conversationVerificationDecision;
module.exports.expectedCanonicalConversationId = expectedCanonicalConversationId;
module.exports.ingressIdentityFromMessage = ingressIdentityFromMessage;
