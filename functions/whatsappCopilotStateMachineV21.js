const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const runtime20 = require("./whatsappCopilotRuntimeV20");
const flow19 = require("./whatsappCopilotFlowV19");
const flow20 = require("./whatsappCopilotFlowV20");
const { latestCustomerText } = require("./whatsappCopilotConversationPolicy");
const { cleanText, hashId, normalizeText } = require("./whatsappCopilotSchedulingCore");
const { sanitizeRequestBody } = require("./whatsappCopilotSessionContextV20");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const FLOW_VERSION = 21;

function identityCandidates(conversation) {
  const values = [];
  const phone = cleanText(conversation?.contactPhone, 40).replace(/\D/g, "");
  const jid = cleanText(conversation?.contactJid, 120);
  const title = normalizeText(conversation?.chatTitle);
  if (phone) values.push(phone);
  if (jid) values.push(jid);
  for (const message of conversation?.messages || []) {
    if (message?.direction !== "inbound") continue;
    const match = String(message?.id || "").match(/(?:^|_)(\d{7,20})@(c\.us|s\.whatsapp\.net)(?:_|$)/i);
    if (match) {
      values.push(match[1], `${match[1]}@${match[2]}`);
      break;
    }
  }
  if (title) values.push(title);
  return [...new Set(values.filter(Boolean))];
}

function offerDocId(key) {
  return `wa-offer-${hashId(key, 32)}`;
}

function offerIsUsable(offer) {
  if (!offer || !["open", "booked"].includes(offer.status) || !Array.isArray(offer.options) || !offer.options.length) return false;
  if (offer.expiresAt && offer.expiresAt < new Date().toISOString()) return false;
  return true;
}

function newestOffer(offers) {
  return [...offers].sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")))[0] || null;
}

async function findCurrentOfferV21(conversation) {
  const found = [];
  for (const key of identityCandidates(conversation)) {
    const snapshot = await db.collection("whatsappCopilotOffers").doc(offerDocId(key)).get();
    if (snapshot.exists) {
      const offer = { id: snapshot.id, ...snapshot.data() };
      if (offerIsUsable(offer)) found.push(offer);
    }
  }
  if (found.length) return newestOffer(found);

  const title = cleanText(conversation?.chatTitle, 160);
  if (title) {
    const snapshot = await db.collection("whatsappCopilotOffers").where("chatTitle", "==", title).limit(10).get();
    for (const doc of snapshot.docs || []) {
      const offer = { id: doc.id, ...doc.data() };
      if (offerIsUsable(offer)) found.push(offer);
    }
  }
  return newestOffer(found);
}

function isDeicticConfirmation(value) {
  const text = normalizeText(value);
  if (!text || text.length > 140) return false;
  return /\b(esa cita|ese horario|ese cupo|esa opcion|esa opción|esa hora|dame esa|pon esa|reserva esa|confirmame esa|confirma esa|si esa|sí esa|esa esta bien|esa está bien|me quedo con esa)\b/.test(text);
}

function isExplicitSelectionTurnV21(value) {
  return flow20.isSimpleAffirmation(value)
    || flow20.optionOrdinalFromTurn(value) > 0
    || flow20.isBookingCommandV20(value)
    || isDeicticConfirmation(value);
}

function selectOptionFromTurn(value, offer) {
  const options = Array.isArray(offer?.options) ? offer.options.filter(Boolean) : [];
  if (!options.length) return null;

  const ordinal = flow20.optionOrdinalFromTurn(value);
  if (ordinal >= 1 && ordinal <= options.length) return { option: options[ordinal - 1], ordinal };

  const requestedTime = flow19.contextualTime(value, offer);
  if (requestedTime) {
    const uniqueDates = [...new Set(options.map((option) => option?.date).filter(Boolean))];
    const requestedDate = uniqueDates.length === 1 ? uniqueDates[0] : "";
    const fuzzy = flow19.findFuzzyOption(options, requestedDate, requestedTime);
    if (fuzzy) return { option: fuzzy.option, ordinal: fuzzy.index + 1 };
  }

  if ((flow20.isSimpleAffirmation(value) || isDeicticConfirmation(value)) && options.length === 1) {
    return { option: options[0], ordinal: 1 };
  }
  return null;
}

function rewriteAsOrdinal(body, offer, selection) {
  const sanitized = sanitizeRequestBody(body);
  const conversation = sanitized.conversation || {};
  const replacement = `opción ${selection.ordinal}`;
  const messages = Array.isArray(conversation.messages) ? [...conversation.messages] : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.direction !== "inbound") continue;
    messages[index] = { ...messages[index], text: replacement };
    break;
  }
  return {
    ...sanitized,
    conversation: {
      ...conversation,
      chatTitle: offer.chatTitle || conversation.chatTitle,
      contactPhone: offer.contactPhone || conversation.contactPhone || "",
      messages,
      customerTurn: {
        ...(conversation.customerTurn || {}),
        text: replacement,
      },
      confirmedFacts: {
        ...(conversation.confirmedFacts || {}),
        serviceType: conversation.confirmedFacts?.serviceType || offer.request?.serviceType || "",
        quantity: String(conversation.confirmedFacts?.quantity || offer.request?.quantity || ""),
        address: conversation.confirmedFacts?.address || offer.request?.address || "",
        requestedDate: selection.option.date,
        preferredTime: selection.option.time,
      },
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
    source: "erp-appointment-state-machine-v21",
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

function turnLanguage(value) {
  const text = normalizeText(value);
  if (/\b(yes|okay|sure|option|appointment)\b/.test(text)) return "en";
  if (/\b(bon|danki|bo|ta bon|opcionnan)\b/.test(text)) return "pap-aw";
  return "es";
}

async function handleStatefulSchedulingV21(rawBody) {
  const body = sanitizeRequestBody(rawBody);
  const conversation = body?.conversation || {};
  const latest = latestCustomerText(conversation);
  const offer = await findCurrentOfferV21(conversation);

  if (offer && isExplicitSelectionTurnV21(latest)) {
    const selected = selectOptionFromTurn(latest, offer);
    if (selected) {
      const rewritten = rewriteAsOrdinal(body, offer, selected);
      const result = await runtime20.handleDeterministicScheduling(rewritten);
      if (result?.metadata) result.metadata.flowVersion = FLOW_VERSION;
      if (result) result.source = "erp-appointment-state-machine-v21";
      return result;
    }
    if (flow20.isSimpleAffirmation(latest) && offer.options.length > 1) {
      return clarificationPayload(turnLanguage(latest), offer);
    }
  }

  const result = await runtime20.handleDeterministicScheduling(body);
  if (result?.metadata) result.metadata.flowVersion = FLOW_VERSION;
  return result;
}

function isSchedulingControlTurnV21(value) {
  return flow20.isSchedulingControlTurn(value) || isExplicitSelectionTurnV21(value);
}

module.exports = {
  FLOW_VERSION,
  findCurrentOfferV21,
  handleStatefulSchedulingV21,
  identityCandidates,
  isDeicticConfirmation,
  isExplicitSelectionTurnV21,
  isSchedulingControlTurnV21,
  rewriteAsOrdinal,
  selectOptionFromTurn,
};
