const { cleanText, normalizeText } = require("./whatsappCopilotSchedulingCore");

function latestCustomerText(conversation) {
  const explicit = cleanText(conversation?.customerTurn?.text, 4_000);
  if (explicit) return explicit;
  return cleanText(
    [...(conversation?.messages || [])].reverse().find((item) => item?.direction === "inbound")?.text,
    4_000,
  );
}

function normalizedTurn(value) {
  return normalizeText(value)
    .replace(/[!¡?¿.,;:()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGreetingOnly(value) {
  const text = normalizedTurn(value);
  if (!text) return false;
  return /^(hola|buenos dias|buen dia|buenas tardes|buenas noches|buenas|good morning|good afternoon|good evening|hello|hi|bon dia|bon tardi|bon nochi)(\s+(senor|senora|sr|sra|demac|equipo|team))?$/.test(text);
}

function isServiceSelectionOnly(value) {
  const text = normalizedTurn(value);
  return /^(servicio|servicios|servicio y mantenimiento|mantenimiento|service|maintenance|service and maintenance|servicio di airco)$/.test(text);
}

function isInstallationSelectionOnly(value) {
  const text = normalizedTurn(value);
  return /^(instalacion|instalar|installation|install|instalacion di airco)$/.test(text);
}

function isRepairSelectionOnly(value) {
  const text = normalizedTurn(value);
  return /^(reparacion|reparar|repair|diagnostico|diagnostic|checkup)$/.test(text);
}

function isKnowledgeRejectionTurn(value) {
  const text = normalizedTurn(value);
  if (!text) return false;
  return /\b(no te pregunte|no te pregunte nada|no pregunte|no estoy preguntando|yo no pregunte|no me hables|no necesito saber)\b/.test(text)
    && /\b(duracion|tiempo|erp|precio|costo|garantia|pago)\b/.test(text);
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

function selectionReply(kind, language = "es") {
  if (language === "en") {
    if (kind === "installation") return "Perfect.\n\nHow many AC units would you like installed, and what is the property address?";
    if (kind === "repair") return "Perfect.\n\nHow many AC units have the problem, and what is the property address?";
    return "Perfect.\n\nHow many AC units need service, and what is the property address?";
  }
  if (language === "pap-aw") {
    if (kind === "installation") return "Perfecto.\n\nCuanto airco bo kier instala y kico ta e adres di e propiedad?";
    if (kind === "repair") return "Perfecto.\n\nCuanto airco tin e problema y kico ta e adres di e propiedad?";
    return "Perfecto.\n\nCuanto airco mester servicio y kico ta e adres di e propiedad?";
  }
  if (kind === "installation") return "Perfecto.\n\n¿Cuántos aires desea instalar y cuál es la dirección de la propiedad?";
  if (kind === "repair") return "Perfecto.\n\n¿Cuántos aires presentan el problema y cuál es la dirección de la propiedad?";
  return "Perfecto.\n\n¿Cuántos aires son y cuál es la dirección donde debemos ir?";
}

function correctionReply(language = "es") {
  if (language === "en") return "Understood. Sorry for the confusion.\n\nLet’s continue with your request.";
  if (language === "pap-aw") return "Comprendi. Disculpa pa e confusion.\n\nLaga nos sigui cu bo solicitud.";
  return "Entendido. Disculpe la confusión.\n\nContinuemos con su solicitud.";
}

function isAvailabilityTurn(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /\b(cupo|disponibilidad|disponible|espacio|appointment|availability|slot|cita|pueden venir|puede venir|pueden el|puede el|tin cupo|tin espacio|tienes para|tiene para|hay para|hay cupo)\b/.test(text)
    || /\b(para|el|este|proximo|próximo)\s+(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/.test(text)
    || /\b(en|por|para)\s+la\s+(manana|mañana|tarde)\b/.test(text);
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

function languageForTurn(latest, languageMode = "auto") {
  const normalized = normalizeText(latest);
  if (languageMode === "en" || /\b(good|hello|hi|service|installation|repair)\b/.test(normalized)) return "en";
  if (languageMode === "pap-aw" || /\b(bon dia|bon tardi|bon nochi|mi kier|bo por|airco)\b/.test(normalized)) return "pap-aw";
  return "es";
}

function immediateReply({ conversation, languageMode = "auto" }) {
  const latest = latestCustomerText(conversation);
  const language = languageForTurn(latest, languageMode);
  let draft = "";
  let intent = "";
  let serviceType = "";

  if (isGreetingOnly(latest)) {
    draft = greetingReply(latest, language);
    intent = "greeting";
  } else if (isServiceSelectionOnly(latest)) {
    draft = selectionReply("service", language);
    intent = "service_request";
    serviceType = "service";
  } else if (isInstallationSelectionOnly(latest)) {
    draft = selectionReply("installation", language);
    intent = "installation_request";
    serviceType = "installation";
  } else if (isRepairSelectionOnly(latest)) {
    draft = selectionReply("repair", language);
    intent = "repair_request";
    serviceType = "repair";
  } else if (isKnowledgeRejectionTurn(latest)) {
    draft = correctionReply(language);
    intent = "customer_correction";
  } else {
    return null;
  }

  return {
    draft,
    source: "conversation-policy-v18",
    warning: "",
    metadata: {
      intent,
      language,
      conversationStage: intent === "greeting" ? "initial_request" : "collecting_details",
      nextAction: "wait_for_customer",
      summary: "El último turno del cliente fue resuelto antes de consultar el historial.",
      confidence: 1,
      requiresHuman: false,
      missingInformation: [],
      collectedInformation: serviceType ? { serviceType } : {},
      selectedOptionOrdinal: 0,
      customerConfirmedAppointment: false,
      currentTurnPolicy: "authoritative",
    },
  };
}

module.exports = {
  correctionReply,
  formatNaturalCustomerReply,
  fuzzyTimeOption,
  greetingReply,
  immediateReply,
  isAvailabilityTurn,
  isGreetingOnly,
  isInstallationSelectionOnly,
  isKnowledgeRejectionTurn,
  isRepairSelectionOnly,
  isServiceSelectionOnly,
  latestCustomerText,
  looksLikeAffirmativeSelection,
  selectionReply,
  stripInternalLanguage,
};