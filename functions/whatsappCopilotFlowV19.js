const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const availability = require("./whatsappCopilotAvailability");
const schedulingModule = require("./whatsappCopilotScheduling");
const {
  AFTERNOON_SLOTS,
  arubaDateParts,
  cleanText,
  hashId,
  normalizeRequestedDate,
  normalizeText,
  normalizeTime,
} = require("./whatsappCopilotSchedulingCore");
const {
  latestCustomerText,
  isAvailabilityTurn,
} = require("./whatsappCopilotConversationPolicy");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const originalGenerateOptions = availability.generateOptions;
const originalOrchestrateScheduling = schedulingModule.orchestrateScheduling;
const V19_MARKER = "natural-scheduling-flow-v19";

function normalizeLanguage(latest, languageMode = "auto") {
  if (languageMode === "en") return "en";
  if (languageMode === "pap-aw") return "pap-aw";
  if (languageMode === "es") return "es";
  const text = normalizeText(latest);
  if (/\b(good morning|good afternoon|good evening|hello|hi|service|installation|repair)\b/.test(text)) return "en";
  if (/\b(bon dia|bon tardi|bon nochi|mi kier|bo por|tin cupo|airco)\b/.test(text)) return "pap-aw";
  return "es";
}

function hasExplicitAmPm(value) {
  return /\b(?:a\.?\s*m\.?|p\.?\s*m\.?)\b/i.test(String(value || ""));
}

function contextualTime(value, offer) {
  const raw = cleanText(value, 300);
  let time = normalizeTime(raw);
  if (!time) return "";
  const [hourText, minuteText] = time.split(":");
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (hasExplicitAmPm(raw) || hour > 5 || hour === 0) return time;

  const text = normalizeText(raw);
  const options = Array.isArray(offer?.options) ? offer.options : [];
  const allAfternoon = options.length > 0 && options.every((option) => AFTERNOON_SLOTS.includes(option.time));
  const afternoonContext = /\b(tarde|afternoon|merdia)\b/.test(text) || allAfternoon;
  if (afternoonContext) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function conversationKey(request) {
  return request.contactPhone
    || request.contactJid
    || normalizeText(request.chatTitle)
    || hashId(request.latestCustomerTurn, 20);
}

async function currentOffer(dbInstance, request) {
  const key = conversationKey(request);
  const id = `wa-offer-${hashId(key, 32)}`;
  const snapshot = await dbInstance.collection("whatsappCopilotOffers").doc(id).get();
  if (!snapshot.exists) return null;
  const offer = { id: snapshot.id, ...snapshot.data() };
  if (!["open", "booked"].includes(offer.status) || !Array.isArray(offer.options)) return null;
  if (offer.expiresAt && offer.expiresAt < new Date().toISOString()) return null;
  return offer;
}

function uniqueOfferDate(offer) {
  const dates = [...new Set((offer?.options || []).map((option) => option?.date).filter(Boolean))];
  return dates.length === 1 ? dates[0] : "";
}

function explicitDateFromTurn(latest, today = arubaDateParts().date) {
  return normalizeRequestedDate("", latest, today);
}

function looksLikeTimeRefinement(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /\b(tarde|afternoon|merdia|manana|morning|mainta|despues|después|after|a partir|desde|antes|before|hasta|until)\b/.test(text)
    || /\b(a|para|desde|despues de|después de)\s+(?:la|las)?\s*\d{1,2}(?::\d{2})?\b/.test(text);
}

function looksLikeBookingCommand(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /\b(ponlo|pon la cita|agendalo|agéndalo|agenda|reservalo|resérvalo|confirmalo|confírmalo|dejalo|déjalo|me sirve|esta bien|está bien)\b/.test(text)
    && /\b\d{1,2}(?::\d{2})?\b/.test(text);
}

function isSchedulingControlTurn(value) {
  return isAvailabilityTurn(value) || looksLikeTimeRefinement(value) || looksLikeBookingCommand(value);
}

function findFuzzyOption(options, requestedDate, requestedTime) {
  const available = Array.isArray(options) ? options : [];
  const dated = requestedDate ? available.filter((option) => option.date === requestedDate) : available;
  const pool = dated.length ? dated : available;
  if (!requestedTime || !pool.length) return null;
  const [targetHourText, targetMinuteText] = requestedTime.split(":");
  const target = Number(targetHourText) * 60 + Number(targetMinuteText);
  const ranked = pool.map((option, index) => {
    const [hourText, minuteText] = String(option.time || "").split(":");
    const value = Number(hourText) * 60 + Number(minuteText);
    return { option, index: available.indexOf(option), distance: Math.abs(value - target) };
  }).filter((item) => Number.isFinite(item.distance) && item.distance <= 45)
    .sort((a, b) => a.distance - b.distance);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].distance === ranked[1].distance) return null;
  return ranked[0];
}

