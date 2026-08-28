const {
  EXTRA_MORNING_SLOT,
  MORNING_SLOTS,
  REGULAR_SLOTS,
  endTime,
  isHalfDay,
  occupiedSlots,
  orderBlocksCapacity,
  orderSlotCount,
  resolveAssignment,
  vanCanReceiveAppointments,
} = require("./bookingSchedulingPrimitives");

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
  if (Array.isArray(order.scheduledSlots)) {
    return [...new Set(order.scheduledSlots.map(text).filter(Boolean))];
  }
  const halfDay = isHalfDay(text(order.vanId), text(order.date), halfDaySchedules);
  return occupiedSlots(text(order.time), orderSlotCount(order, services), halfDay);
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
