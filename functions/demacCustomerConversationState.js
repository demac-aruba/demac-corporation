const {
  cleanText,
  hashId,
} = require("./bookingSchedulingPrimitives");

const CUSTOMER_AGENT_SESSION_VERSION = 3;
const CUSTOMER_AGENT_SESSION_COLLECTION = "customerAgentSessions";
const CANONICAL_CONVERSATION_ID = /^COMM-[A-F0-9]{40}$/i;

function timestampValue() {
  try {
    const { FieldValue } = require("firebase-admin/firestore");
    return FieldValue.serverTimestamp();
  } catch {
    return new Date().toISOString();
  }
}

function stableConversationIdentity(context = {}) {
  const conversation = cleanText(context.conversationId || context.conversationKey, 300);
  return CANONICAL_CONVERSATION_ID.test(conversation) ? conversation.toUpperCase() : "";
}

function sessionIdentity(context = {}) {
  const channel = cleanText(context.channel || "whatsapp", 80).toLowerCase() || "whatsapp";
  const provider = cleanText(context.provider, 80).toLowerCase();
  const conversation = stableConversationIdentity(context);
  if (!provider || !conversation) return null;
  return {
    communicationAccountId: cleanText(context.communicationAccountId, 180).toLowerCase(),
    channel,
    provider,
    conversation,
    sessionId: `CAS-${hashId(`${channel}|${provider}|${conversation}`, 40).toUpperCase()}`,
  };
}

function offerUsable(offer, now = new Date()) {
  if (!offer || offer.status !== "open") return false;
  const expiry = Date.parse(String(offer.expiresAt || ""));
  return Number.isFinite(expiry) && expiry > now.getTime();
}

function compactCanonicalOffer(offer) {
  if (!offer) return null;
  return {
    id: cleanText(offer.id, 180),
    version: Number(offer.version || 0),
    status: cleanText(offer.status, 40),
    expiresAt: cleanText(offer.expiresAt, 80),
    request: {
      customerId: cleanText(offer.request?.customerId, 160),
      propertyId: cleanText(offer.request?.propertyId, 160),
      workLines: Array.isArray(offer.request?.workLines)
        ? offer.request.workLines.map((line) => ({
          id: cleanText(line.id, 120),
          presetId: cleanText(line.presetId, 120),
          serviceId: cleanText(line.serviceId, 120),
          quantity: Number(line.quantity || 0),
        }))
        : [],
      constraints: offer.request?.constraints || {},
    },
    options: Array.isArray(offer.options)
      ? offer.options.slice(0, 5).map((option, index) => ({
        ordinal: index + 1,
        id: cleanText(option.id, 180),
        date: cleanText(option.date, 20),
        time: cleanText(option.time, 20),
        endTime: cleanText(option.endTime, 20),
        address: cleanText(option.address, 500),
        zone: cleanText(option.zone, 120),
      }))
      : [],
  };
}

function emptySession(identity) {
  return {
    id: identity?.sessionId || "",
    version: CUSTOMER_AGENT_SESSION_VERSION,
    communicationAccountId: identity?.communicationAccountId || "",
    channel: identity?.channel || "",
    provider: identity?.provider || "",
    conversationId: identity?.conversation || "",
    status: "AI_ACTIVE",
    customerId: "",
    propertyId: "",
    activeOfferId: "",
    activeOfferVersion: 0,
    appointmentId: "",
    reservationId: "",
    reservationStatus: "",
    presetId: "",
    serviceId: "",
    quantity: 0,
    language: "",
    lastOutcome: "",
    requiresHuman: false,
    handoffQueue: "",
    handoffReason: "",
  };
}

async function loadCustomerConversationState({ db, context = {}, now = new Date() } = {}) {
  const identity = sessionIdentity(context);
  if (!identity) return { session: emptySession(null), activeOffer: null, stable: false };
  const ref = db.collection(CUSTOMER_AGENT_SESSION_COLLECTION).doc(identity.sessionId);
  const snapshot = await ref.get();
  const session = snapshot.exists
    ? { ...emptySession(identity), id: snapshot.id, ...snapshot.data() }
    : emptySession(identity);

  let activeOffer = null;
  if (session.activeOfferId) {
    const offerSnapshot = await db.collection("bookingOffers").doc(session.activeOfferId).get();
    const offer = offerSnapshot.exists ? { id: offerSnapshot.id, ...offerSnapshot.data() } : null;
    if (offerUsable(offer, now)) {
      activeOffer = compactCanonicalOffer(offer);
    } else if (snapshot.exists) {
      await ref.set({
        activeOfferId: "",
        activeOfferVersion: 0,
        updatedAt: timestampValue(),
        updatedAtIso: now.toISOString(),
      }, { merge: true });
      session.activeOfferId = "";
      session.activeOfferVersion = 0;
    }
  }
  return { session, activeOffer, stable: true };
}

