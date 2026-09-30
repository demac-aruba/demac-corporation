// Explicit office-only booking in weekly rest or beyond an ordinary afternoon tail.
// This never adds ordinary availability or changes attendance/payroll truth.
const { BOOKING_ERROR_CODES, BookingAuthorityError } = require('./bookingAuthorityCore');
const { REGULAR_SLOTS, hashId, isHalfDay, resolveCrewMembership, arubaDateParts, normalizeTime } = require('./bookingSchedulingPrimitives');
const { resolveWorkScope } = require('./bookingAuthoritySchedulingEngine');
const { workOrderCapacityInterval } = require('./bookingCapacityAvailability');

const KIND = 'weekly_rest_overtime';
const minutes = (time) => /^\d{2}:\d{2}$/.test(time || '') ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN;
const clock = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const fail = (reason, message, code = BOOKING_ERROR_CODES.AVAILABILITY_CHANGED) => {
  throw new BookingAuthorityError(code, message, { reason });
};

function plannedOvertimePlan({ data, van, crew, date, time, workLines, now, actor, requestId, fingerprint }, { capacityOvertime = false } = {}) {
  if (!actor?.id || actor.source !== 'office-scheduling') fail('overtime-office-only', 'An authenticated office operator is required.', BOOKING_ERROR_CODES.INVALID_REQUEST);
  const current = arubaDateParts(now);
  if (date < current.date || (date === current.date && time <= current.time)) fail('overtime-past-start', 'Select a future start for planned overtime.');
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const schedule = isHalfDay(van.id, date, data.vanHalfDaySchedules)
    && data.vanHalfDaySchedules.find((item) => item.active !== false && item.vanId === van.id && Number(item.weekday) === weekday);
  if (!capacityOvertime && !schedule) fail('overtime-not-weekly-rest', 'This Van has no weekly rest window on the selected date.');
  const regularStart = minutes(schedule?.workdayStart || '08:00');
  const regularEnd = minutes(schedule ? schedule.workdayEnd || '13:00' : '16:30');
  const start = minutes(time);
  if (!Number.isFinite(regularStart) || !Number.isFinite(regularEnd) || regularEnd <= regularStart || !REGULAR_SLOTS.includes(time)
      || (!capacityOvertime && start >= regularStart && start < regularEnd)) fail('overtime-not-weekly-rest', 'Select a blocked weekly rest slot.');
  const scope = resolveWorkScope({ workLines }, data);
  const slots = Math.ceil(scope.totalDurationMinutes / 60);
  const end = start + scope.totalDurationMinutes;
  const capacityEnd = start + slots * 60;
  const ordinaryTail = REGULAR_SLOTS.filter(slot => minutes(slot) >= start && minutes(slot) >= regularStart && minutes(slot) + 60 <= regularEnd);
  if (capacityOvertime && (start < 13 * 60 || ordinaryTail[0] !== time
      || ordinaryTail.some((slot, index) => minutes(slot) !== start + index * 60)
      || slots <= ordinaryTail.length)) {
    fail('overtime-not-afternoon-overflow', 'Possible overtime requires work exceeding the remaining ordinary afternoon slots.');
  }
  if (capacityEnd >= 24 * 60) fail('overtime-crosses-midnight', 'The complete overtime booking must finish on the selected date.');
  if (start < regularStart && capacityEnd > regularStart) fail('overtime-crosses-regular-shift', 'Overtime during morning rest must finish before the regular shift starts.');
  if (start < 13 * 60 && capacityEnd > 12 * 60) fail('overtime-protected-lunch', 'The lunch interval remains protected. Select an afternoon start.');
  const members = resolveCrewMembership(van, date, data.dailyVanAssignments).technicianIds;
  if (new Set(members).size !== members.length || members.length !== crew.technicianIds.length
      || members.some((id) => !crew.technicianIds.includes(id))) fail('overtime-staff-unavailable', 'Every assigned crew member must be available.');
  if (data.vans.some((other) => other.id !== van.id && resolveCrewMembership(other, date, data.dailyVanAssignments).technicianIds.some((id) => members.includes(id)))) fail('overtime-duplicate-crew', 'The dated crew is also assigned to another Van.');
  for (const order of data.workOrders) {
    if (['cancelada', 'cancelled', 'canceled', 'reprogramada', 'rescheduled'].includes(String(order.status || '').toLowerCase())) continue;
    const otherVan = data.vans.find((item) => item.id === order.vanId);
    const otherCrew = [...(order.technicianIds || []), ...(otherVan ? resolveCrewMembership(otherVan, date, data.dailyVanAssignments).technicianIds : [])];
    if (order.vanId !== van.id && !otherCrew.some((id) => members.includes(id))) continue;
    const interval = workOrderCapacityInterval(order, data.services, isHalfDay(order.vanId, date, data.vanHalfDaySchedules));
    const otherStart = minutes(normalizeTime(order.time));
    const open = order.afterHoursOpenEnded === true && !['Completada', 'Facturada', 'Pagada'].includes(order.status);
    const otherEnd = open ? 24 * 60 : interval?.capacityEnd;
    if (!Number.isFinite(otherStart) || !Number.isFinite(otherEnd)) fail('overtime-unresolved-conflict', 'Existing Van or crew work has an unresolved time window.');
    if (start < otherEnd && capacityEnd > otherStart) fail('overtime-interval-conflict', 'The complete overtime interval conflicts with existing Van or staff work.', BOOKING_ERROR_CODES.SLOT_CONFLICT);
  }
  const slotStarts = Array.from({ length: slots }, (_, index) => clock(start + index * 60));
  const proposal = { kind: capacityOvertime ? 'capacity_overflow_overtime' : KIND, date, vanId: van.id, vanName: van.name || van.id, start: time,
    estimatedEnd: clock(end), capacityEnd: clock(capacityEnd), durationMinutes: scope.totalDurationMinutes,
    requiredSlots: slots, quantity: scope.totalQuantity, regularStart: clock(regularStart), regularEnd: clock(regularEnd), slotStarts,
    ...(capacityOvertime ? { ordinarySlots: ordinaryTail.length } : {}) };
  const confirmationToken = hashId(JSON.stringify({ requestId, fingerprint, actorId: actor.id, proposal, crew, schedule, workItems: scope.workItems }), 64);
  const locks = slotStarts.map((slot) => ({ id: `BAL-${hashId(`${date}|${van.id}|${slot}`, 32).toUpperCase()}`, date, vanId: van.id, slot }));
  return { proposal: { ...proposal, confirmationToken }, locks, scope };
}

module.exports = { KIND,
  restDayOvertimePlan: input => plannedOvertimePlan(input),
  capacityOvertimePlan: input => plannedOvertimePlan(input, { capacityOvertime: true }),
};
