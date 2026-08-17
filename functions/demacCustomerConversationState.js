const {
  cleanText,
  hashId,
} = require("./whatsappCopilotSchedulingCore");

const CUSTOMER_AGENT_SESSION_VERSION = 1;
const CUSTOMER_AGENT_SESSION_COLLECTION = "customerAgentSessions";

function timestampValue() {
  try {
    const { FieldValue } = require("firebase-admin/firestore");
    return FieldValue.serverTimestamp();
  } catch {
    return new Date().toISOString();
  }
}

function stableConversationIdentity(context = {}) {
  return cleanText(
    context.conversationId
      || context.conversationKey
      || context.contactJid
      || context.contactPhone,
    300,
  );
}

function sessionIdentity(context = {}) {
  const provider = cleanText(context.provider || context.channel || "whatsapp", 80) || "whatsapp";
  const conversation = stableConversationIdentity(context);
  if (!conversation) return null;
  return {
    provider,
    conversation,
    sessionId: `CAS-${hashId(`${provider}|${conversation}`, 40).toUpperCase()}`,
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
    provider: identity?.provider || "",
    conversationId: identity?.conversation || "",
    status: "AI_ACTIVE",
    customerId: "",
    propertyId: "",
    activeOfferId: "",
    activeOfferVersion: 0,
    appointmentId: "",
    presetId: "",
    serviceId: "",
    quantity: 0,
    language: "",
    lastOutcome: "",
    requiresHuman: false,
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
  if (toolName === "create_appointment" && result.appointmentId) {
    return {
      appointmentId: cleanText(result.appointmentId, 180),
      activeOfferId: "",
      activeOfferVersion: 0,
    };
  }
  return {};
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
    version: CUSTOMER_AGENT_SESSION_VERSION,
    provider: identity.provider,
    conversationId: identity.conversation,
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
  now = new Date(),
} = {}) {
  const identity = sessionIdentity(context);
  if (!identity) return { updated: false, sessionId: "" };
  const ref = db.collection(CUSTOMER_AGENT_SESSION_COLLECTION).doc(identity.sessionId);
  const patch = {
    version: CUSTOMER_AGENT_SESSION_VERSION,
    provider: identity.provider,
    conversationId: identity.conversation,
    status: requiresHuman || outcome === "handoff" ? "HUMAN_ACTIVE" : "AI_ACTIVE",
    lastOutcome: cleanText(outcome, 80),
    language: cleanText(language, 40),
    requiresHuman: Boolean(requiresHuman || outcome === "handoff"),
    updatedAt: timestampValue(),
    updatedAtIso: now.toISOString(),
  };
  if (appointmentId) patch.appointmentId = cleanText(appointmentId, 180);
  await ref.set(patch, { merge: true });
  return { updated: true, sessionId: identity.sessionId, patch };
}

module.exports = {
  CUSTOMER_AGENT_SESSION_COLLECTION,
  CUSTOMER_AGENT_SESSION_VERSION,
  compactCanonicalOffer,
  emptySession,
  loadCustomerConversationState,
  offerUsable,
  recordCustomerConversationOutcome,
  sessionIdentity,
  stableConversationIdentity,
  toolStatePatch,
  updateCustomerConversationStateAfterTool,
};
