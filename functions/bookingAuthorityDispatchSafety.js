const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { BOOKING_COLLECTIONS, compactObject } = require("./bookingAuthorityFirestore");
const { cleanText } = require("./bookingSchedulingPrimitives");
const { communicationEpochDecision } = require("./demacCommunicationEpoch");

const DISPATCH_SAFETY_VERSION = 4;
const HOLD_REASON = "customer_change_unresolved";
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "cancelada"]);

function dispatchHoldActive(appointment = {}) {
  return appointment?.dispatchHold?.active === true;
}

function dispatchReadinessDecision(appointment = {}) {
  const status = cleanText(appointment.status, 40).toLowerCase();
  if (CANCELLED_STATUSES.has(status)) {
    return { safeToDispatch: false, reason: "appointment-cancelled" };
  }
  if (dispatchHoldActive(appointment)) {
    return {
      safeToDispatch: false,
      reason: cleanText(appointment.dispatchHold?.reason, 120) || HOLD_REASON,
      caseId: cleanText(appointment.dispatchHold?.caseId, 180),
    };
  }
  return { safeToDispatch: true, reason: "appointment-dispatch-ready" };
}

function workOrderDispatchProjection(appointment = {}) {
  const decision = dispatchReadinessDecision(appointment);
  return {
    dispatchSafety: decision.safeToDispatch ? "ready" : "do_not_dispatch",
    dispatchHoldActive: dispatchHoldActive(appointment),
    dispatchHoldCaseId: cleanText(appointment.dispatchHold?.caseId, 180) || null,
    dispatchHoldReason: dispatchHoldActive(appointment)
      ? cleanText(appointment.dispatchHold?.reason, 120) || HOLD_REASON
      : decision.safeToDispatch ? null : decision.reason,
  };
}

function holdActor(actor = {}) {
  return compactObject({
    actorId: cleanText(actor.id || actor.userId, 160),
    actorName: cleanText(actor.name || actor.displayName, 160) || "Maya",
    source: cleanText(actor.source, 100) || "maya-observer",
  });
}

function holdHistoryEvent({ kind, caseId, requestedAction, reasonCategory, sourceMessageIds, actor, now }) {
  return compactObject({
    kind,
    at: now.toISOString(),
    caseId: cleanText(caseId, 180),
    requestedAction: cleanText(requestedAction, 80),
    reasonCategory: cleanText(reasonCategory, 120),
    sourceMessageIds: Array.isArray(sourceMessageIds)
      ? [...new Set(sourceMessageIds.map((value) => cleanText(value, 300)).filter(Boolean))].slice(-20)
      : [],
    ...holdActor(actor),
  });
}

async function communicationEpochGuardInTransaction(transaction, db, {
  conversationId = "",
  expectedOwnershipVersion,
  expectedCustomerInputVersion,
} = {}) {
  const canonicalConversationId = cleanText(conversationId, 300);
  const epochGuardRequested = Boolean(
    canonicalConversationId
    || expectedOwnershipVersion !== undefined
    || expectedCustomerInputVersion !== undefined,
  );
  if (!epochGuardRequested) return { allowed: true, reason: "communication-epoch-guard-not-requested" };
  if (!canonicalConversationId) return { allowed: false, reason: "communication-conversation-missing" };
  const snapshot = await transaction.get(db.collection("communicationConversations").doc(canonicalConversationId));
  if (!snapshot.exists) return { allowed: false, reason: "communication-conversation-not-found" };
  return communicationEpochDecision({
    conversation: snapshot.data() || {},
    expectedOwnershipVersion,
    expectedCustomerInputVersion,
  });
}

function normalizedWorkOrderIds(appointment = {}, workOrderIds) {
  const values = Array.isArray(workOrderIds) ? workOrderIds : appointment.workOrderIds;
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value, 180))
    .filter(Boolean))];
}

function writeWorkOrderDispatchProjectionInTransaction({
  transaction,
  db,
  collections = BOOKING_COLLECTIONS,
  appointmentId,
  appointment = {},
  workOrderIds,
  now = new Date(),
} = {}) {
  if (!transaction || typeof transaction.set !== "function") {
    throw new Error("A Firestore transaction is required for dispatch projection.");
  }
  const id = cleanText(appointmentId || appointment.id, 180);
  if (!id) throw new Error("appointmentId is required for dispatch projection.");
  const projection = workOrderDispatchProjection(appointment);
  for (const workOrderId of normalizedWorkOrderIds(appointment, workOrderIds)) {
    transaction.set(db.collection(collections.workOrders).doc(workOrderId), {
      ...projection,
      dispatchSafetySourceAppointmentId: id,
      updatedAt: now.toISOString(),
    }, { merge: true });
  }
  return projection;
}

async function appointmentForTransaction({ transaction, appointmentRef, appointmentSnapshot, appointment }) {
  if (appointment && typeof appointment === "object" && Object.keys(appointment).length) {
    return { exists: true, current: { ...appointment } };
  }
  const snapshot = appointmentSnapshot || await transaction.get(appointmentRef);
  if (!snapshot?.exists) return { exists: false, current: null };
  return { exists: true, current: { id: snapshot.id, ...snapshot.data() } };
}

