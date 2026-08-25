const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  canonicalConversationDocumentId,
  canonicalMessageStatusDocumentId,
  canonicalProviderMessageDocumentId,
  configuredCommunicationAccountId,
  normalizeCommunicationAccountId,
  normalizeRemoteConversationId,
} = require("./demacCommunicationIdentity");

const WACLI_CHANNEL = "whatsapp";
const WACLI_PROVIDER = "wacli";
const WACLI_COMMUNICATION_ACCOUNT_HEADER = "x-demac-communication-account-id";

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

module.exports = {
  WACLI_CHANNEL,
  WACLI_COMMUNICATION_ACCOUNT_HEADER,
  WACLI_PROVIDER,
  assertedCommunicationAccountId,
  assignedCustomerInputVersion,
  normalizeWacliRemoteConversationId,
  requestHeader,
  safeEpoch,
  wacliCanonicalIdentity,
  wacliCanonicalStatusId,
  wacliCommunicationAccountDecision,
};
