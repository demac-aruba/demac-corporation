const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { arubaDateParts, cleanText, hashId } = require("./bookingSchedulingPrimitives");
const { normalizeArubaWhatsAppPhone } = require("./demacCustomerAgentReplyPolicy");
const { createBookingDispatchSafetyAuthority } = require("./bookingAuthorityDispatchSafety");
const { communicationEpochDecision } = require("./demacCustomerTurn");

const COMMUNICATION_CASE_VERSION = 3;
const COMMUNICATION_CASE_COLLECTION = "communicationCases";
const DISPATCH_HOLD_CONFIDENCE = 0.86;
const ACTIVE_APPOINTMENT_CHANGE_INTENTS = new Set(["cancellation", "reschedule"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "cancelada"]);

function caseTypeForObservation(observation = {}) {
  const intent = cleanText(observation.intent, 80);
  if ([...ACTIVE_APPOINTMENT_CHANGE_INTENTS, "customer_withdrew_change"].includes(intent)) return "appointment_change";
  return intent;
}

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
  const sourceMessageId = cleanText(messageId, 300);
  const normalizedAppointmentId = cleanText(appointmentId, 180);
  return {
    id: `CASEEV-${hashId(`${sourceMessageId}|${kind}|${normalizedAppointmentId}`, 24).toUpperCase()}`,
    kind,
    at: now.toISOString(),
    sourceMessageId,
    intent: cleanText(observation?.intent, 80),
    confidence: Number(observation?.confidence || 0),
    appointmentId: normalizedAppointmentId,
    summary: cleanText(observation?.summary, 800),
  };
}

function appendCaseHistory(existing, event, limit = 100) {
  const prior = Array.isArray(existing) ? existing.filter((item) => item?.id && item.id !== event.id) : [];
  return [...prior, event].slice(-limit);
}

function sourceMessagePatch(messageId) {
  const normalized = cleanText(messageId, 300);
  return normalized
    ? { sourceMessageIds: FieldValue.arrayUnion(normalized), lastSourceMessageId: normalized }
    : {};
}

