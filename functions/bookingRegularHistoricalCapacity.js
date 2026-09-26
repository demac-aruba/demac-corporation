'use strict';

const { BOOKING_ERROR_CODES, BookingAuthorityError, cleanText, hashKey } = require('./bookingAuthorityCore');
const { arubaDateParts, capacitySlotsForOwnership, isHalfDay, minutesTime, timeMinutes,
  orderBlocksCapacity } = require('./bookingSchedulingPrimitives');
const { assignmentCapacityInterval } = require('./bookingCapacityAvailability');
const { assertNoLinkedCommercialEvidence, assertNoFieldExecutionEvidence } = require('./projectCommercialGuard');

const lockId = (date, vanId, slot) => `BAL-${hashKey(`${date}|${vanId}|${slot}`, 32).toUpperCase()}`;
const sameCrew = (left, right) => JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
const fail = (message, code = BOOKING_ERROR_CODES.INVALID_REQUEST) => {
  throw new BookingAuthorityError(code, message);
};

function normalizeInput(value = {}) {
  const input = {
    appointmentId: cleanText(value.appointmentId, 180),
    requestId: cleanText(value.requestId, 240),
    expectedSlots: Number(value.expectedSlots),
    slots: Number(value.slots),
    reason: cleanText(value.reason, 1_001),
    noBillingAcknowledged: value.noBillingAcknowledged === true,
  };
  if (!input.appointmentId || input.requestId.length < 8
    || !Number.isSafeInteger(input.expectedSlots) || input.expectedSlots < 1 || input.expectedSlots > 6
    || !Number.isSafeInteger(input.slots) || input.slots < 1 || input.slots > 6
    || input.reason.length < 5 || input.reason.length > 1000) {
    fail('Appointment, stable request ID, current and corrected whole slots (1–6), and a reason (5–1000 characters) are required.');
  }
  return input;
}

