const {
  isGreetingOnly,
  isInstallationSelectionOnly,
  isRepairSelectionOnly,
  isServiceSelectionOnly,
} = require("./whatsappCopilotConversationPolicy");
const {
  arubaDateParts,
  cleanText,
  normalizeRequestedDate,
  normalizeText,
  normalizeTime,
  timeBlock,
} = require("./whatsappCopilotSchedulingCore");
const { parseTimeConstraint } = require("./whatsappCopilotCorrections");

const MEMORY_MESSAGE_ID = "__demac_copilot_memory__";

function serviceTypeFromText(value) {
  if (isServiceSelectionOnly(value)) return "service";
  if (isInstallationSelectionOnly(value)) return "installation";
  if (isRepairSelectionOnly(value)) return "repair";
  const text = normalizeText(value);
  if (/\b(instalacion|installation|instalar|install)\b/.test(text)) return "installation";
  if (/\b(reparacion|repair|diagnostico|diagnostic|checkup)\b/.test(text)) return "repair";
  if (/\b(servicio|service|mantenimiento|maintenance|deep cleaning)\b/.test(text)) return "service";
  return "";
}

function quantityFromText(value) {
  const match = String(value || "").match(/\b(\d{1,2})\s*(?:aires?|airco(?:nan)?|a\.?c\.?\s*units?)\b/i);
  return match ? String(Math.max(1, Math.min(40, Number(match[1])))) : "";
}

function cleanAddress(value) {
  const candidate = cleanText(value, 160)
    .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "")
    .trim();
  if (!candidate || !/[A-Za-zÀ-ÿ]/.test(candidate) || !/\d/.test(candidate)) return "";
  return candidate;
}

function addressFromText(value) {
  const raw = cleanText(value, 500);
  const direct = [
    /(?:la\s+)?direcci[oó]n\s*(?:es|esta|está|:)?\s+(.+)$/i,
    /\baddress\s*(?:is|:)?\s+(.+)$/i,
    /\badres\s*(?:ta|:)?\s+(.+)$/i,
    /\b(?:en|na)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'\-]{1,90}\s+\d+[A-Za-z0-9\-]*)\b/i,
    /^\s*\d{1,2}\s*(?:aires?|airco(?:nan)?|a\.?c\.?\s*units?)\s+(.+\d[A-Za-z0-9\-]*)\s*$/i,
  ];
  for (const pattern of direct) {
    const candidate = cleanAddress(raw.match(pattern)?.[1]);
    if (candidate) return candidate;
  }
  return "";
}

function timePreferenceFromText(value) {
  const constraint = parseTimeConstraint({ collectedInformation: {} }, value);
  if (["morning", "afternoon"].includes(constraint.kind)) return constraint.kind;
  if (constraint.kind && constraint.time) return `${constraint.kind} ${constraint.time}`;
  const block = timeBlock(value);
  if (block) return block;
  return normalizeTime(value);
}

function rebuildSessionFacts(messages, today = arubaDateParts().date) {
  const facts = {};
  for (const message of messages || []) {
    if (message?.direction !== "inbound") continue;
    const text = cleanText(message.text, 500);
    if (!text) continue;
    const serviceType = serviceTypeFromText(text);
    const quantity = quantityFromText(text);
    const address = addressFromText(text);
    const requestedDate = normalizeRequestedDate("", text, today);
    const preferredTime = timePreferenceFromText(text);
    if (serviceType) facts.serviceType = serviceType;
    if (quantity) facts.quantity = quantity;
    if (address) facts.address = address;
    if (requestedDate) facts.requestedDate = requestedDate;
    if (preferredTime) facts.preferredTime = preferredTime;
  }
  return facts;
}

function latestGreetingIndex(messages) {
  let index = -1;
  (messages || []).forEach((message, current) => {
    if (message?.direction === "inbound" && isGreetingOnly(message.text)) index = current;
  });
  return index;
}

function sanitizeConversationSession(conversation, today = arubaDateParts().date) {
  const original = conversation || {};
  const visible = Array.isArray(original.messages)
    ? original.messages.filter((message) => message?.id !== MEMORY_MESSAGE_ID)
    : [];
  const boundary = latestGreetingIndex(visible);
  if (boundary < 0) return { ...original, messages: visible.length ? visible : original.messages };

  const sessionMessages = visible.slice(boundary);
  return {
    ...original,
    messages: sessionMessages,
    confirmedFacts: rebuildSessionFacts(sessionMessages, today),
    sessionBoundary: {
      reason: "latest-customer-greeting",
      resetApplied: true,
    },
  };
}

function sanitizeRequestBody(body, today = arubaDateParts().date) {
  if (!body || typeof body !== "object" || !body.conversation) return body || {};
  return {
    ...body,
    conversation: sanitizeConversationSession(body.conversation, today),
  };
}

module.exports = {
  MEMORY_MESSAGE_ID,
  addressFromText,
  latestGreetingIndex,
  quantityFromText,
  rebuildSessionFacts,
  sanitizeConversationSession,
  sanitizeRequestBody,
  serviceTypeFromText,
  timePreferenceFromText,
};