async function applyDispatchHoldInTransaction({
  transaction,
  db,
  collections = BOOKING_COLLECTIONS,
  appointmentRef,
  appointmentSnapshot,
  appointment,
  appointmentId,
  caseId,
  requestedAction = "customer_change",
  reasonCategory = "customer_change_unresolved",
  sourceMessageIds = [],
  actor = {},
  now = new Date(),
  projectWorkOrders = true,
} = {}) {
  const id = cleanText(appointmentId || appointmentRef?.id || appointment?.id, 180);
  const canonicalCaseId = cleanText(caseId, 180);
  if (!id || !canonicalCaseId) throw new Error("appointmentId and caseId are required for a dispatch hold.");
  const ref = appointmentRef || db.collection(collections.appointments).doc(id);
  const loaded = await appointmentForTransaction({ transaction, appointmentRef: ref, appointmentSnapshot, appointment });
  if (!loaded.exists) return { success: false, reason: "appointment-not-found", appointmentId: id };
  const current = { id, ...loaded.current };
  const status = cleanText(current.status, 40).toLowerCase();
  if (CANCELLED_STATUSES.has(status)) {
    return { success: true, replayed: true, reason: "appointment-already-cancelled", appointmentId: id };
  }

  const existing = current.dispatchHold || {};
  const existingCaseId = cleanText(existing.caseId, 180);
  if (existing.active === true && existingCaseId === canonicalCaseId) {
    if (projectWorkOrders) {
      writeWorkOrderDispatchProjectionInTransaction({
        transaction,
        db,
        collections,
        appointmentId: id,
        appointment: current,
        now,
      });
    }
    return { success: true, replayed: true, reason: "dispatch-hold-already-active", appointmentId: id, dispatchHold: existing };
  }
  if (existing.active === true && existingCaseId && existingCaseId !== canonicalCaseId) {
    return {
      success: false,
      reason: "dispatch-hold-owned-by-other-case",
      appointmentId: id,
      activeCaseId: existingCaseId,
    };
  }

  const event = holdHistoryEvent({
    kind: "dispatch_hold_applied",
    caseId: canonicalCaseId,
    requestedAction,
    reasonCategory,
    sourceMessageIds,
    actor,
    now,
  });
  const dispatchHold = compactObject({
    active: true,
    reason: HOLD_REASON,
    caseId: canonicalCaseId,
    requestedAction: cleanText(requestedAction, 80) || "customer_change",
    reasonCategory: cleanText(reasonCategory, 120) || "customer_change_unresolved",
    sourceMessageIds: event.sourceMessageIds,
    appliedAtIso: now.toISOString(),
    ...holdActor(actor),
  });
  const history = [...(Array.isArray(current.dispatchSafetyHistory) ? current.dispatchSafetyHistory : []), event].slice(-80);
  const nextAppointment = { ...current, dispatchHold, dispatchSafetyHistory: history };
  transaction.set(ref, {
    dispatchHold,
    dispatchSafetyHistory: history,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtIso: now.toISOString(),
  }, { merge: true });

  if (projectWorkOrders) {
    writeWorkOrderDispatchProjectionInTransaction({
      transaction,
      db,
      collections,
      appointmentId: id,
      appointment: nextAppointment,
      now,
    });
  }

  return { success: true, replayed: false, appointmentId: id, dispatchHold, appointment: nextAppointment };
}

async function releaseDispatchHoldInTransaction({
  transaction,
  db,
  collections = BOOKING_COLLECTIONS,
  appointmentRef,
  appointmentSnapshot,
  appointment,
  appointmentId,
  caseId = "",
  resolution = "resolved",
  actor = {},
  now = new Date(),
  projectWorkOrders = true,
  projectionAppointment = null,
  workOrderIds,
} = {}) {
  const id = cleanText(appointmentId || appointmentRef?.id || appointment?.id, 180);
  if (!id) throw new Error("appointmentId is required to release a dispatch hold.");
  const ref = appointmentRef || db.collection(collections.appointments).doc(id);
  const loaded = await appointmentForTransaction({ transaction, appointmentRef: ref, appointmentSnapshot, appointment });
  if (!loaded.exists) return { success: false, reason: "appointment-not-found", appointmentId: id };
  const current = { id, ...loaded.current };
  const existing = current.dispatchHold || {};
  const requestedCaseId = cleanText(caseId, 180);
  const existingCaseId = cleanText(existing.caseId, 180);

  if (existing.active === true && requestedCaseId && existingCaseId && requestedCaseId !== existingCaseId) {
    return { success: false, reason: "dispatch-hold-case-mismatch", appointmentId: id, activeCaseId: existingCaseId };
  }

  let dispatchHold = existing;
  let history = Array.isArray(current.dispatchSafetyHistory) ? current.dispatchSafetyHistory : [];
  let replayed = existing.active !== true;
  if (existing.active === true) {
    const event = holdHistoryEvent({
      kind: "dispatch_hold_released",
      caseId: existingCaseId,
      requestedAction: cleanText(existing.requestedAction, 80),
      reasonCategory: cleanText(resolution, 120),
      sourceMessageIds: existing.sourceMessageIds,
      actor,
      now,
    });
    dispatchHold = compactObject({
      ...existing,
      active: false,
      releasedAtIso: now.toISOString(),
      resolution: cleanText(resolution, 120) || "resolved",
      releasedBy: holdActor(actor),
    });
    history = [...history, event].slice(-80);
    transaction.set(ref, {
      dispatchHold,
      dispatchSafetyHistory: history,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtIso: now.toISOString(),
    }, { merge: true });
    replayed = false;
  }

  const nextAppointment = {
    ...current,
    ...(projectionAppointment && typeof projectionAppointment === "object" ? projectionAppointment : {}),
    dispatchHold,
    dispatchSafetyHistory: history,
  };
  if (projectWorkOrders) {
    writeWorkOrderDispatchProjectionInTransaction({
      transaction,
      db,
      collections,
      appointmentId: id,
      appointment: nextAppointment,
      workOrderIds,
      now,
    });
  }

  return {
    success: true,
    replayed,
    reason: replayed ? "dispatch-hold-not-active" : "dispatch-hold-released",
    appointmentId: id,
    dispatchHold,
    appointment: nextAppointment,
  };
}

