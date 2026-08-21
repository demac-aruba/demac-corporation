const papiamentoVocabulary = require("./data/papiamento-aruba-vocabulary-2009.json");
const { TIME_ZONE } = require("./operatingCalendarService");
const { canonicalSchedulingWorkTypeId } = require("./schedulingWorkTypes");

const SUPPORTED_LANGUAGES = new Set(["pap", "es", "nl", "en"]);
const PAPIAMENTO_WORDS = new Set((papiamentoVocabulary.words || []).map((word) => String(word).toLocaleLowerCase("en-US")));
const PAPIAMENTO_TECHNICAL_WORDS = new Set([
  "demac", "professional", "cooling", "solutions", "premium", "standard", "check", "up", "am", "pm",
]);
const PAPIAMENTO_WEEKDAYS = Object.freeze([
  "diadomingo", "dialuna", "diamars", "diaranson", "diahuebs", "diabierna", "diasabra",
]);
const PAPIAMENTO_MONTHS = Object.freeze([
  "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "october", "november", "december",
]);

const WORK_TYPE_LABELS = Object.freeze({
  en: Object.freeze({
    standard_service: "Standard Service",
    deep_cleaning: "Premium Deep Cleaning Service",
    standard_installation: "Standard Installation",
    installation_extended_labor: "Installation Extended Labor",
    check_up: "Check Up",
    leak_repair: "Leak Repair",
    commercial_service: "Commercial Service",
    other: "Other",
  }),
  es: Object.freeze({
    standard_service: "Servicio estándar",
    deep_cleaning: "Servicio premium de limpieza profunda",
    standard_installation: "Instalación estándar",
    installation_extended_labor: "Instalación con trabajo adicional",
    check_up: "Chequeo",
    leak_repair: "Reparación de fuga",
    commercial_service: "Servicio comercial",
    other: "Otro",
  }),
  nl: Object.freeze({
    standard_service: "Standaard service",
    deep_cleaning: "Premium dieptereiniging",
    standard_installation: "Standaard installatie",
    installation_extended_labor: "Installatie met extra arbeid",
    check_up: "Controle",
    leak_repair: "Lekreparatie",
    commercial_service: "Commerciële service",
    other: "Overig",
  }),
  pap: Object.freeze({
    standard_service: "Servicio standard",
    deep_cleaning: "Servicio premium di limpieza profundo",
    standard_installation: "Instalacion standard",
    installation_extended_labor: "Instalacion cu trabou adicional",
    check_up: "Check Up",
    leak_repair: "Reparacion di fuga",
    commercial_service: "Servicio comercial",
    other: "Otro",
  }),
});

function normalizePreferredLanguage(value) {
  const language = String(value || "unknown").trim().toLowerCase();
  if (["pap", "pap_aw", "pap-aw", "papiamento", "papiamento di aruba"].includes(language)) return "pap";
  if (["es", "spa", "spanish", "español", "espanol"].includes(language)) return "es";
  if (["nl", "dut", "dutch", "nederlands", "neerlandés", "neerlandes"].includes(language)) return "nl";
  if (["en", "eng", "english", "inglés", "ingles"].includes(language)) return "en";
  return "unknown";
}

function templateLanguageForRecipient(recipient, client) {
  const candidates = [
    recipient?.templateLanguage,
    recipient?.preferredLanguage,
    client?.templateLanguage,
    client?.preferredLanguage,
  ];
  for (const candidate of candidates) {
    const normalized = normalizePreferredLanguage(candidate);
    if (SUPPORTED_LANGUAGES.has(normalized)) return normalized;
  }
  return "en";
}

function localeForLanguage(languageCode) {
  if (languageCode === "es") return "es-ES";
  if (languageCode === "nl") return "nl-NL";
  return "en-US";
}