function inheritOfferContext(analysis, offer, latest) {
  const next = {
    ...analysis,
    collectedInformation: { ...(analysis.collectedInformation || {}) },
  };
  if (!offer) return next;

  const savedRequest = offer.request || {};
  if (!next.collectedInformation.serviceType && savedRequest.serviceType) next.collectedInformation.serviceType = savedRequest.serviceType;
  if (!next.collectedInformation.quantity && savedRequest.quantity) next.collectedInformation.quantity = String(savedRequest.quantity);
  if (!next.collectedInformation.address && savedRequest.address) next.collectedInformation.address = savedRequest.address;

  const explicitDate = explicitDateFromTurn(latest);
  const inheritedDate = explicitDate || uniqueOfferDate(offer);
  if (inheritedDate) {
    next.collectedInformation.requestedDate = inheritedDate;
    next.collectedInformation.preferredDate = inheritedDate;
  }

  const time = contextualTime(latest, offer);
  if (time) {
    next.collectedInformation.requestedTime = time;
    next.collectedInformation.preferredTime = time;
  }

  if (looksLikeBookingCommand(latest) && time) {
    const fuzzy = findFuzzyOption(offer.options, inheritedDate, time);
    if (fuzzy) {
      next.selectedOptionOrdinal = fuzzy.index + 1;
      next.customerConfirmedAppointment = true;
      next.conversationStage = "appointment_option_selected";
      next.nextAction = "reserve_erp_appointment";
      next.collectedInformation.requestedDate = fuzzy.option.date;
      next.collectedInformation.preferredDate = fuzzy.option.date;
      next.collectedInformation.requestedTime = fuzzy.option.time;
      next.collectedInformation.preferredTime = fuzzy.option.time;
      return next;
    }
  }

  if (looksLikeTimeRefinement(latest) || isAvailabilityTurn(latest)) {
    next.selectedOptionOrdinal = 0;
    next.customerConfirmedAppointment = false;
    next.conversationStage = "ready_for_schedule_lookup";
    next.nextAction = "query_erp_availability";
  }
  return next;
}

function requestedWeekdayWord(value, language) {
  const text = normalizeText(value);
  const names = language === "en"
    ? ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    : language === "pap-aw"
      ? ["dialuna", "diamars", "diaranson", "diahuebs", "diabierna", "diasabra", "diadomingo"]
      : ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
  return names.find((name) => text.includes(normalizeText(name))) || "";
}

function presentationContext(result, args) {
  const latest = cleanText(args?.request?.latestCustomerTurn, 300);
  const language = args?.analysis?.language || "es";
  const requestedDate = result?.requestedDate || explicitDateFromTurn(latest);
  const weekday = requestedWeekdayWord(latest, language);
  const constraint = result?.timeConstraint || {};
  const requestedBlock = /\b(tarde|afternoon|merdia)\b/.test(normalizeText(latest)) ? "afternoon" : "";
  const slots = Math.max(1, ...(result?.allocations || []).map((item) => Number(item.slots || 1)));
  const totalMinutes = Math.max(0, ...(result?.allocations || []).map((item) => Number(item.quantity || 0) * Number(result?.preset?.durationMinutesPerUnit || 60)));
  const latestAfternoonIndex = AFTERNOON_SLOTS.length - slots;
  const latestAfternoonStart = latestAfternoonIndex >= 0 ? AFTERNOON_SLOTS[latestAfternoonIndex] : "";
  return {
    latest,
    weekday,
    requestedDate,
    requestedBlock,
    constraint,
    totalMinutes,
    latestAfternoonStart,
    quantity: Number(result?.quantity || 0),
  };
}

