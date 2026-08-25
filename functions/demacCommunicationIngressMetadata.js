const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  communicationIdentityDecision,
  resolveCommunicationAccountId,
} = require("./demacCommunicationIdentity");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const INGRESS_METADATA_VERSION = 1;

function safeDocumentId(value) {
  return String(value || "unknown").replaceAll("/", "_").replaceAll("#", "_").slice(0, 1200);
}

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
    const conversationId = safeDocumentId(message.conversationId || message.chat || message.phone);
    const messagePatch = {
      firstReceivedAt: FieldValue.serverTimestamp(),
      firstIngestedAtIso: new Date().toISOString(),
      ingressMetadataVersion: INGRESS_METADATA_VERSION,
      remoteConversationId: identity.remoteConversationId || null,
      ...(identity.communicationAccountId ? { communicationAccountId: identity.communicationAccountId } : {}),
      communicationIdentityStatus: identity.decision.valid ? "verified" : identity.decision.reason,
    };

    if (!conversationId || conversationId === "unknown") {
      await snapshot.ref.set(messagePatch, { merge: true });
      return;
    }

    const conversationRef = db.collection("communicationConversations").doc(conversationId);
    await db.runTransaction(async (transaction) => {
      const conversationSnapshot = await transaction.get(conversationRef);
      const conversation = conversationSnapshot.exists ? conversationSnapshot.data() || {} : {};
      const existingAccount = cleanText(conversation.communicationAccountId, 180).toLowerCase();
      const accountConflict = Boolean(
        identity.communicationAccountId
        && existingAccount
        && identity.communicationAccountId !== existingAccount,
      );
      transaction.set(snapshot.ref, {
        ...messagePatch,
        conversationId,
        communicationIdentityStatus: accountConflict ? "communication-account-conflict" : messagePatch.communicationIdentityStatus,
      }, { merge: true });
      if (!accountConflict) {
        transaction.set(conversationRef, {
          remoteConversationId: identity.remoteConversationId || conversation.remoteConversationId || null,
          ...(identity.communicationAccountId ? { communicationAccountId: identity.communicationAccountId } : {}),
          ownershipVersion: Number.isSafeInteger(Number(conversation.ownershipVersion))
            ? Number(conversation.ownershipVersion)
            : 0,
          communicationIdentityStatus: identity.decision.valid ? "verified" : identity.decision.reason,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });
  },
);

module.exports.INGRESS_METADATA_VERSION = INGRESS_METADATA_VERSION;
module.exports.ingressIdentityFromMessage = ingressIdentityFromMessage;
