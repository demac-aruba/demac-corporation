const { cleanText } = require("./bookingSchedulingPrimitives");

const DEFAULT_COUNTRY_CODE = "297";
const DEFAULT_MODE = "allowlist";

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeArubaWhatsAppPhone(value) {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.length === 7) return `${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length === 10 && digits.startsWith(DEFAULT_COUNTRY_CODE)) return digits;
  return digits;
}

function configuredAllowlist(settings = {}) {
  const raw = Array.isArray(settings.autoReplyAllowlist)
    ? settings.autoReplyAllowlist
    : Array.isArray(settings.replyAllowlist)
      ? settings.replyAllowlist
      : [];

  return [...new Set(raw
    .map((entry) => normalizeArubaWhatsAppPhone(
      typeof entry === "string" ? entry : entry?.phone || entry?.whatsapp || entry?.number,
    ))
    .filter(Boolean))];
}

function resolveConversationPhone({ message = {}, conversation = {} } = {}) {
  return normalizeArubaWhatsAppPhone(
    message.phone
      || conversation.phone
      || message.chat
      || conversation.chatJid
      || conversation.externalChatId,
  );
}

function mayaReplyDecision({ message = {}, conversation = {}, settings = {} } = {}) {
  const mode = cleanText(settings.autoReplyMode, 40).toLowerCase() || DEFAULT_MODE;
  const phone = resolveConversationPhone({ message, conversation });
  const allowlist = configuredAllowlist(settings);

  if (settings.autoReplyEnabled !== true || mode === "off") {
    return { allowed: false, mode, phone, reason: "auto-reply-disabled" };
  }
  if (mode !== "allowlist") {
    return { allowed: false, mode, phone, reason: "unsupported-auto-reply-mode" };
  }
  if (!phone) {
    return { allowed: false, mode, phone: "", reason: "missing-customer-phone" };
  }
  if (!allowlist.includes(phone)) {
    return { allowed: false, mode, phone, reason: "phone-not-allowlisted" };
  }
  return { allowed: true, mode, phone, reason: "allowlisted" };
}

module.exports.DEFAULT_COUNTRY_CODE = DEFAULT_COUNTRY_CODE;
module.exports.DEFAULT_MODE = DEFAULT_MODE;
module.exports.configuredAllowlist = configuredAllowlist;
module.exports.digitsOnly = digitsOnly;
module.exports.mayaReplyDecision = mayaReplyDecision;
module.exports.normalizeArubaWhatsAppPhone = normalizeArubaWhatsAppPhone;
module.exports.resolveConversationPhone = resolveConversationPhone;
