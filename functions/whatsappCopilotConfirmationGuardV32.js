const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  cleanText,
  hashId,
  normalizeText,
} = require("./whatsappCopilotSchedulingCore");
const { orchestrateScheduling } = require("./whatsappCopilotScheduling");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const CONFIRMATION_GUARD_VERSION = 32;

const WEEKDAYS = new Map([
  [0, ["domingo", "sunday"]],
  [1, ["lunes", "monday"]],
  [2, ["martes", "tuesday"]],
  [3, ["miercoles", "wednesday"]],
  [4, ["jueves", "thursday"]],
  [5, ["viernes", "friday"]],
  [6, ["sabado", "saturday"]],
]);

function conversationKey(request) {
  return request.contactPhone
    || request.contactJid
    || normalizeText(request.chatTitle)
    || hashId(request.latestCustomerTurn, 20);
}

function offerUsable(offer) {
  if (!offer || !["open", "booked"].includes(offer.status) || !Array.isArray(offer.options) || !offer.options.length) return false;
  if (offer.expiresAt && offer.expiresAt < new Date().toISOString()) return false;
  return true;
}

async function getCurrentOffer(request) {
  const key = conversationKey(request);
  const id = `wa-offer-${hashId(key, 32)}`;
  const snapshot = await db.collection("whatsappCopilotOffers").doc(id).get();
  if (snapshot.exists) {
    const offer = { id: snapshot.id, ...snapshot.data() };
    if (offerUsable(offer)) return offer;
  }

  const title = cleanText(request.chatTitle, 160);
  if (!title) return null;
  const byTitle = await db.collection("whatsappCopilotOffers").where("chatTitle", "==", title).limit(10).get();
  return (byTitle.docs || [])
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter(offerUsable)
    .sort((a, b) => String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || "")))[0] || null;
}

function technicalIdentity(value) {
  const match = String(value || "").match(/(?:^|_)(\d{5,30})@(c\.us|s\.whatsapp\.net|lid)(?:_|$)/i);
  if (!match) return null;
  return {
    user: match[1],
    domain: match[2].toLowerCase(),
    jid: `${match[1]}@${match[2].toLowerCase()}`,
  };
}

function requestIdentity(conversation) {
  let phone = cleanText(conversation?.contactPhone, 40).replace(/\D/g, "");
  let jid = cleanText(conversation?.contactJid, 120);
  for (const message of conversation?.messages || []) {
    if (message?.direction !== "inbound") continue;
    const technical = technicalIdentity(message?.id);
    if (!technical) continue;
    if (!jid) jid = technical.jid;
    if (!phone && technical.domain !== "lid") phone = technical.user;
    if (jid && phone) break;
  }
  return { phone, jid };
}

function latestCustomerText(conversation) {
  const explicit = cleanText(conversation?.customerTurn?.text, 1_000);
  if (explicit) return explicit;
  return cleanText(
    [...(conversation?.messages || [])].reverse().find((message) => message?.direction === "inbound")?.text,
    1_000,
  );
}

function weekdayIndex(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return -1;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.getUTCDay() : -1;
}

function requestedWeekdays(text) {
  const normalized = normalizeText(text);
  const found = new Set();
  for (const [index, words] of WEEKDAYS.entries()) {
    if (words.some((word) => new RegExp(`\\b${word}\\b`).test(normalized))) found.add(index);
  }
  return found;
}

function requestedBlock(text) {
  const normalized = normalizeText(text);
  if (/\b(tarde|afternoon)\b/.test(normalized)) return "afternoon";
  if (/\b(manana|morning)\b/.test(normalized)) return "morning";
  return "";
}

function explicitOrdinal(text) {
  const normalized = normalizeText(text);
  if (/\b(primera|primer|first)\b/.test(normalized) || /\bopcion\s*(?:1|uno|one)\b/.test(normalized)) return 1;
  if (/\b(segunda|segundo|second)\b/.test(normalized) || /\bopcion\s*(?:2|dos|two)\b/.test(normalized)) return 2;
  if (/\b(tercera|tercer|third)\b/.test(normalized) || /\bopcion\s*(?:3|tres|three)\b/.test(normalized)) return 3;
  return 0;
}

