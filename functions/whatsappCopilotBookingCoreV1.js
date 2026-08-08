const { FieldValue } = require("firebase-admin/firestore");
const {
  cleanText,
  hashId,
  normalizeText,
  normalizeTime,
} = require("./whatsappCopilotSchedulingCore");

const BOOKING_CORE_VERSION = 1;
const SESSION_COLLECTION = "whatsappCopilotBookingSessions";
const OFFER_COLLECTION = "whatsappCopilotOffers";

function conversationKey(request) {
  return request?.contactPhone
    || request?.contactJid
    || normalizeText(request?.chatTitle)
    || hashId(request?.latestCustomerTurn, 20);
}

function offerDocId(key) {
  return `wa-offer-${hashId(key, 32)}`;
}

function sessionDocId(key) {
  return `wa-session-${hashId(key, 32)}`;
}

function offerUsable(offer) {
  if (!offer || !["open", "booked"].includes(offer.status) || !Array.isArray(offer.options)) return false;
  if (offer.expiresAt && offer.expiresAt < new Date().toISOString()) return false;
  return true;
}

function minutes(value) {
  const time = normalizeTime(value);
  const match = String(time || "").match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function hardConstraintsFromAnalysis(analysis = {}) {
  const info = analysis.collectedInformation || {};
  const requestedDate = cleanText(info.requestedDate || info.preferredDate, 20);
  const requestedTime = normalizeTime(info.requestedTime);
  const preferredTime = cleanText(info.preferredTime, 80);
  return {
    requestedDate,
    requestedTime,
    preferredTime,
  };
}

function matchesPreferredTime(option, preferredTime) {
  const normalized = normalizeText(preferredTime);
  if (!normalized) return true;
  const value = minutes(option?.time);
  if (value === null) return false;
  if (/\b(afternoon|tarde)\b/.test(normalized)) return value >= 12 * 60;
  if (/\b(morning|manana)\b/.test(normalized)) return value < 12 * 60;

  const boundary = normalized.match(/\b(after|despues de|posterior a|later than|from|desde|a partir de|before|antes de|until|hasta)\s+(\d{1,2})(?::([0-5]\d))?/);
  if (!boundary) return true;
  let hour = Number(boundary[2]);
  const minute = Number(boundary[3] || 0);
  if (hour >= 1 && hour <= 7 && /\b(after|despues de|posterior a|later than|from|desde|a partir de)\b/.test(boundary[1])) hour += 12;
  const target = hour * 60 + minute;
  if (/^(after|despues de|posterior a|later than)$/.test(boundary[1])) return value > target;
  if (/^(from|desde|a partir de)$/.test(boundary[1])) return value >= target;
  if (/^(before|antes de)$/.test(boundary[1])) return value < target;
  if (/^(until|hasta)$/.test(boundary[1])) return value <= target;
  return true;
}

function applyHardConstraints(result, analysis = {}) {
  const base = result || {};
  let options = Array.isArray(base.options) ? [...base.options] : [];
  const constraints = hardConstraintsFromAnalysis(analysis);

  if (constraints.requestedDate) {
    options = options.filter((option) => option?.date === constraints.requestedDate);
  }
  if (constraints.requestedTime) {
    options = options.filter((option) => normalizeTime(option?.time) === constraints.requestedTime);
  }
  if (constraints.preferredTime) {
    options = options.filter((option) => matchesPreferredTime(option, constraints.preferredTime));
  }

  return {
    ...base,
    options,
    requestedDate: constraints.requestedDate || base.requestedDate || "",
    requestedDateUnavailable: Boolean(constraints.requestedDate && options.length === 0),
    hardConstraints: constraints,
  };
}

function offerRequest(analysis, result) {
  const info = analysis?.collectedInformation || {};
  const constraints = hardConstraintsFromAnalysis(analysis);
  return {
    intent: analysis?.intent || "",
    serviceType: cleanText(info.serviceType, 80),
    quantity: result?.quantity ?? info.quantity ?? "",
    address: cleanText(info.address, 180),
    requestedDate: constraints.requestedDate,
    requestedTime: constraints.requestedTime,
    preferredDate: constraints.requestedDate,
    preferredTime: constraints.preferredTime || constraints.requestedTime,
    presetId: result?.preset?.id || "",
    presetLabel: result?.preset?.label || "",
    durationMinutesPerUnit: result?.preset?.durationMinutesPerUnit || 0,
  };
}

function offeredSessionRecord({ key, request, analysis, result, offer, previous = {} }) {
  const version = Number(previous.offerVersion || 0) + 1;
  const constraints = hardConstraintsFromAnalysis(analysis);
  return {
    id: sessionDocId(key),
    conversationKey: key,
    chatTitle: cleanText(request?.chatTitle, 160),
    contactPhone: request?.contactPhone || "",
    contactJid: request?.contactJid || "",
    bookingCoreVersion: BOOKING_CORE_VERSION,
    stage: "offered",
    serviceType: cleanText(analysis?.collectedInformation?.serviceType, 80),
    quantity: String(result?.quantity ?? analysis?.collectedInformation?.quantity ?? ""),
    address: cleanText(analysis?.collectedInformation?.address, 180),
    constraints,
    offerVersion: version,
    activeOffer: {
      ...offer,
      version,
      status: "open",
      request: offerRequest(analysis, result),
      options: Array.isArray(result?.options) ? result.options : [],
    },
    selectedOptionId: "",
    selectedOption: null,
    primaryWorkOrderId: "",
    updatedAtIso: new Date().toISOString(),
  };
}

function selectedSessionPatch(option) {
  return {
    bookingCoreVersion: BOOKING_CORE_VERSION,
    stage: "selected",
    selectedOptionId: option?.id || "",
    selectedOption: option || null,
    updatedAtIso: new Date().toISOString(),
  };
}

function bookingSessionPatch(option) {
  return {
    ...selectedSessionPatch(option),
    stage: "booking",
  };
}

function bookedSessionPatch(option, primaryWorkOrderId, workOrderIds = []) {
  return {
    bookingCoreVersion: BOOKING_CORE_VERSION,
    stage: "booked",
    selectedOptionId: option?.id || "",
    selectedOption: option || null,
    primaryWorkOrderId: primaryWorkOrderId || "",
    workOrderIds,
    bookedAt: FieldValue.serverTimestamp(),
    bookedAtIso: new Date().toISOString(),
    updatedAtIso: new Date().toISOString(),
  };
}

async function loadBookingSession(db, request) {
  const key = conversationKey(request);
  const direct = await db.collection(SESSION_COLLECTION).doc(sessionDocId(key)).get();
  if (direct.exists) return { id: direct.id, ...direct.data() };

  const title = cleanText(request?.chatTitle, 160);
  if (!title) return null;
  const byTitle = await db.collection(SESSION_COLLECTION).where("chatTitle", "==", title).limit(10).get();
  return (byTitle.docs || [])
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(b.updatedAtIso || "").localeCompare(String(a.updatedAtIso || "")))[0] || null;
}

