const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
  normalizeWorkLines,
} = require("./bookingAuthorityCore");
const {
  BOOKING_COLLECTIONS,
  compactObject,
  findLiveForeignCapacityLocks,
} = require("./bookingAuthorityFirestore");
const {
  arubaDateParts,
  hashId,
  resolveAssignment,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");
const { canonicalizeSchedulingData, resolveCanonicalVanId } = require("./bookingVanIdentity");
const { isOpenBusinessDate } = require("./operatingCalendarService");
const { mergeBookablePresets } = require("./serviceCatalog");
const { resolveAppointmentRecipients } = require("./customerContactDirectory");

const AFTER_HOURS_VERSION = 2;
const AFTER_HOURS_FINGERPRINT_VERSION = 1;
const AFTER_HOURS_KIND = "after_hours_emergency";
const AFTER_HOURS_START_MINUTES = 17 * 60;

function defaultServerTimestamp() {
  const { FieldValue } = require("firebase-admin/firestore");
  return FieldValue.serverTimestamp();
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function timeMinutes(value) {
  const match = cleanText(value, 20).match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return Number.NaN;
  return hour * 60 + minute;
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

function afterHoursAppointmentId(requestId) {
  return `APT-AH-${hashId(requestId, 20).toUpperCase()}`;
}

function afterHoursWorkOrderId(appointmentId) {
  return `WO-${appointmentId}-1`;
}

function normalizedRecipientSelections(selections) {
  return (Array.isArray(selections) ? selections : [])
    .map((selection) => ({
      recipientType: cleanText(selection?.recipientType, 40) === "client" ? "client" : "contact",
      sourceId: cleanText(selection?.sourceId, 180),
      sendConfirmation: selection?.sendConfirmation === true,
      sendReminder: selection?.sendReminder === true,
    }))
    .filter((selection) => selection.sourceId)
    .sort((left, right) => `${left.recipientType}:${left.sourceId}`.localeCompare(`${right.recipientType}:${right.sourceId}`));
}

function afterHoursRequestFingerprint({
  customerId,
  propertyId,
  workLines,
  requestedDate,
  requestedTime,
  requiredVanId,
  customerFacingDescription,
  technicianInstructions,
  recipientSelections,
}) {
  return hashId(JSON.stringify({
    version: AFTER_HOURS_FINGERPRINT_VERSION,
    customerId: cleanText(customerId, 180),
    propertyId: cleanText(propertyId, 180),
    workLines: (workLines || []).map((line) => ({
      id: cleanText(line.id, 120),
      presetId: cleanText(line.presetId, 120),
      serviceId: cleanText(line.serviceId, 120),
      quantity: Number(line.quantity) || 0,
      manualDurationMinutes: Number(line.manualDurationMinutes) || 0,
      customerFacingDescription: cleanText(line.customerFacingDescription, 500),
      technicianInstructions: cleanText(line.technicianInstructions, 1_500),
    })),
    requestedDate: cleanText(requestedDate, 20),
    requestedTime: cleanText(requestedTime, 20),
    requiredVanId: cleanText(requiredVanId, 120),
    customerFacingDescription: cleanText(customerFacingDescription, 1_500),
    technicianInstructions: cleanText(technicianInstructions, 1_500),
    recipientSelections: normalizedRecipientSelections(recipientSelections),
  }), 40);
}

function storedAfterHoursMatchesRequest(appointment, workOrder, payload) {
  const storedFingerprint = cleanText(appointment?.afterHoursRequestFingerprint, 80);
  if (storedFingerprint) return storedFingerprint === payload.requestFingerprint;
  const storedLines = Array.isArray(appointment?.workLines) ? appointment.workLines : [];
  const requestedDescription = cleanText(payload.customerFacingDescription, 1_500);
  const requestedSelections = normalizedRecipientSelections(payload.recipientSelections);
  const storedRecipients = Array.isArray(workOrder?.notificationRecipients) ? workOrder.notificationRecipients : [];
  const recipientSelectionsMatch = requestedSelections.every((selection) => {
    const stored = storedRecipients.find((recipient) => (
      cleanText(recipient?.recipientType, 40) === selection.recipientType
      && cleanText(recipient?.sourceId, 180) === selection.sourceId
    ));
    return stored
      && stored.sendConfirmation === selection.sendConfirmation
      && stored.sendReminder === selection.sendReminder;
  });
  return cleanText(appointment?.afterHoursRequestId, 240) === payload.requestId
    && cleanText(appointment?.customerId, 180) === payload.customerId
    && cleanText(appointment?.propertyId, 180) === payload.propertyId
    && cleanText(appointment?.date, 20) === payload.requestedDate
    && cleanText(appointment?.startTime, 20) === payload.requestedTime
    && cleanText(appointment?.primaryVanId, 120) === payload.requiredVanId
    && JSON.stringify(storedLines) === JSON.stringify(payload.workLines)
    && (!requestedDescription || cleanText(workOrder?.customerFacingDescription, 1_500) === requestedDescription)
    && cleanText(workOrder?.technicianInstructions, 1_500) === cleanText(payload.technicianInstructions, 1_500)
    && recipientSelectionsMatch;
}

function afterHoursGuard(dateKey, vanId) {
  return {
    id: `BAH-${hashId(`${dateKey}|${vanId}|open-after-hours`, 32).toUpperCase()}`,
    date: dateKey,
    vanId,
    slot: "AFTER_HOURS_OPEN",
    capacityKind: AFTER_HOURS_KIND,
  };
}

function recipientCanNotify(recipient) {
  return Boolean(cleanText(recipient?.whatsapp || recipient?.phone, 80))
    && (recipient?.sendConfirmation === true || recipient?.sendReminder === true);
}

function activeOpenAfterHours(order) {
  if (!order || order.afterHoursOpenEnded !== true) return false;
  if (cleanText(order.afterHoursKind, 80) !== AFTER_HOURS_KIND) return false;
  return !["Cancelada", "Reprogramada", "Completada", "Facturada", "Pagada"].includes(cleanText(order.status, 80));
}

function createAfterHoursAuthority({
  db,
  clock = () => new Date(),
  serverTimestamp = defaultServerTimestamp,
  collections = BOOKING_COLLECTIONS,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }

  async function createEmergency({
    requestId,
    customerId,
    propertyId,
    workLines,
    presetId,
    serviceId,
    quantity = 1,
    requestedDate,
    requestedTime = "17:00",
    requiredVanId,
    customerFacingDescription = "",
    technicianInstructions = "",
    recipientSelections = [],
    actor = {},
  } = {}) {
    const stableRequestId = cleanText(requestId, 240);
    const clientId = cleanText(customerId, 180);
    const siteId = cleanText(propertyId, 180);
    const requestedWorkLines = normalizeWorkLines(Array.isArray(workLines) && workLines.length
      ? workLines
      : [{ presetId: presetId || serviceId, serviceId, quantity }]);
    const dateKey = cleanText(requestedDate, 20);
    const startTime = cleanText(requestedTime, 20);
    const rawVanId = cleanText(requiredVanId, 120);
    const startMinutes = timeMinutes(startTime);
    if (stableRequestId.length < 8 || !clientId || !siteId || !dateKey || !rawVanId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "After-hours emergency requires requestId, customer, property, work type, date, time and Van.",
      );
    }
    if (!Number.isFinite(startMinutes) || startMinutes < AFTER_HOURS_START_MINUTES) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "After-hours emergency work must start at 17:00 or later.",
        { reason: "after-hours-start-before-17", requestedTime: startTime },
      );
    }
    const requestFingerprint = afterHoursRequestFingerprint({
      customerId: clientId,
      propertyId: siteId,
      workLines: requestedWorkLines,
      requestedDate: dateKey,
      requestedTime: startTime,
      requiredVanId: rawVanId,
      customerFacingDescription,
      technicianInstructions,
      recipientSelections,
    });

    const appointmentId = afterHoursAppointmentId(stableRequestId);
    const workOrderId = afterHoursWorkOrderId(appointmentId);
    const appointmentRef = db.collection(collections.appointments).doc(appointmentId);
    const workOrderRef = db.collection(collections.workOrders).doc(workOrderId);

    // Resolve notification responsibility through the same canonical Contact/Property
    // authority as normal Booking Authority appointments. Reminders are harmless for
    // same-day work (the reminder scheduler targets the next open date), while the
    // confirmation may be queued by the existing Work Order trigger.
    const recipients = await resolveAppointmentRecipients(db, {
      clientId,
      propertyId: siteId,
      selections: recipientSelections,
    });

    return db.runTransaction(async (transaction) => {
      const replaySnapshot = await transaction.get(appointmentRef);
      if (replaySnapshot.exists) {
        const replay = { id: replaySnapshot.id, ...replaySnapshot.data() };
        const replayOrderSnapshot = await transaction.get(workOrderRef);
        const replayOrder = replayOrderSnapshot.exists ? { id: workOrderId, ...replayOrderSnapshot.data() } : null;
        if (!storedAfterHoursMatchesRequest(replay, replayOrder, {
          requestId: stableRequestId,
          requestFingerprint,
          customerId: clientId,
          propertyId: siteId,
          workLines: requestedWorkLines,
          requestedDate: dateKey,
          requestedTime: startTime,
          requiredVanId: rawVanId,
          customerFacingDescription,
          technicianInstructions,
          recipientSelections,
        })) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This after-hours request identity was already used with a different payload.",
            { appointmentId },
          );
        }
        return {
          success: true,
          replayed: true,
          appointmentId,
          workOrderIds: [workOrderId],
          appointment: replay,
          workOrder: replayOrder,
        };
      }

      // Firestore may retry this callback after a concurrent write. Read the
      // clock inside every attempt so a request cannot commit after its start
      // minute has elapsed. A committed idempotent replay is intentionally
      // recognized first, so historical retries still return their result.
      const now = asDate(clock());
      const current = arubaDateParts(now);
      if (dateKey !== current.date) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "After-hours emergency scheduling is a same-day operational action.",
          { reason: "after-hours-same-day-only", requestedDate: dateKey, currentDate: current.date },
        );
      }
      if (startMinutes <= timeMinutes(current.time)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The selected after-hours start time has already passed.",
          {
            reason: "selected-time-passed",
            requestedDate: dateKey,
            requestedTime: startTime,
            currentDate: current.date,
            currentTime: current.time,
            rejection: {
              code: "START_TIME_PASSED",
              stage: "temporal",
              date: dateKey,
              time: startTime,
            },
          },
        );
      }

      const dailyAssignmentQuery = db.collection("dailyVanAssignments").where("date", "==", dateKey);
      const closureQuery = db.collection("calendarClosures").where("date", "==", dateKey);
      const [
        clientSnapshot,
        propertySnapshot,
        serviceSnapshot,
        legacyPresetSnapshot,
        vanSnapshot,
        staffSnapshot,
        dailyAssignmentSnapshot,
        absenceSnapshot,
        halfDaySnapshot,
        businessSnapshot,
        closureSnapshot,
        sameDayWorkOrders,
      ] = await Promise.all([
        transaction.get(db.collection("clients").doc(clientId)),
        transaction.get(db.collection("properties").doc(siteId)),
        transaction.get(db.collection("services")),
        transaction.get(db.collection("businessSettings").doc("appointment-work-presets")),
        transaction.get(db.collection("vans")),
        transaction.get(db.collection("staffProfiles")),
        transaction.get(dailyAssignmentQuery),
        transaction.get(db.collection("staffAbsences")),
        transaction.get(db.collection("vanHalfDaySchedules")),
        transaction.get(db.collection("businessSettings")),
        transaction.get(closureQuery),
        transaction.get(db.collection(collections.workOrders).where("date", "==", dateKey)),
      ]);
      if (!clientSnapshot.exists || clientSnapshot.data()?.active === false) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.CUSTOMER_NOT_FOUND, "The selected customer does not exist or is inactive.", { customerId: clientId });
      }
      if (!propertySnapshot.exists || cleanText(propertySnapshot.data()?.clientId, 180) !== clientId) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.PROPERTY_CUSTOMER_MISMATCH, "The selected property does not belong to this customer.", { customerId: clientId, propertyId: siteId });
      }

      const rawVans = snapshotItems(vanSnapshot);
      const canonical = canonicalizeSchedulingData({
        workOrders: snapshotItems(sameDayWorkOrders),
        services: snapshotItems(serviceSnapshot),
        properties: [{ id: propertySnapshot.id, ...propertySnapshot.data() }],
        vans: rawVans,
        staffProfiles: snapshotItems(staffSnapshot),
        dailyVanAssignments: snapshotItems(dailyAssignmentSnapshot),
        staffAbsences: snapshotItems(absenceSnapshot),
        vanHalfDaySchedules: snapshotItems(halfDaySnapshot),
        businessSettings: snapshotItems(businessSnapshot),
        calendarClosures: snapshotItems(closureSnapshot),
      });
      if (!businessDateOpen(dateKey, canonical.businessSettings, canonical.calendarClosures)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The selected date is closed by the canonical company calendar.",
          { reason: "company-calendar-closed", date: dateKey },
        );
      }

      const vanId = resolveCanonicalVanId(rawVanId, canonical.aliases) || rawVanId;
      const van = canonical.vans.find((item) => item.id === vanId);
      if (!van || van.active === false || ["Mantenimiento", "Fuera de servicio"].includes(cleanText(van.status, 80))) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The selected Van is not available for after-hours emergency work.",
          { reason: "after-hours-van-unavailable", vanId },
        );
      }
      const crew = resolveAssignment(van, dateKey, canonical.staffProfiles, canonical.dailyVanAssignments, canonical.staffAbsences);
      if (!crew.driverStaffId || ["Mantenimiento", "Fuera de servicio", "Sin personal"].includes(crew.status)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The selected Van has no valid dated crew for after-hours work.",
          { reason: "after-hours-crew-unavailable", vanId, crewStatus: crew.status },
        );
      }

      const services = snapshotItems(serviceSnapshot);
      const legacyPreset = legacyPresetSnapshot.exists ? { id: "appointment-work-presets", ...legacyPresetSnapshot.data() } : { id: "appointment-work-presets" };
      const presets = mergeBookablePresets(services, [legacyPreset]);
      const resolvedWorkLines = requestedWorkLines.map((line, index) => {
        const preset = presets.find((item) => item.id === line.presetId || (line.serviceId && item.serviceId === line.serviceId));
        if (!preset || preset.active === false) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.INVALID_REQUEST,
            "Every selected after-hours work type must be active in Scheduling.",
            { field: `workLines[${index}]`, presetId: line.presetId, serviceId: line.serviceId },
          );
        }
        return { line, preset };
      });

      const guard = afterHoursGuard(dateKey, vanId);
      const guardRef = db.collection(collections.capacityLocks).doc(guard.id);
      const guardSnapshot = await transaction.get(guardRef);
      const liveForeignLocks = await findLiveForeignCapacityLocks({
        transaction,
        db,
        collections,
        lockSnapshots: [{ lock: guard, lockRef: guardRef, snapshot: guardSnapshot }],
        appointmentId,
      });
      if (liveForeignLocks.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "This Van already has an open-ended after-hours emergency. Complete or cancel it before assigning another one.",
          { reason: "after-hours-open-job-exists", vanId, appointmentId: liveForeignLocks[0].ownerId },
        );
      }

      const existingOpen = canonical.workOrders.find((order) => cleanText(order.vanId, 120) === vanId && activeOpenAfterHours(order));
      if (existingOpen) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "This Van already has an open-ended after-hours emergency.",
          { reason: "after-hours-open-job-exists", vanId, workOrderId: existingOpen.id },
        );
      }

      const client = { id: clientSnapshot.id, ...clientSnapshot.data() };
      const property = { id: propertySnapshot.id, ...propertySnapshot.data() };
      const workItems = resolvedWorkLines.map(({ line, preset }, index) => compactObject({
        id: cleanText(line.id, 120) || `AH-WORK-${hashId(`${appointmentId}|${preset.id}|${index}`, 12).toUpperCase()}`,
        presetId: preset.id,
        serviceId: preset.serviceId,
        label: preset.label,
        quantity: line.quantity,
        durationMode: "open_ended",
        serviceDefinitionVersion: preset.serviceDefinitionVersion,
      }));
      const itemQuantity = workItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
      const primaryPreset = resolvedWorkLines[0].preset;
      const description = cleanText(customerFacingDescription, 1_500)
        || workItems.map((item) => `${item.label} × ${item.quantity}`).join("; ");
      const instructions = cleanText(technicianInstructions, 1_500);
      const timestamp = now.toISOString();
      const assignment = compactObject({
        id: workOrderId,
        vanId,
        vanName: van.name || `Van ${vanId.slice(-1)}`,
        technicianIds: crew.technicianIds,
        driverStaffId: crew.driverStaffId,
        helperStaffId: crew.helperStaffId,
        additionalHelperStaffId: crew.additionalHelperStaffId,
        quantity: itemQuantity,
        time: startTime,
        role: "primary",
        afterHoursOpenEnded: true,
        afterHoursKind: AFTER_HOURS_KIND,
      });
      const appointment = compactObject({
        id: appointmentId,
        appointmentId,
        customerId: clientId,
        propertyId: siteId,
        status: "confirmed",
        source: "office-scheduling",
        date: dateKey,
        startTime,
        primaryVanId: vanId,
        assignments: [assignment],
        workOrderIds: [workOrderId],
        capacityLockIds: [guard.id],
        workLines: requestedWorkLines,
        workItems,
        afterHoursKind: AFTER_HOURS_KIND,
        afterHoursOpenEnded: true,
        afterHoursRequestId: stableRequestId,
        afterHoursRequestFingerprint: requestFingerprint,
        afterHoursVersion: AFTER_HOURS_VERSION,
        actualCompletedAt: null,
        createdBy: cleanText(actor?.id || actor?.userId, 160) || "office-scheduling",
        createdByName: cleanText(actor?.name || actor?.displayName, 160),
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const workOrder = compactObject({
        id: workOrderId,
        appointmentId,
        clientId,
        propertyId: siteId,
        serviceId: primaryPreset.serviceId,
        date: dateKey,
        time: startTime,
        status: "Confirmada",
        technicianIds: crew.technicianIds,
        vanId,
        address: cleanText(property.address || property.addressRaw || client.address, 500),
        zone: cleanText(property.operationalZone || property.zone || client.zone, 160),
        problem: description,
        customerFacingDescription: description,
        technicianInstructions: instructions,
        appointmentWorkType: primaryPreset.id,
        appointmentPresetId: primaryPreset.id,
        appointmentWorkLabel: primaryPreset.label,
        appointmentWorkItems: workItems,
        appointmentAssignmentRole: "primary",
        airConditionerCount: itemQuantity,
        afterHoursKind: AFTER_HOURS_KIND,
        afterHoursOpenEnded: true,
        afterHoursRequestId: stableRequestId,
        afterHoursRequestFingerprint: requestFingerprint,
        afterHoursVersion: AFTER_HOURS_VERSION,
        afterHoursStartTime: startTime,
        afterHoursGuardId: guard.id,
        actualStartedAt: null,
        actualCompletedAt: null,
        whatsappNotificationsEnabled: recipients.some(recipientCanNotify),
        notificationRecipients: recipients,
        customerCommunicationOwner: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: cleanText(actor?.id || actor?.userId, 160) || "office-scheduling",
        createdByName: cleanText(actor?.name || actor?.displayName, 160),
      });

      transaction.set(appointmentRef, appointment);
      transaction.set(workOrderRef, workOrder);
      transaction.set(guardRef, compactObject({
        ...guard,
        appointmentId,
        workOrderId,
        active: true,
        openEnded: true,
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));

      return {
        success: true,
        replayed: false,
        appointmentId,
        workOrderIds: [workOrderId],
        appointment,
        workOrder,
      };
    });
  }

  return {
    version: AFTER_HOURS_VERSION,
    createEmergency,
  };
}

module.exports = {
  AFTER_HOURS_KIND,
  AFTER_HOURS_START_MINUTES,
  AFTER_HOURS_VERSION,
  activeOpenAfterHours,
  afterHoursAppointmentId,
  afterHoursGuard,
  afterHoursWorkOrderId,
  businessDateOpen,
  createAfterHoursAuthority,
  timeMinutes,
};
