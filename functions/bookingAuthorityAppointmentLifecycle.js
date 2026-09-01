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
  BOOKING_CREATE_MODES,
  assertCustomerPropertyRelationship,
  compactObject,
  notificationRecipientsFrom,
  validateCapacityLocks,
  validateWorkOrders,
} = require("./bookingAuthorityFirestore");
const { workOrderStatusIsTerminal } = require("./bookingSchedulingPrimitives");

const APPOINTMENT_LIFECYCLE_VERSION = 8;
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

function isTemporaryHoldAppointment(appointment) {
  return cleanText(appointment?.status, 40).toLowerCase() === BOOKING_CREATE_MODES.TEMPORARY_HOLD;
}

function primaryAssignment(value = {}) {
  const assignments = Array.isArray(value.assignments) ? value.assignments : [];
  return assignments.find((item) => cleanText(item?.role, 40) !== "support")
    || assignments[0]
    || {};
}

function supportAssignment(value = {}) {
  const assignments = Array.isArray(value.assignments) ? value.assignments : [];
  const primary = primaryAssignment(value);
  return assignments.find((item) => item !== primary && cleanText(item?.role, 40) === "support")
    || assignments.find((item) => item !== primary)
    || null;
}

function capacityEndTime(value = {}) {
  const primary = primaryAssignment(value);
  return cleanText(
    value.capacityEndTime || primary.capacityEndTime || value.endTime,
    20,
  );
}