async function readContext({ db, get, appointmentId, now }) {
  const appointmentRef = db.collection('appointments').doc(appointmentId);
  const [appointmentSnap, claimSnap, halfDaySnapshot] = await Promise.all([
    get(appointmentRef),
    get(db.collection('projectBookingClaims').doc(appointmentId)),
    get(db.collection('vanHalfDaySchedules')),
  ]);
  const appointment = appointmentSnap.exists ? appointmentSnap.data() : null;
  if (!appointment || appointment.bookingAuthorityVersion !== 1 || appointment.status !== 'confirmed'
    || !/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) || appointment.date >= arubaDateParts(now).date) {
    fail('Choose a confirmed canonical Regular Booking before today in Aruba.');
  }
  if (claimSnap.exists || appointment.projectId || appointment.projectPhaseId || appointment.projectName || appointment.project) {
    fail('Project-linked bookings must be corrected in Projects.');
  }
  if (appointment.assignments?.length !== 1 || appointment.workOrderIds?.length !== 1) {
    fail('Only a single-Van Regular Booking can have historical slots adjusted.');
  }
  const assignment = appointment.assignments[0];
  const workOrderId = cleanText(appointment.workOrderIds[0], 180);
  if (!workOrderId || !assignment?.vanId || appointment.primaryVanId !== assignment.vanId
    || !Array.isArray(assignment.technicianIds) || !assignment.technicianIds.length
    || assignment.technicianIds.some(id => !cleanText(id, 180))
    || !appointment.startTime || (assignment.time || appointment.startTime) !== appointment.startTime) {
    fail('Historical Van, crew or start cannot be verified.');
  }
  const orderSnap = await get(db.collection('workOrders').doc(workOrderId));
  const order = orderSnap.exists ? orderSnap.data() : null;
  if (!order || order.appointmentId !== appointmentId || order.status !== 'Confirmada'
    || order.projectId || order.projectPhaseId || order.projectName
    || order.clientId !== appointment.customerId || order.propertyId !== appointment.propertyId
    || order.date !== appointment.date || order.time !== appointment.startTime
    || order.vanId !== assignment.vanId || !sameCrew(order.technicianIds, assignment.technicianIds)) {
    fail('Appointment and Work Order identities or crew disagree.');
  }
  const currentSlots = Number(assignment.slots);
  if (!Number.isSafeInteger(currentSlots) || currentSlots < 1 || currentSlots > 6
    || Number(order.scheduledSlots) !== currentSlots) fail('Current Regular Booking slots disagree with the Work Order.');
  if (!Array.isArray(halfDaySnapshot.docs)) fail('Historical Van capacity policy could not be read.');
  const halfDay = isHalfDay(assignment.vanId, appointment.date, halfDaySnapshot.docs.map(doc => doc.data()));
  const quantity = Number(assignment.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 6
    || (order.airConditionerCount !== undefined && Number(order.airConditionerCount) !== quantity)
    || Boolean(assignment.fullDay) !== Boolean(order.fullDaySingleProperty)
    || (assignment.fullDay === true && (halfDay || currentSlots !== 6 || quantity !== 6 || appointment.startTime !== '08:30'))) {
    // The 7-unit exception is six capacity slots but seven hours of work. It
    // cannot be changed through a simple one-hour-per-slot correction.
    fail('Nonstandard Regular Booking scope needs separate capacity review.');
  }
  const currentDuration = Number(assignment.durationMinutes);
  if (!Number.isSafeInteger(currentDuration) || currentDuration < 1
    || Number(order.appointmentDurationMinutes) !== currentDuration) {
    fail('Recorded work duration disagrees between the Appointment and Work Order.');
  }
  const workItems = order.appointmentWorkItems;
  if (currentDuration !== currentSlots * 60 || !Array.isArray(workItems) || !workItems.length
    || workItems.some(item => !Number.isSafeInteger(Number(item?.quantity)) || Number(item.quantity) < 1
      || Number(item?.durationMinutesPerUnit) !== 60 || item?.durationMode !== 'per_unit'
      || Number(item?.durationMinutes) !== Number(item.quantity) * 60)
    || workItems.reduce((sum, item) => sum + Number(item.quantity), 0) !== quantity) {
    fail('Only one-hour-per-unit Regular Bookings with reconciled work scope can use this slot correction.');
  }
  const workScopeDuration = workItems.reduce((sum, item) => sum + Number(item.durationMinutes), 0);
  const workScopeDigest = hashKey(JSON.stringify(workItems), 64);
  const previousCorrectionId = cleanText(appointment.regularCapacityCorrectionRequestId, 240);
  if (previousCorrectionId || order.regularCapacityCorrectionRequestId) {
    if (!previousCorrectionId || order.regularCapacityCorrectionRequestId !== previousCorrectionId) {
      fail('Previous Regular Booking correction markers disagree.');
    }
    const previousSnap = await get(db.collection('regularCapacityCorrections').doc(hashKey(previousCorrectionId, 64)));
    const previous = previousSnap.exists ? previousSnap.data() : null;
    if (!previous || previous.appointmentId !== appointmentId || previous.workOrderId !== workOrderId
      || previous.currentSlots !== currentSlots || previous.workScopeDigest !== workScopeDigest) {
      fail('Previous Regular Booking correction audit cannot be reconciled.');
    }
  } else if (workScopeDuration !== currentDuration) {
    fail('Original Regular Booking work scope and planned duration disagree.');
  }
  const currentInterval = assignmentCapacityInterval({ time: appointment.startTime,
    allocation: { slots: currentSlots, durationMinutes: currentDuration }, halfDay });
  const currentAnchors = capacitySlotsForOwnership(appointment.startTime, currentSlots, halfDay);
  if (!currentInterval || currentAnchors.length !== currentSlots
    || JSON.stringify(currentInterval.lockSlots) !== JSON.stringify(currentAnchors)) {
    fail('Current slots do not fit the canonical Van day.');
  }
  const currentWorkEnd = minutesTime(currentInterval.end);
  const currentCapacityEnd = minutesTime(currentInterval.capacityEnd);
  if (appointment.endTime !== currentWorkEnd || assignment.endTime !== currentWorkEnd
    || order.appointmentEndTime !== currentWorkEnd
    || appointment.capacityEndTime !== currentCapacityEnd
    || assignment.capacityEndTime !== currentCapacityEnd
    || order.appointmentCapacityEndTime !== currentCapacityEnd) {
    fail('The recorded work end or capacity end disagrees with canonical allocation; reconcile this booking separately.');
  }
  const ownedIds = Array.isArray(appointment.capacityLockIds) ? appointment.capacityLockIds : [];
  if (ownedIds.length !== currentSlots || new Set(ownedIds).size !== currentSlots
    || currentAnchors.some(slot => !ownedIds.includes(lockId(appointment.date, assignment.vanId, slot)))) {
    fail('Canonical capacity-lock ownership is ambiguous.');
  }
  const snapshots = await Promise.all(currentAnchors.map(slot => get(db.collection('bookingCapacityLocks').doc(lockId(appointment.date, assignment.vanId, slot)))));
  for (let index = 0; index < snapshots.length; index += 1) {
    const lock = snapshots[index].exists ? snapshots[index].data() : null;
    if (!lock || lock.active !== true || lock.appointmentId !== appointmentId
      || lock.date !== appointment.date || lock.vanId !== assignment.vanId || lock.slot !== currentAnchors[index]) {
      fail('Canonical capacity locks no longer match this Regular Booking.');
    }
  }
  const ownedSnapshot = await get(db.collection('bookingCapacityLocks').where('appointmentId', '==', appointmentId));
  if (!Array.isArray(ownedSnapshot.docs)
    || ownedSnapshot.docs.some(doc => doc.data().active !== false && !ownedIds.includes(doc.id))) {
    fail('Additional capacity locks cannot be reconciled.');
  }
  await assertNoFieldExecutionEvidence({ db, get, appointment, order, workOrderId, appointmentId,
    allowSyntheticBackdatedMarker: true });
  await assertNoLinkedCommercialEvidence({ db, get, appointment, order, workOrderId, appointmentId });
  return { appointment, assignment, order, workOrderId, halfDay, currentSlots, currentAnchors,
    workScopeDigest, workScopeDuration };
}

