const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const scheduling = require("./whatsappCopilotScheduling");
const flow20 = require("./whatsappCopilotFlowV20");
const state21 = require("./whatsappCopilotStateMachineV21");
const { latestCustomerText } = require("./whatsappCopilotConversationPolicy");
const { cleanText, normalizeText } = require("./whatsappCopilotSchedulingCore");
const { sanitizeRequestBody } = require("./whatsappCopilotSessionContextV20");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const FLOW_VERSION = 22;

function turnLanguage(value) {
  const text = normalizeText(value);
  if (/\b(yes|okay|sure|option|appointment)\b/.test(text)) return "en";
  if (/\b(bon|danki|bo|ta bon|opcionnan)\b/.test(text)) return "pap-aw";
  return "es";
}

function requestFromOffer(conversation, offer, latest) {
  return {
    chatTitle: cleanText(offer?.chatTitle || conversation?.chatTitle, 160),
    contactPhone: cleanText(offer?.contactPhone || conversation?.contactPhone, 40).replace(/\D/g, ""),
    contactJid: cleanText(conversation?.contactJid, 120),
    latestCustomerTurn: cleanText(latest, 300),
  };
}

function confirmedAnalysisFromOffer(conversation, offer, selection, latest) {
  const option = selection.option;
  const saved = offer?.request || {};
  const facts = conversation?.confirmedFacts || {};
  const language = turnLanguage(latest);
  return {
    intent: "appointment_question",
    language,
    conversationStage: "appointment_option_selected",
    nextAction: "reserve_erp_appointment",
    summary: "El cliente seleccionó de forma explícita una opción ya ofrecida por la agenda.",
    reply: "",
    requiresHuman: false,
    confidence: 1,
    missingInformation: [],
    selectedOptionOrdinal: selection.ordinal,
    customerConfirmedAppointment: true,
    collectedInformation: {
      serviceType: cleanText(facts.serviceType || saved.serviceType, 80),
      quantity: String(facts.quantity || saved.quantity || ""),
      address: cleanText(facts.address || saved.address || option?.address, 160),
      requestedDate: cleanText(option?.date, 20),
      requestedTime: cleanText(option?.time, 20),
      preferredDate: cleanText(option?.date, 20),
      preferredTime: cleanText(option?.time, 20),
      customerName: cleanText(facts.customerName, 120),
      extraDetails: cleanText(latest, 300),
    },
  };
}

function payloadFromScheduling(result, analysis) {
  return {
    draft: result.reply,
    source: "erp-appointment-state-machine-v22",
    warning: result.warning || "",
    metadata: {
      intent: analysis.intent,
      language: analysis.language,
      conversationStage: result.action === "appointment_booked"
        ? "appointment_confirmed"
        : result.action === "appointment_pending_approval"
          ? "appointment_option_selected"
          : "offering_appointments",
      nextAction: result.action === "appointment_pending_approval"
        ? "reserve_erp_appointment"
        : "wait_for_customer",
      summary: analysis.summary,
      confidence: 1,
      requiresHuman: false,
      missingInformation: [],
      collectedInformation: analysis.collectedInformation,
      selectedOptionOrdinal: analysis.selectedOptionOrdinal,
      customerConfirmedAppointment: analysis.customerConfirmedAppointment,
      scheduling: result.metadata || null,
      flowVersion: FLOW_VERSION,
    },
  };
}

function clarificationPayload(language, offer) {
  const count = offer?.options?.length || 0;
  const draft = language === "en"
    ? `Of course. I still have ${count} options active. Which one would you like, option 1 or option 2?`
    : language === "pap-aw"
      ? `Claro. Mi tin ${count} opcionnan activo ainda. Cua bo kier, opcion 1 of opcion 2?`
      : `Claro. Todavía tengo ${count} opciones activas. ¿Cuál prefiere, la opción 1 o la opción 2?`;
  return {
    draft,
    source: "erp-appointment-state-machine-v22",
    warning: "",
    metadata: {
      intent: "appointment_question",
      language,
      conversationStage: "offering_appointments",
      nextAction: "wait_for_customer",
      requiresHuman: false,
      confidence: 1,
      missingInformation: ["selectedAppointmentOption"],
      collectedInformation: {},
      selectedOptionOrdinal: 0,
      customerConfirmedAppointment: false,
      flowVersion: FLOW_VERSION,
      scheduling: { offerId: offer.id, availabilityOptions: offer.options },
    },
  };
}

async function handleStatefulSchedulingV22(rawBody) {
  const body = sanitizeRequestBody(rawBody);
  const conversation = body?.conversation || {};
  const latest = latestCustomerText(conversation);
  const offer = await state21.findCurrentOfferV21(conversation);

  if (offer && state21.isExplicitSelectionTurnV21(latest)) {
    const selection = state21.selectOptionFromTurn(latest, offer);
    if (selection) {
      const request = requestFromOffer(conversation, offer, latest);
      const analysis = confirmedAnalysisFromOffer(conversation, offer, selection, latest);
      const result = await scheduling.orchestrateScheduling({
        db,
        request,
        analysis,
        commitAppointment: body?.commitAppointment === true,
      });
      return payloadFromScheduling(result, analysis);
    }

    if (flow20.isSimpleAffirmation(latest) && offer.options.length > 1) {
      return clarificationPayload(turnLanguage(latest), offer);
    }
  }

  const result = await state21.handleStatefulSchedulingV21(body);
  if (result?.metadata) result.metadata.flowVersion = FLOW_VERSION;
  return result;
}

function isSchedulingControlTurnV22(value) {
  return state21.isSchedulingControlTurnV21(value);
}

module.exports = {
  FLOW_VERSION,
  clarificationPayload,
  confirmedAnalysisFromOffer,
  handleStatefulSchedulingV22,
  isSchedulingControlTurnV22,
  payloadFromScheduling,
  requestFromOffer,
};
