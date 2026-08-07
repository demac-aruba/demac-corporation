const availability = require("./whatsappCopilotAvailability");
const flow = require("./whatsappCopilotFlowV19");
const {
  MAX_SEARCH_DAYS,
  addDays,
  cleanText,
  normalizeText,
} = require("./whatsappCopilotSchedulingCore");

const baseGenerateOptions = availability.generateOptions;
const baseInheritOfferContext = flow.inheritOfferContext;
const baseSchedulingControlTurn = flow.isSchedulingControlTurn;
const baseBookingCommand = flow.looksLikeBookingCommand;
const V20_MARKER = "stateful-confirmation-flow-v20";

function isSimpleAffirmation(value) {
  const text = normalizeText(value);
  if (!text || text.length > 80) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 7) return false;

  const forbidden = new Set([
    "no", "pero", "aunque", "otra", "otro", "cambia", "cambiar", "mejor",
    "manana", "tarde", "lunes", "martes", "miercoles", "jueves", "viernes",
    "sabado", "domingo", "after", "before", "tomorrow", "afternoon", "morning",
  ]);
  if (tokens.some((token) => forbidden.has(token))) return false;
  if (tokens.some((token) => /^\d{1,2}(?::\d{2})?$/.test(token))) return false;

  const allowed = new Set([
    "si", "ok", "okay", "okey", "excelente", "perfecto", "perfecta", "dale",
    "listo", "lista", "esta", "bien", "me", "sirve", "claro", "gracias", "correcto",
    "correcta", "de", "acuerdo", "yes", "yeah", "yep", "sure", "good", "great",
    "works", "fine", "ta", "bon", "danki", "kla",
  ]);
  const positive = new Set([
    "si", "ok", "okay", "okey", "excelente", "perfecto", "perfecta", "dale",
    "listo", "lista", "sirve", "claro", "correcto", "correcta", "acuerdo", "yes",
    "yeah", "yep", "sure", "good", "great", "works", "fine", "bon", "kla",
  ]);
  return tokens.every((token) => allowed.has(token)) && tokens.some((token) => positive.has(token));
}

function optionOrdinalFromTurn(value) {
  const text = normalizeText(value);
  if (!text) return 0;
  if (/\b(opcion|option)\s*(numero\s*)?1\b/.test(text) || /\b(la|el)?\s*(primera|primer|first)\b/.test(text)) return 1;
  if (/\b(opcion|option)\s*(numero\s*)?2\b/.test(text) || /\b(la|el)?\s*(segunda|segundo|second)\b/.test(text)) return 2;
  if (/\b(opcion|option)\s*(numero\s*)?3\b/.test(text) || /\b(la|el)?\s*(tercera|tercer|third)\b/.test(text)) return 3;
  return 0;
}

function isBookingCommandV20(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (baseBookingCommand(value)) return true;
  const hasTime = /\b\d{1,2}(?::\d{2})?\b/.test(text);
  const direct = /\b(dame|quiero|pon|ponme|agenda|agendame|reserva|reservame|confirma|confirmame|dejame|me quedo con)\b/.test(text)
    && /\b(cita|servicio|cupo|horario|hora|la|el)\b/.test(text);
  return hasTime && direct;
}

function applyOfferSelection(result, option, ordinal) {
  return {
    ...result,
    selectedOptionOrdinal: ordinal,
    customerConfirmedAppointment: true,
    conversationStage: "appointment_option_selected",
    nextAction: "reserve_erp_appointment",
    collectedInformation: {
      ...(result.collectedInformation || {}),
      requestedDate: option.date,
      preferredDate: option.date,
      requestedTime: option.time,
      preferredTime: option.time,
    },
  };
}

function inheritOfferContextV20(analysis, offer, latest) {
  const result = baseInheritOfferContext(analysis, offer, latest);
  const options = Array.isArray(offer?.options) ? offer.options.filter(Boolean) : [];
  if (!options.length || result.customerConfirmedAppointment) return result;

  if (isBookingCommandV20(latest)) {
    const requestedTime = flow.contextualTime(latest, offer);
    if (requestedTime) {
      const uniqueDates = [...new Set(options.map((option) => option.date).filter(Boolean))];
      const requestedDate = result.collectedInformation?.requestedDate || (uniqueDates.length === 1 ? uniqueDates[0] : "");
      const fuzzy = flow.findFuzzyOption(options, requestedDate, requestedTime);
      if (fuzzy) return applyOfferSelection(result, fuzzy.option, fuzzy.index + 1);
    }
  }

  const ordinal = optionOrdinalFromTurn(latest);
  if (ordinal >= 1 && ordinal <= options.length) {
    return applyOfferSelection(result, options[ordinal - 1], ordinal);
  }

  if (isSimpleAffirmation(latest) && options.length === 1) {
    return applyOfferSelection(result, options[0], 1);
  }

  return result;
}

function hasExplicitDateConstraint(result) {
  return Boolean(cleanText(result?.requestedDate, 30));
}

function forceDateAnalysis(analysis, date) {
  return {
    ...(analysis || {}),
    selectedOptionOrdinal: 0,
    customerConfirmedAppointment: false,
    collectedInformation: {
      ...(analysis?.collectedInformation || {}),
      requestedDate: date,
      preferredDate: date,
    },
  };
}

function earliestFeasibleResult(generate, args) {
  const initial = generate(args);
  if (!initial || hasExplicitDateConstraint(initial) || !Array.isArray(initial.options) || !initial.options.length) return initial;

  const firstReturnedDate = [...initial.options]
    .map((option) => option?.date)
    .filter(Boolean)
    .sort()[0];
  if (!firstReturnedDate) return initial;

  for (let offset = 0; offset < MAX_SEARCH_DAYS; offset += 1) {
    const date = addDays(args.today, offset);
    if (date > firstReturnedDate) break;
    const forced = generate({ ...args, analysis: forceDateAnalysis(args.analysis, date) });
    const sameDateOptions = Array.isArray(forced?.options)
      ? forced.options.filter((option) => option?.date === date)
      : [];
    if (!sameDateOptions.length) continue;

    return {
      ...forced,
      options: sameDateOptions,
      requestedDate: "",
      requestedDateUnavailable: false,
      presentation: {
        ...(forced.presentation || initial.presentation || {}),
        requestedDate: "",
        latest: cleanText(args?.request?.latestCustomerTurn, 300),
      },
      flowVersion: 20,
      earliestDatePolicyApplied: true,
    };
  }

  return { ...initial, flowVersion: 20 };
}

function generateOptionsV20(args) {
  return earliestFeasibleResult(baseGenerateOptions, args);
}

flow.inheritOfferContext = inheritOfferContextV20;
flow.isSchedulingControlTurn = (value) => (
  baseSchedulingControlTurn(value)
  || isSimpleAffirmation(value)
  || optionOrdinalFromTurn(value) > 0
  || isBookingCommandV20(value)
);
flow.looksLikeBookingCommand = isBookingCommandV20;
availability.generateOptions = generateOptionsV20;

module.exports = {
  V20_MARKER,
  applyOfferSelection,
  earliestFeasibleResult,
  generateOptionsV20,
  inheritOfferContextV20,
  isBookingCommandV20,
  isSimpleAffirmation,
  optionOrdinalFromTurn,
};
