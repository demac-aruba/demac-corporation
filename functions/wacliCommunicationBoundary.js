const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  canonicalConversationDocumentId,
  canonicalMessageStatusDocumentId,
  canonicalProviderMessageDocumentId,
  configuredCommunicationAccountId,
  normalizeCommunicationAccountId,
  normalizeRemoteConversationId,
} = require("./demacCommunicationIdentity");
const { communicationEpochDecision, nonNegativeEpoch } = require("./demacCustomerTurn");

const WACLI_CHANNEL = "whatsapp";
const WACLI_PROVIDER = "wacli";
const WACLI_COMMUNICATION_ACCOUNT_HEADER = "x-demac-communication-account-id";
const WACLI_OUTBOUND_CLASSES = Object.freeze({
  TRANSACTIONAL: "transactional",
  HUMAN: "conversation_human",
  MAYA: "conversation_maya",
});

function requestHeader(request, name) {
  const fromGetter = request?.get?.(name);
  if (fromGetter !== undefined && fromGetter !== null && String(fromGetter).trim()) return String(fromGetter);
  const headers = request?.headers && typeof request.headers === "object" ? request.headers : {};
  return String(headers[name] || headers[name.toLowerCase()] || "");
}

function assertedCommunicationAccountId(request = {}) {
  return normalizeCommunicationAccountId(requestHeader(request, WACLI_COMMUNICATION_ACCOUNT_HEADER));
}

function wacliCommunicationAccountDecision({ request = {}, settings = {} } = {}) {
  const configured = configuredCommunicationAccountId(settings);
  const asserted = assertedCommunicationAccountId(request);
  if (!configured) {
    return { allowed: false, reason: "communication-account-not-configured", configuredAccountId: "", assertedAccountId: asserted };
  }
  if (!asserted) {
    return { allowed: false, reason: "communication-account-header-missing", configuredAccountId: configured, assertedAccountId: "" };
  }
  if (asserted !== configured) {
    return { allowed: false, reason: "communication-account-mismatch", configuredAccountId: configured, assertedAccountId: asserted };
  }
  return { allowed: true, reason: "communication-account-bound", configuredAccountId: configured, assertedAccountId: asserted };
}

