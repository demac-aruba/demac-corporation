const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { BOOKING_COLLECTIONS, compactObject } = require("./bookingAuthorityFirestore");
const { cleanText } = require("./bookingSchedulingPrimitives");

const DISPATCH_SAFETY_VERSION = 1;
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
  } = {}) {
    const id = cleanText(appointmentId, 180);
    const canonicalCaseId = cleanText(caseId, 180);
    if (!id || !canonicalCaseId) throw new Error("appointmentId and caseId are required for a dispatch hold.");
    const appointmentRef = db.collection(collections.appointments).doc(id);
    const now = clock();

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(appointmentRef);
      if (!snapshot.exists) return { success: false, reason: "appointment-not-found", appointmentId: id };
      const current = { id: snapshot.id, ...snapshot.data() };
      const status = cleanText(current.status, 40).toLowerCase();
      if (CANCELLED_STATUSES.has(status)) {
        return { success: true, replayed: true, reason: "appointment-already-cancelled", appointmentId: id };
      }
      const existing = current.dispatchHold || {};
      if (existing.active === true && cleanText(existing.caseId, 180) === canonicalCaseId) {
        return { success: true, replayed: true, reason: "dispatch-hold-already-active", appointmentId: id, dispatchHold: existing };
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
      transaction.set(appointmentRef, {
        dispatchHold,
        dispatchSafetyHistory: history,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: now.toISOString(),
      }, { merge: true });

      for (const workOrderId of Array.isArray(current.workOrderIds) ? current.workOrderIds : []) {
        transaction.set(db.collection(collections.workOrders).doc(workOrderId), {
          dispatchHoldActive: true,
          dispatchHoldCaseId: canonicalCaseId,
          dispatchHoldReason: HOLD_REASON,
          dispatchSafety: "do_not_dispatch",
          dispatchSafetySourceAppointmentId: id,
          updatedAt: now.toISOString(),
        }, { merge: true });
      }

      return { success: true, replayed: false, appointmentId: id, dispatchHold };
    });
  }

  async function releaseDispatchHold({ appointmentId, caseId = "", resolution = "resolved", actor = {} } = {}) {
    const id = cleanText(appointmentId, 180);
    if (!id) throw new Error("appointmentId is required to release a dispatch hold.");
    const appointmentRef = db.collection(collections.appointments).doc(id);
    const now = clock();

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(appointmentRef);
      if (!snapshot.exists) return { success: false, reason: "appointment-not-found", appointmentId: id };
      const current = { id: snapshot.id, ...snapshot.data() };
      const existing = current.dispatchHold || {};
      if (existing.active !== true) {
        return { success: true, replayed: true, reason: "dispatch-hold-not-active", appointmentId: id };
      }
      const requestedCaseId = cleanText(caseId, 180);
      const existingCaseId = cleanText(existing.caseId, 180);
      if (requestedCaseId && existingCaseId && requestedCaseId !== existingCaseId) {
        return { success: false, reason: "dispatch-hold-case-mismatch", appointmentId: id, activeCaseId: existingCaseId };
      }

      const event = holdHistoryEvent({
        kind: "dispatch_hold_released",
        caseId: existingCaseId,
        requestedAction: cleanText(existing.requestedAction, 80),
        reasonCategory: cleanText(resolution, 120),
        sourceMessageIds: existing.sourceMessageIds,
        actor,
        now,
      });
      const dispatchHold = compactObject({
        ...existing,
        active: false,
        releasedAtIso: now.toISOString(),
        resolution: cleanText(resolution, 120) || "resolved",
        releasedBy: holdActor(actor),
      });
      const history = [...(Array.isArray(current.dispatchSafetyHistory) ? current.dispatchSafetyHistory : []), event].slice(-80);
      transaction.set(appointmentRef, {
        dispatchHold,
        dispatchSafetyHistory: history,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtIso: now.toISOString(),
      }, { merge: true });
      for (const workOrderId of Array.isArray(current.workOrderIds) ? current.workOrderIds : []) {
        transaction.set(db.collection(collections.workOrders).doc(workOrderId), {
          dispatchHoldActive: false,
          dispatchHoldCaseId: existingCaseId || null,
          dispatchHoldReason: null,
          dispatchSafety: "ready",
          dispatchSafetySourceAppointmentId: id,
          updatedAt: now.toISOString(),
        }, { merge: true });
      }
      return { success: true, replayed: false, appointmentId: id, dispatchHold };
    });
  }

  return { applyDispatchHold, releaseDispatchHold };
}

module.exports = {
  CANCELLED_STATUSES,
  DISPATCH_SAFETY_VERSION,
  HOLD_REASON,
  createBookingDispatchSafetyAuthority,
  dispatchHoldActive,
  dispatchReadinessDecision,
  holdHistoryEvent,
};
