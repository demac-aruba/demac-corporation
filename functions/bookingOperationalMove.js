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
  isHalfDay,
  occupiedSlots,
  orderSlotCount,
  snapshotItems,
} = require("./bookingSchedulingPrimitives");
const {
  normalizeOrderTime,
} = require("./bookingCapacityAvailability");
const {
  canonicalizeSchedulingData,
} = require("./bookingVanIdentity");

const OPERATIONAL_MOVE_VERSION = 1;
const BLOCKED_VAN_STATUSES = new Set(["mantenimiento", "fuera de servicio"]);
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

function activeAppointment(snapshot, appointmentId) {
  if (!snapshot.exists) {
    throw new BookingAuthorityError(
      BOOKING_ERROR_CODES.APPOINTMENT_NOT_FOUND,
      "The appointment does not exist.",
      { appointmentId },
    );
  }
  const appointment = { id: snapshot.id, ...snapshot.data() };
  const status = cleanText(appointment.status, 40).toLowerCase();
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

function normalizedStatus(value) {
  return cleanText(value, 80).toLowerCase();
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

  const start = cleanText(appointment.startTime || assignment?.time, 20);
  const end = cleanText(appointment.endTime || assignment?.endTime, 20);
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes !== null && endMinutes !== null && endMinutes > startMinutes) {
    return Math.max(1, Math.min(6, Math.ceil((endMinutes - startMinutes) / 60)));
  }

  throw new BookingAuthorityError(
    BOOKING_ERROR_CODES.INVALID_REQUEST,
    "The canonical appointment has no reliable duration for drag-and-drop.",
    { appointmentId: cleanText(appointment.appointmentId || appointment.id, 180) },
  );
}

function timeToMinutes(value) {
  const match = cleanText(value, 20).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function endFromOccupiedSlots(slots) {
  const last = slots[slots.length - 1];
  const minutes = timeToMinutes(last);
  if (minutes === null) return last || "";
  const endMinutes = minutes + 60;
  return `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
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

function targetVanAvailable(van, dailyAssignment) {
  if (!van || van.active === false) return false;
  if (BLOCKED_VAN_STATUSES.has(normalizedStatus(van.status))) return false;
  if (BLOCKED_VAN_STATUSES.has(normalizedStatus(dailyAssignment?.status))) return false;
  return true;
}

function capacityLocks(date, vanId, slots) {
  return slots.map((slot) => ({
    id: `BAL-${hashId(`${date}|${vanId}|${slot}`, 32).toUpperCase()}`,
    date,
    vanId,
    slot,
  }));
}

function appointmentStillOwnsLock(appointment, lockId) {
  if (!appointment) return false;
  const status = normalizedStatus(appointment.status);
  if (["cancelled", "canceled", "cancelada"].includes(status)) return false;
  return Array.isArray(appointment.capacityLockIds) && appointment.capacityLockIds.includes(lockId);
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

function operationalConflict({ orders, appointmentId, vanId, requestedSlots, halfDay }) {
  return orders.find((order) => {
    if (!workOrderBlocksOperationalCapacity(order)) return false;
    if (cleanText(order.appointmentId, 180) === appointmentId) return false;
    if (cleanText(order.vanId, 120) !== vanId) return false;
    const existingSlots = occupiedSlots(
      normalizeOrderTime(order.time),
      orderSlotCount(order, []),
      halfDay,
    );
    return existingSlots.some((slot) => requestedSlots.includes(slot));
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
      const [sameDaySnapshot, vanSnapshot, halfDaySnapshot, dailyAssignmentSnapshot] = await Promise.all([
        transaction.get(sameDayQuery),
        transaction.get(db.collection("vans")),
        transaction.get(db.collection("vanHalfDaySchedules")),
        transaction.get(dailyAssignmentQuery),
      ]);

      const canonical = canonicalizeSchedulingData({
        workOrders: snapshotItems(sameDaySnapshot),
        vans: snapshotItems(vanSnapshot),
        vanHalfDaySchedules: snapshotItems(halfDaySnapshot),
        dailyVanAssignments: snapshotItems(dailyAssignmentSnapshot),
      });
      const targetVan = canonical.vans.find((van) => van.id === requiredVanId);
      const dailyAssignment = canonical.dailyVanAssignments.find((item) => item.vanId === requiredVanId && item.date === targetDate);
      if (!targetVanAvailable(targetVan, dailyAssignment)) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The target van is not operationally available for this move.",
          { reason: "target-van-unavailable", targetVanId: requiredVanId },
        );
      }

      const currentOrders = canonical.workOrders.filter((order) => cleanText(order.appointmentId, 180) === id);
      const slotCount = slotCountFromCanonicalAppointment(appointment, assignment, currentOrders);
      const halfDay = isHalfDay(requiredVanId, targetDate, canonical.vanHalfDaySchedules);
      const requestedSlots = occupiedSlots(targetTime, slotCount, halfDay);
      if (!requestedSlots.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.AVAILABILITY_CHANGED,
          "The complete appointment block does not fit in the selected van/time window.",
          { reason: halfDay ? "target-outside-half-day-capacity" : "target-outside-workday-capacity", targetVanId: requiredVanId, targetTime, slotCount },
        );
      }

      const conflict = operationalConflict({
        orders: canonical.workOrders,
        appointmentId: id,
        vanId: requiredVanId,
        requestedSlots,
        halfDay,
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
      const foreignOwnerIds = [...new Set(lockSnapshots
        .filter((entry) => entry.snapshot.exists)
        .map((entry) => entry.snapshot.data() || {})
        .filter((stored) => stored.active !== false && cleanText(stored.appointmentId, 180) !== id)
        .map((stored) => cleanText(stored.appointmentId, 180))
        .filter(Boolean))];
      const ownerSnapshots = await Promise.all(foreignOwnerIds.map(async (ownerId) => ({
        ownerId,
        snapshot: await transaction.get(db.collection(collections.appointments).doc(ownerId)),
      })));
      const owners = new Map(ownerSnapshots.map(({ ownerId, snapshot }) => [
        ownerId,
        snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null,
      ]));
      for (const entry of lockSnapshots) {
        if (!entry.snapshot.exists) continue;
        const stored = entry.snapshot.data() || {};
        const ownerId = cleanText(stored.appointmentId, 180);
        if (stored.active === false || !ownerId || ownerId === id) continue;
        if (!appointmentStillOwnsLock(owners.get(ownerId), entry.lock.id)) continue;
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.SLOT_CONFLICT,
          "The selected destination is owned by another active appointment.",
          { reason: "capacity-lock-conflict", appointmentId: ownerId, targetVanId: requiredVanId, slot: entry.lock.slot },
        );
      }

      const workOrderIds = existingLinkedWorkOrderIds(appointment, currentOrders);
      if (!workOrderIds.length) {
        throw new BookingAuthorityError(
          BOOKING_ERROR_CODES.INVALID_REQUEST,
          "The canonical appointment has no active linked work order to move.",
          { appointmentId: id },
        );
      }

      const crew = targetCrew(targetVan, dailyAssignment);
      const targetEnd = endFromOccupiedSlots(requestedSlots);
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
  targetVanAvailable,
  workOrderBlocksOperationalCapacity,
};
