const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  canonicalAppointmentIdentity,
  cleanText,
  normalizeBookingRequest,
} = require("./bookingAuthorityCore");
const { compactObject } = require("./bookingAuthorityFirestore");

const PARTIAL_COMPLETION_VERSION = 1;

function defaultServerTimestamp() {
  const { FieldValue } = require("firebase-admin/firestore");
  return FieldValue.serverTimestamp();
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function arubaDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Aruba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(asDate(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validTime(value) {
  const normalized = cleanText(value, 20);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? normalized : "";
}

function timeToMinutes(value) {
  const normalized = validTime(value);
  if (!normalized) return NaN;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function actorFields(actor = {}) {
  return {
    actorId: cleanText(actor.id || actor.userId, 160),
    actorName: cleanText(actor.name || actor.displayName, 160),
    source: cleanText(actor.source, 80) || "office-scheduling",
  };
}

function activeAppointment(snapshot, appointmentId) {
  if (!snapshot.exists) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.APPOINTMENT_NOT_FOUND,
      "The appointment does not exist.",
      { appointmentId },
    );
  }
  return { id: snapshot.id, ...snapshot.data() };
}

function normalizedWorkLines(value) {
  if (!Array.isArray(value)) return [];
  return value.map((line, index) => ({
    id: cleanText(line?.id, 120) || `work-${index + 1}`,
    presetId: cleanText(line?.presetId || line?.serviceType, 120),
    serviceId: cleanText(line?.serviceId, 120),
    quantity: Math.max(1, Math.round(Number(line?.quantity) || 1)),
    ...(Number(line?.manualDurationMinutes) > 0 ? { manualDurationMinutes: Number(line.manualDurationMinutes) } : {}),
    ...(cleanText(line?.customerFacingDescription, 1_500) ? { customerFacingDescription: cleanText(line.customerFacingDescription, 1_500) } : {}),
    ...(cleanText(line?.technicianInstructions, 1_500) ? { technicianInstructions: cleanText(line.technicianInstructions, 1_500) } : {}),
  })).filter((line) => line.presetId);
}

function lineIdentity(line) {
  return [
    cleanText(line?.presetId, 120),
    cleanText(line?.serviceId, 120),
    Math.max(1, Math.round(Number(line?.quantity) || 1)),
    Math.max(0, Math.round(Number(line?.manualDurationMinutes) || 0)),
  ].join("|");
}

function sameWorkLines(left, right) {
  const a = normalizedWorkLines(left).map(lineIdentity).sort();
  const b = normalizedWorkLines(right).map(lineIdentity).sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function primaryAssignment(appointment = {}) {
  const assignments = Array.isArray(appointment.assignments) ? appointment.assignments : [];
  return assignments.find((item) => cleanText(item?.role, 40).toLowerCase() !== "support") || assignments[0] || null;
}

function supportAssignments(appointment = {}) {
  const assignments = Array.isArray(appointment.assignments) ? appointment.assignments : [];
  const primary = primaryAssignment(appointment);
  return assignments.filter((item) => item !== primary);
}

function scheduleSnapshot(appointment = {}) {
  const primary = primaryAssignment(appointment) || {};
  return compactObject({
    dateKey: cleanText(appointment.date, 20),
    primaryVanId: cleanText(primary.vanId || appointment.primaryVanId, 120),
    primaryStart: cleanText(primary.time || appointment.startTime, 20),
    primaryEnd: cleanText(primary.endTime || appointment.endTime, 20),
    primaryCapacityEnd: cleanText(primary.capacityEndTime || appointment.capacityEndTime || appointment.endTime, 20),
  });
}

function lifecycleEvent({ kind, actor, reason, note, now, from, to, details = {} }) {
  const actorInfo = actorFields(actor);
  return compactObject({
    id: `LIFE-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    at: now.toISOString(),
    actorId: actorInfo.actorId,
    actorName: actorInfo.actorName,
    reason: cleanText(reason, 500),
    note: cleanText(note, 1_500),
    from,
    to,
    customerNotificationRecommended: false,
    ...details,
  });
}

function completedWorkItems(items, completedQuantity, elapsedMinutes) {
  if (!Array.isArray(items) || !items.length) return items;
  if (items.length !== 1) return items.map((item) => ({ ...item }));
  return [{
    ...items[0],
    quantity: completedQuantity,
    durationMinutes: elapsedMinutes,
  }];
}

function requirePartialOutcome(appointment) {
  const outcome = appointment?.executionOutcome;
  if (!outcome || cleanText(outcome.status, 40) !== "partial") {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "This appointment does not have a recorded partial completion.",
      { reason: "partial-completion-not-recorded" },
    );
  }
  return outcome;
}

function createPartialCompletionAuthority({
  db,
  bookingAuthority,
  clock = () => new Date(),
  serverTimestamp = defaultServerTimestamp,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }
  if (!bookingAuthority || typeof bookingAuthority.createAppointment !== "function" || typeof bookingAuthority.getAppointment !== "function") {
    throw new Error("Booking Authority is required for partial-completion follow-up scheduling.");
  }

  async function recordPartialCompletion({
    appointmentId,
    requestId,
    completedQuantity,
    actualEndTime,
    reason,
    note = "",
    actor = {},
  } = {}) {
    const id = cleanText(appointmentId, 180);
    const stableRequestId = cleanText(requestId, 240);
    const completed = Math.round(Number(completedQuantity));
    const endTime = validTime(actualEndTime);
    const outcomeReason = cleanText(reason, 500);
    if (!id || stableRequestId.length < 8 || !Number.isInteger(completed) || completed < 1 || !endTime || !outcomeReason) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Appointment, request id, completed quantity, actual end time, and reason are required.",
        { reason: "invalid-partial-completion-input" },
      );
    }

    const now = asDate(clock());
    const appointmentRef = db.collection("appointments").doc(id);

    return db.runTransaction(async (transaction) => {
      const appointmentSnapshot = await transaction.get(appointmentRef);
      const current = activeAppointment(appointmentSnapshot, id);
      const status = cleanText(current.status, 40).toLowerCase();
      if (["cancelled", "canceled", "cancelada", "temporary_hold"].includes(status)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Only a confirmed active appointment can record partial completion.",
          { appointmentId: id, status },
        );
      }
      if (cleanText(current.date, 20) > arubaDateKey(now)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Partial completion cannot be recorded for a future appointment.",
          { appointmentId: id, appointmentDate: current.date },
        );
      }
      const existingOutcome = current.executionOutcome;
      if (existingOutcome && cleanText(existingOutcome.status, 40) === "partial") {
        if (cleanText(existingOutcome.recordRequestId, 240) === stableRequestId) {
          return { success: true, replayed: true, appointmentId: id, appointment: current, outcome: existingOutcome };
        }
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Partial completion is already recorded for this appointment. Use Schedule remaining work instead of rewriting the executed history.",
          { appointmentId: id, reason: "partial-completion-already-recorded" },
        );
      }

      const workLines = normalizedWorkLines(current.workLines);
      if (workLines.length !== 1) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Partial completion currently requires one canonical work line. Mixed-service appointments must be reconciled manually before using this action.",
          { appointmentId: id, reason: "partial-completion-mixed-work-not-supported" },
        );
      }
      const primary = primaryAssignment(current);
      if (!primary || supportAssignments(current).length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Partial completion currently supports a single primary Van assignment only.",
          { appointmentId: id, reason: "partial-completion-multi-van-not-supported" },
        );
      }
      const workOrderIds = Array.isArray(current.workOrderIds) ? current.workOrderIds.map((value) => cleanText(value, 180)).filter(Boolean) : [];
      if (workOrderIds.length !== 1) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Partial completion requires exactly one canonical Work Order for this appointment.",
          { appointmentId: id, reason: "partial-completion-work-order-shape-not-supported" },
        );
      }

      const plannedQuantity = workLines[0].quantity;
      if (completed >= plannedQuantity) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Completed quantity must be lower than the planned quantity for a partial completion.",
          { plannedQuantity, completedQuantity: completed },
        );
      }
      const startTime = validTime(primary.time || current.startTime);
      if (!startTime || timeToMinutes(endTime) <= timeToMinutes(startTime)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Actual end time must be later than the appointment start time.",
          { startTime, actualEndTime: endTime },
        );
      }

      const workOrderRef = db.collection("workOrders").doc(workOrderIds[0]);
      const workOrderSnapshot = await transaction.get(workOrderRef);
      if (!workOrderSnapshot.exists) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The canonical Work Order is missing, so partial completion cannot be reconciled safely.",
          { appointmentId: id, workOrderId: workOrderIds[0] },
        );
      }
      const lockIds = Array.isArray(current.capacityLockIds) ? current.capacityLockIds.map((value) => cleanText(value, 180)).filter(Boolean) : [];
      if (!lockIds.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The appointment has no canonical capacity locks to reconcile.",
          { appointmentId: id },
        );
      }
      const lockEntries = [];
      for (const lockId of lockIds) {
        const ref = db.collection("bookingCapacityLocks").doc(lockId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) continue;
        const lock = snapshot.data() || {};
        if (lock.active === false || cleanText(lock.appointmentId, 180) !== id) continue;
        const slot = validTime(lock.slot);
        if (!slot) continue;
        lockEntries.push({ id: lockId, ref, slot });
      }
      const retainedLocks = lockEntries.filter((entry) => timeToMinutes(entry.slot) < timeToMinutes(endTime));
      const releasedLocks = lockEntries.filter((entry) => timeToMinutes(entry.slot) >= timeToMinutes(endTime));
      if (!retainedLocks.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Actual end time would release all appointment capacity. Use cancellation or a manual reconciliation instead.",
          { appointmentId: id, actualEndTime: endTime },
        );
      }

      const remainingQuantity = plannedQuantity - completed;
      const completedLine = { ...workLines[0], quantity: completed };
      const remainingLine = { ...workLines[0], id: `${workLines[0].id}-remaining`, quantity: remainingQuantity };
      const elapsedMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
      const updatedAssignment = {
        ...primary,
        quantity: completed,
        durationMinutes: elapsedMinutes,
        slots: retainedLocks.length,
        endTime,
        capacityEndTime: endTime,
      };
      const workItems = completedWorkItems(current.workItems, completed, elapsedMinutes);
      const actorInfo = actorFields(actor);
      const plannedSchedule = scheduleSnapshot(current);
      const actualSchedule = {
        dateKey: cleanText(current.date, 20),
        primaryVanId: cleanText(primary.vanId || current.primaryVanId, 120),
        primaryStart: startTime,
        primaryEnd: endTime,
        primaryCapacityEnd: endTime,
      };
      const outcome = compactObject({
        status: "partial",
        revision: 1,
        recordRequestId: stableRequestId,
        recordedAtIso: now.toISOString(),
        recordedById: actorInfo.actorId,
        recordedByName: actorInfo.actorName,
        reason: outcomeReason,
        note: cleanText(note, 1_500),
        actualEndTime: endTime,
        plannedQuantity,
        completedQuantity: completed,
        remainingQuantity,
        plannedWorkLines: workLines,
        completedWorkLines: [completedLine],
        remainingWorkLines: [remainingLine],
        plannedSchedule,
        remainingWorkStatus: "pending_schedule",
      });
      const event = lifecycleEvent({
        kind: "partial_completion",
        actor,
        reason: outcomeReason,
        note,
        now,
        from: plannedSchedule,
        to: actualSchedule,
        details: { plannedQuantity, completedQuantity: completed, remainingQuantity, actualEndTime: endTime },
      });
      const lifecycleHistory = [...(Array.isArray(current.lifecycleHistory) ? current.lifecycleHistory : []), event];

      transaction.set(appointmentRef, compactObject({
        workLines: [completedLine],
        workItems,
        endTime,
        capacityEndTime: endTime,
        assignments: [updatedAssignment],
        primaryVanId: cleanText(updatedAssignment.vanId, 120),
        capacityLockIds: retainedLocks.map((entry) => entry.id),
        executionOutcome: outcome,
        lastScheduleChangeKind: "partial_completion",
        customerNotificationRecommended: false,
        updatedAtIso: now.toISOString(),
        lifecycleHistory,
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        updatedAt: serverTimestamp(),
      }), { merge: true });

      const currentWorkOrder = workOrderSnapshot.data() || {};
      transaction.set(workOrderRef, compactObject({
        airConditionerCount: completed,
        quantity: completed,
        appointmentWorkItems: completedWorkItems(currentWorkOrder.appointmentWorkItems, completed, elapsedMinutes),
        appointmentDurationMinutes: elapsedMinutes,
        duration: elapsedMinutes,
        appointmentEndTime: endTime,
        appointmentCapacityEndTime: endTime,
        scheduledSlots: retainedLocks.map((entry) => entry.slot),
        operationalOutcomeStatus: "partial",
        partialCompletion: outcome,
        updatedAt: now.toISOString(),
      }), { merge: true });

      releasedLocks.forEach((entry) => {
        transaction.set(entry.ref, compactObject({
          active: false,
          releasedAtIso: now.toISOString(),
          releaseReason: "partial_completion",
          updatedAtIso: now.toISOString(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      });

      return {
        success: true,
        replayed: false,
        appointmentId: id,
        outcome,
        releasedCapacitySlots: releasedLocks.map((entry) => entry.slot),
        retainedCapacitySlots: retainedLocks.map((entry) => entry.slot),
        appointment: {
          ...current,
          workLines: [completedLine],
          workItems,
          endTime,
          capacityEndTime: endTime,
          assignments: [updatedAssignment],
          capacityLockIds: retainedLocks.map((entry) => entry.id),
          executionOutcome: outcome,
          lifecycleHistory,
        },
      };
    });
  }

  async function linkFollowUp({ originalAppointmentId, followUpAppointmentId, revision, actor, requestId }) {
    const now = asDate(clock());
    const originalRef = db.collection("appointments").doc(originalAppointmentId);
    const followUpRef = db.collection("appointments").doc(followUpAppointmentId);
    return db.runTransaction(async (transaction) => {
      const [originalSnapshot, followUpSnapshot] = await Promise.all([
        transaction.get(originalRef),
        transaction.get(followUpRef),
      ]);
      const original = activeAppointment(originalSnapshot, originalAppointmentId);
      const followUp = activeAppointment(followUpSnapshot, followUpAppointmentId);
      const outcome = requirePartialOutcome(original);
      if (Number(outcome.revision || 0) !== Number(revision)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The partial-completion record changed before remaining work could be linked.",
          { originalAppointmentId, followUpAppointmentId },
        );
      }
      const alreadyLinked = cleanText(outcome.followUpAppointmentId, 180);
      if (alreadyLinked && alreadyLinked !== followUpAppointmentId) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          "Remaining work is already linked to another follow-up appointment.",
          { originalAppointmentId, followUpAppointmentId: alreadyLinked },
        );
      }
      const actorInfo = actorFields(actor);
      const nextOutcome = {
        ...outcome,
        remainingWorkStatus: "scheduled",
        followUpAppointmentId,
        followUpScheduledAtIso: now.toISOString(),
        followUpScheduledById: actorInfo.actorId,
        followUpScheduledByName: actorInfo.actorName,
        followUpScheduleRequestId: cleanText(requestId, 240),
      };
      const event = lifecycleEvent({
        kind: "remaining_work_scheduled",
        actor,
        reason: "Remaining work scheduled",
        note: `Follow-up appointment ${followUpAppointmentId}`,
        now,
        from: scheduleSnapshot(original),
        to: scheduleSnapshot(original),
        details: { followUpAppointmentId, remainingQuantity: Number(outcome.remainingQuantity || 0) },
      });
      transaction.set(originalRef, compactObject({
        executionOutcome: nextOutcome,
        lifecycleHistory: [...(Array.isArray(original.lifecycleHistory) ? original.lifecycleHistory : []), event],
        updatedAtIso: now.toISOString(),
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        updatedAt: serverTimestamp(),
      }), { merge: true });
      transaction.set(followUpRef, compactObject({
        sourcePartialAppointmentId: originalAppointmentId,
        sourcePartialOutcomeRevision: revision,
        workRelationship: "remaining_work_follow_up",
        updatedAtIso: cleanText(followUp.updatedAtIso, 80) || now.toISOString(),
        updatedAt: serverTimestamp(),
      }), { merge: true });
      for (const workOrderId of Array.isArray(followUp.workOrderIds) ? followUp.workOrderIds : []) {
        transaction.set(db.collection("workOrders").doc(workOrderId), {
          sourcePartialAppointmentId: originalAppointmentId,
          sourcePartialOutcomeRevision: revision,
          workRelationship: "remaining_work_follow_up",
          updatedAt: now.toISOString(),
        }, { merge: true });
      }
      return { original, followUp, nextOutcome };
    });
  }

  async function scheduleRemainingWork({
    appointmentId,
    requestId,
    offerId,
    offerVersion,
    optionId,
    actor = {},
  } = {}) {
    const id = cleanText(appointmentId, 180);
    const stableRequestId = cleanText(requestId, 240);
    const canonicalOfferId = cleanText(offerId, 180);
    const canonicalOptionId = cleanText(optionId, 180);
    if (!id || stableRequestId.length < 8 || !canonicalOfferId || !canonicalOptionId || !Number.isFinite(Number(offerVersion))) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Appointment, request id, offer, offer version, and option are required to schedule remaining work.",
        { reason: "invalid-remaining-work-schedule-input" },
      );
    }

    const original = await bookingAuthority.getAppointment(id);
    const outcome = requirePartialOutcome(original);
    if (Number(outcome.remainingQuantity || 0) < 1 || !Array.isArray(outcome.remainingWorkLines) || !outcome.remainingWorkLines.length) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "This appointment has no remaining work to schedule.",
        { appointmentId: id },
      );
    }
    if (cleanText(outcome.remainingWorkStatus, 80) === "scheduled" && cleanText(outcome.followUpAppointmentId, 180)) {
      const followUp = await bookingAuthority.getAppointment(outcome.followUpAppointmentId);
      return {
        success: true,
        replayed: true,
        originalAppointmentId: id,
        followUpAppointmentId: outcome.followUpAppointmentId,
        followUpAppointment: followUp,
      };
    }

    const revision = Math.max(1, Math.round(Number(outcome.revision) || 1));
    const stableIdempotencyKey = `office:partial-followup:${id}:v${revision}`;
    const expectedIdentity = canonicalAppointmentIdentity(stableIdempotencyKey);
    const expectedSnapshot = await db.collection("appointments").doc(expectedIdentity.appointmentId).get();
    if (expectedSnapshot.exists) {
      const linked = await linkFollowUp({
        originalAppointmentId: id,
        followUpAppointmentId: expectedIdentity.appointmentId,
        revision,
        actor,
        requestId: stableRequestId,
      });
      return {
        success: true,
        replayed: true,
        originalAppointmentId: id,
        followUpAppointmentId: expectedIdentity.appointmentId,
        followUpAppointment: linked.followUp,
      };
    }

    const offerSnapshot = await db.collection("bookingOffers").doc(canonicalOfferId).get();
    if (!offerSnapshot.exists) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The selected Booking Authority offer no longer exists.",
        { offerId: canonicalOfferId },
      );
    }
    const offer = offerSnapshot.data() || {};
    const request = normalizeBookingRequest(offer.request || {});
    if (
      request.customerId !== cleanText(original.customerId, 160)
      || request.propertyId !== cleanText(original.propertyId, 160)
      || !sameWorkLines(request.workLines, outcome.remainingWorkLines)
    ) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The selected offer does not match this appointment's canonical remaining work.",
        { appointmentId: id, offerId: canonicalOfferId, reason: "remaining-work-offer-mismatch" },
      );
    }

    const created = await bookingAuthority.createAppointment({
      offerId: canonicalOfferId,
      offerVersion: Number(offerVersion),
      optionId: canonicalOptionId,
      idempotencyKey: stableIdempotencyKey,
      actor,
      context: {
        channel: "office",
        officeRequestId: stableRequestId,
        sourcePartialAppointmentId: id,
        sourcePartialOutcomeRevision: revision,
      },
    });
    if (!created?.success || !cleanText(created.appointmentId, 180)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
        "Booking Authority did not return a verified follow-up appointment.",
        { appointmentId: id },
      );
    }
    await linkFollowUp({
      originalAppointmentId: id,
      followUpAppointmentId: created.appointmentId,
      revision,
      actor,
      requestId: stableRequestId,
    });
    return {
      success: true,
      replayed: created.replayed === true,
      originalAppointmentId: id,
      followUpAppointmentId: created.appointmentId,
      followUpAppointment: created.appointment,
      workOrderIds: created.workOrderIds || [],
    };
  }

  return {
    version: PARTIAL_COMPLETION_VERSION,
    recordPartialCompletion,
    scheduleRemainingWork,
  };
}

module.exports = {
  PARTIAL_COMPLETION_VERSION,
  arubaDateKey,
  createPartialCompletionAuthority,
  normalizedWorkLines,
  sameWorkLines,
  timeToMinutes,
  validTime,
};