function formatAppointmentDate(dateKey, languageCode) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return String(dateKey || "");
  if (languageCode === "pap") {
    return `${PAPIAMENTO_WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} di ${PAPIAMENTO_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
  return new Intl.DateTimeFormat(localeForLanguage(languageCode), {
    timeZone: TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatAppointmentTime(value, languageCode) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value || "");
  const hour = Number(match[1]);
  const minute = match[2];
  if (languageCode === "nl") return `${String(hour).padStart(2, "0")}:${minute}`;
  const spanish = languageCode === "es";
  const suffix = hour >= 12 ? (spanish ? "p. m." : "PM") : (spanish ? "a. m." : "AM");
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function arubaHour(now = new Date()) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  const hour = Number(value);
  return Number.isFinite(hour) ? hour : 12;
}

function greetingForLanguage(languageCode, name, now = new Date()) {
  if (languageCode === "pap") {
    const hour = arubaHour(now);
    const greeting = hour < 12 ? "Bon dia" : hour < 18 ? "Bon tardi" : "Bon nochi";
    return `${greeting} ${name},`;
  }
  if (languageCode === "es") return `Hola ${name},`;
  if (languageCode === "nl") return `Hallo ${name},`;
  return `Hello ${name},`;
}

function workTypeLabel(presetId, fallback, languageCode) {
  const canonicalId = canonicalSchedulingWorkTypeId(presetId);
  const language = WORK_TYPE_LABELS[languageCode] || WORK_TYPE_LABELS.en;
  return language[canonicalId] || String(fallback || "").trim();
}

function localizeServiceDescription(order = {}, fallback = "", languageCode = "en") {
  const workItems = Array.isArray(order.appointmentWorkItems) ? order.appointmentWorkItems.filter(Boolean) : [];
  if (workItems.length) {
    return workItems.map((item) => {
      const label = workTypeLabel(item.presetId, item.label, languageCode) || String(item.label || "Service").trim();
      const quantity = Math.max(1, Number(item.quantity) || 1);
      return `${label} × ${quantity}`;
    }).join("; ");
  }
  const presetId = order.appointmentPresetId || order.appointmentWorkType;
  const label = workTypeLabel(presetId, "", languageCode);
  if (label) {
    const quantity = Math.max(1, Number(order.airConditionerCount) || 1);
    return `${label} × ${quantity}`;
  }
  return String(fallback || "").trim();
}

function renderAppointmentText(notificationType, bodyParameters, languageCode, options = {}) {
  const [name, date, time, address, service] = bodyParameters.map((value) => String(value || "").trim());
  const reminder = notificationType === "appointment-reminder";
  const brand = "*DEMAC Professional Cooling Solutions*";
  const greeting = greetingForLanguage(languageCode, name, options.now);

  if (languageCode === "pap") {
    return [
      greeting,
      "",
      reminder
        ? `Esaki ta un recordatorio pa bo cita cu ${brand}.`
        : `Nos ta confirma bo cita cu ${brand}.`,
      "",
      `*Fecha:* ${date}`,
      `*Ora:* ${time}`,
      `*Adres:* ${address}`,
      `*Servicio:* ${service}`,
      "",
      "Si bo mester haci algun cambio, contesta e mensahe aki.",
    ].join("\n");
  }
  if (languageCode === "es") {
    return [
      greeting,
      "",
      reminder
        ? `Este es un recordatorio de tu cita con ${brand}.`
        : `Tu cita con ${brand} ha sido confirmada.`,
      "",
      `*Fecha:* ${date}`,
      `*Hora:* ${time}`,
      `*Dirección:* ${address}`,
      `*Servicio:* ${service}`,
      "",
      "Si necesitas hacer algún cambio, responde a este mensaje.",
    ].join("\n");
  }
  if (languageCode === "nl") {
    return [
      greeting,
      "",
      reminder
        ? `Dit is een herinnering voor uw afspraak met ${brand}.`
        : `Uw afspraak met ${brand} is bevestigd.`,
      "",
      `*Datum:* ${date}`,
      `*Tijd:* ${time}`,
      `*Adres:* ${address}`,
      `*Service:* ${service}`,
      "",
      "Als u iets wilt wijzigen, kunt u op dit bericht reageren.",
    ].join("\n");
  }
  return [
    greeting,
    "",
    reminder
      ? `This is a reminder for your appointment with ${brand}.`
      : `Your appointment with ${brand} has been confirmed.`,
    "",
    `*Date:* ${date}`,
    `*Time:* ${time}`,
    `*Address:* ${address}`,
    `*Service:* ${service}`,
    "",
    "If you need to make any changes, reply to this message.",
  ].join("\n");
}

function papiamentoTokens(value) {
  return String(value || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
}

function papiamentoUnknownFixedWords() {
  const fixedCopy = [
    "Bon dia Bon tardi Bon nochi",
    "Esaki ta un recordatorio pa bo cita cu",
    "Nos ta confirma bo cita cu",
    "Fecha Ora Adres Servicio",
    "Si bo mester haci algun cambio contesta e mensahe aki",
    PAPIAMENTO_WEEKDAYS.join(" "),
    PAPIAMENTO_MONTHS.join(" "),
    ...Object.values(WORK_TYPE_LABELS.pap),
  ].join(" ");
  return [...new Set(papiamentoTokens(fixedCopy)
    .map((token) => token.toLocaleLowerCase("en-US"))
    .filter((token) => !PAPIAMENTO_WORDS.has(token) && !PAPIAMENTO_TECHNICAL_WORDS.has(token)))]
    .sort();
}

module.exports.PAPIAMENTO_MONTHS = PAPIAMENTO_MONTHS;
module.exports.PAPIAMENTO_WEEKDAYS = PAPIAMENTO_WEEKDAYS;
module.exports.WORK_TYPE_LABELS = WORK_TYPE_LABELS;
module.exports.formatAppointmentDate = formatAppointmentDate;
module.exports.formatAppointmentTime = formatAppointmentTime;
module.exports.greetingForLanguage = greetingForLanguage;
module.exports.localizeServiceDescription = localizeServiceDescription;
module.exports.normalizePreferredLanguage = normalizePreferredLanguage;
module.exports.papiamentoUnknownFixedWords = papiamentoUnknownFixedWords;
module.exports.renderAppointmentText = renderAppointmentText;
module.exports.templateLanguageForRecipient = templateLanguageForRecipient;