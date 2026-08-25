const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { arubaDateParts, cleanText, hashId } = require("./bookingSchedulingPrimitives");
const { normalizeArubaWhatsAppPhone } = require("./demacCustomerAgentReplyPolicy");
const { createBookingDispatchSafetyAuthority } = require("./bookingAuthorityDispatchSafety");

const COMMUNICATION_CASE_VERSION = 1;
const COMMUNICATION_CASE_COLLECTION = "communicationCases";
const DISPATCH_HOLD_CONFIDENCE = 0.86;
const ACTIVE_APPOINTMENT_CHANGE_INTENTS = new Set(["cancellation", "reschedule"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "cancelada"]);

function communicationCaseId({ communicationAccountId, conversationId, caseType = "appointment_change" } = {}) {
  const account = cleanText(communicationAccountId, 180).toLowerCase();
  const conversation = cleanText(conversationId, 300);
  const type = cleanText(caseType, 80);
  if (!account || !conversation || !type) return "";
  return `COMMCASE-${hashId(`${account}|${conversation}|${type}`, 40).toUpperCase()}`;
}

function appointmentStartKey(appointment = {}) {
  return `${cleanText(appointment.date, 20)}T${cleanText(appointment.startTime || appointment.time, 20).padStart(5, "0")}`;
}

function upcomingAppointmentCandidates(appointments = [], today = arubaDateParts().date) {
  return appointments
    .filter((appointment) => {
      const status = cleanText(appointment?.status, 40).toLowerCase();
      if (CANCELLED_STATUSES.has(status)) return false;
      const date = cleanText(appointment?.date, 20);
      return Boolean(date && date >= today);
    })
    .sort((left, right) => appointmentStartKey(left).localeCompare(appointmentStartKey(right)));
}

function normalizedRequestedDate(value) {
  const raw = cleanText(value, 80);
  const exact = raw.match(/^\d{4}-\d{2}-\d{2}$/);
  return exact ? exact[0] : "";
}

function normalizedRequestedTime(value) {
  const raw = cleanText(value, 80).toLowerCase();
  const match = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : "";
}

function matchRelevantAppointment({ appointments = [], observation = {}, today } = {}) {
  const candidates = upcomingAppointmentCandidates(appointments, today);
  if (!candidates.length) return { matched: false, reason: "no-upcoming-appointment", candidates: [] };
  if (candidates.length === 1) return { matched: true, reason: "single-upcoming-appointment", appointment: candidates[0], candidates };

  const requestedDate = normalizedRequestedDate(observation.requestedDate);
  const requestedTime = normalizedRequestedTime(observation.requestedTime);
  let narrowed = candidates;
  if (requestedDate) narrowed = narrowed.filter((appointment) => cleanText(appointment.date, 20) === requestedDate);
  if (requestedTime) narrowed = narrowed.filter((appointment) => cleanText(appointment.startTime || appointment.time, 20) === requestedTime);
  if (narrowed.length === 1) return { matched: true, reason: "explicit-date-time-match", appointment: narrowed[0], candidates };
  return {
    matched: false,
    reason: "multiple-plausible-appointments",
    candidates: narrowed.length ? narrowed : candidates,
  };
}

function materialCaseIntent(observation = {}) {
  return [
    "cancellation",
    "reschedule",
    "customer_withdrew_change",
    "operational_change",
    "complaint",
    "human_request",
  ].includes(observation.intent);
}

function shouldApplyDispatchHold(observation = {}, match = {}) {
  return ACTIVE_APPOINTMENT_CHANGE_INTENTS.has(observation.intent)
    && observation.dispatchRisk === true
    && observation.criticalValueAmbiguous !== true
    && Number(observation.confidence || 0) >= DISPATCH_HOLD_CONFIDENCE
    && match.matched === true
    && Boolean(match.appointment?.id);
}

function caseHistoryEvent({ kind, messageId, observation, appointmentId = "", now }) {
  return {
    id: `CASEEV-${hashId(`${messageId}|${kind}|${now.toISOString()}`, 24).toUpperCase()}`,
    kind,
    at: now.toISOString(),
    sourceMessageId: cleanText(messageId, 300),
    intent: cleanText(observation?.intent, 80),
    confidence: Number(observation?.confidence || 0),
    appointmentId: cleanText(appointmentId, 180),
    summary: cleanText(observation?.summary, 800),
  };
}