function toolStatePatch(toolName, args = {}, result = {}) {
  if (!result?.success) return {};
  if (toolName === "resolve_customer" && result.resolved && result.customerId) {
    return { customerId: cleanText(result.customerId, 160) };
  }
  if (toolName === "resolve_property" && result.resolved && result.propertyId) {
    return { propertyId: cleanText(result.propertyId, 160) };
  }
  if (toolName === "create_or_update_lead") {
    return {
      ...(result.customerId ? { customerId: cleanText(result.customerId, 160) } : {}),
      ...(result.propertyId ? { propertyId: cleanText(result.propertyId, 160) } : {}),
    };
  }
  if (toolName === "check_availability" && result.available && result.offer?.id) {
    const work = result.offer.request?.workLines?.[0] || {};
    return {
      activeOfferId: cleanText(result.offer.id, 180),
      activeOfferVersion: Number(result.offer.version || 0),
      customerId: cleanText(result.offer.request?.customerId, 160),
      propertyId: cleanText(result.offer.request?.propertyId, 160),
      presetId: cleanText(work.presetId, 120),
      serviceId: cleanText(work.serviceId, 120),
      quantity: Number(work.quantity || 0),
    };
  }
  if (["create_appointment", "cancel_appointment", "reschedule_appointment"].includes(toolName) && result.appointmentId) {
    return {
      appointmentId: cleanText(result.appointmentId, 180),
      activeOfferId: "",
      activeOfferVersion: 0,
    };
  }
  if (["create_product_reservation", "get_product_reservation", "release_product_reservation"].includes(toolName)) {
    const reservationId = cleanText(result.reservationId || result.reservation?.reservationId || result.reservation?.id, 180);
    const reservationStatus = cleanText(result.reservation?.status || result.status, 80);
    if (reservationId) {
      return {
        reservationId,
        reservationStatus,
      };
    }
  }
  return {};
}

function identityPatch(identity) {
  return {
    version: CUSTOMER_AGENT_SESSION_VERSION,
    ...(identity.communicationAccountId ? { communicationAccountId: identity.communicationAccountId } : {}),
    channel: identity.channel,
    provider: identity.provider,
    conversationId: identity.conversation,
  };
}

async function updateCustomerConversationStateAfterTool({
  db,
  context = {},
  toolName,
  args = {},
  result = {},
  now = new Date(),
} = {}) {
  const identity = sessionIdentity(context);
  if (!identity) return { updated: false, sessionId: "" };
  const patch = toolStatePatch(toolName, args, result);
  const ref = db.collection(CUSTOMER_AGENT_SESSION_COLLECTION).doc(identity.sessionId);
  await ref.set({
    ...identityPatch(identity),
    status: "AI_ACTIVE",
    ...patch,
    lastTool: cleanText(toolName, 120),
    lastInboundMessageId: cleanText(context.inboundMessageId || context.messageId, 300),
    updatedAt: timestampValue(),
    updatedAtIso: now.toISOString(),
  }, { merge: true });
  return { updated: true, sessionId: identity.sessionId, patch };
}

async function recordCustomerConversationOutcome({
  db,
  context = {},
  outcome = "reply",
  language = "",
  requiresHuman = false,
  appointmentId = "",
  reservationId = "",
  handoffQueue = "",
  handoffReason = "",
  now = new Date(),
} = {}) {
  const identity = sessionIdentity(context);
  if (!identity) return { updated: false, sessionId: "" };
  const isHandoff = Boolean(requiresHuman || outcome === "handoff");
  const ref = db.collection(CUSTOMER_AGENT_SESSION_COLLECTION).doc(identity.sessionId);
  const patch = {
    ...identityPatch(identity),
    status: isHandoff ? "HUMAN_ACTIVE" : "AI_ACTIVE",
    lastOutcome: cleanText(outcome, 80),
    language: cleanText(language, 40),
    requiresHuman: isHandoff,
    handoffQueue: isHandoff ? cleanText(handoffQueue, 80) : "",
    handoffReason: isHandoff ? cleanText(handoffReason, 500) : "",
    updatedAt: timestampValue(),
    updatedAtIso: now.toISOString(),
  };
  if (appointmentId) patch.appointmentId = cleanText(appointmentId, 180);
  if (reservationId) patch.reservationId = cleanText(reservationId, 180);
  if (outcome === "product_reserved") patch.reservationStatus = "active";
  if (outcome === "product_reservation_released") patch.reservationStatus = "released";
  await ref.set(patch, { merge: true });
  return { updated: true, sessionId: identity.sessionId, patch };
}

module.exports = {
  CANONICAL_CONVERSATION_ID,
  CUSTOMER_AGENT_SESSION_COLLECTION,
  CUSTOMER_AGENT_SESSION_VERSION,
  compactCanonicalOffer,
  emptySession,
  identityPatch,
  loadCustomerConversationState,
  offerUsable,
  recordCustomerConversationOutcome,
  sessionIdentity,
  stableConversationIdentity,
  toolStatePatch,
  updateCustomerConversationStateAfterTool,
};
