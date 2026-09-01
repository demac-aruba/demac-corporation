const {
  BOOKING_ERROR_CODES,
  BookingAuthorityError,
  cleanText,
  normalizeOfferOption,
} = require("./bookingAuthorityCore");
const {
  BOOKING_COLLECTIONS,
  compactObject,
  validateCapacityLocks,
} = require("./bookingAuthorityFirestore");
const {
  hashId,
  normalizeTime,
  orderBlocksCapacity,
  orderSlotCount,
  snapshotItems,
  workOrderStatusIsTerminal,
} = require("./bookingSchedulingPrimitives");
const {
  normalizeOrderTime,
  workOrderDurationMinutes,
} = require("./bookingCapacityAvailability");
const { createSchedulingProvider } = require("./bookingAuthoritySchedulingProvider");
const { appointmentStillOwnsLock } = require("./bookingAuthorityAppointmentLifecycle");

const OPERATIONAL_MOVE_VERSION = 5;
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

function timeToMinutes(value) {
  const match = cleanText(value, 20).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesToTime(value) {
  const normalized = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function activeAppointment(snapshot, appointmentId) {
  if (!snapshot.exists) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.APPOINTMENT_NOT_FOUND,
      "The appointment does not exist.",
      { appointmentId },
    );
  }
  const appointment = { id: snapshot.id, ...snapshot.data() };
  const status = normalizedStatus(appointment.status);
  if (["cancelled", "canceled", "cancelada"].includes(status)) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.INVALID_REQUEST,
      "A cancelled appointment cannot be moved.",
      { appointmentId },
    );
  }
  return appointment;
}

function primaryAssignment(appointment) {
  const assignments = Array.isArray(appointment.assignments) ? appointment.assignments : [];
  if (assignments.length !== 1) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
      "Simple drag-and-drop requires exactly one canonical van assignment.",
      { reason: "multi-van-booking-requires-reschedule" },
    );
  }
  return assignments[0] || {};
}

function workOrderBlocksOperationalCapacity(order) {
  const appointmentId = cleanText(order?.appointmentId, 180);
  if (!appointmentId) return false;
  return orderBlocksCapacity(order);
}

function slotCountFromCanonicalAppointment(appointment, assignment, currentOrders) {
  const storedAssignmentSlots = Number(assignment?.slots);
  if (Number.isFinite(storedAssignmentSlots) && storedAssignmentSlots > 0) {
    return Math.max(1, Math.min(6, Math.ceil(storedAssignmentSlots)));
  }

  const primaryOrder = currentOrders.find((order) => normalizedStatus(order.appointmentAssignmentRole) !== "support")
    || currentOrders[0];
  if (primaryOrder) {
    const derived = orderSlotCount(primaryOrder, []);
    if (derived > 0) return derived;
  }

  const start = timeToMinutes(cleanText(appointment.startTime || assignment?.time, 20));
  const end = timeToMinutes(cleanText(appointment.endTime || assignment?.endTime, 20));
  if (start !== null && end !== null && end > start) {
    return Math.max(1, Math.min(6, Math.ceil((end - start) / 60)));
  }

  throw new BookingAuthorityError(
    BOOKING_ERROR_CODES.INVALID_REQUEST,
    "The canonical appointment has no reliable duration for drag-and-drop.",
    { appointmentId: cleanText(appointment.appointmentId || appointment.id, 180) },
  );
}

function durationFromCanonicalAppointment(appointment, assignment, currentOrders) {
  const primaryOrder = currentOrders.find((order) => normalizedStatus(order.appointmentAssignmentRole) !== "support")
    || currentOrders[0];
  if (primaryOrder) return workOrderDurationMinutes(primaryOrder, []);

  const start = timeToMinutes(cleanText(appointment.startTime || assignment?.time, 20));
  const end = timeToMinutes(cleanText(appointment.endTime || assignment?.endTime, 20));
  if (start !== null && end !== null && end > start) return end - start;

  return slotCountFromCanonicalAppointment(appointment, assignment, currentOrders) * 60;
}

