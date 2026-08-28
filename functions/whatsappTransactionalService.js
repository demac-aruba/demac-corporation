const { FieldValue } = require("firebase-admin/firestore");
const { configuredCommunicationAccountId } = require("./demacCommunicationIdentity");

const ARUBA_COUNTRY_CODE = "297";
const DEFAULT_TRANSACTIONAL_PROVIDER = "wacli";
const SUPPORTED_TRANSACTIONAL_PROVIDERS = new Set(["wacli", "meta"]);
const WACLI_JID_PATTERN = /^[^@\s]{1,120}@(s\.whatsapp\.net|lid|g\.us|newsletter)$/;
const MIGRATABLE_TRANSACTIONAL_TEMPLATES = new Set([
  "appointment_confirmation",
  "appointment_reminder_24_hours",
  "technician_daily_schedule",
]);

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeWhatsAppPhone(value, defaultCountryCode = ARUBA_COUNTRY_CODE) {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.length === 7 && defaultCountryCode) return `${defaultCountryCode}${digits}`;
  return digits;
}

function normalizeWacliRecipient(value, defaultCountryCode = ARUBA_COUNTRY_CODE) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (WACLI_JID_PATTERN.test(raw)) return raw;
  return normalizeWhatsAppPhone(raw, defaultCountryCode);
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

function validWacliRecipient(value) {
  const recipient = String(value || "").trim();
  return validWhatsAppPhone(recipient) || WACLI_JID_PATTERN.test(recipient);
}

function normalizeTransactionalProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return SUPPORTED_TRANSACTIONAL_PROVIDERS.has(provider) ? provider : DEFAULT_TRANSACTIONAL_PROVIDER;
}

function normalizedLanguage(value) {
  const language = String(value || "en").trim().toLowerCase();
  if (language.startsWith("es")) return "es";
  if (language.startsWith("nl")) return "nl";
  return "en";
}

function normalizedParameters(values) {
  return Array.isArray(values) ? values.map((value) => String(value ?? "").trim()) : [];
}

function renderAppointmentTransactionalText({ reminder = false, bodyParameters = [], languageCode = "en" } = {}) {
  const values = normalizedParameters(bodyParameters);
  if (values.length < 5) return "";
  const [name, date, time, address, service] = values;
  const language = normalizedLanguage(languageCode);

  if (language === "es") {
    return [
      `Hola ${name},`,
      "",
      reminder
        ? "Este es un recordatorio de tu cita con DEMAC Professional Cooling Solutions."
        : "Tu cita con DEMAC Professional Cooling Solutions ha sido confirmada.",
      "",
      `Fecha: ${date}`,
      `Hora: ${time}`,
      `Dirección: ${address}`,
      `Servicio: ${service}`,
      "",
      "Si necesitas hacer algún cambio, responde a este mensaje.",
    ].join("\n");
  }

  if (language === "nl") {
    return [
      `Hallo ${name},`,
      "",
      reminder
        ? "Dit is een herinnering voor uw afspraak met DEMAC Professional Cooling Solutions."
        : "Uw afspraak met DEMAC Professional Cooling Solutions is bevestigd.",
      "",
      `Datum: ${date}`,
      `Tijd: ${time}`,
      `Adres: ${address}`,
      `Service: ${service}`,
      "",
      "Als u iets wilt wijzigen, kunt u op dit bericht reageren.",
    ].join("\n");
  }

  return [
    `Hello ${name},`,
    "",
    reminder
      ? "This is a reminder for your appointment with DEMAC Professional Cooling Solutions."
      : "Your appointment with DEMAC Professional Cooling Solutions has been confirmed.",
    "",
    `Date: ${date}`,
    `Time: ${time}`,
    `Address: ${address}`,
    `Service: ${service}`,
    "",
    "If you need to make any changes, reply to this message.",
  ].join("\n");
}

function renderTechnicianDailyScheduleText(bodyParameters = []) {
  const values = normalizedParameters(bodyParameters);
  if (values.length < 3) return "";
  const [name, date, agenda] = values;
  return [
    `Hola ${name},`,
    "",
    `Esta es tu agenda de trabajo de DEMAC para ${date}:`,
    "",
    agenda,
    "",
    "Revisa el ERP antes de salir por cualquier cambio o actualización.",
  ].join("\n");
}

