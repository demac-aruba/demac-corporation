const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
  normalizeBookingRequest,
  normalizeOfferOption,
  validateOfferSelection,
} = require("./bookingAuthorityCore");
const {
  BOOKING_COLLECTIONS,
  assertCustomerPropertyRelationship,
  compactObject,
  validateCapacityLocks,
  validateWorkOrders,
} = require("./bookingAuthorityFirestore");

const APPOINTMENT_LIFECYCLE_VERSION = 2;
const RESCHEDULE_CHANGE_KINDS = new Set(["customer_reschedule", "operational_move"]);

function defaultServerTimestamp() {
  const { FieldValue } = require("firebase-admin/firestore");
  return FieldValue.serverTimestamp();
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function actorFields(actor = {}) {
  return {
    actorId: cleanText(actor.id || actor.userId, 160),
    actorName: cleanText(actor.name || actor.displayName, 160),
    source: cleanText(actor.source, 80) || "booking-authority-lifecycle",
  };
}

function requireReason(value, operation) {
  const reason = cleanText(value, 500);
  if (!reason) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      `${operation} requires a reason.`,
      { field: "reason" },
    );
  }
  return reason;
}

function normalizeChangeKind(value) {
  const candidate = cleanText(value, 80);
  return RESCHEDULE_CHANGE_KINDS.has(candidate) ? candidate : "customer_reschedule";
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

function scheduleSnapshot(appointment = {}) {
  const assignments = Array.isArray(appointment.assignments) ? appointment.assignments : [];
  const primary = assignments[0] || {};
  const support = assignments[1] || null;
  return compactObject({
    dateKey: cleanText(appointment.date, 20),
    primaryVanId: cleanText(primary.vanId || appointment.primaryVanId, 120),
    primaryStart: cleanText(primary.time || appointment.startTime, 20),
    primaryEnd: cleanText(appointment.endTime, 20),
    supportVanId: cleanText(support?.vanId, 120),
    supportStart: cleanText(support?.time, 20),
  });
}

function historyEvent({ kind, actor, reason, note, now, from, to, customerNotificationRecommended }) {
  const actorInfo = actorFields(actor);
  return compactObject({
    id: `LIFE-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    at: now.toISOString(),
    actorId: actorInfo.actorId,
    actorName: actorInfo.actorName,
    reason,
    note: cleanText(note, 1_500),
    from,
    to,
    customerNotificationRecommended: customerNotificationRecommended === true,
  });
}

function scheduleChangeNeedsCustomerFollowUp(kind, from = {}, to = {}) {
  if (kind === "customer_reschedule") return true;
  return cleanText(from.dateKey, 20) !== cleanText(to.dateKey, 20)
    || cleanText(from.primaryStart, 20) !== cleanText(to.primaryStart, 20);
}

function createBookingAppointmentLifecycle({
  db,
  schedulingProvider,
  clock = () => new Date(),
  serverTimestamp = defaultServerTimestamp,
  collections = BOOKING_COLLECTIONS,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }
  if (!schedulingProvider) throw new Error("A schedulingProvider is required.");

  async function cancelAppointment({ appointmentId, reason, note = "", actor = {} } = {}) {
    const id = cleanText(appointmentId, 180);
    if (!id) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "appointmentId is required.", { field: "appointmentId" });
    }
    const cancellationReason = requireReason(reason, "Cancellation");
    const now = asDate(clock());
    const appointmentRef = db.collection(collections.appointments).doc(id);

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(appointmentRef);
      const appointment = activeAppointment(snapshot, id);
      if (["cancelled", "canceled", "cancelada"].includes(cleanText(appointment.status, 40).toLowerCase())) {
        return { success: true, replayed: true, appointmentId: id, appointment };
      }

      const actorInfo = actorFields(actor);
      const event = historyEvent({
        kind: "cancelled",
        actor,
        reason: cancellationReason,
        note,
        now,
        from: scheduleSnapshot(appointment),
        customerNotificationRecommended: false,
      });
      const lifecycleHistory = [...(Array.isArray(appointment.lifecycleHistory) ? appointment.lifecycleHistory : []), event];
      const patch = compactObject({
        status: "cancelled",
        cancellationReason,
        cancellationNote: cleanText(note, 1_500),
        cancelledAtIso: now.toISOString(),
        updatedAtIso: now.toISOString(),
        lifecycleHistory,
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        updatedAt: serverTimestamp(),
      });
      transaction.set(appointmentRef, patch, { merge: true });

      for (const workOrderId of Array.isArray(appointment.workOrderIds) ? appointment.workOrderIds : []) {
        transaction.set(db.collection(collections.workOrders).doc(workOrderId), compactObject({
          status: "Cancelada",
          cancellationReason,
          cancellationNote: cleanText(note, 1_500),
          cancelledAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }), { merge: true });
      }
      for (const lockId of Array.isArray(appointment.capacityLockIds) ? appointment.capacityLockIds : []) {
        transaction.set(db.collection(collections.capacityLocks).doc(lockId), compactObject({
          active: false,
          releasedAtIso: now.toISOString(),
          updatedAtIso: now.toISOString(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      }

      return { success: true, replayed: false, appointmentId: id, appointment: { ...appointment, ...patch } };
    });
  }

  async function rescheduleAppointment({
    appointmentId,
    offerId,
    offerVersion,
    optionId,
    reason,
    note = "",
    actor = {},
    changeKind = "customer_reschedule",
    context = {},
  } = {}) {
    const id = cleanText(appointmentId, 180);
    const canonicalOfferId = cleanText(offerId, 180);
    if (!id || !canonicalOfferId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "appointmentId and offerId are required.",
        { appointmentId: id, offerId: canonicalOfferId },
      );
    }
    const normalizedChangeKind = normalizeChangeKind(changeKind);
    const rescheduleReason = requireReason(reason, normalizedChangeKind === "operational_move" ? "Operational move" : "Reschedule");
    const now = asDate(clock());
    const appointmentRef = db.collection(collections.appointments).doc(id);
    const offerRef = db.collection(collections.offers).doc(canonicalOfferId);

    const [appointmentSnapshot, offerSnapshot] = await Promise.all([appointmentRef.get(), offerRef.get()]);
    const existing = activeAppointment(appointmentSnapshot, id);
    if (["cancelled", "canceled", "cancelada"].includes(cleanText(existing.status, 40).toLowerCase())) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A cancelled appointment cannot be rescheduled.", { appointmentId: id });
    }
    const offer = offerSnapshot.exists ? { id: offerSnapshot.id, ...offerSnapshot.data() } : null;
    const selected = validateOfferSelection({ offer, offerVersion, optionId, now });
    const request = normalizeBookingRequest(offer.request);
    if (request.customerId !== cleanText(existing.customerId, 160) || request.propertyId !== cleanText(existing.propertyId, 160)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The reschedule offer does not belong to this appointment customer/property.",
        { appointmentId: id },
      );
    }

    let revalidation;
    try {
      revalidation = await schedulingProvider.revalidateSelection({ request, offer, option: selected, context, now });
    } catch (error) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
        "Booking availability provider failed while revalidating the reschedule.",
        { cause: cleanText(error?.message || error, 500) },
      );
    }
    if (!revalidation || revalidation.available !== true || !revalidation.option) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
        "The selected reschedule option is no longer available.",
        { reason: cleanText(revalidation?.reason, 240) },
      );
    }
    const refreshedOption = normalizeOfferOption(revalidation.option);

    return db.runTransaction(async (transaction) => {
      const [currentAppointmentSnapshot, currentOfferSnapshot] = await Promise.all([
        transaction.get(appointmentRef),
        transaction.get(offerRef),
      ]);
      const current = activeAppointment(currentAppointmentSnapshot, id);
      if (["cancelled", "canceled", "cancelada"].includes(cleanText(current.status, 40).toLowerCase())) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A cancelled appointment cannot be rescheduled.", { appointmentId: id });
      }
      const currentOffer = currentOfferSnapshot.exists ? { id: currentOfferSnapshot.id, ...currentOfferSnapshot.data() } : null;
      validateOfferSelection({ offer: currentOffer, offerVersion, optionId, now });
      const currentRequest = normalizeBookingRequest(currentOffer.request);
      if (currentRequest.customerId !== cleanText(current.customerId, 160) || currentRequest.propertyId !== cleanText(current.propertyId, 160)) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The current reschedule offer no longer matches the appointment.", { appointmentId: id });
      }

      const customerRef = db.collection(collections.clients).doc(currentRequest.customerId);
      const propertyRef = db.collection(collections.properties).doc(currentRequest.propertyId);
      const [customerSnapshot, propertySnapshot] = await Promise.all([
        transaction.get(customerRef),
        transaction.get(propertyRef),
      ]);
      const { customer, property } = assertCustomerPropertyRelationship({ customerSnapshot, propertySnapshot, request: currentRequest });

      const validation = await schedulingProvider.validateTransaction({
        transaction,
        db,
        request: currentRequest,
        offer: currentOffer,
        option: refreshedOption,
        appointmentId: id,
        context: { ...context, excludeAppointmentId: id },
        now,
      });
      if (!validation || validation.available !== true) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected reschedule capacity was occupied before it could be committed.",
          { reason: cleanText(validation?.reason, 240) },
        );
      }

      const newLocks = validateCapacityLocks(validation.capacityLocks);
      const newLockIds = new Set(newLocks.map((lock) => lock.id));
      const lockSnapshots = [];
      for (const lock of newLocks) {
        const lockRef = db.collection(collections.capacityLocks).doc(lock.id);
        lockSnapshots.push({ lock, lockRef, snapshot: await transaction.get(lockRef) });
      }
      for (const entry of lockSnapshots) {
        if (!entry.snapshot.exists) continue;
        const stored = entry.snapshot.data();
        if (stored.active !== false && stored.appointmentId !== id) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.SLOT_CONFLICT,
            "The selected reschedule capacity was occupied concurrently.",
            { date: entry.lock.date, vanId: entry.lock.vanId, slot: entry.lock.slot },
          );
        }
      }

      const workOrders = validateWorkOrders(await schedulingProvider.buildWorkOrders({
        appointment: { ...current, appointmentId: id, id },
        option: refreshedOption,
        request: currentRequest,
        customer,
        property,
        actor,
        context: { ...context, reschedule: true, changeKind: normalizedChangeKind },
        now,
      }), id);
      const workOrderIds = workOrders.map((item) => item.id);
      const newWorkOrderIds = new Set(workOrderIds);
      const oldWorkOrderIds = Array.isArray(current.workOrderIds) ? current.workOrderIds : [];
      const oldLockIds = Array.isArray(current.capacityLockIds) ? current.capacityLockIds : [];
      const actorInfo = actorFields(actor);
      const previousSchedule = scheduleSnapshot(current);
      const nextSchedule = {
        dateKey: refreshedOption.date,
        primaryVanId: cleanText(refreshedOption.assignments?.[0]?.vanId, 120),
        primaryStart: cleanText(refreshedOption.assignments?.[0]?.time || refreshedOption.time, 20),
        primaryEnd: cleanText(refreshedOption.endTime, 20),
        supportVanId: cleanText(refreshedOption.assignments?.[1]?.vanId, 120),
        supportStart: cleanText(refreshedOption.assignments?.[1]?.time, 20),
      };
      const customerNotificationRecommended = scheduleChangeNeedsCustomerFollowUp(normalizedChangeKind, previousSchedule, nextSchedule);
      const event = historyEvent({
        kind: normalizedChangeKind,
        actor,
        reason: rescheduleReason,
        note,
        now,
        from: previousSchedule,
        to: nextSchedule,
        customerNotificationRecommended,
      });
      const lifecycleHistory = [...(Array.isArray(current.lifecycleHistory) ? current.lifecycleHistory : []), event];

      transaction.set(appointmentRef, compactObject({
        status: "confirmed",
        offerId: canonicalOfferId,
        offerVersion: Number(offerVersion),
        selectedOptionId: cleanText(optionId, 180),
        date: refreshedOption.date,
        startTime: refreshedOption.time,
        endTime: refreshedOption.endTime,
        workLines: currentRequest.workLines,
        constraints: currentRequest.constraints,
        notes: currentRequest.notes,
        assignments: refreshedOption.assignments,
        primaryVanId: cleanText(refreshedOption.assignments?.[0]?.vanId, 120),
        workOrderIds,
        capacityLockIds: newLocks.map((lock) => lock.id),
        rescheduleReason,
        rescheduleNote: cleanText(note, 1_500),
        lastScheduleChangeKind: normalizedChangeKind,
        customerNotificationRecommended,
        rescheduledAtIso: now.toISOString(),
        updatedAtIso: now.toISOString(),
        lifecycleHistory,
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        updatedAt: serverTimestamp(),
      }), { merge: true });

      for (const workOrder of workOrders) {
        transaction.set(db.collection(collections.workOrders).doc(workOrder.id), compactObject({
          ...workOrder,
          status: "Confirmada",
          bookingOfferId: canonicalOfferId,
          updatedAt: now.toISOString(),
        }));
      }
      for (const oldWorkOrderId of oldWorkOrderIds) {
        if (newWorkOrderIds.has(oldWorkOrderId)) continue;
        transaction.set(db.collection(collections.workOrders).doc(oldWorkOrderId), compactObject({
          status: "Cancelada",
          replacedByReschedule: true,
          updatedAt: now.toISOString(),
        }), { merge: true });
      }
      for (const oldLockId of oldLockIds) {
        if (newLockIds.has(oldLockId)) continue;
        transaction.set(db.collection(collections.capacityLocks).doc(oldLockId), compactObject({
          active: false,
          releasedAtIso: now.toISOString(),
          updatedAtIso: now.toISOString(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      }
      for (const { lock, lockRef } of lockSnapshots) {
        transaction.set(lockRef, compactObject({
          ...lock,
          appointmentId: id,
          active: true,
          updatedAtIso: now.toISOString(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      }
      transaction.set(offerRef, compactObject({
        status: "booked",
        selectedOptionId: cleanText(optionId, 180),
        appointmentId: id,
        workOrderIds,
        bookedAtIso: now.toISOString(),
        updatedAtIso: now.toISOString(),
        bookedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }), { merge: true });

      return {
        success: true,
        appointmentId: id,
        changeKind: normalizedChangeKind,
        customerNotificationRecommended,
        appointment: {
          ...current,
          status: "confirmed",
          date: refreshedOption.date,
          startTime: refreshedOption.time,
          endTime: refreshedOption.endTime,
          assignments: refreshedOption.assignments,
          primaryVanId: cleanText(refreshedOption.assignments?.[0]?.vanId, 120),
          workOrderIds,
          capacityLockIds: newLocks.map((lock) => lock.id),
          lifecycleHistory,
        },
        workOrderIds,
      };
    });
  }

  return {
    version: APPOINTMENT_LIFECYCLE_VERSION,
    cancelAppointment,
    rescheduleAppointment,
  };
}

module.exports = {
  APPOINTMENT_LIFECYCLE_VERSION,
  createBookingAppointmentLifecycle,
  normalizeChangeKind,
  scheduleChangeNeedsCustomerFollowUp,
};
