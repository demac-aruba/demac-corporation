const { cleanText, hashId } = require("./bookingSchedulingPrimitives");

const COMMUNICATION_IDENTITY_VERSION = 2;
const SUPPORTED_CHANNELS = new Set(["whatsapp"]);
const SUPPORTED_PROVIDERS = new Set(["wacli", "meta"]);

function normalizedIdentityText(value, limit = 300) {
  return cleanText(value, limit);
}

function normalizeCommunicationAccountId(value) {
  return normalizedIdentityText(value, 180).toLowerCase();
}

function normalizeCommunicationChannel(value) {
  const channel = normalizedIdentityText(value, 40).toLowerCase();
  return SUPPORTED_CHANNELS.has(channel) ? channel : "";
}

function normalizeCommunicationProvider(value) {
  const provider = normalizedIdentityText(value, 40).toLowerCase();
  return SUPPORTED_PROVIDERS.has(provider) ? provider : "";
}

function normalizeRemoteConversationId(value) {
  return normalizedIdentityText(value, 300);
}

function configuredCommunicationAccountId(settings = {}) {
  return normalizeCommunicationAccountId(
    settings.communicationAccountId
      || settings.activeCommunicationAccountId
      || settings.wacliCommunicationAccountId,
  );
}

function resolveCommunicationAccountId({ message = {}, conversation = {}, payload = {} } = {}) {
  return normalizeCommunicationAccountId(
    message.communicationAccountId
      || conversation.communicationAccountId
      || payload.CommunicationAccountId
      || payload.communicationAccountId
      || payload.AccountId
      || payload.AccountID
      || payload?.Identity?.CommunicationAccountId
      || payload?.Identity?.AccountId
      || payload?.Identity?.AccountID,
  );
}

function communicationIdentityParts({ message = {}, conversation = {}, payload = {} } = {}) {
  const provider = normalizeCommunicationProvider(
    message.provider || conversation.provider || payload.provider || payload.Provider || "wacli",
  );
  const channel = normalizeCommunicationChannel(
    message.channel || conversation.channel || payload.channel || payload.Channel || "whatsapp",
  );
  const communicationAccountId = resolveCommunicationAccountId({ message, conversation, payload });
  const remoteConversationId = normalizeRemoteConversationId(
    message.remoteConversationId
      || conversation.remoteConversationId
      || message.chat
      || conversation.chatJid
      || conversation.externalChatId
      || payload.Chat,
  );
  return { communicationAccountId, channel, provider, remoteConversationId };
}

function communicationIdentityDecision(input = {}) {
  const identity = communicationIdentityParts(input);
  if (!identity.communicationAccountId) {
    return { valid: false, reason: "missing-communication-account-id", identity };
  }
  if (!identity.channel) return { valid: false, reason: "unsupported-channel", identity };
  if (!identity.provider) return { valid: false, reason: "unsupported-provider", identity };
  if (!identity.remoteConversationId) {
    return { valid: false, reason: "missing-remote-conversation-id", identity };
  }
  return { valid: true, reason: "ok", identity };
}

function canonicalConversationKey(input = {}) {
  const decision = communicationIdentityDecision(input);
  if (!decision.valid) return "";
  const { communicationAccountId, channel, provider, remoteConversationId } = decision.identity;
  return `${communicationAccountId}|${channel}|${provider}|${remoteConversationId}`;
}

function canonicalConversationDocumentId(input = {}) {
  const key = canonicalConversationKey(input);
  return key ? `COMM-${hashId(key, 40).toUpperCase()}` : "";
}

function canonicalProviderMessageKey({ providerMessageId, ...input } = {}) {
  const conversationKey = canonicalConversationKey(input);
  const normalizedMessageId = normalizedIdentityText(providerMessageId, 300);
  if (!conversationKey || !normalizedMessageId) return "";
  return `${conversationKey}|${normalizedMessageId}`;
}

function canonicalProviderMessageDocumentId(input = {}) {
  const key = canonicalProviderMessageKey(input);
  return key ? `MSG-${hashId(key, 40).toUpperCase()}` : "";
}

function canonicalMessageStatusDocumentId({ providerMessageId, status, providerTimestamp, ...input } = {}) {
  const messageKey = canonicalProviderMessageKey({ providerMessageId, ...input });
  const normalizedStatus = normalizedIdentityText(status, 80).toLowerCase();
  const normalizedTimestamp = normalizedIdentityText(providerTimestamp, 120);
  if (!messageKey || !normalizedStatus) return "";
  return `MSGSTATUS-${hashId(`${messageKey}|${normalizedStatus}|${normalizedTimestamp}`, 40).toUpperCase()}`;
}

function activeAccountDecision({ message = {}, conversation = {}, settings = {}, payload = {} } = {}) {
  const decision = communicationIdentityDecision({ message, conversation, payload });
  if (!decision.valid) return { allowed: false, reason: decision.reason, identity: decision.identity };
  const activeCommunicationAccountId = configuredCommunicationAccountId(settings);
  if (!activeCommunicationAccountId) {
    return { allowed: false, reason: "active-communication-account-not-configured", identity: decision.identity };
  }
  if (decision.identity.communicationAccountId !== activeCommunicationAccountId) {
    return { allowed: false, reason: "communication-account-not-active", identity: decision.identity };
  }
  return { allowed: true, reason: "active-communication-account", identity: decision.identity };
}

module.exports = {
  COMMUNICATION_IDENTITY_VERSION,
  activeAccountDecision,
  canonicalConversationDocumentId,
  canonicalConversationKey,
  canonicalMessageStatusDocumentId,
  canonicalProviderMessageDocumentId,
  canonicalProviderMessageKey,
  communicationIdentityDecision,
  communicationIdentityParts,
  configuredCommunicationAccountId,
  normalizeCommunicationAccountId,
  normalizeCommunicationChannel,
  normalizeCommunicationProvider,
  normalizeRemoteConversationId,
  resolveCommunicationAccountId,
};
