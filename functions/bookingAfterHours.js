const { chargeFingerprint, prepareInitialCharges, authorizeInitialCharges } = require('./appointmentCharges');
const { prepareVisitReferencesCommit, referenceInput } = require('./bookingVisitReferences');
const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
  normalizeWorkLines,
  normalizeBookingRequest,
} = require("./bookingAuthorityCore");
const {
  BOOKING_COLLECTIONS,
  compactObject,
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

const AFTER_HOURS_VERSION = 1;
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

  async function createSpecialBooking({
    project,
    dwellingId, requesterId, accessContactId,
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
    visitReferences,
    charges,
    actor = {},
    overtimeConsent,
  } = {}, { restDay = false, capacityOvertime = false, prepareOnly = false } = {}) {
    const boundedOvertime = restDay || capacityOvertime;
    const stableRequestId = cleanText(requestId, 240);
    const clientId = cleanText(customerId, 180);
    const siteId = cleanText(propertyId, 180);
    const requestedWorkLines = normalizeWorkLines(Array.isArray(workLines) && workLines.length
      ? workLines
      : [{ presetId: presetId || serviceId, serviceId, quantity }]);
    // Reuse the canonical Project contract and atomic link writer. A Project must
    // never silently degrade to an unlinked service booking on another path.
    if (project && !restDay) throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
      'Project overtime bookings require the weekly rest booking flow.');
    const projectRequest = project ? normalizeBookingRequest({ project, customerId: clientId,
      propertyId: siteId, workLines: requestedWorkLines }) : null;
    const projectLinks = projectRequest ? require('./projectBookingLinks').withProjectBookingLinks({ db, provider: {} }) : null;
    const projectContext = { channel: actor.source === 'office-scheduling' ? 'office' : '', projectActorId: actor.id };
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
    if (!Number.isFinite(startMinutes) || (!boundedOvertime && startMinutes < AFTER_HOURS_START_MINUTES)) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "After-hours emergency work must start at 17:00 or later.",
        { reason: "after-hours-start-before-17", requestedTime: startTime },
      );
    }

    const now = asDate(clock());
    const currentDate = arubaDateParts(now).date;
    const parsedDate = new Date(`${dateKey}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateKey) {
      throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'A valid appointment date is required.');
    }
    const requestFingerprint = hashId(JSON.stringify({ restDay, ...(capacityOvertime ? { capacityOvertime: true } : {}), clientId, siteId, dwellingId: dwellingId || '', requesterId: requesterId || '', accessContactId: accessContactId || '',
      ...(projectRequest ? { project: projectRequest.project } : {}),
      ...(visitReferences !== undefined ? { visitReferences: referenceInput(visitReferences) } : {}),
      ...(charges !== undefined ? { chargesFingerprint: chargeFingerprint(charges) } : {}),
      requestedWorkLines, dateKey, startTime, rawVanId, customerFacingDescription, technicianInstructions, recipientSelections, actorId: actor.id || actor.userId || '' }), 64);
    const appointmentId = boundedOvertime ? `APT-${capacityOvertime ? 'CO' : 'OT'}-${hashId(stableRequestId, 20).toUpperCase()}` : afterHoursAppointmentId(stableRequestId);
    const workOrderId = afterHoursWorkOrderId(appointmentId);
    const appointmentRef = db.collection(collections.appointments).doc(appointmentId);
    const workOrderRef = db.collection(collections.workOrders).doc(workOrderId);

    // Resolve notification responsibility through the same canonical Contact/Property
    // authority as normal appointments, including reminders for future bookings.
    const recipients = await resolveAppointmentRecipients(db, {
      clientId,
      propertyId: siteId,
      dwellingId,
      selections: recipientSelections,
    });

    return db.runTransaction(async (transaction) => {
      await authorizeInitialCharges({ db, get: ref => transaction.get(ref), input: charges, actor });
      const replaySnapshot = await transaction.get(appointmentRef);
      if (replaySnapshot.exists) {
        const replay = { id: replaySnapshot.id, ...replaySnapshot.data() };
        if (cleanText(boundedOvertime ? replay.overtimeRequestId : replay.afterHoursRequestId, 240) !== stableRequestId
            || (replay.specialBookingFingerprint && replay.specialBookingFingerprint !== requestFingerprint)
            || (charges != null && !replay.specialBookingFingerprint)) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "The deterministic after-hours appointment identity belongs to another request.",
          );
        }
        if (prepareOnly) throw new BookingAuthorityError(BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT, "This overtime request is already saved. Refresh the schedule.");
        if (projectLinks) await projectLinks.authorizeProjectReplay({ appointment: replay, actor, transaction });
        const replayOrderSnapshot = await transaction.get(workOrderRef);
        return {
          success: true,
          replayed: true,
          appointmentId,
          workOrderIds: [workOrderId],
          appointment: replay,
          workOrder: replayOrderSnapshot.exists ? { id: workOrderId, ...replayOrderSnapshot.data() } : null,
        };
      }

      if (dateKey < currentDate) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.INVALID_REQUEST,
          'Emergency and planned overtime bookings require today or a future date.',
          { reason: 'after-hours-past-date', requestedDate: dateKey, currentDate });
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

      const overtime = boundedOvertime ? require('./bookingRestDayOvertime')[capacityOvertime ? 'capacityOvertimePlan' : 'restDayOvertimePlan']({
        data: canonical, van, crew, date: dateKey, time: startTime, workLines: requestedWorkLines,
        now, actor, requestId: stableRequestId, fingerprint: requestFingerprint,
      }) : null;
      const guard = afterHoursGuard(dateKey, vanId);
      const guardRef = db.collection(collections.capacityLocks).doc(guard.id);
      const guardSnapshot = await transaction.get(guardRef);
      if (guardSnapshot.exists) {
        const stored = guardSnapshot.data() || {};
        if (stored.active !== false && cleanText(stored.appointmentId, 180) !== appointmentId
            && (!overtime || !canonical.workOrders.some((order) => order.id === stored.workOrderId
              && timeMinutes(order.time) >= timeMinutes(overtime.proposal.capacityEnd)))) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.SLOT_CONFLICT,
            "This Van already has an open-ended after-hours emergency. Complete or cancel it before assigning another one.",
            { reason: "after-hours-open-job-exists", vanId, appointmentId: stored.appointmentId || "" },
          );
        }
      }

      const existingOpen = canonical.workOrders.find((order) => cleanText(order.vanId, 120) === vanId && activeOpenAfterHours(order));
      if (existingOpen && !overtime) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "This Van already has an open-ended after-hours emergency.",
          { reason: "after-hours-open-job-exists", vanId, workOrderId: existingOpen.id },
        );
      }
      // Bounded manual overtime shares the BAH guard with emergencies, but does not
      // become an open-ended emergency. Its complete reserved tail must stay protected.
      const boundedConflict = canonical.workOrders.find((order) => (order.operationalMoveOvertime?.accepted === true || order.scheduledOvertime?.accepted === true)
        && !['Cancelada', 'Reprogramada', 'cancelled', 'rescheduled'].includes(cleanText(order.status, 80))
        && (order.vanId === vanId || (order.technicianIds || []).some((id) => crew.technicianIds.includes(id)))
        && startMinutes < timeMinutes(order.scheduledOvertime?.capacityEnd || order.operationalMoveOvertime?.capacityEnd));
      if (!overtime && boundedConflict) throw new BookingAuthorityError(BOOKING_ERROR_CODES.SLOT_CONFLICT, 'The Van or crew is reserved by a fixed-duration manual transfer.', { reason: 'bounded-overtime-conflict', workOrderId: boundedConflict.id });

      const client = { id: clientSnapshot.id, ...clientSnapshot.data() };
      const property = { id: propertySnapshot.id, ...propertySnapshot.data() };
      const locationSnapshot = (property.hasIndependentDwellings || dwellingId || requesterId || accessContactId)
        ? await require('./propertyLocations').resolvePropertyLocation({ db, transaction, customer: client, property,
          request: { customerId: clientId, dwellingId, requesterId, accessContactId } }) : undefined;
      const workItems = overtime?.scope.workItems || resolvedWorkLines.map(({ line, preset }, index) => compactObject({
        id: cleanText(line.id, 120) || `AH-WORK-${hashId(`${appointmentId}|${preset.id}|${index}`, 12).toUpperCase()}`,
        presetId: preset.id,
        serviceId: preset.serviceId,
        label: preset.label,
        quantity: line.quantity,
        durationMode: "open_ended",
        serviceDefinitionVersion: preset.serviceDefinitionVersion,
      }));
      const lockSnapshots = overtime ? await Promise.all(overtime.locks.map(async (lock) => {
        const ref = db.collection(collections.capacityLocks).doc(lock.id);
        const snapshot = await transaction.get(ref);
        if (snapshot.exists && snapshot.data()?.active !== false && snapshot.data()?.appointmentId !== appointmentId) {
          throw new BookingAuthorityError(BOOKING_ERROR_CODES.SLOT_CONFLICT, 'An overtime slot is already reserved.');
        }
        return { lock, ref };
      })) : [];
      const projectCommit = projectLinks ? await projectLinks.prepareCommit({ transaction, request: projectRequest,
        context: projectContext, appointmentId, now, option: { date: dateKey, time: startTime,
          assignments: [{ vanId, technicianIds: crew.technicianIds, time: startTime,
            slots: overtime.proposal.requiredSlots, capacityEndTime: overtime.proposal.capacityEnd }] } }) : null;
      if (prepareOnly) return { success: true, proposal: overtime.proposal };
      if (overtime && (overtimeConsent?.accepted !== true || overtimeConsent?.confirmationToken !== overtime.proposal.confirmationToken)) {
        throw new BookingAuthorityError(BOOKING_ERROR_CODES.AVAILABILITY_CHANGED, 'Confirm the current overtime calculation before saving.', { reason: 'overtime-confirmation-required' });
      }
      const scheduledOvertime = overtime ? compactObject({ ...overtime.proposal, confirmationToken: undefined,
        accepted: true, acceptedBy: cleanText(actor.id, 160), acceptedByName: cleanText(actor.name, 160), acceptedAtIso: now.toISOString(), requestId: stableRequestId }) : undefined;
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
        ...(overtime ? { slots: overtime.proposal.requiredSlots, durationMinutes: overtime.proposal.durationMinutes,
          endTime: overtime.proposal.estimatedEnd, capacityEndTime: overtime.proposal.capacityEnd }
          : { afterHoursOpenEnded: true, afterHoursKind: AFTER_HOURS_KIND }),
      });
      const referencesCommit = await prepareVisitReferencesCommit({ db, transaction, input: visitReferences, actor, appointmentId, now });
      const chargesCommit = await prepareInitialCharges({ db, transaction, input: charges, actor, appointmentId,
        appointment: { customerId: clientId, propertyId: siteId, status: "confirmed", workOrderIds: [workOrderId] }, now });
      const appointment = compactObject({
        ...(chargesCommit ? { jobCharges: chargesCommit.value } : {}),
        ...(referencesCommit ? { visitReferences: referencesCommit.value } : {}),
        ...(projectCommit?.fields || {}),
        ...(locationSnapshot ? { dwellingId: dwellingId || '', requesterId: requesterId || '', accessContactId: accessContactId || '', locationSnapshot } : {}),
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
        capacityLockIds: overtime ? overtime.locks.map((lock) => lock.id) : [guard.id],
        workLines: requestedWorkLines,
        workItems,
        ...(overtime ? { scheduledOvertime, overtimeRequestId: stableRequestId,
          endTime: overtime.proposal.estimatedEnd, capacityEndTime: overtime.proposal.capacityEnd,
          lifecycleHistory: [{ kind: capacityOvertime ? 'capacity_overflow_overtime_booked' : 'weekly_rest_overtime_booked', actorId: actor.id, atIso: now.toISOString(), scheduledOvertime }] }
          : { afterHoursKind: AFTER_HOURS_KIND, afterHoursOpenEnded: true, afterHoursRequestId: stableRequestId }),
        specialBookingFingerprint: requestFingerprint,
        actualCompletedAt: null,
        createdBy: cleanText(actor?.id || actor?.userId, 160) || "office-scheduling",
        createdByName: cleanText(actor?.name || actor?.displayName, 160),
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const workOrder = compactObject({
        ...(projectCommit?.fields || {}),
        ...(locationSnapshot ? { dwellingId: dwellingId || '', requesterId: requesterId || '', accessContactId: accessContactId || '', locationSnapshot } : {}),
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
        ...(overtime ? { scheduledOvertime, scheduledSlots: overtime.proposal.requiredSlots,
          appointmentDurationMinutes: overtime.proposal.durationMinutes, appointmentEndTime: overtime.proposal.estimatedEnd,
          appointmentCapacityEndTime: overtime.proposal.capacityEnd }
          : { afterHoursKind: AFTER_HOURS_KIND, afterHoursOpenEnded: true, afterHoursStartTime: startTime, afterHoursGuardId: guard.id }),
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

      if (projectCommit) projectCommit.write({ workOrders: [workOrder], createMode: 'confirmed' });
      transaction.set(appointmentRef, appointment);
      if (referencesCommit) referencesCommit.write();
      if (chargesCommit) chargesCommit.write();
      transaction.set(workOrderRef, workOrder);
      if (overtime) {
        for (const { lock, ref } of lockSnapshots) transaction.set(ref, { ...lock, appointmentId, workOrderId, active: true, createdAtIso: timestamp, updatedAtIso: timestamp });
        // Serialize bounded work with open-ended emergencies and manual overtime moves.
        // The BAH guard is not owned by this appointment; cancellation releases only BALs.
        transaction.set(guardRef, { ...guard, lastBoundedBookingRequestId: stableRequestId, updatedAtIso: timestamp,
          ...(guardSnapshot.exists ? {} : { active: false }) }, { merge: true });
      } else {
        transaction.set(guardRef, compactObject({
          ...guard, appointmentId, workOrderId, active: true, openEnded: true,
          createdAtIso: timestamp, updatedAtIso: timestamp, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }));
      }

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
    createEmergency: (input) => createSpecialBooking(input),
    prepareRestDayOvertime: (input) => createSpecialBooking(input, { restDay: true, prepareOnly: true }),
    createRestDayOvertime: (input) => createSpecialBooking(input, { restDay: true }),
    prepareCapacityOvertime: (input) => createSpecialBooking(input, { capacityOvertime: true, prepareOnly: true }),
    createCapacityOvertime: (input) => createSpecialBooking(input, { capacityOvertime: true }),
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