async function queryCustomerByPhone(db, phone) {
  const normalized = normalizeArubaWhatsAppPhone(phone);
  if (!normalized) return { customer: null, ambiguous: false };
  const local = normalized.startsWith("297") ? normalized.slice(3) : normalized;
  const candidates = [...new Set([normalized, `+${normalized}`, local])].filter(Boolean);
  const matches = new Map();
  for (const field of ["phone", "whatsapp"]) {
    for (const value of candidates) {
      const snapshot = await db.collection("clients").where(field, "==", value).limit(2).get();
      snapshot.docs.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() };
        if (normalizeArubaWhatsAppPhone(data.phone || data.whatsapp) === normalized) matches.set(doc.id, data);
      });
    }
  }
  const values = [...matches.values()].filter((item) => item.active !== false);
  return { customer: values.length === 1 ? values[0] : null, ambiguous: values.length > 1 };
}

function createCommunicationCaseService({ db = getFirestore(), dispatchSafety = null, clock = () => new Date() } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required for Communication Cases.");
  const safety = dispatchSafety || createBookingDispatchSafetyAuthority({ db, clock });

  async function resolveCustomer({ conversation = {}, message = {} } = {}) {
    const customerId = cleanText(conversation.customerId || message.customerId, 160);
    if (customerId) {
      const snapshot = await db.collection("clients").doc(customerId).get();
      if (snapshot.exists) return { customer: { id: snapshot.id, ...snapshot.data() }, ambiguous: false };
    }
    return queryCustomerByPhone(db, conversation.phone || message.phone);
  }

  async function loadUpcomingAppointments(customerId) {
    if (!customerId) return [];
    const snapshot = await db.collection("appointments").where("customerId", "==", customerId).get();
    return upcomingAppointmentCandidates(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }

  async function existingCase(caseId) {
    if (!caseId) return null;
    const snapshot = await db.collection(COMMUNICATION_CASE_COLLECTION).doc(caseId).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }

  async function processObservation({
    communicationAccountId,
    conversationId,
    conversation = {},
    message = {},
    observation = {},
  } = {}) {
    const canonicalCaseId = communicationCaseId({ communicationAccountId, conversationId });
    if (!canonicalCaseId) return { processed: false, reason: "missing-case-identity" };
    if (!materialCaseIntent(observation)) return { processed: false, reason: "no-material-operational-case" };
    const now = clock();
    const messageId = cleanText(message.messageId || message.id, 300);
    const caseRef = db.collection(COMMUNICATION_CASE_COLLECTION).doc(canonicalCaseId);
    const previous = await existingCase(canonicalCaseId);

    if (observation.intent === "customer_withdrew_change") {
      const appointmentId = cleanText(previous?.appointmentId, 180);
      if (appointmentId) {
        await safety.releaseDispatchHold({
          appointmentId,
          caseId: canonicalCaseId,
          resolution: "customer_withdrew_change",
          actor: { id: "demac-customer-agent", name: "Maya", source: "maya-observer" },
        });
      }
      const event = caseHistoryEvent({ kind: "customer_withdrew_change", messageId, observation, appointmentId, now });
      await caseRef.set({
        id: canonicalCaseId,
        version: COMMUNICATION_CASE_VERSION,
        communicationAccountId: cleanText(communicationAccountId, 180).toLowerCase(),
        conversationId: cleanText(conversationId, 300),
        caseType: "appointment_change",
        state: "RESOLVED_CUSTOMER_WITHDREW_CHANGE",
        intent: observation.intent,
        confidence: Number(observation.confidence || 0),
        dispatchHoldActive: false,
        sourceMessageIds: FieldValue.arrayUnion(messageId),
        history: [...(Array.isArray(previous?.history) ? previous.history : []), event].slice(-100),
        resolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: now.toISOString(),
      }, { merge: true });
      return { processed: true, caseId: canonicalCaseId, state: "RESOLVED_CUSTOMER_WITHDREW_CHANGE", appointmentId };
    }

    const customerResolution = await resolveCustomer({ conversation, message });
    const customer = customerResolution.customer;
    const appointments = customer ? await loadUpcomingAppointments(customer.id) : [];
    const match = matchRelevantAppointment({ appointments, observation });
    let state = "DETECTED";
    let attentionReason = "";
    let appointmentId = match.matched ? cleanText(match.appointment?.id, 180) : "";
    let dispatchHoldActive = false;

    if (!customer) {
      state = "ESCALATED";
      attentionReason = customerResolution.ambiguous ? "ambiguous-customer-identity" : "customer-not-resolved";
    } else if (ACTIVE_APPOINTMENT_CHANGE_INTENTS.has(observation.intent) && observation.criticalValueAmbiguous === true) {
      state = "AWAITING_APPOINTMENT_CLARIFICATION";
      attentionReason = "critical-value-ambiguous";
    } else if (ACTIVE_APPOINTMENT_CHANGE_INTENTS.has(observation.intent) && !match.matched) {
      state = match.reason === "multiple-plausible-appointments" ? "AWAITING_APPOINTMENT_CLARIFICATION" : "ESCALATED";
      attentionReason = match.reason;
    } else if (match.matched) {
      state = "APPOINTMENT_MATCHED";
    }

    if (shouldApplyDispatchHold(observation, match)) {
      const hold = await safety.applyDispatchHold({
        appointmentId,
        caseId: canonicalCaseId,
        requestedAction: observation.intent,
        reasonCategory: observation.reason ? "customer_provided_reason" : "no_reason_provided",
        sourceMessageIds: [messageId],
        actor: { id: "demac-customer-agent", name: "Maya", source: "maya-observer" },
      });
      dispatchHoldActive = hold.success === true;
      if (dispatchHoldActive) state = "AWAITING_CUSTOMER_DECISION";
    }

    const event = caseHistoryEvent({
      kind: observation.intent === "cancellation" ? "cancellation_detected"
        : observation.intent === "reschedule" ? "reschedule_detected"
          : "attention_detected",
      messageId,
      observation,
      appointmentId,
      now,
    });
    const history = [...(Array.isArray(previous?.history) ? previous.history : []), event].slice(-100);
    await caseRef.set({
      id: canonicalCaseId,
      version: COMMUNICATION_CASE_VERSION,
      communicationAccountId: cleanText(communicationAccountId, 180).toLowerCase(),
      conversationId: cleanText(conversationId, 300),
      customerId: customer?.id || null,
      appointmentId: appointmentId || null,
      caseType: ACTIVE_APPOINTMENT_CHANGE_INTENTS.has(observation.intent) ? "appointment_change" : observation.intent,
      state,
      intent: observation.intent,
      confidence: Number(observation.confidence || 0),
      language: cleanText(observation.language, 40),
      summary: cleanText(observation.summary, 800),
      reasonProvided: observation.reasonAlreadyProvided === true,
      reason: cleanText(observation.reason, 500) || null,
      attentionRequired: observation.requiresAttention === true || Boolean(attentionReason),
      attentionReason: attentionReason || null,
      dispatchRisk: observation.dispatchRisk === true,
      dispatchHoldActive,
      candidateAppointmentIds: match.candidates?.map((item) => item.id).filter(Boolean).slice(0, 10) || [],
      sourceMessageIds: FieldValue.arrayUnion(messageId),
      lastSourceMessageId: messageId,
      history,
      createdAt: previous?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: now.toISOString(),
    }, { merge: true });

    return {
      processed: true,
      caseId: canonicalCaseId,
      state,
      customerId: customer?.id || "",
      appointmentId,
      dispatchHoldActive,
      attentionReason,
    };
  }

  return {
    existingCase,
    loadUpcomingAppointments,
    processObservation,
    resolveCustomer,
  };
}

module.exports = {
  ACTIVE_APPOINTMENT_CHANGE_INTENTS,
  COMMUNICATION_CASE_COLLECTION,
  COMMUNICATION_CASE_VERSION,
  DISPATCH_HOLD_CONFIDENCE,
  appointmentStartKey,
  communicationCaseId,
  createCommunicationCaseService,
  materialCaseIntent,
  matchRelevantAppointment,
  normalizedRequestedDate,
  normalizedRequestedTime,
  queryCustomerByPhone,
  shouldApplyDispatchHold,
  upcomingAppointmentCandidates,
};
