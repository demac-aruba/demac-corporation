const {
  EXTRA_MORNING_SLOT,
  MORNING_SLOTS,
  REGULAR_SLOTS,
  capacitySlotsForInterval,
  endTime,
  isHalfDay,
  orderBlocksCapacity,
  resolveAssignment,
  vanCanReceiveAppointments,
} = require("./bookingSchedulingPrimitives");
const { workOrderCapacityInterval } = require("./bookingCapacityAvailability");

function text(value) {
  return String(value ?? "").trim();
}

function canonicalDaySlots(vanId, dateKey, halfDaySchedules = []) {
  return isHalfDay(text(vanId), text(dateKey), halfDaySchedules)
    ? [...MORNING_SLOTS, EXTRA_MORNING_SLOT]
    : [...REGULAR_SLOTS];
}

function reservedSlotsForOrder(order, services = [], halfDaySchedules = []) {
  if (!order || !orderBlocksCapacity(order)) return [];
  const halfDay = isHalfDay(text(order.vanId), text(order.date), halfDaySchedules);

  // Full-day policy is a capacity reservation, not a fabricated wall-clock end.
  // It intentionally owns every sellable start for the Van/day.
  if (order.fullDaySingleProperty === true) return canonicalDaySlots(order.vanId, order.date, halfDaySchedules);

  const interval = workOrderCapacityInterval(order, services, halfDay);
  if (interval) {
    return capacitySlotsForInterval(text(order.time), interval.durationMinutes, halfDay);
  }

  // Historical fallback only: older records may contain an explicit lock/start array
  // but no duration/end snapshot. Preserve those reservations without making arrays
  // the timing authority for modern Work Orders.
  if (Array.isArray(order.scheduledSlots)) {
    return [...new Set(order.scheduledSlots.map(text).filter(Boolean))];
  }
  return [];
}

function vanPendingCapacityAvailable({ van, dateKey, staffProfiles = [], dailyVanAssignments = [], staffAbsences = [] } = {}) {
  if (!van || !dateKey) return false;
  const assignment = resolveAssignment(van, dateKey, staffProfiles, dailyVanAssignments, staffAbsences);
  return vanCanReceiveAppointments(van, assignment);
}

function pendingSlotsForVan({
  van,
  dateKey,
  capacityOrders = [],
  services = [],
  staffProfiles = [],
  dailyVanAssignments = [],
  staffAbsences = [],
  halfDaySchedules = [],
} = {}) {
  if (!vanPendingCapacityAvailable({ van, dateKey, staffProfiles, dailyVanAssignments, staffAbsences })) return [];
  const daySlots = canonicalDaySlots(van.id, dateKey, halfDaySchedules);
  const occupied = new Set();
  for (const order of capacityOrders) {
    if (text(order?.vanId) !== text(van.id)) continue;
    for (const slot of reservedSlotsForOrder(order, services, halfDaySchedules)) occupied.add(slot);
  }
  return daySlots.filter((slot) => !occupied.has(slot));
}

function pendingPeriod(slot) {
  const start = text(slot);
  return { start, end: endTime(start, 1) };
}

module.exports = {
  canonicalDaySlots,
  pendingPeriod,
  pendingSlotsForVan,
  reservedSlotsForOrder,
  vanPendingCapacityAvailable,
};