function normalizeWacliRemoteConversationId(value) {
  const remote = normalizeRemoteConversationId(value);
  if (!remote) return "";
  if (remote.includes("@")) return remote;
  const digits = remote.replace(/\D/g, "");
  return /^\d{8,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : remote;
}

function wacliCanonicalIdentity({ communicationAccountId, chat, providerMessageId = "" } = {}) {
  const remoteConversationId = normalizeWacliRemoteConversationId(chat);
  const message = {
    communicationAccountId,
    channel: WACLI_CHANNEL,
    provider: WACLI_PROVIDER,
    remoteConversationId,
  };
  return {
    communicationAccountId: normalizeCommunicationAccountId(communicationAccountId),
    channel: WACLI_CHANNEL,
    provider: WACLI_PROVIDER,
    remoteConversationId,
    conversationId: canonicalConversationDocumentId({ message }),
    messageId: providerMessageId
      ? canonicalProviderMessageDocumentId({ message, providerMessageId: cleanText(providerMessageId, 300) })
      : "",
  };
}

function wacliCanonicalStatusId({ communicationAccountId, chat, providerMessageId, status, providerTimestamp } = {}) {
  const message = {
    communicationAccountId,
    channel: WACLI_CHANNEL,
    provider: WACLI_PROVIDER,
    remoteConversationId: normalizeWacliRemoteConversationId(chat),
  };
  return canonicalMessageStatusDocumentId({
    message,
    providerMessageId: cleanText(providerMessageId, 300),
    status: cleanText(status, 80),
    providerTimestamp: cleanText(providerTimestamp, 120),
  });
}

function safeEpoch(value) {
  const normalized = Number(value || 0);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : 0;
}

function assignedCustomerInputVersion({ currentConversation = {}, existingMessage = {}, inbound = false, messageExists = false } = {}) {
  const current = safeEpoch(currentConversation.customerInputVersion);
  if (!inbound) return null;
  if (messageExists) {
    const existing = Number(existingMessage.customerInputVersion);
    return Number.isSafeInteger(existing) && existing > 0 ? existing : current;
  }
  return current + 1;
}

function wacliOutboundClaimDecision({ queueItem = {}, conversation = null, communicationAccountId = "" } = {}) {
  const account = normalizeCommunicationAccountId(communicationAccountId);
  const queueAccount = normalizeCommunicationAccountId(queueItem.communicationAccountId);
  if (!account || !queueAccount || account !== queueAccount) {
    return { allowed: false, reason: "communication-account-mismatch" };
  }
  if (cleanText(queueItem.provider, 40).toLowerCase() !== WACLI_PROVIDER) {
    return { allowed: false, reason: "provider-not-wacli" };
  }
  const outboundClass = cleanText(queueItem.outboundClass, 80).toLowerCase();
  if (outboundClass === WACLI_OUTBOUND_CLASSES.TRANSACTIONAL) {
    return { allowed: true, reason: "transactional-send-authorized", outboundClass };
  }
  if (![WACLI_OUTBOUND_CLASSES.HUMAN, WACLI_OUTBOUND_CLASSES.MAYA].includes(outboundClass)) {
    return { allowed: false, reason: "outbound-class-missing-or-unsupported", outboundClass };
  }
  if (!conversation || typeof conversation !== "object") {
    return { allowed: false, reason: "conversation-required", outboundClass };
  }
  const conversationAccount = normalizeCommunicationAccountId(conversation.communicationAccountId);
  if (!conversationAccount || conversationAccount !== account) {
    return { allowed: false, reason: "conversation-account-mismatch", outboundClass };
  }
  if (cleanText(conversation.provider, 40).toLowerCase() !== WACLI_PROVIDER) {
    return { allowed: false, reason: "conversation-provider-mismatch", outboundClass };
  }

  if (outboundClass === WACLI_OUTBOUND_CLASSES.MAYA) {
    if (conversation.aiDisposition !== "ai_active" || conversation.ownerUserId || conversation.lockedByUserId) {
      return { allowed: false, reason: "maya-sender-ownership-invalid", outboundClass };
    }
    const epochDecision = communicationEpochDecision({
      conversation,
      expectedOwnershipVersion: queueItem.expectedOwnershipVersion,
      expectedCustomerInputVersion: queueItem.expectedCustomerInputVersion,
    });
    return epochDecision.allowed
      ? { allowed: true, reason: "maya-send-authorized", outboundClass }
      : { allowed: false, reason: "stale-communication-epoch", epochReason: epochDecision.reason, outboundClass };
  }

  if (conversation.aiDisposition !== "human_active" || (!conversation.ownerUserId && !conversation.lockedByUserId)) {
    return { allowed: false, reason: "human-sender-ownership-invalid", outboundClass };
  }
  const expectedOwnership = nonNegativeEpoch(queueItem.expectedOwnershipVersion);
  const currentOwnership = nonNegativeEpoch(conversation.ownershipVersion);
  if (expectedOwnership === null || currentOwnership === null) {
    return { allowed: false, reason: "ownership-version-missing", outboundClass };
  }
  if (expectedOwnership !== currentOwnership) {
    return { allowed: false, reason: "ownership-version-changed", outboundClass };
  }
  return { allowed: true, reason: "human-send-authorized", outboundClass };
}

module.exports = {
  WACLI_CHANNEL,
  WACLI_COMMUNICATION_ACCOUNT_HEADER,
  WACLI_OUTBOUND_CLASSES,
  WACLI_PROVIDER,
  assertedCommunicationAccountId,
  assignedCustomerInputVersion,
  normalizeWacliRemoteConversationId,
  requestHeader,
  safeEpoch,
  wacliCanonicalIdentity,
  wacliCanonicalStatusId,
  wacliCommunicationAccountDecision,
  wacliOutboundClaimDecision,
};