function withdrawalAppointmentResolution({ previousCase = {}, appointments = [], caseId = "" } = {}) {
  const canonicalCaseId = cleanText(caseId, 180);
  const matchingHolds = canonicalCaseId
    ? appointments.filter((appointment) => (
      appointment?.dispatchHold?.active === true
      && cleanText(appointment.dispatchHold.caseId, 180) === canonicalCaseId
      && cleanText(appointment.id, 180)
    ))
    : [];
  if (matchingHolds.length > 1) {
    return { appointmentId: "", ambiguous: true, reason: "multiple-dispatch-holds-for-case" };
  }
  if (matchingHolds.length === 1) {
    return { appointmentId: cleanText(matchingHolds[0].id, 180), ambiguous: false, reason: "active-hold-for-case" };
  }
  const previousAppointmentId = cleanText(previousCase?.appointmentId, 180);
  return previousAppointmentId
    ? { appointmentId: previousAppointmentId, ambiguous: false, reason: "previous-case-appointment" }
    : { appointmentId: "", ambiguous: false, reason: "no-known-held-appointment" };
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
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible transactional db is required for Communication Cases.");
  }
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

  async function writeCaseIfCurrent({
    caseRef,
    conversationId,
    expectedOwnershipVersion,
    expectedCustomerInputVersion,
    patch,
    event,
  }) {
    return db.runTransaction(async (transaction) => {
      const conversationRef = db.collection("communicationConversations").doc(conversationId);
      const conversationSnapshot = await transaction.get(conversationRef);
      const caseSnapshot = await transaction.get(caseRef);
      if (!conversationSnapshot.exists) return { written: false, reason: "communication-conversation-not-found" };
      const epochDecision = communicationEpochDecision({
        conversation: conversationSnapshot.data() || {},
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
      });
      if (!epochDecision.allowed) return { written: false, reason: "stale-communication-epoch", epochReason: epochDecision.reason };
      const currentCase = caseSnapshot.exists ? caseSnapshot.data() || {} : {};
      transaction.set(caseRef, {
        ...patch,
        ...(event ? { history: appendCaseHistory(currentCase.history, event) } : {}),
        createdAt: currentCase.createdAt || patch.createdAt || FieldValue.serverTimestamp(),
      }, { merge: true });
      return { written: true };
    });
  }

  async function processObservation({
    communicationAccountId,
    conversationId,
    conversation = {},
    message = {},
    observation = {},
    expectedOwnershipVersion,
    expectedCustomerInputVersion,
  } = {}) {
    if (!materialCaseIntent(observation)) return { processed: false, reason: "no-material-operational-case" };
    const caseType = caseTypeForObservation(observation);
    const canonicalCaseId = communicationCaseId({ communicationAccountId, conversationId, caseType });
    if (!canonicalCaseId) return { processed: false, reason: "missing-case-identity" };
    const now = clock();
    const messageId = cleanText(message.messageId || message.id, 300);
    const caseRef = db.collection(COMMUNICATION_CASE_COLLECTION).doc(canonicalCaseId);
    const previous = await existingCase(canonicalCaseId);

    if (observation.intent === "customer_withdrew_change") {
      const customerResolution = await resolveCustomer({ conversation, message });
      const appointments = customerResolution.customer
        ? await loadUpcomingAppointments(customerResolution.customer.id)
        : [];
      const withdrawalResolution = withdrawalAppointmentResolution({
        previousCase: previous || {},
        appointments,
        caseId: canonicalCaseId,
      });
      if (withdrawalResolution.ambiguous) {
        return {
          processed: false,
          reason: withdrawalResolution.reason,
          attentionReason: withdrawalResolution.reason,
        };
      }
      const appointmentId = withdrawalResolution.appointmentId;
      if (appointmentId) {
        const release = await safety.releaseDispatchHold({
          appointmentId,
          caseId: canonicalCaseId,
          resolution: "customer_withdrew_change",
          actor: { id: "demac-customer-agent", name: "Maya", source: "maya-observer" },
          conversationId,
          expectedOwnershipVersion,
          expectedCustomerInputVersion,
        });
        if (!release.success && release.reason === "stale-communication-epoch") {
          return { processed: false, reason: release.reason, epochReason: release.epochReason };
        }
        if (!release.success && release.reason === "dispatch-hold-case-mismatch") {
          return { processed: false, reason: release.reason, attentionReason: release.reason };
        }
      }
      const event = caseHistoryEvent({ kind: "customer_withdrew_change", messageId, observation, appointmentId, now });
      const write = await writeCaseIfCurrent({
        caseRef,
        conversationId,
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
        event,
        patch: {
          id: canonicalCaseId,
          version: COMMUNICATION_CASE_VERSION,
          communicationAccountId: cleanText(communicationAccountId, 180).toLowerCase(),
          conversationId: cleanText(conversationId, 300),
          caseType,
          state: "RESOLVED_CUSTOMER_WITHDREW_CHANGE",
          intent: observation.intent,
          confidence: Number(observation.confidence || 0),
          dispatchHoldActive: false,
          ...sourceMessagePatch(messageId),
          resolvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: now.toISOString(),
        },
      });
      if (!write.written) return { processed: false, reason: write.reason, epochReason: write.epochReason };
      return { processed: true, caseId: canonicalCaseId, state: "RESOLVED_CUSTOMER_WITHDREW_CHANGE", appointmentId };
    }

    const customerResolution = await resolveCustomer({ conversation, message });
    const customer = customerResolution.customer;
    const appointments = customer ? await loadUpcomingAppointments(customer.id) : [];
    const match = matchRelevantAppointment({ appointments, observation });
    let state = "DETECTED";
    let attentionReason = "";
    const appointmentId = match.matched ? cleanText(match.appointment?.id, 180) : "";
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
        sourceMessageIds: messageId ? [messageId] : [],
        actor: { id: "demac-customer-agent", name: "Maya", source: "maya-observer" },
        conversationId,
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
      });
      if (!hold.success && hold.reason === "stale-communication-epoch") {
        return { processed: false, reason: hold.reason, epochReason: hold.epochReason };
      }
      dispatchHoldActive = hold.dispatchHold?.active === true;
      if (dispatchHoldActive) state = "AWAITING_CUSTOMER_DECISION";
      if (!hold.success && hold.reason === "dispatch-hold-owned-by-other-case") {
        attentionReason = hold.reason;
        state = "ESCALATED";
      }
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
    const write = await writeCaseIfCurrent({
      caseRef,
      conversationId,
      expectedOwnershipVersion,
      expectedCustomerInputVersion,
      event,
      patch: {
        id: canonicalCaseId,
        version: COMMUNICATION_CASE_VERSION,
        communicationAccountId: cleanText(communicationAccountId, 180).toLowerCase(),
        conversationId: cleanText(conversationId, 300),
        customerId: customer?.id || null,
        appointmentId: appointmentId || null,
        caseType,
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
        ...sourceMessagePatch(messageId),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: now.toISOString(),
      },
    });
    if (!write.written) return { processed: false, reason: write.reason, epochReason: write.epochReason };

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
    writeCaseIfCurrent,
  };
}

module.exports = {
  ACTIVE_APPOINTMENT_CHANGE_INTENTS,
  COMMUNICATION_CASE_COLLECTION,
  COMMUNICATION_CASE_VERSION,
  DISPATCH_HOLD_CONFIDENCE,
  appendCaseHistory,
  appointmentStartKey,
  caseHistoryEvent,
  caseTypeForObservation,
  communicationCaseId,
  createCommunicationCaseService,
  materialCaseIntent,
  matchRelevantAppointment,
  normalizedRequestedDate,
  normalizedRequestedTime,
  queryCustomerByPhone,
  shouldApplyDispatchHold,
  sourceMessagePatch,
  upcomingAppointmentCandidates,
  withdrawalAppointmentResolution,
};