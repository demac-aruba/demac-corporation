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
  orderSlotCount,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");
const {
  normalizeOrderTime,
} = require("./bookingCapacityAvailability");
const {
  canonicalizeSchedulingData,
} = require("./bookingVanIdentity");

const OPERATIONAL_MOVE_VERSION = 2;
const INACTIVE_WORK_ORDER_STATUSES = new Set([
  "cancelada",
  "cancelled",
  "canceled",
  "reprogramada",
  "rescheduled",
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

function weekday(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function manualDispatchBlocks(dateKey) {
  const day = weekday(dateKey);
  if (day === 0) return [];
  if (day === 6) return [["09:00", "10:00", "11:00", "12:00"]];
  return [
    ["08:30", "09:30", "10:30"],
    ["13:30", "14:30", "15:30"],
  ];
}

function manualOccupiedSlots(dateKey, startTime, slotCount) {
  const count = Math.max(1, Math.min(6, Math.ceil(Number(slotCount) || 0)));
  for (const block of manualDispatchBlocks(dateKey)) {
    const index = block.indexOf(startTime);
    if (index < 0 || index + count > block.length) continue;
    return block.slice(index, index + count);
  }
  return [];
}

function endFromSlots(slots) {
  const last = slots[slots.length - 1];
  const minutes = timeToMinutes(last);
  return minutes === null ? last || "" : minutesToTime(minutes + 60);
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
  return !INACTIVE_WORK_ORDER_STATUSES.has(normalizedStatus(order?.status));
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

function operationalConflict({ orders, appointmentId, vanId, targetStart, slotCount }) {
  const targetStartMinutes = timeToMinutes(targetStart);
  if (targetStartMinutes === null) return null;
  const targetEndMinutes = targetStartMinutes + slotCount * 60;

  return orders.find((order) => {
    if (!workOrderBlocksOperationalCapacity(order)) return false;
    if (cleanText(order.appointmentId, 180) === appointmentId) return false;
    if (cleanText(order.vanId, 120) !== vanId) return false;
    const existingStart = timeToMinutes(normalizeOrderTime(order.time));
    if (existingStart === null) return false;
    const existingEnd = existingStart + orderSlotCount(order, []) * 60;
    return targetStartMinutes < existingEnd && targetEndMinutes > existingStart;
  }) || null;
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
    const targetTime = cleanText(requestedTime, 20);
    const requiredVanId = cleanText(targetVanId, 120);
    const moveReason = cleanText(reason, 500) || "Drag-and-drop operational move";
    if (!id || stableRequestId.length < 8 || !targetDate || !targetTime || !requiredVanId) {
      throw new BookingAuthorityError(
        BOOKING_ERROR_CODES.INVALID_REQUEST,
        "Operational move requires appointmentId, requestId, requestedDate, requestedTime and targetVanId.",
        { appointmentId: id, requestedDate: targetDate, requestedTime: targetTime, targetVanId: requiredVanId },
      );
    }

    const now = asDate(clock());
    const appointmentRef = db.collection(collections.appointments).doc(id);

    return db.runTransaction(async (transaction) => {
      const appointmentSnapshot = await transaction.get(appointmentRef);
      const appointment = activeAppointment(appointmentSnapshot, id);

      if (cleanText(appointment.lastOperationalMoveRequestId, 240) === stableRequestId) {
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
      const dailyAssignmentQuery = db.collection("dailyVanAssignments").where("date", "==", targetDate);
      const [sameDaySnapshot, vanSnapshot, dailyAssignmentSnapshot] = await Promise.all([
        transaction.get(sameDayQuery),
        transaction.get(db.collection("vans")),
        transaction.get(dailyAssignmentQuery),
      ]);

      const canonical = canonicalizeSchedulingData({
        workOrders: snapshotItems(sameDaySnapshot),
        vans: snapshotItems(vanSnapshot),
        dailyVanAssignments: snapshotItems(dailyAssignmentSnapshot),
        vanHalfDaySchedules: [],
      });
      const targetVan = canonical.vans.find((van) => van.id === requiredVanId);
      if (!targetVan) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The selected van does not exist in the canonical fleet.",
          { reason: "target-van-not-found", targetVanId: requiredVanId },
        );
      }

      const currentOrders = canonical.workOrders.filter((order) => cleanText(order.appointmentId, 180) === id);
      const slotCount = slotCountFromCanonicalAppointment(appointment, assignment, currentOrders);
      const requestedSlots = manualOccupiedSlots(targetDate, targetTime, slotCount);
      if (!requestedSlots.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The complete appointment block does not fit in the selected time window.",
          { reason: "target-outside-visible-capacity", targetVanId: requiredVanId, targetTime, slotCount },
        );
      }

      const conflict = operationalConflict({
        orders: canonical.workOrders,
        appointmentId: id,
        vanId: requiredVanId,
        targetStart: targetTime,
        slotCount,
      });
      if (conflict) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected destination is occupied by another active appointment.",
          { reason: "work-order-conflict", workOrderId: conflict.id, appointmentId: conflict.appointmentId, targetVanId: requiredVanId, targetTime },
        );
      }

      const newLocks = capacityLocks(targetDate, requiredVanId, requestedSlots);
      const newLockIds = new Set(newLocks.map((lock) => lock.id));
      const lockSnapshots = await Promise.all(newLocks.map(async (lock) => {
        const lockRef = db.collection(collections.capacityLocks).doc(lock.id);
        return { lock, lockRef, snapshot: await transaction.get(lockRef) };
      }));

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

      const dailyAssignment = canonical.dailyVanAssignments.find((item) => item.vanId === requiredVanId && item.date === targetDate);
      const crew = targetCrew(targetVan, dailyAssignment);
      const targetEnd = endFromSlots(requestedSlots);
      const nextAssignment = compactObject({
        ...assignment,
        vanId: requiredVanId,
        vanName: targetVan.name || `Van ${requiredVanId.slice(-1)}`,
        technicianIds: crew.technicianIds,
        driverStaffId: crew.driverStaffId,
        helperStaffId: crew.helperStaffId,
        time: targetTime,
        endTime: targetEnd,
        slots: slotCount,
        role: assignment.role || "primary",
      });
      const previousSchedule = scheduleSnapshot(appointment);
      const nextSchedule = {
        dateKey: targetDate,
        primaryVanId: requiredVanId,
        primaryStart: targetTime,
        primaryEnd: targetEnd,
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
      const oldLockIds = Array.isArray(appointment.capacityLockIds) ? appointment.capacityLockIds : [];
      const patch = compactObject({
        date: targetDate,
        startTime: targetTime,
        endTime: targetEnd,
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
        lastOperationalMoveAtIso: now.toISOString(),
        operationalMoveVersion: OPERATIONAL_MOVE_VERSION,
        updatedAt: serverTimestamp(),
      });

      transaction.set(appointmentRef, patch, { merge: true });
      for (const workOrderId of workOrderIds) {
        transaction.set(db.collection(collections.workOrders).doc(workOrderId), compactObject({
          date: targetDate,
          time: targetTime,
          vanId: requiredVanId,
          technicianIds: crew.technicianIds,
          scheduledSlots: slotCount,
          updatedAt: now.toISOString(),
          lastOperationalMoveRequestId: stableRequestId,
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
  manualOccupiedSlots,
  workOrderBlocksOperationalCapacity,
};
