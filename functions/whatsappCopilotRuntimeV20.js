const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const runtime = require("./whatsappCopilotSchedulingRuntimeV19");
const schedulingDraftModule = require("./whatsappCopilot");
const flow20 = require("./whatsappCopilotFlowV20");
const {
  cleanText,
  hashId,
  normalizeText,
} = require("./whatsappCopilotSchedulingCore");
const { latestCustomerText } = require("./whatsappCopilotConversationPolicy");
const { sanitizeRequestBody } = require("./whatsappCopilotSessionContextV20");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const baseHandleDeterministicScheduling = runtime.handleDeterministicScheduling;
const baseSchedulingDraft = schedulingDraftModule.whatsappCopilotDraft;

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

function conversationKey(conversation) {
  const identity = extractIdentity(conversation);
  return identity.contactPhone
    || identity.contactJid
    || normalizeText(conversation?.chatTitle)
    || hashId(latestCustomerText(conversation), 20);
}

async function currentOpenOffer(conversation) {
  const key = conversationKey(conversation);
  if (!key) return null;
  const id = `wa-offer-${hashId(key, 32)}`;
  const snapshot = await db.collection("whatsappCopilotOffers").doc(id).get();
  if (!snapshot.exists) return null;
  const offer = { id: snapshot.id, ...snapshot.data() };
  if (offer.status !== "open" || !Array.isArray(offer.options) || !offer.options.length) return null;
  if (offer.expiresAt && offer.expiresAt < new Date().toISOString()) return null;
  return offer;
}

function clarificationPayload(language, offer) {
  const optionCount = offer?.options?.length || 0;
  const draft = language === "en"
    ? `Of course. Which of the ${optionCount} options would you like, option 1 or option 2?`
    : language === "pap-aw"
      ? `Claro. Cua di e ${optionCount} opcionnan bo kier, opcion 1 of opcion 2?`
      : `Claro. ¿Cuál de las ${optionCount} opciones prefiere, la opción 1 o la opción 2?`;
  return {
    draft,
    source: "erp-stateful-confirmation-v20",
    warning: "",
    metadata: {
      intent: "appointment_question",
      language,
      conversationStage: "offering_appointments",
      nextAction: "wait_for_customer",
      summary: "El cliente confirmó de forma general, pero hay más de una opción activa y debe indicar cuál.",
      confidence: 1,
      requiresHuman: false,
      missingInformation: ["selectedAppointmentOption"],
      collectedInformation: {},
      selectedOptionOrdinal: 0,
      customerConfirmedAppointment: false,
      scheduling: { offerId: offer.id, availabilityOptions: offer.options },
      flowVersion: 20,
    },
  };
}

function languageFromTurn(value) {
  const text = normalizeText(value);
  if (/\b(good|yes|okay|sure|option)\b/.test(text)) return "en";
  if (/\b(bon|danki|opcionnan|bo|ta bon)\b/.test(text)) return "pap-aw";
  return "es";
}

async function handleDeterministicSchedulingV20(rawBody) {
  const body = sanitizeRequestBody(rawBody);
  const conversation = body?.conversation || {};
  const latest = latestCustomerText(conversation);

  if (flow20.isSimpleAffirmation(latest)) {
    const offer = await currentOpenOffer(conversation);
    if (!offer) return null;
    if (offer.options.length > 1) return clarificationPayload(languageFromTurn(latest), offer);
  }

  return baseHandleDeterministicScheduling(body);
}

async function schedulingDraftV20(request, response) {
  const originalBody = request.body;
  request.body = sanitizeRequestBody(originalBody);
  try {
    return await baseSchedulingDraft(request, response);
  } finally {
    request.body = originalBody;
  }
}

runtime.handleDeterministicScheduling = handleDeterministicSchedulingV20;
schedulingDraftModule.whatsappCopilotDraft = schedulingDraftV20;

module.exports = {
  clarificationPayload,
  handleDeterministicScheduling: handleDeterministicSchedulingV20,
  schedulingDraft: schedulingDraftV20,
};
