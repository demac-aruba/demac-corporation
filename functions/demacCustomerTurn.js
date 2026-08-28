const { cleanText } = require("./bookingSchedulingPrimitives");
const {
  communicationEpochDecision,
  nonNegativeEpoch,
  positiveEpoch,
} = require("./demacCommunicationEpoch");

const CUSTOMER_TURN_VERSION = 2;
const VOICE_TYPES = new Set(["audio", "voice"]);

function messageMediaType(message = {}) {
  return cleanText(message.mediaType || message.type, 40).toLowerCase();
}

function customerSemanticContent(message = {}, limit = 8_000) {
  const mediaType = messageMediaType(message);
  if (VOICE_TYPES.has(mediaType)) {
    if (message.transcriptionStatus !== "completed") return "";
    return cleanText(message.rawTranscript || message.transcript || message.normalizedTranscript, limit);
  }
  return cleanText(message.text || message.mediaCaption || message.reactionEmoji, limit);
}

function outboundSemanticContent(message = {}, limit = 8_000) {
  return cleanText(message.text || message.mediaCaption || message.reactionEmoji, limit);
}

function canonicalMessageDirection(message = {}) {
  if (message.direction === "inbound" || message.role === "customer") return "inbound";
  if (message.direction === "outbound" || ["operator", "ai", "assistant"].includes(message.role)) return "outbound";
  return "";
}

function canonicalRuntimeMessage(message = {}, limit = 4_000) {
  const direction = canonicalMessageDirection(message);
  if (!direction) return null;
  const text = direction === "inbound"
    ? customerSemanticContent(message, limit)
    : outboundSemanticContent(message, limit);
  if (!text) return null;
  const inputVersion = positiveEpoch(message.customerInputVersion);
  return {
    id: cleanText(message.messageId || message.id, 300),
    direction,
    text,
    ...(direction === "inbound" && inputVersion !== null
      ? { customerInputVersion: inputVersion }
      : {}),
  };
}

function canonicalVoiceRuntimeMessage(message = {}) {
  if (!VOICE_TYPES.has(messageMediaType(message))) return null;
  const text = customerSemanticContent(message, 8_000);
  if (!text) return null;
  return {
    ...message,
    text,
    mediaCaption: "",
    mayaInputModality: "voice_transcript",
  };
}

module.exports = {
  CUSTOMER_TURN_VERSION,
  VOICE_TYPES,
  canonicalMessageDirection,
  canonicalRuntimeMessage,
  canonicalVoiceRuntimeMessage,
  communicationEpochDecision,
  customerSemanticContent,
  messageMediaType,
  nonNegativeEpoch,
  outboundSemanticContent,
  positiveEpoch,
};
