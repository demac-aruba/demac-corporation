const { cleanText } = require("./bookingSchedulingPrimitives");
const { activeAccountDecision } = require("./demacCommunicationIdentity");

const DEFAULT_COUNTRY_CODE = "297";
const DEFAULT_MODE = "allowlist";
const PILOT_MODE = "pilot";
const MAYA_SETTINGS_COLLECTION = "businessSettings";
const MAYA_SETTINGS_DOCUMENT = "customer-agent";
const AUTHORIZED_PILOT_WORKFLOWS = new Set(["cancellation", "reschedule"]);

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

function configuredReplyMode(settings = {}) {
  return cleanText(settings.replyMode || settings.autoReplyMode, 40).toLowerCase() || DEFAULT_MODE;
}

function accountRequiredForMode(mode) {
  return mode === PILOT_MODE;
}

function mayaObservationDecision({ message = {}, conversation = {}, settings = {} } = {}) {
  if (settings.enabled === false || settings.observationEnabled !== true) {
    return { allowed: false, reason: "observation-disabled" };
  }
  if (message.direction !== "inbound") {
    return { allowed: false, reason: "not-canonical-inbound" };
  }
  const account = activeAccountDecision({ message, conversation, settings });
  if (!account.allowed) return { allowed: false, reason: account.reason, identity: account.identity };
  return { allowed: true, reason: "observation-enabled", identity: account.identity };
}

function pilotWorkflowReplyDecision({ workflow, settings = {} } = {}) {
  const normalized = cleanText(workflow, 80).toLowerCase();
  if (!AUTHORIZED_PILOT_WORKFLOWS.has(normalized)) return { allowed: false, reason: "workflow-not-authorized" };
  if (normalized === "cancellation" && settings.cancellationAutoReplyEnabled === true) {
    return { allowed: true, reason: "authorized-cancellation-workflow" };
  }
  if (normalized === "reschedule" && settings.rescheduleAutoReplyEnabled === true) {
    return { allowed: true, reason: "authorized-reschedule-workflow" };
  }
  return { allowed: false, reason: "workflow-auto-reply-disabled" };
}

function mayaReplyDecision({
  message = {},
  conversation = {},
  settings = {},
  isNewContact = false,
  authorizedWorkflow = "",
} = {}) {
  const mode = configuredReplyMode(settings);
  const phone = resolveConversationPhone({ message, conversation });
  const allowlist = configuredAllowlist(settings);

  if (settings.autoReplyEnabled !== true || mode === "off") {
    return { allowed: false, mode, phone, reason: "auto-reply-disabled" };
  }
  if (![DEFAULT_MODE, PILOT_MODE].includes(mode)) {
    return { allowed: false, mode, phone, reason: "unsupported-auto-reply-mode" };
  }
  if (!phone) {
    return { allowed: false, mode, phone: "", reason: "missing-customer-phone" };
  }

  if (accountRequiredForMode(mode)) {
    const account = activeAccountDecision({ message, conversation, settings });
    if (!account.allowed) {
      return { allowed: false, mode, phone, reason: account.reason, identity: account.identity };
    }
  }

  if (allowlist.includes(phone)) {
    return { allowed: true, mode, phone, reason: "allowlisted" };
  }
  if (mode === DEFAULT_MODE) {
    return { allowed: false, mode, phone, reason: "phone-not-allowlisted" };
  }
  if (isNewContact === true && settings.newContactAutoReplyEnabled === true) {
    return { allowed: true, mode, phone, reason: "new-contact-pilot" };
  }

  const workflowDecision = pilotWorkflowReplyDecision({ workflow: authorizedWorkflow, settings });
  if (workflowDecision.allowed) {
    return { allowed: true, mode, phone, reason: workflowDecision.reason };
  }
  return {
    allowed: false,
    mode,
    phone,
    reason: authorizedWorkflow ? workflowDecision.reason : "existing-customer-observe-only",
  };
}

function mayaBusinessActionDecision({ action, settings = {}, ownershipAllowed = false } = {}) {
  const normalized = cleanText(action, 80).toLowerCase();
  if (settings.enabled === false) return { allowed: false, reason: "maya-disabled" };
  if (ownershipAllowed !== true) return { allowed: false, reason: "sender-ownership-not-valid" };
  if (normalized === "cancel_appointment") {
    return settings.autoCancelEnabled === true
      ? { allowed: true, reason: "auto-cancel-enabled" }
      : { allowed: false, reason: "auto-cancel-disabled" };
  }
  if (normalized === "reschedule_appointment") {
    return settings.autoRescheduleEnabled === true
      ? { allowed: true, reason: "auto-reschedule-enabled" }
      : { allowed: false, reason: "auto-reschedule-disabled" };
  }
  return { allowed: false, reason: "business-action-not-authorized" };
}

module.exports.DEFAULT_COUNTRY_CODE = DEFAULT_COUNTRY_CODE;
module.exports.DEFAULT_MODE = DEFAULT_MODE;
module.exports.PILOT_MODE = PILOT_MODE;
module.exports.MAYA_SETTINGS_COLLECTION = MAYA_SETTINGS_COLLECTION;
module.exports.MAYA_SETTINGS_DOCUMENT = MAYA_SETTINGS_DOCUMENT;
module.exports.AUTHORIZED_PILOT_WORKFLOWS = AUTHORIZED_PILOT_WORKFLOWS;
module.exports.accountRequiredForMode = accountRequiredForMode;
module.exports.configuredAllowlist = configuredAllowlist;
module.exports.configuredReplyMode = configuredReplyMode;
module.exports.digitsOnly = digitsOnly;
module.exports.mayaBusinessActionDecision = mayaBusinessActionDecision;
module.exports.mayaObservationDecision = mayaObservationDecision;
module.exports.mayaReplyDecision = mayaReplyDecision;
module.exports.normalizeArubaWhatsAppPhone = normalizeArubaWhatsAppPhone;
module.exports.pilotWorkflowReplyDecision = pilotWorkflowReplyDecision;
module.exports.resolveConversationPhone = resolveConversationPhone;
