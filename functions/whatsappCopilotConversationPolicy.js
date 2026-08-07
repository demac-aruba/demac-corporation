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
    if (/good afternoon/.test(text)) return "Good afternoon. How can I help you?";
    if (/good evening/.test(text)) return "Good evening. How can I help you?";
    return "Good morning. How can I help you?";
  }
  if (language === "pap-aw") {
    if (/bon tardi/.test(text)) return "Bon tardi. Con nos por yuda bo?";
    if (/bon nochi/.test(text)) return "Bon nochi. Con nos por yuda bo?";
    return "Bon dia. Con nos por yuda bo?";
  }
  if (/buenas tardes/.test(text)) return "Buenas tardes. ¿Cómo puedo ayudarle?";
  if (/buenas noches/.test(text)) return "Buenas noches. ¿Cómo puedo ayudarle?";
  if (/^hola\b/.test(text)) return "Hola. ¿Cómo puedo ayudarle?";
  return "Buenos días. ¿Cómo puedo ayudarle?";
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
      .replace(/la duraci[oó]n estimada configurada en (?:nuestro|el) ERP es de aproximadamente/gi, "La duración aproximada es de")
      .replace(/el precio actual registrado en (?:nuestro|el) ERP es/gi, "El precio actual es")
      .replace(/seg[uú]n (?:nuestro|el) ERP/gi, "")
      .replace(/configurad[oa] en (?:nuestro|el) ERP/gi, "");
  } else if (language === "en") {
    text = text
      .replace(/the estimated duration configured in our ERP is approximately/gi, "The estimated duration is approximately")
      .replace(/the current price registered in our ERP is/gi, "The current price is")
      .replace(/according to our ERP/gi, "");
  } else if (language === "pap-aw") {
    text = text
      .replace(/e duracion estima cu ta configura den nos ERP ta aproximadamente/gi, "E duracion ta aproximadamente")
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
  immediateReply,
  isAvailabilityTurn,
  isGreetingOnly,
  latestCustomerText,
  looksLikeAffirmativeSelection,
  stripInternalLanguage,
};