function targetCrew(van, dailyAssignment) {
  const driverStaffId = cleanText(dailyAssignment?.driverStaffId || van?.responsibleStaffId, 160);
  const helperStaffId = cleanText(dailyAssignment?.helperStaffId || van?.regularHelperId, 160);
  return {
    driverStaffId: driverStaffId || undefined,
    helperStaffId: helperStaffId || undefined,
    technicianIds: [driverStaffId, helperStaffId].filter(Boolean),
  };
}

function capacityLocks(date, vanId, slots) {
  return slots.map((slot) => ({
    id: `BAL-${hashId(`${date}|${vanId}|${slot}`, 32).toUpperCase()}`,
    date,
    vanId,
    slot,
  }));
}

function scheduleSnapshot(appointment = {}) {
  const assignment = Array.isArray(appointment.assignments) ? appointment.assignments[0] || {} : {};
  return compactObject({
    dateKey: cleanText(appointment.date, 20),
    primaryVanId: cleanText(assignment.vanId || appointment.primaryVanId, 120),
    primaryStart: cleanText(assignment.time || appointment.startTime, 20),
    primaryEnd: cleanText(assignment.endTime || appointment.endTime, 20),
  });
}

function actorFields(actor = {}) {
  return {
    actorId: cleanText(actor.id || actor.userId, 160),
    actorName: cleanText(actor.name || actor.displayName, 160),
    source: cleanText(actor.source, 80) || "office-scheduling",
  };
}

function operationalMoveFingerprint({ appointmentId, requestedDate, requestedTime, targetVanId, reason, note }) {
  return hashId(JSON.stringify({
    appointmentId: cleanText(appointmentId, 180),
    requestedDate: cleanText(requestedDate, 20),
    requestedTime: cleanText(requestedTime, 20),
    targetVanId: cleanText(targetVanId, 120),
    reason: cleanText(reason, 500),
    note: cleanText(note, 1_500),
  }), 40);
}

