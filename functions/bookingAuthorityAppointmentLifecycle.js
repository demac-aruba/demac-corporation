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
const { createBookingDispatchSafetyAuthority } = require("./bookingAuthorityDispatchSafety");

const APPOINTMENT_LIFECYCLE_VERSION = 7;
const RESCHEDULE_CHANGE_KINDS = new Set(["customer_reschedule", "operational_move", "details_edited"]);

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

function changeOperationLabel(kind) {
  if (kind === "operational_move") return "Operational move";
  if (kind === "details_edited") return "Appointment edit";
  return "Reschedule";
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
  if (kind === "details_edited") return false;
  if (kind === "customer_reschedule") return true;
  return cleanText(from.dateKey, 20) !== cleanText(to.dateKey, 20)
    || cleanText(from.primaryStart, 20) !== cleanText(to.primaryStart, 20);
}

function appointmentStillOwnsLock(appointment, lockId) {
  if (!appointment) return false;
  const status = cleanText(appointment.status, 40).toLowerCase();
  if (["cancelled", "canceled", "cancelada"].includes(status)) return false;
  return Array.isArray(appointment.capacityLockIds) && appointment.capacityLockIds.includes(lockId);
}

function assertDetailsEditKeepsPlacement(current, refreshedOption) {
  const currentSchedule = scheduleSnapshot(current);
  const nextPrimary = refreshedOption.assignments?.find((item) => cleanText(item?.role, 40) !== "support")
    || refreshedOption.assignments?.[0]
    || {};
  const nextDate = cleanText(refreshedOption.date, 20);
  const nextStart = cleanText(nextPrimary.time || refreshedOption.time, 20);
  const nextVanId = cleanText(nextPrimary.vanId, 120);
  if (
    nextDate !== cleanText(currentSchedule.dateKey, 20)
    || nextStart !== cleanText(currentSchedule.primaryStart, 20)
    || nextVanId !== cleanText(currentSchedule.primaryVanId, 120)
  ) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
      "Edit appointment may change work details and required capacity, but not its date, start time, or primary van. Use Reschedule or Move for schedule changes.",
      { reason: "details-edit-placement-changed" },
    );
  }
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
  const dispatchSafety = createBookingDispatchSafetyAuthority({ db, clock, collections });

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

      const dispatchResolution = await dispatchSafety.releaseDispatchHoldInTransaction(transaction, {
        appointmentRef,
        appointment,
        appointmentId: id,
        resolution: "booking_cancelled",
        actor: { ...actor, source: actor.source || "booking-authority-lifecycle" },
        now,
        projectWorkOrders: false,
      });
      const finalAppointment = {
        ...appointment,
        ...patch,
        dispatchHold: dispatchResolution.dispatchHold || appointment.dispatchHold,
      };
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
      dispatchSafety.writeWorkOrderDispatchProjectionInTransaction(transaction, {
        appointmentId: id,
        appointment: finalAppointment,
        workOrderIds: appointment.workOrderIds,
        now,
      });
      for (const lockId of Array.isArray(appointment.capacityLockIds) ? appointment.capacityLockIds : []) {
        transaction.set(db.collection(collections.capacityLocks).doc(lockId), compactObject({
          active: false,
          releasedAtIso: now.toISOString(),
          updatedAtIso: now.toISOString(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      }

      return { success: true, replayed: false, appointmentId: id, appointment: finalAppointment };
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
    const lifecycleReason = requireReason(reason, changeOperationLabel(normalizedChangeKind));
    const now = asDate(clock());
    const appointmentRef = db.collection(collections.appointments).doc(id);
    const offerRef = db.collection(collections.offers).doc(canonicalOfferId);

    const [appointmentSnapshot, offerSnapshot] = await Promise.all([appointmentRef.get(), offerRef.get()]);
    const existing = activeAppointment(appointmentSnapshot, id);
    if (["cancelled", "canceled", "cancelada"].includes(cleanText(existing.status, 40).toLowerCase())) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A cancelled appointment cannot be changed.", { appointmentId: id });
    }
    const offer = offerSnapshot.exists ? { id: offerSnapshot.id, ...offerSnapshot.data() } : null;
    const selected = validateOfferSelection({ offer, offerVersion, optionId, now });
    const request = normalizeBookingRequest(offer.request);
    if (request.customerId !== cleanText(existing.customerId, 160) || request.propertyId !== cleanText(existing.propertyId, 160)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "The lifecycle offer does not belong to this appointment customer/property.",
        { appointmentId: id },
      );
    }

    let refreshedOption;
    if (normalizedChangeKind === "operational_move") {
      refreshedOption = normalizeOfferOption(selected);
    } else {
      let revalidation;
      try {
        revalidation = await schedulingProvider.revalidateSelection({ request, offer, option: selected, context, now });
      } catch (error) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
          "Booking availability provider failed while revalidating the appointment change.",
          { cause: cleanText(error?.message || error, 500) },
        );
      }
      if (!revalidation || revalidation.available !== true || !revalidation.option) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The selected appointment option is no longer available.",
          { reason: cleanText(revalidation?.reason, 240) },
        );
      }
      refreshedOption = normalizeOfferOption(revalidation.option);
    }
    if (normalizedChangeKind === "details_edited") assertDetailsEditKeepsPlacement(existing, refreshedOption);

    return db.runTransaction(async (transaction) => {
      const [currentAppointmentSnapshot, currentOfferSnapshot] = await Promise.all([
        transaction.get(appointmentRef),
        transaction.get(offerRef),
      ]);
      const current = activeAppointment(currentAppointmentSnapshot, id);
      if (["cancelled", "canceled", "cancelada"].includes(cleanText(current.status, 40).toLowerCase())) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A cancelled appointment cannot be changed.", { appointmentId: id });
      }
      const currentOffer = currentOfferSnapshot.exists ? { id: currentOfferSnapshot.id, ...currentOfferSnapshot.data() } : null;
      validateOfferSelection({ offer: currentOffer, offerVersion, optionId, now });
      const currentRequest = normalizeBookingRequest(currentOffer.request);
      if (currentRequest.customerId !== cleanText(current.customerId, 160) || currentRequest.propertyId !== cleanText(current.propertyId, 160)) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The current lifecycle offer no longer matches the appointment.", { appointmentId: id });
      }
      if (normalizedChangeKind === "operational_move") {
        if (cleanText(current.date, 20) !== cleanText(refreshedOption.date, 20)) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
            "The appointment date changed before the operational move could be committed.",
            { reason: "operational-move-date-mismatch" },
          );
        }
        if (!Array.isArray(refreshedOption.assignments) || refreshedOption.assignments.length !== 1) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
            "A simple operational drag must resolve to exactly one van assignment.",
            { reason: "multi-van-booking-requires-reschedule" },
          );
        }
      }
      if (normalizedChangeKind === "details_edited") assertDetailsEditKeepsPlacement(current, refreshedOption);

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
          "The selected appointment capacity was occupied before the change could be committed.",
          { reason: cleanText(validation?.reason, 240) },
        );
      }

      const newLocks = validateCapacityLocks(validation.capacityLocks);
      const newLockIds = new Set(newLocks.map((lock) => lock.id));
      const lockSnapshots = await Promise.all(newLocks.map(async (lock) => {
        const lockRef = db.collection(collections.capacityLocks).doc(lock.id);
        return { lock, lockRef, snapshot: await transaction.get(lockRef) };
      }));
      const foreignActiveLocks = lockSnapshots.filter((entry) => {
        if (!entry.snapshot.exists) return false;
        const stored = entry.snapshot.data() || {};
        return stored.active !== false && cleanText(stored.appointmentId, 180) !== id;
      });
      if (foreignActiveLocks.length) {
        const ownerIds = [...new Set(foreignActiveLocks
          .map((entry) => cleanText(entry.snapshot.data()?.appointmentId, 180))
          .filter(Boolean))];
        const ownerSnapshots = await Promise.all(ownerIds.map(async (ownerId) => ({
          ownerId,
          snapshot: await transaction.get(db.collection(collections.appointments).doc(ownerId)),
        })));
        const owners = new Map(ownerSnapshots.map(({ ownerId, snapshot }) => [
          ownerId,
          snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null,
        ]));

        for (const entry of foreignActiveLocks) {
          const stored = entry.snapshot.data() || {};
          const ownerId = cleanText(stored.appointmentId, 180);
          if (!appointmentStillOwnsLock(owners.get(ownerId), entry.lock.id)) continue;
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.SLOT_CONFLICT,
            "The selected appointment capacity is owned by another active appointment.",
            { date: entry.lock.date, vanId: entry.lock.vanId, slot: entry.lock.slot, appointmentId: ownerId },
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
        context: { ...context, reschedule: normalizedChangeKind !== "details_edited", detailsEdit: normalizedChangeKind === "details_edited", changeKind: normalizedChangeKind },
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
        reason: lifecycleReason,
        note,
        now,
        from: previousSchedule,
        to: nextSchedule,
        customerNotificationRecommended,
      });
      const lifecycleHistory = [...(Array.isArray(current.lifecycleHistory) ? current.lifecycleHistory : []), event];
      const lifecycleMetadata = normalizedChangeKind === "details_edited"
        ? {
          detailsEditReason: lifecycleReason,
          detailsEditNote: cleanText(note, 1_500),
          detailsEditedAtIso: now.toISOString(),
        }
        : {
          rescheduleReason: lifecycleReason,
          rescheduleNote: cleanText(note, 1_500),
          rescheduledAtIso: now.toISOString(),
        };

      const dispatchResolution = normalizedChangeKind === "details_edited"
        ? { dispatchHold: current.dispatchHold }
        : await dispatchSafety.releaseDispatchHoldInTransaction(transaction, {
          appointmentRef,
          appointment: current,
          appointmentId: id,
          resolution: normalizedChangeKind === "operational_move" ? "booking_operational_move" : "booking_rescheduled",
          actor: { ...actor, source: actor.source || "booking-authority-lifecycle" },
          now,
          projectWorkOrders: false,
        });
      const finalAppointment = {
        ...current,
        status: "confirmed",
        offerId: canonicalOfferId,
        offerVersion: Number(offerVersion),
        selectedOptionId: cleanText(optionId, 180),
        date: refreshedOption.date,
        startTime: refreshedOption.time,
        endTime: refreshedOption.endTime,
        workLines: currentRequest.workLines,
        workItems: refreshedOption.workItems,
        constraints: currentRequest.constraints,
        notes: currentRequest.notes,
        assignments: refreshedOption.assignments,
        primaryVanId: cleanText(refreshedOption.assignments?.[0]?.vanId, 120),
        workOrderIds,
        capacityLockIds: newLocks.map((lock) => lock.id),
        ...lifecycleMetadata,
        lastScheduleChangeKind: normalizedChangeKind,
        customerNotificationRecommended,
        updatedAtIso: now.toISOString(),
        lifecycleHistory,
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        dispatchHold: dispatchResolution.dispatchHold || current.dispatchHold,
      };

      transaction.set(appointmentRef, compactObject({
        status: finalAppointment.status,
        offerId: finalAppointment.offerId,
        offerVersion: finalAppointment.offerVersion,
        selectedOptionId: finalAppointment.selectedOptionId,
        date: finalAppointment.date,
        startTime: finalAppointment.startTime,
        endTime: finalAppointment.endTime,
        workLines: finalAppointment.workLines,
        workItems: finalAppointment.workItems,
        constraints: finalAppointment.constraints,
        notes: finalAppointment.notes,
        assignments: finalAppointment.assignments,
        primaryVanId: finalAppointment.primaryVanId,
        workOrderIds: finalAppointment.workOrderIds,
        capacityLockIds: finalAppointment.capacityLockIds,
        ...lifecycleMetadata,
        lastScheduleChangeKind: finalAppointment.lastScheduleChangeKind,
        customerNotificationRecommended,
        updatedAtIso: now.toISOString(),
        lifecycleHistory,
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        updatedAt: serverTimestamp(),
      }), { merge: true });

      // Lifecycle changes update Scheduling-owned fields on the same Work Order IDs.
      // Merge the projection instead of replacing the document so communication
      // delivery history, recipient policy, invoice/report state and other domains
      // that Scheduling does not own cannot be erased by an edit or reschedule.
      for (const workOrder of workOrders) {
        transaction.set(db.collection(collections.workOrders).doc(workOrder.id), compactObject({
          ...workOrder,
          status: "Confirmada",
          bookingOfferId: canonicalOfferId,
          updatedAt: now.toISOString(),
        }), { merge: true });
      }
      dispatchSafety.writeWorkOrderDispatchProjectionInTransaction(transaction, {
        appointmentId: id,
        appointment: finalAppointment,
        workOrderIds,
        now,
      });
      const replacedWorkOrderIds = oldWorkOrderIds.filter((oldWorkOrderId) => !newWorkOrderIds.has(oldWorkOrderId));
      for (const oldWorkOrderId of replacedWorkOrderIds) {
        transaction.set(db.collection(collections.workOrders).doc(oldWorkOrderId), compactObject({
          status: "Cancelada",
          replacedByReschedule: normalizedChangeKind !== "details_edited",
          replacedByDetailsEdit: normalizedChangeKind === "details_edited",
          updatedAt: now.toISOString(),
        }), { merge: true });
      }
      if (replacedWorkOrderIds.length) {
        dispatchSafety.writeWorkOrderDispatchProjectionInTransaction(transaction, {
          appointmentId: id,
          appointment: { ...finalAppointment, status: "cancelled", dispatchHold: { ...(finalAppointment.dispatchHold || {}), active: false } },
          workOrderIds: replacedWorkOrderIds,
          now,
        });
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
        appointment: finalAppointment,
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
  appointmentStillOwnsLock,
  assertDetailsEditKeepsPlacement,
  createBookingAppointmentLifecycle,
  normalizeChangeKind,
  scheduleChangeNeedsCustomerFollowUp,
};
