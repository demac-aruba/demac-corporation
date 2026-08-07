const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  arubaDateParts,
  cleanText,
  hashId,
  normalizeRequestedDate,
  normalizeText,
  normalizeTime,
} = require("./whatsappCopilotSchedulingCore");
const { latestCustomerText } = require("./whatsappCopilotConversationPolicy");
const flow = require("./whatsappCopilotFlowV19");

// whatsappCopilotFlowV19 patches availability formatting first. Reload scheduling so
// its destructured formatter/generator references point at the V19 versions.
delete require.cache[require.resolve("./whatsappCopilotScheduling")];
const scheduling = require("./whatsappCopilotScheduling");
const baseOrchestrateScheduling = scheduling.orchestrateScheduling;

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);

function conversationKey(request) {
  return request.contactPhone
    || request.contactJid
    || normalizeText(request.chatTitle)
    || hashId(request.latestCustomerTurn, 20);
}

async function currentOffer(dbInstance, request) {
  const id = `wa-offer-${hashId(conversationKey(request), 32)}`;
  const snapshot = await dbInstance.collection("whatsappCopilotOffers").doc(id).get();
  if (!snapshot.exists) return null;
  const offer = { id: snapshot.id, ...snapshot.data() };
  if (!["open", "booked"].includes(offer.status) || !Array.isArray(offer.options)) return null;
  if (offer.expiresAt && offer.expiresAt < new Date().toISOString()) return null;
  return offer;
}

async function orchestrateSchedulingV19(args) {
  const offer = await currentOffer(args.db, args.request);
  const analysis = flow.inheritOfferContext(args.analysis, offer, args.request.latestCustomerTurn);
  return baseOrchestrateScheduling({ ...args, analysis });
}

scheduling.orchestrateScheduling = orchestrateSchedulingV19;

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

function languageForTurn(latest, languageMode = "auto") {
  if (["es", "en", "pap-aw"].includes(languageMode)) return languageMode;
  const text = normalizeText(latest);
  if (/\b(good|hello|hi|service|installation|repair)\b/.test(text)) return "en";
  if (/\b(bon dia|bon tardi|bon nochi|mi kier|bo por|tin cupo|airco)\b/.test(text)) return "pap-aw";
  return "es";
}

function deterministicAnalysis(body) {
  const conversation = body?.conversation || {};
  const latest = latestCustomerText(conversation);
  const facts = conversation.confirmedFacts || {};
  const language = languageForTurn(latest, body?.languageMode || "auto");
  const today = arubaDateParts().date;
  const requestedDate = normalizeRequestedDate("", latest, today) || cleanText(facts.requestedDate, 20);
  const storedPreference = cleanText(facts.preferredTime, 80);
  const requestedTime = normalizeTime(latest) || storedPreference.replace(/^(after|from|before|until)\s+/i, "");
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
      preferredTime: storedPreference || requestedTime,
      customerName: cleanText(facts.customerName, 120),
      extraDetails: cleanText(latest, 300),
    },
  };
}

async function handleDeterministicScheduling(body) {
  const conversation = body?.conversation || {};
  const latest = latestCustomerText(conversation);
  if (!flow.isSchedulingControlTurn(latest)) return null;
  const identity = extractIdentity(conversation);
  const request = {
    chatTitle: cleanText(conversation.chatTitle, 160),
    contactPhone: identity.contactPhone,
    contactJid: identity.contactJid,
    latestCustomerTurn: latest,
  };
  const offer = await currentOffer(db, request);
  const analysis = flow.inheritOfferContext(deterministicAnalysis(body), offer, latest);
  if (!analysis.collectedInformation.serviceType || !analysis.collectedInformation.quantity || !analysis.collectedInformation.address) return null;
  const result = await baseOrchestrateScheduling({
    db,
    request,
    analysis,
    commitAppointment: body?.commitAppointment === true,
  });
  return {
    draft: result.reply,
    source: "erp-deterministic-scheduling-v19",
    warning: result.warning || "",
    metadata: {
      intent: analysis.intent,
      language: analysis.language,
      conversationStage: result.action === "appointment_booked" ? "appointment_confirmed" : result.action === "appointment_pending_approval" ? "appointment_option_selected" : "offering_appointments",
      nextAction: result.action === "appointment_pending_approval" ? "reserve_erp_appointment" : result.action === "appointment_booked" ? "wait_for_customer" : result.action === "availability_unavailable" ? "wait_for_customer" : "wait_for_customer",
      summary: analysis.summary,
      confidence: 1,
      requiresHuman: false,
      missingInformation: [],
      collectedInformation: analysis.collectedInformation,
      selectedOptionOrdinal: analysis.selectedOptionOrdinal,
      customerConfirmedAppointment: analysis.customerConfirmedAppointment,
      scheduling: result.metadata || null,
      flowVersion: 19,
    },
  };
}

module.exports = {
  handleDeterministicScheduling,
  orchestrateScheduling: orchestrateSchedulingV19,
};
