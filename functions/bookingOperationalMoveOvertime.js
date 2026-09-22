// A bounded extension of the existing manual-move authority, never an availability
// provider for automatic bookings. Ordinary booking slots are deliberately unchanged.
const { BOOKING_ERROR_CODES, BookingAuthorityError, cleanText } = require('./bookingAuthorityCore');
const { bookingSlots, hashId, isHalfDay, resolveAssignment, resolveCrewMembership, vanCanReceiveAppointments, arubaDateParts } = require('./bookingSchedulingPrimitives');
const { normalizeOrderTime, workOrderDurationMinutes, workOrderCapacityInterval } = require('./bookingCapacityAvailability');
const { activeOpenAfterHours, businessDateOpen, timeMinutes } = require('./bookingAfterHours');

const clock = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const inactive = (order) => ['cancelled', 'canceled', 'cancelada', 'reprogramada', 'rescheduled'].includes(cleanText(order?.status, 80).toLowerCase());
const fail = (reason, message, code = BOOKING_ERROR_CODES.AVAILABILITY_CHANGED) => {
  throw new BookingAuthorityError(code, message, { reason });
};

function ordinaryMoveWindow(data, vanId, date) {
  const halfDay = isHalfDay(vanId, date, data.vanHalfDaySchedules);
  const schedule = halfDay && data.vanHalfDaySchedules.find((item) => item.active !== false && item.vanId === vanId && Number(item.weekday) === new Date(`${date}T12:00:00Z`).getUTCDay());
  const starts = bookingSlots(halfDay);
  const start = schedule ? timeMinutes(schedule.workdayStart || '08:00') : 8 * 60;
  const end = schedule ? timeMinutes(schedule.workdayEnd || '13:00') : timeMinutes(starts.at(-1)) + 60;
  return { start, end, starts: starts.filter((value) => timeMinutes(value) >= start && timeMinutes(value) + 60 <= end) };
}

function moveOvertimePlan({ data, appointment, assignment, van, date, time, slotCount, durationMinutes, now, actor, requestId }) {
  const window = ordinaryMoveWindow(data, van.id, date);
  const index = window.starts.indexOf(time);
  const remaining = index < 0 ? [] : window.starts.slice(index);
  const start = timeMinutes(time);
  const end = start + durationMinutes;
  const needed = index >= 0 && (remaining.length < slotCount || end > window.end);
  if (!needed) return null;
  if (remaining.some((value, i) => i > 0 && timeMinutes(value) - timeMinutes(remaining[i - 1]) !== 60)) fail('overtime-nonconsecutive-tail', 'The exception requires consecutive free ordinary spots through the end of the shift.');
  if (!remaining.length || start < window.start || start >= window.end || end >= 24 * 60) fail('overtime-outside-tail', 'The move must begin in remaining ordinary capacity and finish on the same date.');
  if (assignment.vanId === van.id || appointment.date !== date) fail('overtime-cross-van-only', 'Possible overtime is only available for a same-date transfer between Vans.');
  if (date < arubaDateParts(now).date) fail('overtime-historical-date', 'Possible overtime cannot change historical appointments.');
  if (appointment.status !== 'confirmed' || appointment.afterHoursOpenEnded || appointment.executionOutcome || appointment.fullDaySingleProperty) fail('overtime-ineligible-appointment', 'Only an unexecuted confirmed fixed-duration appointment can use this exception.');
  if (!actor?.id || actor.source !== 'office-scheduling') fail('overtime-office-only', 'An authenticated office operator is required.', BOOKING_ERROR_CODES.INVALID_REQUEST);
  if (!businessDateOpen(date, data.businessSettings, data.calendarClosures)) fail('company-calendar-closed', 'The canonical company calendar is closed.');
  const crew = resolveAssignment(van, date, data.staffProfiles, data.dailyVanAssignments, data.staffAbsences);
  if (!vanCanReceiveAppointments(van, crew)) fail('overtime-crew-unavailable', 'The Van or its dated crew is unavailable.');
  const members = resolveCrewMembership(van, date, data.dailyVanAssignments).technicianIds;
  if (new Set(members).size !== members.length || members.some((id) => !crew.technicianIds.includes(id))) fail('overtime-staff-unavailable', 'Every assigned crew member must be available.');
  if (data.vans.some((other) => other.id !== van.id && resolveCrewMembership(other, date, data.dailyVanAssignments).technicianIds.some((id) => crew.technicianIds.includes(id)))) fail('overtime-duplicate-crew', 'The dated crew is also assigned to another Van.');

  const owned = remaining.slice(0, slotCount);
  while (owned.length < slotCount) owned.push(clock(timeMinutes(owned.at(-1)) + 60));
  // Preserve capacity ownership even when elapsed work and service anchors differ at lunch.
  const capacityEnd = Math.max(end, timeMinutes(owned.at(-1)) + 60);
  if (capacityEnd >= 24 * 60) fail('overtime-crosses-midnight', 'All capacity must remain on the appointment date.');
  const sourceOrders = data.workOrders.filter((order) => order.appointmentId === appointment.id && order.appointmentAssignmentRole !== 'support');
  if (!sourceOrders.length || sourceOrders.some((order) => !['Confirmada', 'confirmed', 'Pendiente', 'pending'].includes(order.status) || order.actualStartedAt || order.actualCompletedAt || order.fullDaySingleProperty)) fail('overtime-executed-work', 'Executed or nonstandard work cannot be moved through this exception.');

  for (const order of data.workOrders) {
    if (inactive(order) || sourceOrders.some((source) => source.id === order.id)) continue;
    const otherStart = timeMinutes(normalizeOrderTime(order.time));
    const interval = workOrderCapacityInterval(order, [], isHalfDay(order.vanId, date, data.vanHalfDaySchedules));
    const otherEnd = activeOpenAfterHours(order) ? 24 * 60 : Math.max(interval?.capacityEnd || 0, timeMinutes(order.operationalMoveOvertime?.capacityEnd || '') || 0, otherStart + workOrderDurationMinutes(order, []));
    const otherVan = data.vans.find((item) => item.id === order.vanId);
    const otherCrew = [...(order.technicianIds || []), ...(otherVan ? resolveCrewMembership(otherVan, date, data.dailyVanAssignments).technicianIds : [])];
    if ((order.vanId === van.id || otherCrew.some((id) => crew.technicianIds.includes(id))) && start < otherEnd && capacityEnd > otherStart) fail('overtime-interval-conflict', 'The complete destination interval conflicts with existing Van or staff work.', BOOKING_ERROR_CODES.SLOT_CONFLICT);
  }
  const proposal = {
    vanId: van.id, vanName: van.name || van.id, start: time,
    requiredSlots: slotCount, ordinarySlots: Math.min(slotCount, remaining.length),
    estimatedEnd: clock(end), ordinaryEnd: clock(window.end), capacityEnd: clock(capacityEnd),
  };
  // Bind consent to the operator, source revision/scope, destination and displayed calculation.
  const confirmationToken = hashId(JSON.stringify({ requestId, actorId: actor.id, appointment, sourceOrders, proposal, crew }), 64);
  return { proposal: { ...proposal, confirmationToken }, owned, crew, sourceOrders };
}

module.exports = { moveOvertimePlan, ordinaryMoveWindow };