function generateOptionsV19(args) {
  const result = originalGenerateOptions(args);
  const context = presentationContext(result, args);
  if (result?.requestedDate && Array.isArray(result.options)) {
    const sameDate = result.options.filter((option) => option.date === result.requestedDate);
    if (sameDate.length) result.options = sameDate;
  }
  return { ...result, presentation: context, flowVersion: 19 };
}

function clockLabel(time, language = "es") {
  if (!time) return "";
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(Date.UTC(2020, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-AW", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date).replace(/\u00a0/g, " ");
}

function durationLabel(minutes, language = "es") {
  const hours = minutes / 60;
  const display = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".0", "");
  if (language === "en") return `${display} hour${hours === 1 ? "" : "s"}`;
  if (language === "pap-aw") return `${display} ora`;
  return `${display} hora${hours === 1 ? "" : "s"}`;
}

function timeConstraintConflict(result) {
  const presentation = result?.presentation || {};
  const constraint = presentation.constraint || {};
  if (!presentation.latestAfternoonStart || !["after", "from"].includes(constraint.kind) || !constraint.time) return false;
  const boundary = Number(constraint.time.slice(0, 2)) * 60 + Number(constraint.time.slice(3, 5));
  const latest = Number(presentation.latestAfternoonStart.slice(0, 2)) * 60 + Number(presentation.latestAfternoonStart.slice(3, 5));
  return constraint.kind === "after" ? boundary >= latest : boundary > latest;
}

function naturalIntro(language, result) {
  const p = result?.presentation || {};
  const optionCount = result?.options?.length || 0;
  const noun = optionCount === 1
    ? (language === "en" ? "opening" : language === "pap-aw" ? "cupo" : "cupo")
    : (language === "en" ? "options" : language === "pap-aw" ? "cuponan" : "opciones");
  const latestText = normalizeText(p.latest);
  const afternoon = p.requestedBlock === "afternoon" || /\b(tarde|afternoon|merdia)\b/.test(latestText);
  const dateRequest = Boolean(p.weekday) || /\b(cupo|tienes para|tiene para|hay para)\b/.test(latestText);

  if (language === "en") {
    if (afternoon && p.weekday) return `Yes. For ${p.weekday} afternoon I have this ${noun}:`;
    if (afternoon) return `Yes. For the afternoon I have this ${noun}:`;
    if (dateRequest && p.weekday) return `Yes. For ${p.weekday} I have these ${noun}:`;
    return `For the service of ${result.quantity} AC unit${result.quantity === 1 ? "" : "s"}, I have these ${noun}:`;
  }
  if (language === "pap-aw") {
    if (afternoon && p.weekday) return `Si. Pa ${p.weekday} den atardi mi tin e ${noun} aki:`;
    if (afternoon) return `Si. Pa atardi mi tin e ${noun} aki:`;
    if (dateRequest && p.weekday) return `Si. Pa ${p.weekday} mi tin e ${noun} aki:`;
    return `Pa e servicio di ${result.quantity} airco, mi tin e opcionnan aki:`;
  }
  if (afternoon && p.weekday) return `Sí. Para el ${p.weekday} en la tarde tengo este ${noun}:`;
  if (afternoon) return `Sí. Para la tarde tengo este ${noun}:`;
  if (dateRequest && p.weekday) return `Sí. Para el ${p.weekday} tengo estas ${noun}:`;
  return `Para el servicio de ${result.quantity} aire${result.quantity === 1 ? "" : "s"}, tengo estas ${noun}:`;
}

function optionLine(language, option, index) {
  const locale = language === "en" ? "en-AW" : "es-AW";
  const date = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${option.date}T12:00:00Z`));
  const normalizedDate = date.charAt(0).toUpperCase() + date.slice(1).replace(",", "");
  return `*${index + 1}. ${normalizedDate} — ${clockLabel(option.time, language)}*`;
}

function formatAvailabilityReplyV19(language, result) {
  const options = Array.isArray(result?.options) ? result.options : [];
  if (!options.length && timeConstraintConflict(result)) {
    const p = result.presentation;
    const duration = durationLabel(p.totalMinutes, language);
    const lastStart = clockLabel(p.latestAfternoonStart, language);
    if (language === "en") return `For ${p.quantity} AC units we need approximately ${duration}.\n\nStarting after the requested time would not leave enough time to finish the workday. The latest possible start is ${lastStart}.\n\nWould ${lastStart} work for you?`;
    if (language === "pap-aw") return `Pa ${p.quantity} airco nos mester aproximadamente ${duration}.\n\nSi nos cuminsa despues di e ora cu bo a pidi, nos no lo tin suficiente tempo pa termina. E ora mas laat cu nos por cuminsa ta ${lastStart}.\n\n${lastStart} ta bon pa bo?`;
    return `Para los ${p.quantity} aires necesitamos aproximadamente ${duration}.\n\nSi comenzamos después de la hora que indicó, no alcanzaríamos a terminar dentro de la jornada. El último horario posible es a la ${lastStart}.\n\n¿Le funciona la ${lastStart}?`;
  }

  if (!options.length) {
    if (language === "en") return "I don't have a suitable opening with the current restrictions. Our Operations team will review the closest available option.";
    if (language === "pap-aw") return "Mi no tin un cupo cu ta cuadra cu e restriccionnan actual. Nos team di Operacion lo revisa e opcion mas cercano.";
    return "No tengo un cupo que cumpla con las restricciones actuales. Nuestro equipo de Operaciones revisará la opción más cercana.";
  }

  const intro = naturalIntro(language, result);
  const lines = options.map((option, index) => optionLine(language, option, index));
  const question = language === "en"
    ? (options.length === 1 ? "Would this time work for you?" : "Which option works best for you?")
    : language === "pap-aw"
      ? (options.length === 1 ? "E ora aki ta bon pa bo?" : "Cua opcion ta mihor pa bo?")
      : (options.length === 1 ? "¿Le funciona este horario?" : "¿Cuál opción le funciona mejor?");
  return `${intro}\n\n${lines.join("\n\n")}\n\n${question}`;
}

function formatConfirmationReplyV19(language, option) {
  const line = optionLine(language, option, 0).replace(/^\*1\.\s*/, "*");
  if (language === "en") return `All set. Your appointment is confirmed:\n\n${line}\n${option.address}`;
  if (language === "pap-aw") return `Kla. Bo cita ta confirma:\n\n${line}\n${option.address}`;
  return `Listo. Su cita quedó confirmada:\n\n${line}\n${option.address}`;
}

availability.generateOptions = generateOptionsV19;
availability.formatAvailabilityReply = formatAvailabilityReplyV19;
availability.formatConfirmationReply = formatConfirmationReplyV19;

async function orchestrateSchedulingV19(args) {
  const offer = await currentOffer(args.db, args.request);
  const analysis = inheritOfferContext(args.analysis, offer, args.request.latestCustomerTurn);
  return originalOrchestrateScheduling({ ...args, analysis });
}

schedulingModule.orchestrateScheduling = orchestrateSchedulingV19;

function extractIdentity(conversation) {
  const explicitPhone = cleanText(conversation?.contactPhone, 40).replace(/\D/g, "");
  if (explicitPhone) return { contactPhone: explicitPhone, contactJid: cleanText(conversation?.contactJid, 120) };
  for (const message of conversation?.messages || []) {
    if (message?.direction !== "inbound") continue;
    const match = String(message?.id || "").match(/(?:^|_)(\d{7,20})@(c\.us|s\.whatsapp\.net)(?:_|$)/i);
    if (match) return { contactPhone: match[1], contactJid: `${match[1]}@${match[2]}` };
  }
  return { contactPhone: "", contactJid: cleanText(conversation?.contactJid, 120) };
}

function deterministicAnalysis(body) {
  const conversation = body?.conversation || {};
  const latest = latestCustomerText(conversation);
  const facts = conversation.confirmedFacts || {};
  const language = normalizeLanguage(latest, body?.languageMode || "auto");
  const today = arubaDateParts().date;
  const requestedDate = explicitDateFromTurn(latest, today) || cleanText(facts.requestedDate, 20);
  const requestedTime = normalizeTime(latest) || cleanText(facts.preferredTime, 30).replace(/^(after|from|before|until)\s+/i, "");
  return {
    intent: "appointment_question",
    language,
    conversationStage: "ready_for_schedule_lookup",
    nextAction: "query_erp_availability",
    summary: "El cliente está refinando o seleccionando una disponibilidad ya conversada.",
    reply: "",
    requiresHuman: false,
    confidence: 1,
    missingInformation: [],
    selectedOptionOrdinal: 0,
    customerConfirmedAppointment: false,
    collectedInformation: {
      serviceType: cleanText(facts.serviceType, 80),
      quantity: cleanText(facts.quantity, 20),
      address: cleanText(facts.address, 160),
      requestedDate,
      requestedTime,
      preferredDate: requestedDate,
      preferredTime: cleanText(facts.preferredTime, 80) || requestedTime,
      customerName: cleanText(facts.customerName, 120),
      extraDetails: cleanText(latest, 300),
    },
  };
}

async function handleDeterministicScheduling(body) {
  const conversation = body?.conversation || {};
  const latest = latestCustomerText(conversation);
  if (!isSchedulingControlTurn(latest)) return null;
  const analysis = deterministicAnalysis(body);
  const identity = extractIdentity(conversation);
  const request = {
    chatTitle: cleanText(conversation.chatTitle, 160),
    contactPhone: identity.contactPhone,
    contactJid: identity.contactJid,
    latestCustomerTurn: latest,
  };
  const offer = await currentOffer(db, request);
  const enriched = inheritOfferContext(analysis, offer, latest);
  if (!enriched.collectedInformation.serviceType || !enriched.collectedInformation.quantity || !enriched.collectedInformation.address) return null;
  const result = await originalOrchestrateScheduling({
    db,
    request,
    analysis: enriched,
    commitAppointment: body?.commitAppointment === true,
  });
  return {
    draft: result.reply,
    source: "erp-deterministic-scheduling-v19",
    warning: result.warning || "",
    metadata: {
      intent: enriched.intent,
      language: enriched.language,
      conversationStage: result.action === "appointment_booked" ? "appointment_confirmed" : result.action === "appointment_pending_approval" ? "appointment_option_selected" : "offering_appointments",
      nextAction: result.action === "appointment_pending_approval" ? "reserve_erp_appointment" : result.action === "appointment_booked" ? "wait_for_customer" : result.action === "availability_unavailable" ? "transfer_human" : "wait_for_customer",
      summary: enriched.summary,
      confidence: 1,
      requiresHuman: result.action === "availability_unavailable" && !result?.result?.presentation?.latestAfternoonStart,
      missingInformation: [],
      collectedInformation: enriched.collectedInformation,
      selectedOptionOrdinal: enriched.selectedOptionOrdinal,
      customerConfirmedAppointment: enriched.customerConfirmedAppointment,
      scheduling: result.metadata || null,
      flowVersion: 19,
    },
  };
}

module.exports = {
  V19_MARKER,
  contextualTime,
  findFuzzyOption,
  formatAvailabilityReplyV19,
  formatConfirmationReplyV19,
  generateOptionsV19,
  handleDeterministicScheduling,
  inheritOfferContext,
  isSchedulingControlTurn,
  looksLikeBookingCommand,
  looksLikeTimeRefinement,
  naturalIntro,
  timeConstraintConflict,
};
