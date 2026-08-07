const { cleanText, normalizeText } = require("./whatsappCopilotSchedulingCore");

function latestCustomerText(conversation) {
  const explicit = cleanText(conversation?.customerTurn?.text, 4_000);
  if (explicit) return explicit;
  return cleanText(
    [...(conversation?.messages || [])].reverse().find((item) => item?.direction === "inbound")?.text,
    4_000,
  );
}

function isGreetingOnly(value) {
  const text = normalizeText(value)
    .replace(/[!¡?¿.,;:()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  return /^(hola|buenos dias|buen dia|buenas tardes|buenas noches|buenas|good morning|good afternoon|good evening|hello|hi|bon dia|bon tardi|bon nochi)(\s+(senor|senora|sr|sra|demac|equipo|team))?$/.test(text);
}

function greetingReply(value, language = "es") {
  const text = normalizeText(value);
  if (language === "en") {
    const greeting = /good afternoon/.test(text)
      ? "Good afternoon."
      : /good evening/.test(text)
        ? "Good evening."
        : /^hello\b|^hi\b/.test(text)
          ? "Hello."
          : "Good morning.";
    return `${greeting}\n\nHow can we help you today?\n\n• Service & maintenance\n• Installation\n• Repair`;
  }
  if (language === "pap-aw") {
    const greeting = /bon tardi/.test(text)
      ? "Bon tardi."
      : /bon nochi/.test(text)
        ? "Bon nochi."
        : "Bon dia.";
    return `${greeting}\n\nCon nos por yuda bo awe?\n\n• Servicio y mantenimento\n• Instalacion\n• Reparacion`;
  }
  const greeting = /buenas tardes/.test(text)
    ? "Buenas tardes."
    : /buenas noches/.test(text)
      ? "Buenas noches."
      : /^hola\b/.test(text)
        ? "Hola."
        : "Buenos días.";
  return `${greeting}\n\n¿Cómo podemos ayudarle hoy?\n\n• Servicio y mantenimiento\n• Instalación\n• Reparación`;
}

function isAvailabilityTurn(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /\b(cupo|disponibilidad|disponible|espacio|appointment|availability|slot|cita|pueden venir|puede venir|pueden el|puede el|tin cupo|tin espacio)\b/.test(text)
    || /\b(para|el|este|proximo|próximo)\s+(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/.test(text);
}

function looksLikeAffirmativeSelection(value) {
  const text = normalizeText(value);
  if (!text || /\b(no|ninguna|ninguno|otra|otro horario|no me sirve|no puedo)\b/.test(text)) return false;
  return /\b(esta bien|está bien|me sirve|perfecto|confirmo|esa|ese|la primera|la segunda|opcion|opción|me quedo|a las \d{1,2})\b/.test(text);
}

function minuteValue(time) {
  const match = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function fuzzyTimeOption(options, requestedTime) {
  const target = minuteValue(requestedTime);
  if (target === null) return null;
  const available = Array.isArray(options) ? options : [];
  const exact = available.filter((option) => minuteValue(option?.time) === target);
  if (exact.length === 1) return exact[0];

  const sameHour = available.filter((option) => {
    const value = minuteValue(option?.time);
    return value !== null && Math.floor(value / 60) === Math.floor(target / 60);
  });
  if (sameHour.length === 1) return sameHour[0];

  const nearby = available
    .map((option) => ({ option, distance: Math.abs((minuteValue(option?.time) ?? 9_999) - target) }))
    .filter((item) => item.distance <= 45)
    .sort((a, b) => a.distance - b.distance);
  if (!nearby.length) return null;
  if (nearby.length === 1 || nearby[0].distance < nearby[1].distance) return nearby[0].option;
  return null;
}

function stripInternalLanguage(value, language = "es") {
  let text = String(value || "");
  if (language === "es") {
    text = text
      .replace(/la duraci[oó]n estimada configurada en (?:nuestro|el) ERP es de aproximadamente\s*/gi, "Un servicio estándar dura aproximadamente ")
      .replace(/la duraci[oó]n aproximada es de\s*/gi, "Un servicio estándar dura aproximadamente ")
      .replace(/el precio actual registrado en (?:nuestro|el) ERP es/gi, "El precio actual es")
      .replace(/seg[uú]n (?:nuestro|el) ERP/gi, "")
      .replace(/configurad[oa] en (?:nuestro|el) ERP/gi, "");
  } else if (language === "en") {
    text = text
      .replace(/the estimated duration configured in our ERP is approximately\s*/gi, "A standard service takes approximately ")
      .replace(/the current price registered in our ERP is/gi, "The current price is")
      .replace(/according to our ERP/gi, "");
  } else if (language === "pap-aw") {
    text = text
      .replace(/e duracion estima cu ta configura den nos ERP ta aproximadamente\s*/gi, "Un servicio standard ta dura aproximadamente ")
      .replace(/e prijs actual registra den nos ERP ta/gi, "E prijs actual ta");
  }
  return text.replace(/\s+([,.!?])/g, "$1").replace(/ {2,}/g, " ").trim();
}

function splitNaturalParagraph(paragraph) {
  const text = String(paragraph || "").trim();
  if (!text) return [];
  if (/^\*?\d+[.)]\s/.test(text) || /^[-•]\s/.test(text)) return [text];
  const segments = text
    .split(/(?<=[.!?])\s+(?=(?:¿|¡|[A-ZÁÉÍÓÚÑ]))/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length <= 1) return [text];
  return segments;
}

function formatNaturalCustomerReply(value, language = "es") {
  const stripped = stripInternalLanguage(value, language)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!stripped) return "";

  const paragraphs = stripped
    .split(/\n{2,}|\n/)
    .flatMap(splitNaturalParagraph)
    .map((item) => item.trim())
    .filter(Boolean);

  return paragraphs.join("\n\n");
}

function immediateReply({ conversation, languageMode = "auto" }) {
  const latest = latestCustomerText(conversation);
  if (!isGreetingOnly(latest)) return null;
  const normalized = normalizeText(latest);
  const language = languageMode === "en" || /\b(good|hello|hi)\b/.test(normalized)
    ? "en"
    : languageMode === "pap-aw" || /\b(bon dia|bon tardi|bon nochi)\b/.test(normalized)
      ? "pap-aw"
      : "es";
  return {
    draft: greetingReply(latest, language),
    source: "conversation-policy",
    warning: "",
    metadata: {
      intent: "greeting",
      language,
      conversationStage: "initial_request",
      nextAction: "wait_for_customer",
      summary: "El cliente saludó sin hacer todavía una solicitud.",
      confidence: 1,
      requiresHuman: false,
      missingInformation: [],
      collectedInformation: {},
      selectedOptionOrdinal: 0,
      customerConfirmedAppointment: false,
    },
  };
}

module.exports = {
  formatNaturalCustomerReply,
  fuzzyTimeOption,
  greetingReply,
  immediateReply,
  isAvailabilityTurn,
  isGreetingOnly,
  latestCustomerText,
  looksLikeAffirmativeSelection,
  stripInternalLanguage,
};