function renderTransactionalText({ templateName, bodyParameters = [], languageCode = "en" } = {}) {
  const template = String(templateName || "").trim();
  if (template === "appointment_confirmation") {
    return renderAppointmentTransactionalText({ reminder: false, bodyParameters, languageCode });
  }
  if (template === "appointment_reminder_24_hours") {
    return renderAppointmentTransactionalText({ reminder: true, bodyParameters, languageCode });
  }
  if (template === "technician_daily_schedule") {
    return renderTechnicianDailyScheduleText(bodyParameters);
  }
  return "";
}

function buildLegacyMetaToWacliMigration(data = {}, activeProvider = DEFAULT_TRANSACTIONAL_PROVIDER) {
  if (normalizeTransactionalProvider(activeProvider) !== "wacli") return null;
  if (String(data.provider || "").trim().toLowerCase() !== "meta") return null;
  if (String(data.status || "queued").trim().toLowerCase() !== "queued") return null;

  const templateName = String(data.templateName || "").trim();
  if (!MIGRATABLE_TRANSACTIONAL_TEMPLATES.has(templateName)) return null;

  const to = normalizeWhatsAppPhone(data.to || data.phone || data.recipient);
  if (!validWhatsAppPhone(to)) return null;

  const text = renderTransactionalText({
    templateName,
    bodyParameters: data.bodyParameters,
    languageCode: data.languageCode,
  });
  if (!text) return null;

  return {
    provider: "wacli",
    type: "text",
    to,
    text,
    migratedFromProvider: "meta",
    migratedFromTemplateName: templateName,
    providerMigrationReason: "active-transactional-provider-wacli",
  };
}

function requireWacliCommunicationAccount(settings = {}) {
  const communicationAccountId = configuredCommunicationAccountId(settings);
  if (communicationAccountId) return communicationAccountId;
  const error = new Error("DEMAC Wacli communicationAccountId is not configured. No transactional WhatsApp message was queued.");
  error.code = "whatsapp_communication_account_missing";
  throw error;
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
      communicationAccountId: configuredCommunicationAccountId(settings),
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

  async function queueWacliText({ queueId, to, text, metadata = {}, transportSettings = null } = {}) {
    const normalizedTo = normalizeWacliRecipient(to);
    if (!validWacliRecipient(normalizedTo)) {
      return { queued: false, created: false, provider: "wacli", reason: "invalid-whatsapp-recipient", to: normalizedTo, queueId: safeDocumentId(queueId) };
    }
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      const error = new Error("A text body is required for wacli transactional messaging.");
      error.code = "whatsapp_text_missing";
      throw error;
    }
    const settings = transportSettings || await getTransportSettings();
    const communicationAccountId = requireWacliCommunicationAccount(settings);
    const id = safeDocumentId(queueId);
    const result = await createQueueItem(id, {
      ...metadata,
      provider: "wacli",
      communicationAccountId,
      outboundClass: "transactional",
      type: "text",
      to: normalizedTo,
      text: normalizedText,
      status: "queued",
      createdByUserId: metadata.createdByUserId || "demac-transactional-notifications",
      createdByName: metadata.createdByName || "DEMAC",
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: new Date().toISOString(),
    });
    return {
      queued: true,
      created: result.created,
      existing: !result.created,
      provider: "wacli",
      communicationAccountId,
      queueId: id,
      to: normalizedTo,
    };
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
      outboundClass: "transactional",
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
    const explicitText = String(text || "").trim();
    const fallbackText = explicitText ? "" : renderTransactionalText({ templateName, bodyParameters, languageCode });
    return queueWacliText({
      queueId,
      to,
      text: explicitText || fallbackText,
      metadata,
      transportSettings: settings,
    });
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
module.exports.MIGRATABLE_TRANSACTIONAL_TEMPLATES = MIGRATABLE_TRANSACTIONAL_TEMPLATES;
module.exports.WACLI_JID_PATTERN = WACLI_JID_PATTERN;
module.exports.buildLegacyMetaToWacliMigration = buildLegacyMetaToWacliMigration;
module.exports.createWhatsAppTransactionalService = createWhatsAppTransactionalService;
module.exports.digitsOnly = digitsOnly;
module.exports.isAlreadyExistsError = isAlreadyExistsError;
module.exports.normalizeTransactionalProvider = normalizeTransactionalProvider;
module.exports.normalizeWacliRecipient = normalizeWacliRecipient;
module.exports.normalizeWhatsAppPhone = normalizeWhatsAppPhone;
module.exports.renderTransactionalText = renderTransactionalText;
module.exports.requireWacliCommunicationAccount = requireWacliCommunicationAccount;
module.exports.safeDocumentId = safeDocumentId;
module.exports.validWacliRecipient = validWacliRecipient;
module.exports.validWhatsAppPhone = validWhatsAppPhone;
