const { FieldValue } = require("firebase-admin/firestore");

const ARUBA_COUNTRY_CODE = "297";

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

function createWhatsAppTransactionalService({ db } = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new Error("A Firestore-compatible db is required for transactional WhatsApp messaging.");
  }

  async function getMetaSenderSettings() {
    const snapshot = await db.collection("businessSettings").doc("whatsapp").get();
    const settings = snapshot.exists ? snapshot.data() || {} : {};
    const phoneNumberId = digitsOnly(settings.phoneNumberId);
    if (!/^\d{5,30}$/.test(phoneNumberId)) {
      const error = new Error("DEMAC WhatsApp Meta phoneNumberId is not configured. No transactional WhatsApp message was queued.");
      error.code = "whatsapp_phone_number_id_missing";
      throw error;
    }
    if (settings.transactionalOutboundEnabled === false) {
      const error = new Error("DEMAC transactional WhatsApp outbound messaging is disabled in business settings.");
      error.code = "whatsapp_transactional_outbound_disabled";
      throw error;
    }
    return { ...settings, phoneNumberId };
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
      return { queued: false, created: false, reason: "invalid-whatsapp-number", to: normalizedTo, queueId: safeDocumentId(queueId) };
    }
    const normalizedTemplateName = String(templateName || "").trim();
    if (!normalizedTemplateName) {
      const error = new Error("A Meta WhatsApp template name is required for transactional messaging.");
      error.code = "whatsapp_template_name_missing";
      throw error;
    }
    const settings = await getMetaSenderSettings();
    const id = safeDocumentId(queueId);
    const reference = db.collection("whatsappOutboundQueue").doc(id);
    try {
      await reference.create({
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
      return { queued: true, created: true, queueId: id, to: normalizedTo, phoneNumberId: settings.phoneNumberId };
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return { queued: true, created: false, existing: true, queueId: id, to: normalizedTo, phoneNumberId: settings.phoneNumberId };
      }
      throw error;
    }
  }

  return {
    getMetaSenderSettings,
    queueMetaTemplate,
  };
}

module.exports.ARUBA_COUNTRY_CODE = ARUBA_COUNTRY_CODE;
module.exports.createWhatsAppTransactionalService = createWhatsAppTransactionalService;
module.exports.digitsOnly = digitsOnly;
module.exports.isAlreadyExistsError = isAlreadyExistsError;
module.exports.normalizeWhatsAppPhone = normalizeWhatsAppPhone;
module.exports.safeDocumentId = safeDocumentId;
module.exports.validWhatsAppPhone = validWhatsAppPhone;
