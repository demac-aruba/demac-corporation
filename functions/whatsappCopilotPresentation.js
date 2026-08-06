const availability = require("./whatsappCopilotAvailability");

const CLIENT_OPTION_LIMIT = 2;
const originalGenerateOptions = availability.generateOptions;

function capitalize(value) {
  const text = String(value ?? "").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function formatDateSpanish(date) {
  const formatted = new Intl.DateTimeFormat("es-AW", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00Z`));
  return capitalize(formatted.replace(",", ""));
}

function formatDateEnglish(date) {
  return new Intl.DateTimeFormat("en-AW", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatDatePapiamento(date) {
  const value = new Date(`${date}T12:00:00Z`);
  const weekdays = ["Diadomingo", "Dialuna", "Diamars", "Diaranson", "Diahuebs", "Diabierna", "Diasabra"];
  const months = [
    "yanuari",
    "februari",
    "maart",
    "aprel",
    "mei",
    "yüni",
    "yüli",
    "augustus",
    "sèptèmber",
    "òktober",
    "novèmber",
    "desèmber",
  ];
  return `${weekdays[value.getUTCDay()]} ${value.getUTCDate()} di ${months[value.getUTCMonth()]}`;
}

function formatClock(value, language) {
  const [hour, minute] = String(value).split(":").map(Number);
  const date = new Date(Date.UTC(2020, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-AW", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date).replace(/\u00a0/g, " ");
}

function serviceReference(language, quantity) {
  if (language === "en") return quantity === 1 ? "the AC service" : `the service for ${quantity} AC units`;
  if (language === "pap-aw") return quantity === 1 ? "e servicio di e airco" : `e servicio di ${quantity} airco`;
  return quantity === 1 ? "el servicio del aire acondicionado" : `el servicio de los ${quantity} aires`;
}

function availabilityIntro(language, quantity, requestedDateUnavailable, requestedDate) {
  if (language === "en") {
    const unavailable = requestedDateUnavailable && requestedDate
      ? `We do not have availability on ${formatDateEnglish(requestedDate)}.\n\n`
      : "";
    return `${unavailable}Perfect. For ${serviceReference(language, quantity)}, I have these options available:`;
  }
  if (language === "pap-aw") {
    const unavailable = requestedDateUnavailable && requestedDate
      ? `Nos no tin disponibilidad riba ${formatDatePapiamento(requestedDate)}.\n\n`
      : "";
    return `${unavailable}Perfecto. Pa ${serviceReference(language, quantity)}, nos tin e opcionnan aki disponibel:`;
  }
  const unavailable = requestedDateUnavailable && requestedDate
    ? `No tenemos disponibilidad el ${formatDateSpanish(requestedDate)}.\n\n`
    : "";
  return `${unavailable}Perfecto. Para ${serviceReference(language, quantity)}, tengo disponibles estas opciones:`;
}

function optionLine(language, option, index) {
  const date = language === "en"
    ? formatDateEnglish(option.date)
    : language === "pap-aw"
      ? formatDatePapiamento(option.date)
      : formatDateSpanish(option.date);
  return `*${index + 1}. ${date} — ${formatClock(option.time, language)}*`;
}

function question(language) {
  if (language === "en") return "Which option works best for you?";
  if (language === "pap-aw") return "Cua opcion ta mihor pa bo?";
  return "¿Cuál opción le resulta mejor?";
}

function formatAvailabilityReply(language, result) {
  const options = Array.isArray(result?.options) ? result.options.slice(0, CLIENT_OPTION_LIMIT) : [];
  if (!options.length) {
    if (language === "en") return "At this moment, I do not have a suitable opening for the service. Our operations team will review the schedule manually and send you the closest option.";
    if (language === "pap-aw") return "Na e momento aki, mi no tin un cupo adecuado pa e servicio. Nos team di Operacion lo revisa e agenda manualmente y lo manda bo e opcion mas cercano.";
    return "En este momento no tengo un espacio adecuado para el servicio. Nuestro equipo de Operaciones revisará la agenda manualmente y le enviará la opción más cercana.";
  }

  const intro = availabilityIntro(
    language,
    Number(result.quantity ?? options[0]?.quantity ?? 0),
    Boolean(result.requestedDateUnavailable),
    result.requestedDate,
  );
  const lines = options.map((option, index) => optionLine(language, option, index));
  return `${intro}\n\n${lines.join("\n\n")}\n\n${question(language)}`;
}

function formatConfirmationReply(language, option) {
  const date = language === "en"
    ? formatDateEnglish(option.date)
    : language === "pap-aw"
      ? formatDatePapiamento(option.date)
      : formatDateSpanish(option.date);
  const time = formatClock(option.time, language);

  if (language === "en") {
    return `Perfect, your appointment is confirmed:\n\n*${date} — ${time}*\n${option.address}\n\nWe will send the corresponding confirmation and reminder.`;
  }
  if (language === "pap-aw") {
    return `Perfecto, bo cita ta confirma:\n\n*${date} — ${time}*\n${option.address}\n\nNos lo manda e confirmacion y recordatorio correspondiente.`;
  }
  return `Perfecto, su cita quedó confirmada:\n\n*${date} — ${time}*\n${option.address}\n\nLe enviaremos la confirmación y el recordatorio correspondientes.`;
}

availability.generateOptions = function generateOptionsWithClientLimit(...args) {
  const result = originalGenerateOptions(...args);
  return {
    ...result,
    options: Array.isArray(result.options) ? result.options.slice(0, CLIENT_OPTION_LIMIT) : [],
  };
};

availability.formatAvailabilityReply = formatAvailabilityReply;
availability.formatConfirmationReply = formatConfirmationReply;

module.exports = {
  CLIENT_OPTION_LIMIT,
  formatAvailabilityReply,
  formatConfirmationReply,
};
