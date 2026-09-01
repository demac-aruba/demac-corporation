const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
} = require("./bookingAuthorityCore");
const {
  BOOKING_COLLECTIONS,
  compactObject,
  findLiveForeignCapacityLocks,
} = require("./bookingAuthorityFirestore");
const {
  arubaDateParts,
  hashId,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");

const ADHOC_SUPPORT_VERSION = 2;
const SUPPORT_FINGERPRINT_VERSION = 1;
const SUPPORT_KIND = "adhoc_rescue";
const INACTIVE_STATUSES = new Set([
  "cancelada",
  "cancelled",
  "canceled",
  "reprogramada",
  "rescheduled",
  "completada",
  "completed",
  "facturada",
  "invoiced",
  "pagada",
  "paid",
]);

function defaultServerTimestamp() {
  const { FieldValue } = require("firebase-admin/firestore");
  return FieldValue.serverTimestamp();
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function normalizedStatus(value) {
  return cleanText(value, 80).toLowerCase();
}

function activeWorkOrder(order) {
  return Boolean(order) && !INACTIVE_STATUSES.has(normalizedStatus(order.status));
}

function primaryAssignment(appointment) {
  const assignments = Array.isArray(appointment?.assignments) ? appointment.assignments : [];
  return assignments.find((item) => cleanText(item?.role, 40) !== "support") || assignments[0] || null;
}

function primaryWorkOrder(orders) {
  return orders.find((order) => activeWorkOrder(order) && normalizedStatus(order.appointmentAssignmentRole || order.assignmentRole) !== "support")
    || orders.find(activeWorkOrder)
    || null;
}

function supportWorkOrderId(appointmentId, requestId) {
  return `WO-${appointmentId}-SUP-${hashId(requestId, 16).toUpperCase()}`;
}

function supportRequestFingerprint({ appointmentId, requestedDate, requestedTime, targetVanId, reason }) {
  return hashId(JSON.stringify({
    version: SUPPORT_FINGERPRINT_VERSION,
    appointmentId: cleanText(appointmentId, 180),
    requestedDate: cleanText(requestedDate, 20),
    requestedTime: cleanText(requestedTime, 20),
    targetVanId: cleanText(targetVanId, 120),
    reason: cleanText(reason, 500),
  }), 40);
}

function storedSupportMatchesRequest(order, {
  appointmentId,
  requestId,
  requestFingerprint,
  requestedDate,
  requestedTime,
  targetVanId,
  reason,
}) {
  const storedFingerprint = cleanText(order?.adhocSupportRequestFingerprint, 80);
  if (storedFingerprint) return storedFingerprint === requestFingerprint;
  return cleanText(order?.appointmentId, 180) === appointmentId
    && (!cleanText(order?.adhocSupportRequestId, 240) || cleanText(order?.adhocSupportRequestId, 240) === requestId)
    && cleanText(order?.date, 20) === requestedDate
    && cleanText(order?.time, 20) === requestedTime
    && cleanText(order?.vanId, 120) === targetVanId
    && cleanText(order?.supportReason, 500) === reason;
}

function supportIdempotencyRecord({
  appointmentId,
  requestId,
  requestFingerprint,
  supportWorkOrderId: workOrderId,
  now,
  serverTimestamp,
}) {
  return compactObject({
    operation: "adhoc_support",
    appointmentId,
    requestId,
    requestFingerprint,
    supportWorkOrderId: workOrderId,
    createdAtIso: now.toISOString(),
    updatedAtIso: now.toISOString(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function supportCapacityLock(dateKey, vanId, time) {
  return {
    id: `BAL-${hashId(`${dateKey}|${vanId}|${time}`, 32).toUpperCase()}`,
    date: dateKey,
    vanId,
    slot: time,
  };
}

function supportHistoryEvent({ requestId, actor, reason, now, primaryVanId, supportVanId, supportStart, supportEnd }) {
  return compactObject({
    id: `LIFE-SUPPORT-${hashId(requestId, 20).toUpperCase()}`,
    kind: "support_added",
    at: now.toISOString(),
    actorId: cleanText(actor?.id || actor?.userId, 160),
    actorName: cleanText(actor?.name || actor?.displayName, 160),
    reason: cleanText(reason, 500),
    primaryVanId,
    supportVanId,
    supportStart,
    supportEnd,
    customerNotificationRecommended: false,
  });
}

function supportOrderSnapshot({
  id,
  appointment,
  primaryOrder,
  property,
  primaryVanId,
  targetVan,
  crew,
  targetDate,
  targetTime,
  endTime,
  reason,
  requestId,
  requestFingerprint,
  actor,
  now,
}) {
  const supportReason = cleanText(reason, 500);
  const inheritedDescription = cleanText(primaryOrder.customerFacingDescription || primaryOrder.problem, 1_500);
  return compactObject({
    id,
    appointmentId: appointment.appointmentId || appointment.id,
    clientId: cleanText(primaryOrder.clientId || appointment.customerId, 180),
    propertyId: cleanText(primaryOrder.propertyId || appointment.propertyId, 180),
    serviceId: cleanText(primaryOrder.serviceId, 180),
    date: targetDate,
    time: targetTime,
    status: "Confirmada",
    technicianIds: crew.technicianIds,
    vanId: targetVan.id,
    address: cleanText(primaryOrder.address || property?.address || property?.addressRaw, 500),
    zone: cleanText(primaryOrder.zone || property?.operationalZone || property?.zone, 160),
    problem: supportReason ? `Apoyo operativo. ${supportReason}` : "Apoyo operativo a compañero.",
    customerFacingDescription: inheritedDescription,
    technicianInstructions: supportReason,
    officeNotes: `Apoyo operativo vinculado a ${primaryOrder.id}. No enviar comunicación duplicada al cliente.`,
    appointmentWorkType: "adhoc_support",
    appointmentPresetId: "adhoc_support",
    appointmentWorkLabel: "Apoyo operativo",
    appointmentDurationMinutes: 60,
    appointmentDurationMode: "fixed",
    appointmentEndTime: endTime,
    appointmentAssignmentRole: "support",
    parentWorkOrderId: primaryOrder.id,
    supportForWorkOrderId: primaryOrder.id,
    supportAssignmentKind: SUPPORT_KIND,
    adhocSupportRequestId: requestId,
    adhocSupportRequestFingerprint: requestFingerprint,
    supportPrimaryVanId: primaryVanId,
    supportReason,
    fullDaySingleProperty: false,
    schedulingMode: "fixed",
    airConditionerCount: 1,
    scheduledSlots: 1,
    whatsappNotificationsEnabled: false,
    notificationRecipients: [],
    customerCommunicationOwner: false,
    supportNonBillable: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: cleanText(actor?.id || actor?.userId, 160) || "office-scheduling",
    createdByName: cleanText(actor?.name || actor?.displayName, 160),
  });
}

function createAdhocSupportAuthority({
  db,
  clock = () => new Date(),
  serverTimestamp = defaultServerTimestamp,
  collections = BOOKING_COLLECTIONS,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }
  const schedulingProvider = createSchedulingProvider({ db });

  async function addSupport({
    appointmentId,
    requestId,
    requestedDate,
    requestedTime,
    targetVanId,
    reason = "",
    actor = {},
  } = {}) {
    const id = cleanText(appointmentId, 180);
    const stableRequestId = cleanText(requestId, 240);
    const targetDate = cleanText(requestedDate, 20);
    const targetTime = cleanText(requestedTime, 20);
    const requestedVanId = cleanText(targetVanId, 120);
    if (!id || stableRequestId.length < 8 || !targetDate || !targetTime || !requestedVanId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Ad-hoc support requires appointmentId, requestId, requestedDate, requestedTime and targetVanId.",
        { appointmentId: id, requestedDate: targetDate, requestedTime: targetTime, targetVanId: requestedVanId },
      );
    }

    const normalizedReason = cleanText(reason, 500);
    const requestFingerprint = supportRequestFingerprint({
      appointmentId: id,
      requestedDate: targetDate,
      requestedTime: targetTime,
      targetVanId: requestedVanId,
      reason: normalizedReason,
    });
    const appointmentRef = db.collection(collections.appointments).doc(id);
    const supportId = supportWorkOrderId(id, stableRequestId);
    const supportRef = db.collection(collections.workOrders).doc(supportId);
    const idempotencyRef = db.collection(collections.idempotency)
      .doc(hashId(`adhoc-support|${stableRequestId}`, 40));

    return db.runTransaction(async (transaction) => {
      // Firestore may retry this callback. Resolve the Aruba clock inside every
      // attempt so an option that passed on attempt one cannot commit after it
      // becomes a past start on a later attempt.
      const now = asDate(clock());
      const [appointmentSnapshot, replaySnapshot, idempotencySnapshot] = await Promise.all([
        transaction.get(appointmentRef),
        transaction.get(supportRef),
        transaction.get(idempotencyRef),
      ]);
      if (!appointmentSnapshot.exists) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.APPOINTMENT_NOT_FOUND, "The appointment does not exist.", { appointmentId: id });
      }
      const appointment = { id: appointmentSnapshot.id, ...appointmentSnapshot.data() };
      if (normalizedStatus(appointment.status) !== "confirmed") {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Ad-hoc support can only be attached to a confirmed appointment.",
          { appointmentId: id, status: appointment.status || "" },
        );
      }
      if (cleanText(appointment.date, 20) !== targetDate) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "Support must be scheduled on the same canonical date as the primary appointment.",
          { appointmentDate: appointment.date || "", requestedDate: targetDate },
        );
      }

      if (idempotencySnapshot.exists) {
        const record = idempotencySnapshot.data() || {};
        const sameRequest = cleanText(record.operation, 80) === "adhoc_support"
          && cleanText(record.appointmentId, 180) === id
          && cleanText(record.requestId, 240) === stableRequestId
          && cleanText(record.requestFingerprint, 80) === requestFingerprint;
        if (!sameRequest) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This support request identity was already used for a different action.",
            { appointmentId: cleanText(record.appointmentId, 180) },
          );
        }
        const recordedSupportId = cleanText(record.supportWorkOrderId, 180) || supportId;
        const recordedSnapshot = recordedSupportId === supportId
          ? replaySnapshot
          : await transaction.get(db.collection(collections.workOrders).doc(recordedSupportId));
        if (!recordedSnapshot.exists) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The recorded support request outcome is no longer available.",
            { appointmentId: id },
          );
        }
        const replay = { id: recordedSnapshot.id, ...recordedSnapshot.data() };
        return {
          success: true,
          replayed: true,
          appointmentId: id,
          supportWorkOrderId: replay.id,
          supportWorkOrder: replay,
          appointment,
        };
      }

      if (replaySnapshot.exists) {
        const replay = { id: replaySnapshot.id, ...replaySnapshot.data() };
        if (!storedSupportMatchesRequest(replay, {
          appointmentId: id,
          requestId: stableRequestId,
          requestFingerprint,
          requestedDate: targetDate,
          requestedTime: targetTime,
          targetVanId: requestedVanId,
          reason: normalizedReason,
        })) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This support request identity was already used with a different payload.",
            { appointmentId: cleanText(replay.appointmentId, 180) },
          );
        }
        transaction.set(idempotencyRef, supportIdempotencyRecord({
          appointmentId: id,
          requestId: stableRequestId,
          requestFingerprint,
          supportWorkOrderId: replay.id,
          now,
          serverTimestamp,
        }));
        return {
          success: true,
          replayed: true,
          appointmentId: id,
          supportWorkOrderId: replay.id,
          supportWorkOrder: replay,
          appointment,
        };
      }

      const today = arubaDateParts(now).date;
      if (targetDate !== today) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "Ad-hoc coworker support is a same-day operational action. Future multi-Van support must use the planned Booking Authority allocation.",
          { reason: "adhoc-support-same-day-only", requestedDate: targetDate, currentDate: today },
        );
      }

      const primary = primaryAssignment(appointment);
      const primaryVanId = cleanText(primary?.vanId || appointment.primaryVanId, 120);
      if (!primaryVanId) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, "The appointment has no canonical primary Van.", { appointmentId: id });
      }
      if (primaryVanId === requestedVanId) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The supporting Van must be different from the primary Van.",
          { primaryVanId, targetVanId: requestedVanId },
        );
      }

      const propertyId = cleanText(appointment.propertyId, 180);
      if (!propertyId) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.PROPERTY_NOT_FOUND, "The appointment property no longer exists.", { appointmentId: id });
      }
      const appointmentOrdersQuery = db.collection(collections.workOrders).where("appointmentId", "==", id);
      const [targetVanSnapshot, propertySnapshot, appointmentOrdersSnapshot] = await Promise.all([
        transaction.get(db.collection("vans").doc(requestedVanId)),
        transaction.get(db.collection(collections.properties).doc(propertyId)),
        transaction.get(appointmentOrdersQuery),
      ]);
      if (!targetVanSnapshot.exists) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The selected supporting Van does not exist in the canonical fleet.",
          { targetVanId: requestedVanId },
        );
      }
      if (!propertySnapshot.exists) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.PROPERTY_NOT_FOUND, "The appointment property no longer exists.", { propertyId });
      }
      const targetVan = { id: targetVanSnapshot.id, ...targetVanSnapshot.data() };
      const property = { id: propertySnapshot.id, ...propertySnapshot.data() };

      const appointmentOrders = snapshotItems(appointmentOrdersSnapshot);
      const primaryOrder = primaryWorkOrder(appointmentOrders);
      if (!primaryOrder) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The appointment has no active primary Work Order to receive support.",
          { appointmentId: id },
        );
      }
      const duplicate = appointmentOrders.find((order) => (
        activeWorkOrder(order)
        && cleanText(order.supportAssignmentKind, 80) === SUPPORT_KIND
        && cleanText(order.vanId, 120) === requestedVanId
        && cleanText(order.time, 20) === targetTime
      ));
      if (duplicate) {
        transaction.set(idempotencyRef, supportIdempotencyRecord({
          appointmentId: id,
          requestId: stableRequestId,
          requestFingerprint,
          supportWorkOrderId: duplicate.id,
          now,
          serverTimestamp,
        }));
        return { success: true, replayed: true, appointmentId: id, supportWorkOrderId: duplicate.id, supportWorkOrder: duplicate, appointment };
      }

      const customerId = cleanText(appointment.customerId || primaryOrder.clientId, 180);
      if (!customerId) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND, "The appointment customer no longer exists.", { appointmentId: id });
      }
      const providerRequest = {
        customerId,
        propertyId,
        workLines: [{
          id: "adhoc-support",
          presetId: cleanText(primaryOrder.appointmentPresetId || primaryOrder.appointmentWorkType || primaryOrder.serviceId, 120) || "adhoc_support",
          serviceId: cleanText(primaryOrder.serviceId, 120) || "adhoc-support",
          quantity: 1,
        }],
        constraints: { requestedDate: targetDate, requestedTime: targetTime },
        notes: normalizedReason,
      };
      const requestedOption = {
        id: `support-${hashId(`${id}|${requestedVanId}|${targetDate}|${targetTime}`, 20)}`,
        date: targetDate,
        time: targetTime,
        address: cleanText(property.address || property.addressRaw, 500),
        requestedDateMatch: true,
        requestedTimeMatch: true,
        assignments: [{
          vanId: requestedVanId,
          quantity: 1,
          slots: 1,
          durationMinutes: 60,
          fullDay: false,
          time: targetTime,
          role: "support",
        }],
      };
      const validation = await schedulingProvider.validateTransaction({
        transaction,
        db,
        request: providerRequest,
        option: requestedOption,
        context: { channel: "office", changeKind: "adhoc_support" },
        now,
      });
      if (!validation.available || !validation.option) {
        const mappedReason = validation.reason === "requested-date-closed"
          ? "company-calendar-closed"
          : validation.reason || "support-target-unavailable";
        const availabilityChanged = new Set([
          "selected-time-passed",
          "company-calendar-closed",
          "van-unavailable",
          "crew-unavailable",
          "half-day-capacity-unavailable",
          "outside-operational-window",
        ]).has(mappedReason);
        throw new BookingAuthorityError(
          availabilityChanged ? BOOKING_ERROR_CODES.AVAILABILITY_CHANGED : BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected supporting Van/time is no longer valid operating capacity for this job.",
          {
            reason: mappedReason,
            targetVanId: requestedVanId,
            targetTime,
            rejection: validation.rejection || null,
          },
        );
      }
      const availability = validation.option.assignments.find((assignment) => assignment.vanId === requestedVanId);
      const authorityLocks = Array.isArray(validation.capacityLocks) ? validation.capacityLocks : [];
      const expectedLock = supportCapacityLock(targetDate, requestedVanId, targetTime);
      if (!availability || availability.endTime === targetTime || authorityLocks.length !== 1 || authorityLocks[0].id !== expectedLock.id) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The selected support assignment did not resolve to one canonical capacity unit.",
          { reason: "support-capacity-shape-changed", targetVanId: requestedVanId, targetTime },
        );
      }

      const lock = authorityLocks[0];
      const lockRef = db.collection(collections.capacityLocks).doc(lock.id);
      const lockSnapshot = await transaction.get(lockRef);
      const liveForeignLocks = await findLiveForeignCapacityLocks({
        transaction,
        db,
        collections,
        lockSnapshots: [{ lock, lockRef, snapshot: lockSnapshot }],
        appointmentId: id,
      });
      if (liveForeignLocks.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected support capacity was occupied concurrently.",
          { date: targetDate, vanId: requestedVanId, slot: targetTime, appointmentId: liveForeignLocks[0].ownerId },
        );
      }

      const supportOrder = supportOrderSnapshot({
        id: supportId,
        appointment,
        primaryOrder,
        property,
        primaryVanId,
        targetVan,
        crew: availability,
        targetDate,
        targetTime,
        endTime: availability.endTime,
        reason: normalizedReason,
        requestId: stableRequestId,
        requestFingerprint,
        actor,
        now,
      });
      const supportAssignment = compactObject({
        id: supportId,
        vanId: requestedVanId,
        vanName: targetVan.name || `Van ${requestedVanId.slice(-1)}`,
        technicianIds: availability.technicianIds,
        driverStaffId: availability.driverStaffId,
        helperStaffId: availability.helperStaffId,
        quantity: 1,
        slots: 1,
        durationMinutes: 60,
        time: targetTime,
        endTime: availability.endTime,
        role: "support",
        supportAssignmentKind: SUPPORT_KIND,
        parentWorkOrderId: primaryOrder.id,
      });
      const existingAssignments = Array.isArray(appointment.assignments) ? appointment.assignments : [];
      const existingWorkOrderIds = Array.isArray(appointment.workOrderIds) ? appointment.workOrderIds : [];
      const existingLockIds = Array.isArray(appointment.capacityLockIds) ? appointment.capacityLockIds : [];
      const event = supportHistoryEvent({
        requestId: stableRequestId,
        actor,
        reason: normalizedReason,
        now,
        primaryVanId,
        supportVanId: requestedVanId,
        supportStart: targetTime,
        supportEnd: availability.endTime,
      });
      const patch = compactObject({
        assignments: [...existingAssignments, supportAssignment],
        workOrderIds: [...new Set([...existingWorkOrderIds, supportId])],
        capacityLockIds: [...new Set([...existingLockIds, lock.id])],
        lifecycleHistory: [...(Array.isArray(appointment.lifecycleHistory) ? appointment.lifecycleHistory : []), event],
        lastScheduleChangeKind: "support_added",
        customerNotificationRecommended: false,
        lastAdhocSupportRequestId: stableRequestId,
        lastAdhocSupportRequestFingerprint: requestFingerprint,
        lastAdhocSupportAtIso: now.toISOString(),
        adhocSupportVersion: ADHOC_SUPPORT_VERSION,
        updatedAtIso: now.toISOString(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(appointmentRef, patch, { merge: true });
      transaction.set(supportRef, supportOrder);
      transaction.set(idempotencyRef, supportIdempotencyRecord({
        appointmentId: id,
        requestId: stableRequestId,
        requestFingerprint,
        supportWorkOrderId: supportId,
        now,
        serverTimestamp,
      }));
      transaction.set(lockRef, compactObject({
        ...lock,
        appointmentId: id,
        active: true,
        createdAtIso: lockSnapshot.exists ? cleanText(lockSnapshot.data()?.createdAtIso, 80) || now.toISOString() : now.toISOString(),
        updatedAtIso: now.toISOString(),
        createdAt: lockSnapshot.exists ? undefined : serverTimestamp(),
        updatedAt: serverTimestamp(),
      }), { merge: true });

      return {
        success: true,
        replayed: false,
        appointmentId: id,
        supportWorkOrderId: supportId,
        supportWorkOrder: supportOrder,
        appointment: { ...appointment, ...patch },
      };
    });
  }

  return {
    version: ADHOC_SUPPORT_VERSION,
    addSupport,
  };
}

module.exports = {
  ADHOC_SUPPORT_VERSION,
  SUPPORT_KIND,
  activeWorkOrder,
  createAdhocSupportAuthority,
  supportCapacityLock,
  supportWorkOrderId,
};