function lifecycleEvent({ requestId, actor, reason, note, now, from, to, customerNotificationRecommended }) {
  const actorInfo = actorFields(actor);
  return compactObject({
    id: `LIFE-OPMOVE-${hashId(requestId, 20).toUpperCase()}`,
    kind: "operational_move",
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

function existingLinkedWorkOrderIds(appointment, currentOrders) {
  const existingIds = new Set(currentOrders.map((order) => cleanText(order.id, 180)).filter(Boolean));
  const canonicalIds = Array.isArray(appointment.workOrderIds)
    ? appointment.workOrderIds.map((id) => cleanText(id, 180)).filter((id) => existingIds.has(id))
    : [];
  if (canonicalIds.length) return canonicalIds;
  return currentOrders
    .filter(workOrderBlocksOperationalCapacity)
    .map((order) => cleanText(order.id, 180))
    .filter(Boolean);
}

function createOperationalMoveAuthority({
  db,
  clock = () => new Date(),
  serverTimestamp = defaultServerTimestamp,
  collections = BOOKING_COLLECTIONS,
} = {}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new Error("A Firestore-compatible db is required.");
  }
  const schedulingProvider = createSchedulingProvider({ db });

  async function moveAppointment({
    appointmentId,
    requestId,
    requestedDate,
    requestedTime,
    targetVanId,
    reason = "Drag-and-drop operational move",
    note = "",
    actor = {},
  } = {}) {
    const id = cleanText(appointmentId, 180);
    const stableRequestId = cleanText(requestId, 240);
    const targetDate = cleanText(requestedDate, 20);
    const targetTime = normalizeTime(requestedTime);
    const requiredVanId = cleanText(targetVanId, 120);
    const moveReason = cleanText(reason, 500) || "Drag-and-drop operational move";
    if (!id || stableRequestId.length < 8 || !targetDate || !targetTime || !requiredVanId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Operational move requires appointmentId, requestId, requestedDate, requestedTime and targetVanId.",
        { appointmentId: id, requestedDate: targetDate, requestedTime: targetTime, targetVanId: requiredVanId },
      );
    }

    const appointmentRef = db.collection(collections.appointments).doc(id);
    const requestFingerprint = operationalMoveFingerprint({
      appointmentId: id,
      requestedDate: targetDate,
      requestedTime: targetTime,
      targetVanId: requiredVanId,
      reason: moveReason,
      note,
    });
    const idempotencyRef = db.collection(collections.idempotency)
      .doc(hashId(`operational-move|${stableRequestId}`, 40));

    return db.runTransaction(async (transaction) => {
      const now = asDate(clock());
      const [appointmentSnapshot, idempotencySnapshot] = await Promise.all([
        transaction.get(appointmentRef),
        transaction.get(idempotencyRef),
      ]);
      const appointment = activeAppointment(appointmentSnapshot, id);
      const persistRequestIdentity = () => transaction.set(idempotencyRef, compactObject({
        id: idempotencyRef.id,
        operation: "operational_move",
        requestId: stableRequestId,
        requestFingerprint,
        appointmentId: id,
        requestedDate: targetDate,
        requestedTime: targetTime,
        targetVanId: requiredVanId,
        createdAtIso: now.toISOString(),
        createdAt: serverTimestamp(),
      }));

      if (idempotencySnapshot.exists) {
        const record = idempotencySnapshot.data() || {};
        const sameRequest = cleanText(record.operation, 80) === "operational_move"
          && cleanText(record.appointmentId, 180) === id
          && cleanText(record.requestId, 240) === stableRequestId
          && cleanText(record.requestFingerprint, 80) === requestFingerprint;
        if (!sameRequest) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This operational move request identity was already used for a different action.",
            { appointmentId: cleanText(record.appointmentId, 180) },
          );
        }
        return {
          success: true,
          replayed: true,
          appointmentId: id,
          changeKind: "operational_move",
          customerNotificationRecommended: appointment.customerNotificationRecommended === true,
          appointment,
        };
      }

      if (cleanText(appointment.lastOperationalMoveRequestId, 240) === stableRequestId) {
        const storedFingerprint = cleanText(appointment.lastOperationalMoveFingerprint, 80);
        const current = scheduleSnapshot(appointment);
        const sameLegacyRequest = storedFingerprint
          ? storedFingerprint === requestFingerprint
          : current.dateKey === targetDate
            && current.primaryVanId === requiredVanId
            && current.primaryStart === targetTime;
        if (!sameLegacyRequest) {
          throw new BookingAuthorityError(
            BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            "This operational move request identity was already used for a different action.",
            { appointmentId: id },
          );
        }
        persistRequestIdentity();
        return {
          success: true,
          replayed: true,
          appointmentId: id,
          changeKind: "operational_move",
          customerNotificationRecommended: appointment.customerNotificationRecommended === true,
          appointment,
        };
      }

      const assignment = primaryAssignment(appointment);
      const currentDate = cleanText(appointment.date, 20);
      const currentTime = cleanText(assignment.time || appointment.startTime, 20);
      const currentVanId = cleanText(assignment.vanId || appointment.primaryVanId, 120);
      if (targetDate !== currentDate) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "Drag-and-drop may only move an appointment within its canonical date.",
          { reason: "operational-move-date-mismatch", currentDate, targetDate },
        );
      }
      if (currentVanId === requiredVanId && currentTime === targetTime) {
        persistRequestIdentity();
        return {
          success: true,
          replayed: true,
          appointmentId: id,
          changeKind: "operational_move",
          customerNotificationRecommended: false,
          appointment,
        };
      }

      const sameDayQuery = db.collection(collections.workOrders).where("date", "==", targetDate);
      const sameDaySnapshot = await transaction.get(sameDayQuery);
      const currentOrders = snapshotItems(sameDaySnapshot).filter((order) => cleanText(order.appointmentId, 180) === id);
      if (currentOrders.some((order) => workOrderStatusIsTerminal(order.status))) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "A terminal Work Order cannot be moved.",
          { appointmentId: id, reason: "terminal-work-order" },
        );
      }
      const slotCount = slotCountFromCanonicalAppointment(appointment, assignment, currentOrders);
      const durationMinutes = durationFromCanonicalAppointment(appointment, assignment, currentOrders);
      const targetStartMinutes = timeToMinutes(targetTime);
      const requestedEnd = targetStartMinutes === null ? "" : minutesToTime(targetStartMinutes + durationMinutes);
      const requestedOption = {
        id: `opt-operational-${hashId(`${id}|${targetDate}|${targetTime}|${requiredVanId}`, 20)}`,
        date: targetDate,
        time: targetTime,
        endTime: requestedEnd,
        address: cleanText(appointment.address, 500),
        quantity: Math.max(1, Math.round(Number(assignment.quantity || appointment.totalQuantity || 1))),
        workItems: Array.isArray(appointment.workItems) ? appointment.workItems : [],
        assignments: [{
          ...assignment,
          vanId: requiredVanId,
          quantity: Math.max(1, Math.round(Number(assignment.quantity || appointment.totalQuantity || 1))),
          slots: slotCount,
          durationMinutes,
          time: targetTime,
          endTime: requestedEnd,
          role: assignment.role || "primary",
        }],
        requestedDateMatch: true,
        requestedTimeMatch: true,
      };
      const request = {
        customerId: cleanText(appointment.customerId, 160),
        propertyId: cleanText(appointment.propertyId, 160),
        workLines: Array.isArray(appointment.workLines) ? appointment.workLines : [],
        constraints: { requestedDate: targetDate, requestedTime: targetTime },
        notes: cleanText(appointment.notes, 1_500),
      };
      const validation = await schedulingProvider.validateTransaction({
        transaction,
        db,
        request,
        option: requestedOption,
        appointmentId: id,
        context: {
          channel: "office",
          changeKind: "operational_move",
          excludeAppointmentId: id,
          requiredPrimaryVanId: requiredVanId,
        },
        now,
      });
      if (!validation?.available || !validation.option) {
        const rejectionReason = cleanText(validation?.reason, 240);
        throw new BookingAuthorityError(
          rejectionReason === "work-order-conflict"
            ? BOOKING_ERROR_CODES.SLOT_CONFLICT
            : BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The selected operational destination is no longer available.",
          compactObject({
            reason: rejectionReason,
            stage: cleanText(validation?.rejection?.stage, 80),
            targetVanId: requiredVanId,
            targetTime,
            slotCount,
          }),
        );
      }
      const committedOption = normalizeOfferOption(validation.option);
      const committedAssignment = committedOption.assignments[0];
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

      // Capacity locks are a concurrency guard, not a second hidden scheduling rule.
      // If the visible canonical work-order schedule has no conflict, detached/stale lock
      // ownership is healed by the atomic lock swap below. Concurrent real bookings still
      // collide on these lock documents and Firestore retries one transaction safely.
      const workOrderIds = existingLinkedWorkOrderIds(appointment, currentOrders);
      if (!workOrderIds.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The canonical appointment has no active linked work order to move.",
          { appointmentId: id },
        );
      }

      const targetEnd = cleanText(committedAssignment.endTime || committedOption.endTime, 20);
      const nextAssignment = compactObject({
        ...assignment,
        ...committedAssignment,
      });
      const previousSchedule = scheduleSnapshot(appointment);
      const nextSchedule = {
        dateKey: targetDate,
        primaryVanId: requiredVanId,
        primaryStart: targetTime,
        primaryEnd: targetEnd,
        primaryCapacityEnd: cleanText(committedAssignment.capacityEndTime, 20),
      };
      const customerNotificationRecommended = currentTime !== targetTime;
      const actorInfo = actorFields(actor);
      const event = lifecycleEvent({
        requestId: stableRequestId,
        actor,
        reason: moveReason,
        note,
        now,
        from: previousSchedule,
        to: nextSchedule,
        customerNotificationRecommended,
      });
      const lifecycleHistory = [...(Array.isArray(appointment.lifecycleHistory) ? appointment.lifecycleHistory : []), event];
      const oldLockIds = [...new Set((Array.isArray(appointment.capacityLockIds) ? appointment.capacityLockIds : [])
        .map((value) => cleanText(value, 180))
        .filter(Boolean))];
      const oldLockSnapshots = await Promise.all(oldLockIds.map(async (lockId) => ({
        lockId,
        ref: db.collection(collections.capacityLocks).doc(lockId),
        snapshot: await transaction.get(db.collection(collections.capacityLocks).doc(lockId)),
      })));
      const patch = compactObject({
        date: targetDate,
        startTime: targetTime,
        endTime: targetEnd,
        capacityEndTime: cleanText(committedAssignment.capacityEndTime, 20),
        assignments: [nextAssignment],
        primaryVanId: requiredVanId,
        capacityLockIds: newLocks.map((lock) => lock.id),
        rescheduleReason: moveReason,
        rescheduleNote: cleanText(note, 1_500),
        lastScheduleChangeKind: "operational_move",
        customerNotificationRecommended,
        rescheduledAtIso: now.toISOString(),
        updatedAtIso: now.toISOString(),
        lifecycleHistory,
        lastLifecycleActorId: actorInfo.actorId,
        lastLifecycleActorName: actorInfo.actorName,
        lastLifecycleSource: actorInfo.source,
        lastOperationalMoveRequestId: stableRequestId,
        lastOperationalMoveFingerprint: requestFingerprint,
        lastOperationalMoveAtIso: now.toISOString(),
        operationalMoveVersion: OPERATIONAL_MOVE_VERSION,
        updatedAt: serverTimestamp(),
      });

      transaction.set(appointmentRef, patch, { merge: true });
      for (const workOrderId of workOrderIds) {
        transaction.set(db.collection(collections.workOrders).doc(workOrderId), compactObject({
          date: targetDate,
          time: targetTime,
          appointmentEndTime: targetEnd,
          appointmentCapacityEndTime: cleanText(committedAssignment.capacityEndTime, 20),
          vanId: requiredVanId,
          technicianIds: committedAssignment.technicianIds,
          driverStaffId: committedAssignment.driverStaffId,
          helperStaffId: committedAssignment.helperStaffId,
          scheduledSlots: committedAssignment.slots,
          updatedAt: now.toISOString(),
          lastOperationalMoveRequestId: stableRequestId,
        }), { merge: true });
      }
      for (const entry of oldLockSnapshots) {
        if (newLockIds.has(entry.lockId)) continue;
        const stored = entry.snapshot.exists ? entry.snapshot.data() || {} : null;
        if (!stored || cleanText(stored.appointmentId, 180) !== id) continue;
        transaction.set(entry.ref, compactObject({
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
      persistRequestIdentity();

      return {
        success: true,
        replayed: false,
        appointmentId: id,
        changeKind: "operational_move",
        customerNotificationRecommended,
        appointment: { ...appointment, ...patch },
        workOrderIds,
      };
    });
  }

  return {
    version: OPERATIONAL_MOVE_VERSION,
    moveAppointment,
  };
}

module.exports = {
  OPERATIONAL_MOVE_VERSION,
  createOperationalMoveAuthority,
  operationalMoveFingerprint,
  workOrderBlocksOperationalCapacity,
};