function scheduleSnapshot(appointment = {}) {
  const primary = primaryAssignment(appointment);
  const support = supportAssignment(appointment);
  return compactObject({
    dateKey: cleanText(appointment.date, 20),
    primaryVanId: cleanText(primary.vanId || appointment.primaryVanId, 120),
    primaryStart: cleanText(primary.time || appointment.startTime, 20),
    primaryEnd: cleanText(appointment.endTime, 20),
    primaryCapacityEnd: capacityEndTime(appointment),
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

function holdRequestFromAppointment(appointment) {
  return normalizeBookingRequest({
    customerId: appointment.customerId,
    propertyId: appointment.propertyId,
    workLines: appointment.workLines,
    constraints: appointment.constraints,
    notes: appointment.notes,
  });
}

function holdOptionFromAppointment(appointment) {
  return normalizeOfferOption({
    id: cleanText(appointment.selectedOptionId, 180) || `hold-${cleanText(appointment.id || appointment.appointmentId, 120)}`,
    date: appointment.date,
    time: appointment.startTime,
    endTime: appointment.endTime,
    capacityEndTime: appointment.capacityEndTime,
    workItems: appointment.workItems,
    assignments: appointment.assignments,
    requestedDateMatch: true,
    requestedTimeMatch: true,
  });
}

function recipientNotificationsEnabled(recipients) {
  return recipients.some((recipient) =>
    (recipient?.sendConfirmation === true || recipient?.sendReminder === true)
    && cleanText(recipient?.whatsapp || recipient?.phone, 80));
}

function sameLockIds(left, right) {
  const leftSet = new Set((left || []).map((item) => cleanText(item, 180)).filter(Boolean));
  const rightSet = new Set((right || []).map((item) => cleanText(item, 180)).filter(Boolean));
  return leftSet.size === rightSet.size && [...leftSet].every((item) => rightSet.has(item));
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
    const appointmentRef = db.collection(collections.appointments).doc(id);

    return db.runTransaction(async (transaction) => {
      const transactionNow = asDate(clock());
      const snapshot = await transaction.get(appointmentRef);
      const appointment = activeAppointment(snapshot, id);
      if (["cancelled", "canceled", "cancelada"].includes(cleanText(appointment.status, 40).toLowerCase())) {
        return { success: true, replayed: true, appointmentId: id, appointment };
      }

      const workOrderIds = [...new Set((Array.isArray(appointment.workOrderIds) ? appointment.workOrderIds : [])
        .map((value) => cleanText(value, 180))
        .filter(Boolean))];
      const lockIds = [...new Set((Array.isArray(appointment.capacityLockIds) ? appointment.capacityLockIds : [])
        .map((value) => cleanText(value, 180))
        .filter(Boolean))];
      const [workOrderSnapshots, lockSnapshots] = await Promise.all([
        Promise.all(workOrderIds.map(async (workOrderId) => {
          const ref = db.collection(collections.workOrders).doc(workOrderId);
          return { workOrderId, ref, snapshot: await transaction.get(ref) };
        })),
        Promise.all(lockIds.map(async (lockId) => {
          const ref = db.collection(collections.capacityLocks).doc(lockId);
          return { lockId, ref, snapshot: await transaction.get(ref) };
        })),
      ]);
      const ownedWorkOrders = workOrderSnapshots.filter((entry) => entry.snapshot.exists
        && cleanText(entry.snapshot.data()?.appointmentId, 180) === id);
      if (ownedWorkOrders.some((entry) => workOrderStatusIsTerminal(entry.snapshot.data()?.status))) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "A terminal Work Order cannot be cancelled through Scheduling.",
          { appointmentId: id, reason: "terminal-work-order" },
        );
      }

      const actorInfo = actorFields(actor);
      const event = historyEvent({
        kind: "cancelled",
        actor,
        reason: cancellationReason,
        note,
        now: transactionNow,
        from: scheduleSnapshot(appointment),
        customerNotificationRecommended: false,
      });
      const lifecycleHistory = [...(Array.isArray(appointment.lifecycleHistory) ? appointment.lifecycleHistory : []), event];
      const patch = compactObject({
        status: "cancelled",
        cancellationReason,
        cancellationNote: cleanText(note, 1_500),
        cancelledAtIso: transactionNow.toISOString(),
        updatedAtIso: transactionNow.toISOString(),
        lifecycleHistory,
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        updatedAt: serverTimestamp(),
      });
      transaction.set(appointmentRef, patch, { merge: true });

      for (const entry of ownedWorkOrders) {
        transaction.set(entry.ref, compactObject({
          status: "Cancelada",
          cancellationReason,
          cancellationNote: cleanText(note, 1_500),
          cancelledAt: transactionNow.toISOString(),
          updatedAt: transactionNow.toISOString(),
        }), { merge: true });
      }
      for (const entry of lockSnapshots) {
        const stored = entry.snapshot.exists ? entry.snapshot.data() || {} : null;
        if (!stored || cleanText(stored.appointmentId, 180) !== id) continue;
        transaction.set(entry.ref, compactObject({
          active: false,
          releasedAtIso: transactionNow.toISOString(),
          updatedAtIso: transactionNow.toISOString(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      }

      return { success: true, replayed: false, appointmentId: id, appointment: { ...appointment, ...patch } };
    });
  }

  async function confirmTemporaryHold({ appointmentId, actor = {}, context = {} } = {}) {
    const id = cleanText(appointmentId, 180);
    if (!id) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "appointmentId is required.", { field: "appointmentId" });
    }
    const appointmentRef = db.collection(collections.appointments).doc(id);

    return db.runTransaction(async (transaction) => {
      const transactionNow = asDate(clock());
      const appointmentSnapshot = await transaction.get(appointmentRef);
      const current = activeAppointment(appointmentSnapshot, id);
      const currentStatus = cleanText(current.status, 40).toLowerCase();
      if (currentStatus === BOOKING_CREATE_MODES.CONFIRMED) {
        return { success: true, replayed: true, appointmentId: id, appointment: current };
      }
      if (!isTemporaryHoldAppointment(current)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Only a temporary hold can be confirmed through this transition.",
          { appointmentId: id, status: current.status || "" },
        );
      }

      const request = holdRequestFromAppointment(current);
      const option = holdOptionFromAppointment(current);
      const validation = await schedulingProvider.validateTransaction({
        transaction,
        db,
        request,
        offer: null,
        option,
        appointmentId: id,
        context: { ...context, excludeAppointmentId: id, changeKind: "hold_confirmed" },
        now: transactionNow,
      });
      if (!validation || validation.available !== true) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The temporary hold no longer maps to valid appointment capacity.",
          { reason: cleanText(validation?.reason, 240) },
        );
      }
      const committedOption = normalizeOfferOption(validation.option || option);
      const committedPrimary = primaryAssignment(committedOption);
      const expectedLocks = validateCapacityLocks(validation.capacityLocks);
      const expectedLockIds = expectedLocks.map((lock) => lock.id);
      const currentLockIds = Array.isArray(current.capacityLockIds) ? current.capacityLockIds : [];
      if (!sameLockIds(currentLockIds, expectedLockIds)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The temporary hold capacity changed before confirmation.",
          { reason: "temporary-hold-lock-set-changed" },
        );
      }

      for (const lockId of currentLockIds) {
        const lockSnapshot = await transaction.get(db.collection(collections.capacityLocks).doc(lockId));
        const lock = lockSnapshot.exists ? lockSnapshot.data() || {} : null;
        if (!lock || lock.active === false || cleanText(lock.appointmentId, 180) !== id) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.SLOT_CONFLICT,
            "The temporary hold no longer owns all reserved capacity.",
            { lockId, reason: "temporary-hold-lock-not-owned" },
          );
        }
      }

      const workOrderIds = Array.isArray(current.workOrderIds) ? current.workOrderIds.map((item) => cleanText(item, 180)).filter(Boolean) : [];
      if (!workOrderIds.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
          "The temporary hold has no canonical Work Orders.",
          { appointmentId: id },
        );
      }
      const workOrderSnapshots = await Promise.all(workOrderIds.map(async (workOrderId) => ({
        workOrderId,
        ref: db.collection(collections.workOrders).doc(workOrderId),
        snapshot: await transaction.get(db.collection(collections.workOrders).doc(workOrderId)),
      })));
      if (workOrderSnapshots.some((entry) => !entry.snapshot.exists)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_PROVIDER_ERROR,
          "The temporary hold is missing one or more canonical Work Orders.",
          { appointmentId: id },
        );
      }

      const recipients = notificationRecipientsFrom(current.notificationRecipients);
      const whatsappEnabled = recipientNotificationsEnabled(recipients);
      for (const entry of workOrderSnapshots) {
        const workOrder = entry.snapshot.data() || {};
        const isSupport = cleanText(workOrder.appointmentAssignmentRole || workOrder.assignmentRole, 40).toLowerCase() === "support";
        const role = isSupport ? "support" : "primary";
        const currentVanId = cleanText(workOrder.vanId, 120);
        const committedAssignment = committedOption.assignments.find((candidate) => (
          candidate.role === role && (!currentVanId || candidate.vanId === currentVanId)
        )) || committedOption.assignments.find((candidate) => candidate.role === role);
        transaction.set(entry.ref, compactObject({
          status: "Confirmada",
          vanId: committedAssignment?.vanId,
          technicianIds: committedAssignment?.technicianIds,
          driverStaffId: committedAssignment?.driverStaffId,
          helperStaffId: committedAssignment?.helperStaffId,
          notificationRecipients: isSupport ? [] : recipients,
          whatsappNotificationsEnabled: isSupport ? false : whatsappEnabled,
          confirmedAt: transactionNow.toISOString(),
          holdConfirmedAt: transactionNow.toISOString(),
          updatedAt: transactionNow.toISOString(),
        }), { merge: true });
      }

      const actorInfo = actorFields(actor);
      const event = historyEvent({
        kind: "hold_confirmed",
        actor,
        reason: "Temporary hold confirmed",
        now: transactionNow,
        from: scheduleSnapshot(current),
        to: scheduleSnapshot(current),
        customerNotificationRecommended: true,
      });
      const lifecycleHistory = [...(Array.isArray(current.lifecycleHistory) ? current.lifecycleHistory : []), event];
      const patch = compactObject({
        status: BOOKING_CREATE_MODES.CONFIRMED,
        assignments: committedOption.assignments,
        primaryVanId: committedPrimary.vanId,
        endTime: committedOption.endTime,
        capacityEndTime: capacityEndTime(committedOption),
        confirmedAtIso: transactionNow.toISOString(),
        holdConfirmedAtIso: transactionNow.toISOString(),
        updatedAtIso: transactionNow.toISOString(),
        lifecycleHistory,
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        updatedAt: serverTimestamp(),
      });
      transaction.set(appointmentRef, patch, { merge: true });

      const offerId = cleanText(current.offerId, 180);
      if (offerId) {
        transaction.set(db.collection(collections.offers).doc(offerId), compactObject({
          status: "booked",
          appointmentId: id,
          workOrderIds,
          bookedAtIso: transactionNow.toISOString(),
          updatedAtIso: transactionNow.toISOString(),
          bookedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      }

      return {
        success: true,
        replayed: false,
        appointmentId: id,
        appointment: { ...current, ...patch },
        workOrderIds,
        customerNotificationRecommended: true,
      };
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
      const transactionNow = asDate(clock());
      const [currentAppointmentSnapshot, currentOfferSnapshot] = await Promise.all([
        transaction.get(appointmentRef),
        transaction.get(offerRef),
      ]);
      const current = activeAppointment(currentAppointmentSnapshot, id);
      if (["cancelled", "canceled", "cancelada"].includes(cleanText(current.status, 40).toLowerCase())) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "A cancelled appointment cannot be changed.", { appointmentId: id });
      }
      const currentTemporaryHold = isTemporaryHoldAppointment(current);
      const appointmentState = currentTemporaryHold ? BOOKING_CREATE_MODES.TEMPORARY_HOLD : BOOKING_CREATE_MODES.CONFIRMED;
      const currentOffer = currentOfferSnapshot.exists ? { id: currentOfferSnapshot.id, ...currentOfferSnapshot.data() } : null;
      validateOfferSelection({ offer: currentOffer, offerVersion, optionId, now: transactionNow });
      const currentRequest = normalizeBookingRequest(currentOffer.request);
      if (currentRequest.customerId !== cleanText(current.customerId, 160) || currentRequest.propertyId !== cleanText(current.propertyId, 160)) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The current lifecycle offer no longer matches the appointment.", { appointmentId: id });
      }
      const oldWorkOrderIds = [...new Set((Array.isArray(current.workOrderIds) ? current.workOrderIds : [])
        .map((value) => cleanText(value, 180))
        .filter(Boolean))];
      const oldLockIds = [...new Set((Array.isArray(current.capacityLockIds) ? current.capacityLockIds : [])
        .map((value) => cleanText(value, 180))
        .filter(Boolean))];
      const [oldWorkOrderSnapshots, oldLockSnapshots] = await Promise.all([
        Promise.all(oldWorkOrderIds.map(async (workOrderId) => {
          const ref = db.collection(collections.workOrders).doc(workOrderId);
          return { workOrderId, ref, snapshot: await transaction.get(ref) };
        })),
        Promise.all(oldLockIds.map(async (lockId) => {
          const ref = db.collection(collections.capacityLocks).doc(lockId);
          return { lockId, ref, snapshot: await transaction.get(ref) };
        })),
      ]);
      const ownedOldWorkOrders = oldWorkOrderSnapshots.filter((entry) => entry.snapshot.exists
        && cleanText(entry.snapshot.data()?.appointmentId, 180) === id);
      if (ownedOldWorkOrders.some((entry) => workOrderStatusIsTerminal(entry.snapshot.data()?.status))) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "A terminal Work Order cannot be changed through Scheduling.",
          { appointmentId: id, reason: "terminal-work-order" },
        );
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
        now: transactionNow,
      });
      if (!validation || validation.available !== true) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected appointment capacity was occupied before the change could be committed.",
          { reason: cleanText(validation?.reason, 240) },
        );
      }
      const committedOption = normalizeOfferOption(validation.option || refreshedOption);
      const committedPrimaryAssignment = primaryAssignment(committedOption);
      const committedSupportAssignment = supportAssignment(committedOption);
      const committedCapacityEndTime = capacityEndTime(committedOption);
      if (normalizedChangeKind === "details_edited") assertDetailsEditKeepsPlacement(current, committedOption);

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
        appointment: { ...current, appointmentId: id, id, status: appointmentState },
        option: committedOption,
        request: currentRequest,
        customer,
        property,
        actor,
        context: {
          ...context,
          reschedule: normalizedChangeKind !== "details_edited",
          detailsEdit: normalizedChangeKind === "details_edited",
          changeKind: normalizedChangeKind,
          appointmentState,
        },
        now: transactionNow,
      }), id);
      const workOrderIds = workOrders.map((item) => item.id);
      const newWorkOrderIds = new Set(workOrderIds);
      const oldWorkOrderIdSet = new Set(oldWorkOrderIds);
      const newWorkOrderSnapshots = await Promise.all(workOrderIds
        .filter((workOrderId) => !oldWorkOrderIdSet.has(workOrderId))
        .map(async (workOrderId) => {
          const ref = db.collection(collections.workOrders).doc(workOrderId);
          return { workOrderId, ref, snapshot: await transaction.get(ref) };
        }));
      const occupiedNewWorkOrder = newWorkOrderSnapshots.find((entry) => entry.snapshot.exists
        && cleanText(entry.snapshot.data()?.appointmentId, 180) !== id);
      if (occupiedNewWorkOrder) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          "A generated Work Order id already belongs to another appointment.",
          { appointmentId: id, workOrderId: occupiedNewWorkOrder.workOrderId },
        );
      }
      if (newWorkOrderSnapshots.some((entry) => entry.snapshot.exists
        && workOrderStatusIsTerminal(entry.snapshot.data()?.status))) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "A terminal Work Order cannot be changed through Scheduling.",
          { appointmentId: id, reason: "terminal-work-order" },
        );
      }
      const actorInfo = actorFields(actor);
      const previousSchedule = scheduleSnapshot(current);
      const nextSchedule = {
        dateKey: committedOption.date,
        primaryVanId: cleanText(committedPrimaryAssignment.vanId, 120),
        primaryStart: cleanText(committedPrimaryAssignment.time || committedOption.time, 20),
        primaryEnd: cleanText(committedOption.endTime, 20),
        primaryCapacityEnd: committedCapacityEndTime,
        supportVanId: cleanText(committedSupportAssignment?.vanId, 120),
        supportStart: cleanText(committedSupportAssignment?.time, 20),
      };
      const customerNotificationRecommended = currentTemporaryHold
        ? false
        : scheduleChangeNeedsCustomerFollowUp(normalizedChangeKind, previousSchedule, nextSchedule);
      const event = historyEvent({
        kind: normalizedChangeKind,
        actor,
        reason: lifecycleReason,
        note,
        now: transactionNow,
        from: previousSchedule,
        to: nextSchedule,
        customerNotificationRecommended,
      });
      const lifecycleHistory = [...(Array.isArray(current.lifecycleHistory) ? current.lifecycleHistory : []), event];
      const lifecycleMetadata = normalizedChangeKind === "details_edited"
        ? {
          detailsEditReason: lifecycleReason,
          detailsEditNote: cleanText(note, 1_500),
          detailsEditedAtIso: transactionNow.toISOString(),
        }
        : {
          rescheduleReason: lifecycleReason,
          rescheduleNote: cleanText(note, 1_500),
          rescheduledAtIso: transactionNow.toISOString(),
        };

      transaction.set(appointmentRef, compactObject({
        status: appointmentState,
        offerId: canonicalOfferId,
        offerVersion: Number(offerVersion),
        selectedOptionId: cleanText(optionId, 180),
        date: committedOption.date,
        startTime: committedOption.time,
        endTime: committedOption.endTime,
        capacityEndTime: committedCapacityEndTime,
        workLines: currentRequest.workLines,
        workItems: committedOption.workItems,
        constraints: currentRequest.constraints,
        notes: currentRequest.notes,
        assignments: committedOption.assignments,
        primaryVanId: cleanText(committedPrimaryAssignment.vanId, 120),
        workOrderIds,
        capacityLockIds: newLocks.map((lock) => lock.id),
        ...lifecycleMetadata,
        lastScheduleChangeKind: normalizedChangeKind,
        customerNotificationRecommended,
        updatedAtIso: transactionNow.toISOString(),
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
          status: currentTemporaryHold ? "Reserva temporal" : "Confirmada",
          bookingOfferId: canonicalOfferId,
          updatedAt: transactionNow.toISOString(),
        }), { merge: true });
      }
      for (const entry of ownedOldWorkOrders) {
        if (newWorkOrderIds.has(entry.workOrderId)) continue;
        transaction.set(entry.ref, compactObject({
          status: "Cancelada",
          replacedByReschedule: normalizedChangeKind !== "details_edited",
          replacedByDetailsEdit: normalizedChangeKind === "details_edited",
          updatedAt: transactionNow.toISOString(),
        }), { merge: true });
      }
      for (const entry of oldLockSnapshots) {
        if (newLockIds.has(entry.lockId)) continue;
        const stored = entry.snapshot.exists ? entry.snapshot.data() || {} : null;
        if (!stored || cleanText(stored.appointmentId, 180) !== id) continue;
        transaction.set(entry.ref, compactObject({
          active: false,
          releasedAtIso: transactionNow.toISOString(),
          updatedAtIso: transactionNow.toISOString(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      }
      for (const { lock, lockRef } of lockSnapshots) {
        transaction.set(lockRef, compactObject({
          ...lock,
          appointmentId: id,
          active: true,
          updatedAtIso: transactionNow.toISOString(),
          updatedAt: serverTimestamp(),
        }), { merge: true });
      }
      transaction.set(offerRef, compactObject({
        status: currentTemporaryHold ? "held" : "booked",
        selectedOptionId: cleanText(optionId, 180),
        appointmentId: id,
        workOrderIds,
        ...(currentTemporaryHold
          ? {
            heldAtIso: transactionNow.toISOString(),
            heldAt: serverTimestamp(),
          }
          : {
            bookedAtIso: transactionNow.toISOString(),
            bookedAt: serverTimestamp(),
          }),
        updatedAtIso: transactionNow.toISOString(),
        updatedAt: serverTimestamp(),
      }), { merge: true });

      return {
        success: true,
        appointmentId: id,
        changeKind: normalizedChangeKind,
        customerNotificationRecommended,
        appointment: {
          ...current,
          status: appointmentState,
          date: committedOption.date,
          startTime: committedOption.time,
          endTime: committedOption.endTime,
          capacityEndTime: committedCapacityEndTime,
          workLines: currentRequest.workLines,
          workItems: committedOption.workItems,
          constraints: currentRequest.constraints,
          notes: currentRequest.notes,
          assignments: committedOption.assignments,
          primaryVanId: cleanText(committedPrimaryAssignment.vanId, 120),
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
    confirmTemporaryHold,
    rescheduleAppointment,
  };
}

module.exports = {
  APPOINTMENT_LIFECYCLE_VERSION,
  appointmentStillOwnsLock,
  assertDetailsEditKeepsPlacement,
  createBookingAppointmentLifecycle,
  holdOptionFromAppointment,
  holdRequestFromAppointment,
  isTemporaryHoldAppointment,
  normalizeChangeKind,
  recipientNotificationsEnabled,
  sameLockIds,
  scheduleChangeNeedsCustomerFollowUp,
};