async function loadCanonicalOffer(db, request) {
  const session = await loadBookingSession(db, request);
  if (session?.activeOffer && offerUsable(session.activeOffer)) {
    return { ...session.activeOffer, id: session.activeOffer.id || offerDocId(session.conversationKey) };
  }

  const key = conversationKey(request);
  const direct = await db.collection(OFFER_COLLECTION).doc(offerDocId(key)).get();
  if (direct.exists) {
    const offer = { id: direct.id, ...direct.data() };
    if (offerUsable(offer)) return offer;
  }

  const title = cleanText(request?.chatTitle, 160);
  if (!title) return null;
  const byTitle = await db.collection(OFFER_COLLECTION).where("chatTitle", "==", title).limit(10).get();
  return (byTitle.docs || [])
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter(offerUsable)
    .sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")))[0] || null;
}

async function persistOfferedSession(db, request, analysis, result) {
  const key = conversationKey(request);
  const offerId = offerDocId(key);
  const sessionId = sessionDocId(key);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1_000).toISOString();
  const offerRef = db.collection(OFFER_COLLECTION).doc(offerId);
  const sessionRef = db.collection(SESSION_COLLECTION).doc(sessionId);

  let saved = null;
  await db.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    const previous = sessionSnapshot.exists ? sessionSnapshot.data() : {};
    const offer = {
      id: offerId,
      conversationKey: key,
      chatTitle: cleanText(request?.chatTitle, 160),
      contactPhone: request?.contactPhone || "",
      contactJid: request?.contactJid || "",
      language: analysis?.language || "es",
      status: "open",
      request: offerRequest(analysis, result),
      options: Array.isArray(result?.options) ? result.options : [],
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso: now.toISOString(),
      expiresAt,
      bookingCoreVersion: BOOKING_CORE_VERSION,
    };
    const session = offeredSessionRecord({ key, request, analysis, result, offer, previous });
    offer.version = session.offerVersion;
    session.activeOffer.version = session.offerVersion;
    transaction.set(offerRef, offer, { merge: false });
    transaction.set(sessionRef, session, { merge: true });
    saved = { id: offerId, key, expiresAt, version: session.offerVersion };
  });
  return saved;
}

