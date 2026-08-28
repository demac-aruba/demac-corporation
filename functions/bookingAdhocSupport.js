const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
} = require("./bookingAuthorityCore");
const {
  BOOKING_COLLECTIONS,
  compactObject,
} = require("./bookingAuthorityFirestore");
const {
  hashId,
  isOpenBusinessDate,
} = (() => {
  const primitives = require("./bookingSchedulingPrimitives");
  const calendar = require("./operatingCalendarService");
  return {
    hashId: primitives.hashId,
    isOpenBusinessDate: calendar.isOpenBusinessDate,
  };
})();
const {
  normalizeRouteConfig,
  propertyZone,
  resolveAssignment,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");
const { candidateAvailability } = require("./bookingCapacityAvailability");
const { canonicalizeSchedulingData } = require("./bookingVanIdentity");

const ADHOC_SUPPORT_VERSION = 1;
const SUPPORT_KIND = "adhoc_rescue";
const INACTIVE_STATUSES = new Set(["cancelada", "cancelled", "canceled", "reprogramada", "rescheduled"]);

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

function routeConfigFromSettings(settings) {
  return normalizeRouteConfig((settings || []).find((item) => item.id === "whatsapp-copilot-routing"));
}

function businessDateOpen(dateKey, businessSettings, closures) {
  const calendar = (businessSettings || []).find((item) => item.id === "business-calendar") || {};
  const closedDates = new Set((closures || [])
    .filter((item) => item.active !== false)
    .map((item) => cleanText(item.date, 20))
    .filter(Boolean));
  return isOpenBusinessDate({
    dateKey,
    closedWeekdays: calendar.closedWeekdays,
    closedDates,
  });
}

function supportWorkOrderId(appointmentId, requestId) {
  return `WO-${appointmentId}-SUP-${hashId(requestId, 16).toUpperCase()}`;
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

    const now = asDate(clock());
    const appointmentRef = db.collection(collections.appointments).doc(id);
    const supportId = supportWorkOrderId(id, stableRequestId);
    const supportRef = db.collection(collections.workOrders).doc(supportId);

    return db.runTransaction(async (transaction) => {
      const [appointmentSnapshot, replaySnapshot] = await Promise.all([
        transaction.get(appointmentRef),
        transaction.get(supportRef),
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
      if (replaySnapshot.exists) {
        const replay = { id: replaySnapshot.id, ...replaySnapshot.data() };
        if (cleanText(replay.appointmentId, 180) === id && activeWorkOrder(replay)) {
          return { success: true, replayed: true, appointmentId: id, supportWorkOrderId: replay.id, supportWorkOrder: replay, appointment };
        }
      }

      const sameDayQuery = db.collection(collections.workOrders).where("date", "==", targetDate);
      const dailyAssignmentQuery = db.collection("dailyVanAssignments").where("date", "==", targetDate);
      const closureQuery = db.collection("calendarClosures").where("date", "==", targetDate);
      const [
        sameDaySnapshot,
        serviceSnapshot,
        propertySnapshot,
        vanSnapshot,
        staffSnapshot,
        dailyAssignmentSnapshot,
        absenceSnapshot,
        halfDaySnapshot,
        businessSnapshot,
        closureSnapshot,
      ] = await Promise.all([
        transaction.get(sameDayQuery),
        transaction.get(db.collection("services")),
        transaction.get(db.collection("properties")),
        transaction.get(db.collection("vans")),
        transaction.get(db.collection("staffProfiles")),
        transaction.get(dailyAssignmentQuery),
        transaction.get(db.collection("staffAbsences")),
        transaction.get(db.collection("vanHalfDaySchedules")),
        transaction.get(db.collection("businessSettings")),
        transaction.get(closureQuery),
      ]);

      const canonical = canonicalizeSchedulingData({
        workOrders: snapshotItems(sameDaySnapshot),
        services: snapshotItems(serviceSnapshot),
        properties: snapshotItems(propertySnapshot),
        vans: snapshotItems(vanSnapshot),
        staffProfiles: snapshotItems(staffSnapshot),
        dailyVanAssignments: snapshotItems(dailyAssignmentSnapshot),
        staffAbsences: snapshotItems(absenceSnapshot),
        vanHalfDaySchedules: snapshotItems(halfDaySnapshot),
        businessSettings: snapshotItems(businessSnapshot),
        calendarClosures: snapshotItems(closureSnapshot),
      });
      if (!businessDateOpen(targetDate, canonical.businessSettings, canonical.calendarClosures)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The selected support date is closed by the canonical operating calendar.",
          { reason: "company-calendar-closed", date: targetDate },
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

      const targetVan = canonical.vans.find((van) => van.id === requestedVanId);
      if (!targetVan) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The selected supporting Van does not exist in the canonical fleet.",
          { targetVanId: requestedVanId },
        );
      }
      const property = canonical.properties.find((item) => item.id === cleanText(appointment.propertyId, 180));
      if (!property) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.PROPERTY_NOT_FOUND, "The appointment property no longer exists.", { propertyId: appointment.propertyId || "" });
      }

      const appointmentOrders = canonical.workOrders.filter((order) => cleanText(order.appointmentId, 180) === id);
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
        return { success: true, replayed: true, appointmentId: id, supportWorkOrderId: duplicate.id, supportWorkOrder: duplicate, appointment };
      }

      const crew = resolveAssignment(
        targetVan,
        targetDate,
        canonical.staffProfiles,
        canonical.dailyVanAssignments,
        canonical.staffAbsences,
      );
      const routeConfig = routeConfigFromSettings(canonical.businessSettings);
      const candidateZone = propertyZone(property, property.address || property.addressRaw || "", routeConfig);
      const availability = candidateAvailability({
        date: targetDate,
        time: targetTime,
        allocation: { quantity: 1, slots: 1, durationMinutes: 60, fullDay: false },
        van: targetVan,
        assignment: crew,
        data: canonical,
        routeConfig,
        candidateZone,
        manualOperationalMove: false,
      });
      if (!availability || availability.endTime === targetTime) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected supporting Van/time is no longer valid operating capacity for this job.",
          { reason: "support-target-unavailable", targetVanId: requestedVanId, targetTime },
        );
      }

      const lock = supportCapacityLock(targetDate, requestedVanId, targetTime);
      const lockRef = db.collection(collections.capacityLocks).doc(lock.id);
      const lockSnapshot = await transaction.get(lockRef);
      if (lockSnapshot.exists) {
        const stored = lockSnapshot.data() || {};
        if (stored.active !== false && cleanText(stored.appointmentId, 180) !== id) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.SLOT_CONFLICT,
            "The selected support capacity was occupied concurrently.",
            { date: targetDate, vanId: requestedVanId, slot: targetTime, appointmentId: stored.appointmentId || "" },
          );
        }
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
        reason,
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
        reason,
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
        lastAdhocSupportAtIso: now.toISOString(),
        adhocSupportVersion: ADHOC_SUPPORT_VERSION,
        updatedAtIso: now.toISOString(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(appointmentRef, patch, { merge: true });
      transaction.set(supportRef, supportOrder);
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
  businessDateOpen,
  createAdhocSupportAuthority,
  supportCapacityLock,
  supportWorkOrderId,
};
