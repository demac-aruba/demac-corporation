const flow = require("./whatsappCopilotFlowV19");
const { normalizeText } = require("./whatsappCopilotSchedulingCore");

const baseInheritOfferContext = flow.inheritOfferContext;
const baseSchedulingControlTurn = flow.isSchedulingControlTurn;

function isNaturalBookingCommand(value) {
  const text = normalizeText(value);
  if (!text || !/\b\d{1,2}(?::\d{2})?\b/.test(text)) return false;
  return /\b(pon|ponlo|pon la cita|pon el servicio|agendalo|agenda|reserva|reservalo|confirma|confirmalo|dejalo|me sirve|esta bien)\b/.test(text);
}

function patchedInheritOfferContext(analysis, offer, latest) {
  const result = baseInheritOfferContext(analysis, offer, latest);
  if (!offer?.options?.length || result.customerConfirmedAppointment || !isNaturalBookingCommand(latest)) return result;

  const requestedTime = flow.contextualTime(latest, offer);
  if (!requestedTime) return result;
  const uniqueDates = [...new Set(offer.options.map((option) => option?.date).filter(Boolean))];
  const requestedDate = result.collectedInformation?.requestedDate || (uniqueDates.length === 1 ? uniqueDates[0] : "");
  const fuzzy = flow.findFuzzyOption(offer.options, requestedDate, requestedTime);
  if (!fuzzy) return result;

  return {
    ...result,
    selectedOptionOrdinal: fuzzy.index + 1,
    customerConfirmedAppointment: true,
    conversationStage: "appointment_option_selected",
    nextAction: "reserve_erp_appointment",
    collectedInformation: {
      ...(result.collectedInformation || {}),
      requestedDate: fuzzy.option.date,
      preferredDate: fuzzy.option.date,
      requestedTime: fuzzy.option.time,
      preferredTime: fuzzy.option.time,
    },
  };
}

flow.looksLikeBookingCommand = (value) => flow.looksLikeBookingCommand(value) || isNaturalBookingCommand(value);
flow.isSchedulingControlTurn = (value) => baseSchedulingControlTurn(value) || isNaturalBookingCommand(value);
flow.inheritOfferContext = patchedInheritOfferContext;

module.exports = {
  isNaturalBookingCommand,
  patchedInheritOfferContext,
};
