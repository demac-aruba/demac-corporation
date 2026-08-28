const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { arubaDateParts, cleanText, hashId } = require("./bookingSchedulingPrimitives");
const { resolveInboundParty } = require("./customerContactDirectory");
const { createBookingDispatchSafetyAuthority } = require("./bookingAuthorityDispatchSafety");
const { communicationEpochDecision } = require("./demacCustomerTurn");

const COMMUNICATION_CASE_VERSION = 4;
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
  const resolution = await resolveInboundParty(db, { phone });
  return {
    customer: resolution.customer || null,
    ambiguous: resolution.ambiguous === true,
    resolution,
  };
}

function createCommunicationCaseService({ db = getFirestore(), dispatchSafety = null, clock = () => new Date() } = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible transactional db is required for Communication Cases.");
  }
  const safety = dispatchSafety || createBookingDispatchSafetyAuthority({ db, clock });

  async function resolveCustomer({ conversation = {}, message = {} } = {}) {
    const resolution = await resolveInboundParty(db, {
      clientId: cleanText(conversation.customerId || message.customerId, 160),
      phone: conversation.phone || message.phone,
      whatsapp: conversation.whatsapp || message.whatsapp || conversation.phone || message.phone,
    });
    return {
      customer: resolution.customer || null,
      ambiguous: resolution.ambiguous === true,
      resolution,
    };
  }

  async function loadUpcomingAppointments(customerId, today = arubaDateParts(clock()).date) {
    if (!customerId) return [];
    const snapshot = await db.collection("appointments").where("customerId", "==", customerId).get();
    return upcomingAppointmentCandidates(
      snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      today,
    );
  }

  async function existingCase(caseId) {
    if (!caseId) return null;
    const snapshot = await db.collection(COMMUNICATION_CASE_COLLECTION).doc(caseId).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }

  async function commitCaseIfCurrent({
    caseRef,
    conversationId,
    expectedOwnershipVersion,
    expectedCustomerInputVersion,
    patch,
    event,
    dispatchMutation = null,
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

      const dispatchResult = typeof dispatchMutation === "function"
        ? await dispatchMutation(transaction)
        : null;
      if (dispatchResult?.abort === true) {
        return {
          written: false,
          reason: dispatchResult.reason || "dispatch-mutation-rejected",
          epochReason: dispatchResult.epochReason,
          dispatchResult,
        };
      }

      const currentCase = caseSnapshot.exists ? caseSnapshot.data() || {} : {};
      const resolvedPatch = typeof patch === "function" ? patch(dispatchResult) : patch;
      transaction.set(caseRef, {
        ...resolvedPatch,
        ...(event ? { history: appendCaseHistory(currentCase.history, event) } : {}),
        createdAt: currentCase.createdAt || resolvedPatch.createdAt || FieldValue.serverTimestamp(),
      }, { merge: true });
      return { written: true, dispatchResult };
    });
  }

  async function writeCaseIfCurrent(args) {
    return commitCaseIfCurrent(args);
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
    const today = arubaDateParts(now).date;
    const messageId = cleanText(message.messageId || message.id, 300);
    const caseRef = db.collection(COMMUNICATION_CASE_COLLECTION).doc(canonicalCaseId);
    const previous = await existingCase(canonicalCaseId);

    if (observation.intent === "customer_withdrew_change") {
      const customerResolution = await resolveCustomer({ conversation, message });
      const appointments = customerResolution.customer
        ? await loadUpcomingAppointments(customerResolution.customer.id, today)
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
      const event = caseHistoryEvent({ kind: "customer_withdrew_change", messageId, observation, appointmentId, now });
      const write = await commitCaseIfCurrent({
        caseRef,
        conversationId,
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
        event,
        dispatchMutation: appointmentId
          ? async (transaction) => {
            const release = await safety.releaseDispatchHoldInTransaction(transaction, {
              appointmentId,
              caseId: canonicalCaseId,
              resolution: "customer_withdrew_change",
              actor: { id: "demac-customer-agent", name: "Maya", source: "maya-observer" },
              now,
            });
            return release.success
              ? release
              : { ...release, abort: true };
          }
          : null,
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
      if (!write.written) {
        return {
          processed: false,
          reason: write.reason,
          epochReason: write.epochReason,
          attentionReason: write.reason === "dispatch-hold-case-mismatch" ? write.reason : undefined,
        };
      }
      return { processed: true, caseId: canonicalCaseId, state: "RESOLVED_CUSTOMER_WITHDREW_CHANGE", appointmentId };
    }

    const customerResolution = await resolveCustomer({ conversation, message });
    const customer = customerResolution.customer;
    const appointments = customer ? await loadUpcomingAppointments(customer.id, today) : [];
    const match = matchRelevantAppointment({ appointments, observation, today });
    let state = "DETECTED";
    let attentionReason = "";
    const appointmentId = match.matched ? cleanText(match.appointment?.id, 180) : "";

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

    const holdRequired = shouldApplyDispatchHold(observation, match);
    const event = caseHistoryEvent({
      kind: observation.intent === "cancellation" ? "cancellation_detected"
        : observation.intent === "reschedule" ? "reschedule_detected"
          : "attention_detected",
      messageId,
      observation,
      appointmentId,
      now,
    });
    const baseState = state;
    const baseAttentionReason = attentionReason;
    const write = await commitCaseIfCurrent({
      caseRef,
      conversationId,
      expectedOwnershipVersion,
      expectedCustomerInputVersion,
      event,
      dispatchMutation: holdRequired
        ? async (transaction) => {
          const hold = await safety.applyDispatchHoldInTransaction(transaction, {
            appointmentId,
            caseId: canonicalCaseId,
            requestedAction: observation.intent,
            reasonCategory: observation.reason ? "customer_provided_reason" : "no_reason_provided",
            sourceMessageIds: messageId ? [messageId] : [],
            actor: { id: "demac-customer-agent", name: "Maya", source: "maya-observer" },
            now,
          });
          if (!hold.success && hold.reason !== "dispatch-hold-owned-by-other-case") {
            return { ...hold, abort: true };
          }
          return hold;
        }
        : null,
      patch: (dispatchResult) => {
        const dispatchHoldActive = dispatchResult?.dispatchHold?.active === true;
        const holdConflict = dispatchResult?.success === false && dispatchResult?.reason === "dispatch-hold-owned-by-other-case";
        const finalState = holdConflict ? "ESCALATED" : dispatchHoldActive ? "AWAITING_CUSTOMER_DECISION" : baseState;
        const finalAttentionReason = holdConflict ? dispatchResult.reason : baseAttentionReason;
        return {
          id: canonicalCaseId,
          version: COMMUNICATION_CASE_VERSION,
          communicationAccountId: cleanText(communicationAccountId, 180).toLowerCase(),
          conversationId: cleanText(conversationId, 300),
          customerId: customer?.id || null,
          appointmentId: appointmentId || null,
          caseType,
          state: finalState,
          intent: observation.intent,
          confidence: Number(observation.confidence || 0),
          language: cleanText(observation.language, 40),
          summary: cleanText(observation.summary, 800),
          reasonProvided: observation.reasonAlreadyProvided === true,
          reason: cleanText(observation.reason, 500) || null,
          attentionRequired: observation.requiresAttention === true || Boolean(finalAttentionReason),
          attentionReason: finalAttentionReason || null,
          dispatchRisk: observation.dispatchRisk === true,
          dispatchHoldActive,
          candidateAppointmentIds: match.candidates?.map((item) => item.id).filter(Boolean).slice(0, 10) || [],
          ...sourceMessagePatch(messageId),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: now.toISOString(),
        };
      },
    });
    if (!write.written) return { processed: false, reason: write.reason, epochReason: write.epochReason };

    const dispatchHoldActive = write.dispatchResult?.dispatchHold?.active === true;
    const holdConflict = write.dispatchResult?.success === false && write.dispatchResult?.reason === "dispatch-hold-owned-by-other-case";
    return {
      processed: true,
      caseId: canonicalCaseId,
      state: holdConflict ? "ESCALATED" : dispatchHoldActive ? "AWAITING_CUSTOMER_DECISION" : baseState,
      customerId: customer?.id || "",
      appointmentId,
      dispatchHoldActive,
      attentionReason: holdConflict ? write.dispatchResult.reason : baseAttentionReason,
    };
  }

  return {
    commitCaseIfCurrent,
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