async function markSelectedSession(db, request, offer, option) {
  const key = conversationKey(request);
  const sessionRef = db.collection(SESSION_COLLECTION).doc(sessionDocId(key));
  const offerRef = db.collection(OFFER_COLLECTION).doc(offer.id || offerDocId(key));
  await Promise.all([
    sessionRef.set(selectedSessionPatch(option), { merge: true }),
    offerRef.set({ selectedOptionId: option?.id || "", selectedAtIso: new Date().toISOString() }, { merge: true }),
  ]);
}

async function markBookingSession(db, request, offer, option) {
  const key = conversationKey(request);
  await db.collection(SESSION_COLLECTION).doc(sessionDocId(key)).set(bookingSessionPatch(option), { merge: true });
  await db.collection(OFFER_COLLECTION).doc(offer.id || offerDocId(key)).set({
    selectedOptionId: option?.id || "",
    bookingStartedAtIso: new Date().toISOString(),
  }, { merge: true });
}

function markBookedInTransaction(transaction, db, request, option, primaryWorkOrderId, workOrderIds) {
  const key = conversationKey(request);
  transaction.set(
    db.collection(SESSION_COLLECTION).doc(sessionDocId(key)),
    bookedSessionPatch(option, primaryWorkOrderId, workOrderIds),
    { merge: true },
  );
}

async function markUnavailableSession(db, request, analysis) {
  const key = conversationKey(request);
  await db.collection(SESSION_COLLECTION).doc(sessionDocId(key)).set({
    id: sessionDocId(key),
    conversationKey: key,
    chatTitle: cleanText(request?.chatTitle, 160),
    bookingCoreVersion: BOOKING_CORE_VERSION,
    stage: "searching",
    constraints: hardConstraintsFromAnalysis(analysis),
    activeOffer: null,
    selectedOptionId: "",
    selectedOption: null,
    updatedAtIso: new Date().toISOString(),
  }, { merge: true });
}

module.exports = {
  BOOKING_CORE_VERSION,
  OFFER_COLLECTION,
  SESSION_COLLECTION,
  applyHardConstraints,
  bookedSessionPatch,
  bookingSessionPatch,
  conversationKey,
  hardConstraintsFromAnalysis,
  loadBookingSession,
  loadCanonicalOffer,
  markBookedInTransaction,
  markBookingSession,
  markSelectedSession,
  markUnavailableSession,
  matchesPreferredTime,
  offerDocId,
  offerRequest,
  offerUsable,
  offeredSessionRecord,
  persistOfferedSession,
  selectedSessionPatch,
  sessionDocId,
};