function clockHint(value) {
  const raw = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const prefixed = raw.match(/\b(?:a\s+la(?:s)?|at|pa)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
  const colon = raw.match(/\b(\d{1,2}):([0-5]\d)\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
  const match = prefixed || colon;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? null : Number(match[2]);
  const meridiemRaw = String(match[3] || "").replace(/[.\s]/g, "");
  const meridiem = meridiemRaw === "am" || meridiemRaw === "pm" ? meridiemRaw : "";
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { hour, minute, meridiem };
}

function optionClock(option) {
  const match = String(option?.time || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function clockMatches(option, hint) {
  if (!hint) return true;
  const clock = optionClock(option);
  if (!clock) return false;

  let allowedHours = [];
  if (hint.meridiem) {
    let hour = hint.hour % 12;
    if (hint.meridiem === "pm") hour += 12;
    allowedHours = [hour];
  } else if (hint.hour >= 13) {
    allowedHours = [hint.hour];
  } else if (hint.hour === 0 || hint.hour === 12) {
    allowedHours = [hint.hour];
  } else {
    // A customer saying "a la 1" after being offered 1:30 p.m. is selecting
    // the offered one-o'clock slot. Keep both 12-hour possibilities until the
    // rest of the offer (day/morning/afternoon) disambiguates it.
    allowedHours = [hint.hour, hint.hour + 12];
  }

  if (!allowedHours.includes(clock.hour)) return false;
  return hint.minute === null ? true : clock.minute === hint.minute;
}

function questionLike(text) {
  const normalized = normalizeText(text);
  return String(text || "").includes("?")
    || /^(tienes|tiene|hay|puedes|puede|pueden|podrias|podría|can you|do you have|is there|what|when|which)\b/.test(normalized);
}

function hasConfirmationLanguage(text) {
  const normalized = normalizeText(text);
  if (!normalized || /\b(no|ninguna|ninguno|otra|otro horario|no me sirve|no puedo)\b/.test(normalized)) return false;
  return /\b(si|ok|dale|excelente|perfecto|confirmo|confirmar|esta bien|me sirve|dame|ponme|agendame|reservame|quiero esa|quiero ese|esa|ese)\b/.test(normalized);
}

function resolveConfirmedOfferSelection(text, offer) {
  if (!offerUsable(offer)) return null;
  const options = offer.options.map((option, index) => ({ option, ordinal: index + 1 }));
  const ordinal = explicitOrdinal(text);
  const weekdays = requestedWeekdays(text);
  const block = requestedBlock(text);
  const clock = clockHint(text);
  const normalized = normalizeText(text);
  const wordCount = normalized ? normalized.split(/\s+/).length : 0;

  const barePreciseSelector = !questionLike(text)
    && wordCount <= 10
    && Boolean(ordinal || clock);
  const confirming = hasConfirmationLanguage(text) || barePreciseSelector;
  if (!confirming) return null;

  let candidates = options;
  if (ordinal) candidates = candidates.filter((item) => item.ordinal === ordinal);
  if (weekdays.size) candidates = candidates.filter((item) => weekdays.has(weekdayIndex(item.option.date)));
  if (block === "afternoon") candidates = candidates.filter((item) => (optionClock(item.option)?.hour ?? -1) >= 12);
  if (block === "morning") candidates = candidates.filter((item) => {
    const hour = optionClock(item.option)?.hour;
    return hour !== undefined && hour !== null && hour < 12;
  });
  if (clock) candidates = candidates.filter((item) => clockMatches(item.option, clock));

  if (!ordinal && !weekdays.size && !block && !clock) {
    return candidates.length === 1 ? candidates[0] : null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function schedulingPayload(result, analysis) {
  const offering = ["availability_offered", "appointment_changed_reoffer"].includes(result.action);
  const booked = result.action === "appointment_booked";
  const pending = result.action === "appointment_pending_approval";
  const unavailable = result.action === "availability_unavailable";
  return {
    draft: result.reply,
    source: "offer-confirmation-guard-v32+erp-scheduling",
    warning: result.warning || "",
    metadata: {
      intent: analysis.intent,
      language: analysis.language,
      conversationStage: booked
        ? "appointment_confirmed"
        : pending
          ? "appointment_option_selected"
          : offering
            ? "offering_appointments"
            : unavailable
              ? "human_handoff"
              : "general_support",
      nextAction: pending ? "reserve_erp_appointment" : booked || offering ? "wait_for_customer" : unavailable ? "transfer_human" : "wait_for_customer",
      summary: analysis.summary,
      confidence: 1,
      requiresHuman: unavailable,
      missingInformation: [],
      collectedInformation: analysis.collectedInformation,
      selectedOptionOrdinal: analysis.selectedOptionOrdinal,
      customerConfirmedAppointment: true,
      scheduling: result.metadata || null,
      decisionSource: "deterministic-active-offer-confirmation",
      confirmationGuardVersion: CONFIRMATION_GUARD_VERSION,
    },
  };
}

async function tryResolveConfirmedAppointment(rawBody) {
  const body = rawBody || {};
  const conversation = body.conversation || {};
  const latest = latestCustomerText(conversation);
  if (!latest) return null;

  const identity = requestIdentity(conversation);
  const request = {
    chatTitle: cleanText(conversation.chatTitle, 160),
    contactPhone: identity.phone,
    contactJid: identity.jid,
    latestCustomerTurn: latest,
  };
  const offer = await getCurrentOffer(request);
  const selected = resolveConfirmedOfferSelection(latest, offer);
  if (!selected) return null;

  const offerRequest = offer.request || {};
  const analysis = {
    intent: "appointment_question",
    language: offer.language || "es",
    conversationStage: "appointment_option_selected",
    nextAction: "reserve_erp_appointment",
    summary: `El cliente seleccionó la opción ${selected.ordinal} de una oferta activa del ERP.`,
    reply: "",
    requiresHuman: false,
    confidence: 1,
    missingInformation: [],
    selectedOptionOrdinal: selected.ordinal,
    customerConfirmedAppointment: true,
    collectedInformation: {
      serviceType: cleanText(offerRequest.serviceType, 80) || "service",
      quantity: String(offerRequest.quantity || ""),
      address: cleanText(offerRequest.address || selected.option.address, 180),
      requestedDate: selected.option.date,
      requestedTime: selected.option.time,
      preferredDate: selected.option.date,
      preferredTime: selected.option.time,
      customerName: "",
      extraDetails: latest,
    },
  };

  const result = await orchestrateScheduling({
    db,
    request,
    analysis,
    commitAppointment: body.commitAppointment === true,
  });
  return schedulingPayload(result, analysis);
}

module.exports = {
  CONFIRMATION_GUARD_VERSION,
  clockHint,
  clockMatches,
  explicitOrdinal,
  hasConfirmationLanguage,
  questionLike,
  requestIdentity,
  requestedBlock,
  requestedWeekdays,
  resolveConfirmedOfferSelection,
  tryResolveConfirmedAppointment,
};