function createBookingDispatchSafetyAuthority({
  db = getFirestore(),
  clock = () => new Date(),
  collections = BOOKING_COLLECTIONS,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required for Booking Dispatch Safety Authority.");
  }

  async function applyDispatchHold({
    appointmentId,
    caseId,
    requestedAction = "customer_change",
    reasonCategory = "customer_change_unresolved",
    sourceMessageIds = [],
    actor = {},
    conversationId = "",
    expectedOwnershipVersion,
    expectedCustomerInputVersion,
  } = {}) {
    const id = cleanText(appointmentId, 180);
    const canonicalCaseId = cleanText(caseId, 180);
    if (!id || !canonicalCaseId) throw new Error("appointmentId and caseId are required for a dispatch hold.");
    const appointmentRef = db.collection(collections.appointments).doc(id);
    const now = clock();

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(appointmentRef);
      const epochDecision = await communicationEpochGuardInTransaction(transaction, db, {
        conversationId,
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
      });
      if (!epochDecision.allowed) {
        return { success: false, reason: "stale-communication-epoch", epochReason: epochDecision.reason, appointmentId: id };
      }
      return applyDispatchHoldInTransaction({
        transaction,
        db,
        collections,
        appointmentRef,
        appointmentSnapshot: snapshot,
        appointmentId: id,
        caseId: canonicalCaseId,
        requestedAction,
        reasonCategory,
        sourceMessageIds,
        actor,
        now,
      });
    });
  }

  async function releaseDispatchHold({
    appointmentId,
    caseId = "",
    resolution = "resolved",
    actor = {},
    conversationId = "",
    expectedOwnershipVersion,
    expectedCustomerInputVersion,
  } = {}) {
    const id = cleanText(appointmentId, 180);
    if (!id) throw new Error("appointmentId is required to release a dispatch hold.");
    const appointmentRef = db.collection(collections.appointments).doc(id);
    const now = clock();

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(appointmentRef);
      const epochDecision = await communicationEpochGuardInTransaction(transaction, db, {
        conversationId,
        expectedOwnershipVersion,
        expectedCustomerInputVersion,
      });
      if (!epochDecision.allowed) {
        return { success: false, reason: "stale-communication-epoch", epochReason: epochDecision.reason, appointmentId: id };
      }
      return releaseDispatchHoldInTransaction({
        transaction,
        db,
        collections,
        appointmentRef,
        appointmentSnapshot: snapshot,
        appointmentId: id,
        caseId,
        resolution,
        actor,
        now,
      });
    });
  }

  return {
    applyDispatchHold,
    applyDispatchHoldInTransaction: (transaction, args = {}) => applyDispatchHoldInTransaction({ transaction, db, collections, ...args }),
    releaseDispatchHold,
    releaseDispatchHoldInTransaction: (transaction, args = {}) => releaseDispatchHoldInTransaction({ transaction, db, collections, ...args }),
    writeWorkOrderDispatchProjectionInTransaction: (transaction, args = {}) => writeWorkOrderDispatchProjectionInTransaction({ transaction, db, collections, ...args }),
  };
}

module.exports = {
  CANCELLED_STATUSES,
  DISPATCH_SAFETY_VERSION,
  HOLD_REASON,
  applyDispatchHoldInTransaction,
  communicationEpochGuardInTransaction,
  createBookingDispatchSafetyAuthority,
  dispatchHoldActive,
  dispatchReadinessDecision,
  holdHistoryEvent,
  releaseDispatchHoldInTransaction,
  workOrderDispatchProjection,
  writeWorkOrderDispatchProjectionInTransaction,
};