function conflictInterval(order) {
  const start = timeMinutes(order.time);
  const workEnd = timeMinutes(order.appointmentEndTime);
  const capacityEnd = timeMinutes(order.appointmentCapacityEndTime);
  const duration = Number(order.appointmentDurationMinutes);
  if (start === null || (workEnd === null && capacityEnd === null)
    || (workEnd !== null && workEnd <= start) || (capacityEnd !== null && capacityEnd <= start)
    || (Number.isFinite(duration) && duration > 0 && !Number.isSafeInteger(duration))) return null;
  const calculatedEnd = Number.isSafeInteger(duration) && duration > 0 ? start + duration : start;
  return { start, end: Math.max(workEnd ?? start, capacityEnd ?? start, calculatedEnd) };
}

function conflicts(order, target) {
  if (!orderBlocksCapacity(order)) return false;
  if (order.vanId !== target.vanId && !(Array.isArray(order.technicianIds) ? order.technicianIds : []).some(id => target.technicianIds.includes(id))) return false;
  const interval = conflictInterval(order);
  if (!interval) return true;
  return interval.start < timeMinutes(target.end) && interval.end > timeMinutes(target.start);
}

function createRegularHistoricalCapacityAuthority({ db, clock = () => new Date() }) {
  async function adjust(actor, rawInput) {
    const input = normalizeInput(rawInput);
    const actorId = cleanText(actor?.id, 160);
    if (!actorId || actor?.source !== 'office-scheduling') fail('Office Booking Authority is required.', 'permission_denied');
    const fingerprint = hashKey(JSON.stringify({ ...input, actorId }), 64);
    const auditRef = db.collection('regularCapacityCorrections').doc(hashKey(input.requestId, 64));
    return db.runTransaction(async transaction => {
      const get = ref => transaction.get(ref);
      const auditSnap = await get(auditRef);
      const appointmentRef = db.collection('appointments').doc(input.appointmentId);
      const appointmentSnap = await get(appointmentRef);
      if (auditSnap.exists) {
        const audit = auditSnap.data();
        if (audit.fingerprint !== fingerprint) fail('This request ID was already used with different correction details.', BOOKING_ERROR_CODES.IDEMPOTENCY_CONFLICT);
        const appointment = appointmentSnap.exists ? appointmentSnap.data() : null;
        return { success: true, replayed: true, appointmentId: input.appointmentId,
          workOrderId: audit.workOrderId,
          previousSlots: audit.previousSlots, currentSlots: audit.currentSlots,
          observedCurrentSlots: Number(appointment?.assignments?.[0]?.slots) || null,
          currentMatchesAudit: Number(appointment?.assignments?.[0]?.slots) === audit.currentSlots,
          audit };
      }
      if (!input.noBillingAcknowledged) fail('Confirm that this booking has no invoice or payment, including outside DEMAC ERP.');
      const context = await readContext({ db, get, appointmentId: input.appointmentId, now: clock() });
      const { appointment, assignment, workOrderId, halfDay, currentSlots, currentAnchors,
        workScopeDigest, workScopeDuration } = context;
      if (currentSlots !== input.expectedSlots) fail('Booking slots changed. Reload and review the correction again.', BOOKING_ERROR_CODES.AVAILABILITY_CHANGED);
      if (input.slots === currentSlots) fail('Choose a different whole-slot count.');
      const durationMinutes = input.slots * 60;
      const targetInterval = assignmentCapacityInterval({ time: appointment.startTime,
        allocation: { slots: input.slots, durationMinutes }, halfDay });
      const targetAnchors = targetInterval?.lockSlots || [];
      if (targetAnchors.length !== input.slots || targetAnchors.some((slot, index) => index < Math.min(input.slots, currentSlots) && slot !== currentAnchors[index])) {
        fail('Requested slots must be a contiguous tail of this historical Van allocation.');
      }
      const added = targetAnchors.slice(currentSlots);
      const removed = currentAnchors.slice(input.slots);
      const addedRefs = added.map(slot => db.collection('bookingCapacityLocks').doc(lockId(appointment.date, assignment.vanId, slot)));
      const addedSnaps = await Promise.all(addedRefs.map(get));
      if (addedSnaps.some((snap, index) => snap.exists
        && (snap.data().active !== false || snap.data().date !== appointment.date
          || snap.data().vanId !== assignment.vanId || snap.data().slot !== added[index]))) {
        fail('Historical Van slot is already reserved or ambiguous.', BOOKING_ERROR_CODES.SLOT_CONFLICT);
      }
      if (added.length) {
        const sameDay = await get(db.collection('workOrders').where('date', '==', appointment.date));
        if (!Array.isArray(sameDay.docs)) fail('Historical same-day work could not be reconciled.');
        // The added sellable anchor may sit after lunch while the corrected work
        // interval crosses lunch. Compare the full target, not just added anchors.
        const target = { vanId: assignment.vanId, technicianIds: assignment.technicianIds,
          start: appointment.startTime, end: minutesTime(targetInterval.capacityEnd) };
        const ambiguousCrew = order => {
          if (!orderBlocksCapacity(order) || (Array.isArray(order.technicianIds)
            && order.technicianIds.length > 0
            && order.technicianIds.every(id => typeof id === 'string' && id.trim()))) return false;
          const interval = conflictInterval(order);
          return !interval || (interval.start < timeMinutes(target.end) && interval.end > timeMinutes(target.start));
        };
        if (sameDay.docs.some(doc => doc.id !== workOrderId
          && (conflicts(doc.data(), target) || ambiguousCrew(doc.data())))) {
          fail('Historical Van or technician capacity is occupied or ambiguous.', BOOKING_ERROR_CODES.SLOT_CONFLICT);
        }
      }
      const workEnd = minutesTime(targetInterval.end);
      const capacityEnd = minutesTime(targetInterval.capacityEnd);
      if (!workEnd || !capacityEnd || durationMinutes <= 0 || durationMinutes > 24 * 60) fail('Historical slot end is invalid.');
      const now = clock().toISOString();
      // Owning all ordinary anchors is not the special 7-unit full-day rule.
      const fullDay = false;
      const event = { kind: 'regular_historical_capacity_adjusted', requestId: input.requestId,
        at: now, actorId, actorName: cleanText(actor.name, 160), reason: input.reason,
        fromSlots: currentSlots, toSlots: input.slots, workScopeDigest,
        customerNotificationRecommended: false };
      const targetIds = targetAnchors.map(slot => lockId(appointment.date, assignment.vanId, slot));
      const appointmentPatch = { assignments: [{ ...assignment, slots: input.slots, durationMinutes,
          endTime: workEnd, capacityEndTime: capacityEnd, fullDay }], capacityLockIds: targetIds,
        endTime: workEnd, capacityEndTime: capacityEnd,
        lifecycleHistory: [...(appointment.lifecycleHistory || []), event],
        lastScheduleChangeKind: 'regular_historical_capacity_adjusted', customerNotificationRecommended: false,
        regularCapacityCorrectionRequestId: input.requestId, updatedAtIso: now };
      const orderPatch = { scheduledSlots: input.slots, appointmentDurationMinutes: durationMinutes,
        appointmentEndTime: workEnd, appointmentCapacityEndTime: capacityEnd,
        fullDaySingleProperty: fullDay, customerNotificationRecommended: false,
        regularCapacityCorrectionRequestId: input.requestId, updatedAt: now };
      const audit = { fingerprint, requestId: input.requestId, appointmentId: input.appointmentId,
        workOrderId, actorId, actorName: cleanText(actor.name, 160), reason: input.reason,
        recordedAtIso: now, previousSlots: currentSlots, currentSlots: input.slots,
        noBillingAcknowledged: true, date: appointment.date, start: appointment.startTime,
        vanId: assignment.vanId, technicianIds: assignment.technicianIds,
        workScopeDigest, workScopeDuration,
        addedSlots: added, releasedSlots: removed };
      transaction.set(appointmentRef, appointmentPatch, { merge: true });
      transaction.set(db.collection('workOrders').doc(workOrderId), orderPatch, { merge: true });
      for (const slot of removed) transaction.set(db.collection('bookingCapacityLocks').doc(lockId(appointment.date, assignment.vanId, slot)),
        { active: false, releasedAtIso: now, releaseReason: 'regular_historical_capacity_adjusted', updatedAtIso: now }, { merge: true });
      for (let index = 0; index < added.length; index += 1) transaction.set(addedRefs[index],
        { date: appointment.date, vanId: assignment.vanId, slot: added[index], appointmentId: input.appointmentId,
          active: true, reservedAtIso: now, updatedAtIso: now }, { merge: true });
      transaction.set(auditRef, audit);
      return { success: true, replayed: false, appointmentId: input.appointmentId, workOrderId,
        previousSlots: currentSlots, currentSlots: input.slots,
        observedCurrentSlots: input.slots, currentMatchesAudit: true, audit };
    });
  }
  return { adjust };
}

module.exports = { createRegularHistoricalCapacityAuthority, normalizeInput, readContext, lockId };
