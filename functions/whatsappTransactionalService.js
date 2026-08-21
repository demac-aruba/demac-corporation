const { FieldValue } = require("firebase-admin/firestore");

const ARUBA_COUNTRY_CODE = "297";
const DEFAULT_TRANSACTIONAL_PROVIDER = "wacli";
const SUPPORTED_TRANSACTIONAL_PROVIDERS = new Set(["wacli", "meta"]);

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeWhatsAppPhone(value, defaultCountryCode = ARUBA_COUNTRY_CODE) {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.length === 7 && defaultCountryCode) return `${defaultCountryCode}${digits}`;
  return digits;
}

function safeDocumentId(value) {
  return String(value || "unknown")
    .replaceAll("/", "_")
    .replaceAll("#", "_")
    .slice(0, 1200);
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === "already-exists" || error?.code === "ALREADY_EXISTS";
}

function validWhatsAppPhone(value) {
  return /^\d{8,15}$/.test(String(value || ""));
}

function normalizeTransactionalProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return SUPPORTED_TRANSACTIONAL_PROVIDERS.has(provider) ? provider : DEFAULT_TRANSACTIONAL_PROVIDER;
}

function createWhatsAppTransactionalService({ db } = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("A Firestore-compatible db is required for transactional WhatsApp messaging.");
  }

  async function getTransportSettings() {
    const snapshot = await db.collection("businessSettings").doc("whatsapp").get();
    const settings = snapshot.exists ? snapshot.data() || {} : {};
    if (settings.transactionalOutboundEnabled === false) {
      const error = new Error("DEMAC transactional WhatsApp outbound messaging is disabled in business settings.");
      error.code = "whatsapp_transactional_outbound_disabled";
      throw error;
    }
    return {
      ...settings,
      transactionalProvider: normalizeTransactionalProvider(settings.transactionalProvider),
    };
  }

  async function getMetaSenderSettings() {
    const settings = await getTransportSettings();
    const phoneNumberId = digitsOnly(settings.phoneNumberId);
    if (!/^\d{5,30}$/.test(phoneNumberId)) {
      const error = new Error("DEMAC WhatsApp Meta phoneNumberId is not configured. No Meta WhatsApp message was queued.");
      error.code = "whatsapp_phone_number_id_missing";
      throw error;
    }
    return { ...settings, phoneNumberId };
  }

  async function createQueueItem(id, payload) {
    const reference = db.collection("whatsappOutboundQueue").doc(id);
    try {
      await reference.create(payload);
      return { created: true, reference };
    } catch (error) {
      if (isAlreadyExistsError(error)) return { created: false, reference };
      throw error;
    }
  }

  async function queueWacliText({ queueId, to, text, metadata = {} } = {}) {
    const normalizedTo = normalizeWhatsAppPhone(to);
    if (!validWhatsAppPhone(normalizedTo)) {
      return { queued: false, created: false, provider: "wacli", reason: "invalid-whatsapp-number", to: normalizedTo, queueId: safeDocumentId(queueId) };
    }
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      const error = new Error("A text body is required for wacli transactional messaging.");
      error.code = "whatsapp_text_missing";
      throw error;
    }
    const id = safeDocumentId(queueId);
    const result = await createQueueItem(id, {
      ...metadata,
      provider: "wacli",
      type: "text",
      to: normalizedTo,
      text: normalizedText,
      status: "queued",
      createdByUserId: metadata.createdByUserId || "demac-transactional-notifications",
      createdByName: metadata.createdByName || "DEMAC",
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: new Date().toISOString(),
    });
    return { queued: true, created: result.created, existing: !result.created, provider: "wacli", queueId: id, to: normalizedTo };
  }

  async function queueMetaTemplate({
    queueId,
    to,
    templateName,
    languageCode = "en",
    bodyParameters = [],
    metadata = {},
  } = {}) {
    const normalizedTo = normalizeWhatsAppPhone(to);
    if (!validWhatsAppPhone(normalizedTo)) {
      return { queued: false, created: false, provider: "meta", reason: "invalid-whatsapp-number", to: normalizedTo, queueId: safeDocumentId(queueId) };
    }
    const normalizedTemplateName = String(templateName || "").trim();
    if (!normalizedTemplateName) {
      const error = new Error("A Meta WhatsApp template name is required for transactional messaging.");
      error.code = "whatsapp_template_name_missing";
      throw error;
    }
    const settings = await getMetaSenderSettings();
    const id = safeDocumentId(queueId);
    const result = await createQueueItem(id, {
      ...metadata,
      provider: "meta",
      to: normalizedTo,
      phoneNumberId: settings.phoneNumberId,
      templateName: normalizedTemplateName,
      languageCode: String(languageCode || "en").trim().toLowerCase() || "en",
      bodyParameters: Array.isArray(bodyParameters) ? bodyParameters.map((item) => String(item ?? "")) : [],
      status: "queued",
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      queued: true,
      created: result.created,
      existing: !result.created,
      provider: "meta",
      queueId: id,
      to: normalizedTo,
      phoneNumberId: settings.phoneNumberId,
    };
  }

  async function queueTransactionalMessage({
    queueId,
    to,
    text,
    templateName,
    languageCode = "en",
    bodyParameters = [],
    metadata = {},
  } = {}) {
    const settings = await getTransportSettings();
    if (settings.transactionalProvider === "meta") {
      return queueMetaTemplate({ queueId, to, templateName, languageCode, bodyParameters, metadata });
    }
    return queueWacliText({ queueId, to, text, metadata });
  }

  return {
    getMetaSenderSettings,
    getTransportSettings,
    queueMetaTemplate,
    queueTransactionalMessage,
    queueWacliText,
  };
}

module.exports.ARUBA_COUNTRY_CODE = ARUBA_COUNTRY_CODE;
module.exports.DEFAULT_TRANSACTIONAL_PROVIDER = DEFAULT_TRANSACTIONAL_PROVIDER;
module.exports.createWhatsAppTransactionalService = createWhatsAppTransactionalService;
module.exports.digitsOnly = digitsOnly;
module.exports.isAlreadyExistsError = isAlreadyExistsError;
module.exports.normalizeTransactionalProvider = normalizeTransactionalProvider;
module.exports.normalizeWhatsAppPhone = normalizeWhatsAppPhone;
module.exports.safeDocumentId = safeDocumentId;
module.exports.validWhatsAppPhone = validWhatsAppPhone;
