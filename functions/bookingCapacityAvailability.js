const {
  EXTRA_MORNING_SLOT,
  REGULAR_SLOTS,
  capacitySlotsForOwnership,
  isHalfDay,
  normalizeTime,
  orderBlocksCapacity,
  orderSlotCount,
  propertyZone,
  routeCompatibility,
  vanCanReceiveAppointments,
} = require("./bookingSchedulingPrimitives");

const OPERATIONAL_NON_BLOCKING_STATUSES = new Set([
  "cancelada",
  "cancelled",
  "canceled",
  "reprogramada",
  "rescheduled",
]);

const ROUTE_POLICIES = Object.freeze({
  ENFORCED: "enforced",
  ADVISORY: "advisory",
});

function clockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesClock(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function normalizeOrderTime(value) {
  const time = normalizeTime(value);
  if (!time) return "08:30";
  if ([...REGULAR_SLOTS, EXTRA_MORNING_SLOT].includes(time)) return time;
  if (time < "09:00") return "08:30";
  if (time < "10:30") return "09:30";
  if (time < "11:30") return "10:30";
  if (time < "12:30") return EXTRA_MORNING_SLOT;
  if (time < "14:30") return "13:30";
  if (time < "15:30") return "14:30";
  return "15:30";
}

function endTimeFromOccupiedSlots(slots) {
  if (!Array.isArray(slots) || !slots.length) return "";
  const match = String(slots[slots.length - 1] || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const total = Number(match[1]) * 60 + Number(match[2]) + 60;
  return minutesClock(total);
}

function endTimeFromDuration(startTime, durationMinutes) {
  const start = clockMinutes(normalizeTime(startTime));
  const duration = Math.max(1, Math.round(Number(durationMinutes) || 0));
  return start === null || !duration ? "" : minutesClock(start + duration);
}

function operationalEndMinutes(halfDay) {
  const slots = halfDay ? ["08:30", "09:30", "10:30", EXTRA_MORNING_SLOT] : REGULAR_SLOTS;
  const last = clockMinutes(slots[slots.length - 1]);
  return last === null ? null : last + 60;
}

function allocationDurationMinutes(allocation = {}) {
  const exact = Number(allocation.durationMinutes);
  if (Number.isFinite(exact) && exact > 0) return Math.max(1, Math.round(exact));
  return Math.max(1, Math.round(Number(allocation.slots) || 1) * 60);
}

function workOrderDurationMinutes(order = {}, services = []) {
  const exact = Number(order.appointmentDurationMinutes);
  if (Number.isFinite(exact) && exact > 0) return Math.max(1, Math.round(exact));

  const workItems = Array.isArray(order.appointmentWorkItems) ? order.appointmentWorkItems : [];
  const workItemMinutes = workItems.reduce((sum, item) => sum + Math.max(0, Number(item?.durationMinutes) || 0), 0);
  if (workItemMinutes > 0) return Math.max(1, Math.round(workItemMinutes));

  const exactStart = clockMinutes(normalizeTime(order.time));
  const exactEnd = clockMinutes(normalizeTime(order.appointmentEndTime));
  if (exactStart !== null && exactEnd !== null && exactEnd > exactStart) return exactEnd - exactStart;

  return Math.max(1, orderSlotCount(order, services) * 60);
}

function intervalsOverlap(left, right) {
  if (!left || !right) return false;
  return left.start < right.capacityEnd && left.capacityEnd > right.start;
}

function assignmentCapacityInterval({ time, allocation, halfDay }) {
  const normalizedStart = normalizeTime(time);
  const start = clockMinutes(normalizedStart);
  const durationMinutes = allocationDurationMinutes(allocation);
  if (start === null) return null;
  const end = start + durationMinutes;
  const operationalEnd = operationalEndMinutes(halfDay);
  if (operationalEnd === null || end > operationalEnd) return null;
  const ownedSlotCount = Math.max(1, Math.round(Number(allocation.slots) || Math.ceil(durationMinutes / 60)));
  const lockSlots = allocation.fullDay
    ? (halfDay ? [] : [...REGULAR_SLOTS])
    : capacitySlotsForOwnership(normalizedStart, ownedSlotCount, halfDay);
  if (!lockSlots.length) return null;
  const capacityEnd = clockMinutes(endTimeFromOccupiedSlots(lockSlots));
  return {
    start,
    end,
    capacityEnd: allocation.fullDay ? operationalEnd : Math.max(end, capacityEnd ?? end),
    durationMinutes,
    lockSlots,
  };
}

function workOrderCapacityInterval(order, services, halfDay) {
  const normalizedStart = normalizeTime(order?.time);
  const start = clockMinutes(normalizedStart);
  if (start === null) return null;
  const durationMinutes = workOrderDurationMinutes(order, services);
  const end = start + durationMinutes;
  const operationalEnd = operationalEndMinutes(halfDay);
  const fullDay = order?.fullDaySingleProperty === true;
  const ownedSlotCount = orderSlotCount(order, services);
  const lockSlots = fullDay
    ? (halfDay ? [] : [...REGULAR_SLOTS])
    : capacitySlotsForOwnership(normalizedStart, ownedSlotCount, halfDay);
  const capacityEnd = clockMinutes(endTimeFromOccupiedSlots(lockSlots));
  return {
    start,
    end,
    capacityEnd: fullDay && operationalEnd !== null ? operationalEnd : Math.max(end, capacityEnd ?? end),
    durationMinutes,
    lockSlots,
  };
}

function capacityLockSlots({ time, durationMinutes, slots, halfDay, fullDay }) {
  if (fullDay === true) return halfDay ? [] : [...REGULAR_SLOTS];
  const duration = Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
    ? Math.max(1, Math.round(Number(durationMinutes)))
    : 60;
  const ownedSlotCount = Math.max(1, Math.round(Number(slots) || Math.ceil(duration / 60)));
  return capacitySlotsForOwnership(normalizeTime(time), ownedSlotCount, halfDay);
}

function vanCanReceiveOperationalMove(van, assignment) {
  return van?.active !== false
    && !["Mantenimiento", "Fuera de servicio"].includes(assignment?.status);
}

function workOrderBlocksOperationalMoveCapacity(order) {
  const appointmentId = String(order?.appointmentId ?? "").trim();
  if (!appointmentId) return false;
  const status = String(order?.status ?? "").trim().toLowerCase();
  if (OPERATIONAL_NON_BLOCKING_STATUSES.has(status)) return false;
  return orderBlocksCapacity(order);
}

function routePolicy(routeConfig) {
  return routeConfig?.routePolicy === ROUTE_POLICIES.ADVISORY
    ? ROUTE_POLICIES.ADVISORY
    : ROUTE_POLICIES.ENFORCED;
}

function candidateAvailability({ date, time, allocation, van, assignment, data, routeConfig, candidateZone, manualOperationalMove = false }) {
  if (manualOperationalMove) {
    if (!vanCanReceiveOperationalMove(van, assignment)) return null;
  } else if (!vanCanReceiveAppointments(van, assignment)) {
    return null;
  }

  const halfDay = isHalfDay(van.id, date, data.vanHalfDaySchedules);
  if (allocation.fullDay && (halfDay || time !== "08:30")) return null;
  const requestedInterval = assignmentCapacityInterval({ time, allocation, halfDay });
  if (!requestedInterval) return null;

  const sameVanOrders = data.workOrders
    .filter((order) => {
      if (order.date !== date || order.vanId !== van.id) return false;
      return manualOperationalMove
        ? workOrderBlocksOperationalMoveCapacity(order)
        : orderBlocksCapacity(order);
    })
    .map((order) => ({
      ...order,
      time: normalizeOrderTime(order.time),
      capacityInterval: workOrderCapacityInterval(order, data.services, halfDay),
      zoneInfo: propertyZone(
        data.properties.find((property) => property.id === order.propertyId),
        `${order.zone ?? ""} ${order.address ?? ""}`,
        routeConfig,
      ),
    }));

  if (sameVanOrders.some((order) => intervalsOverlap(requestedInterval, order.capacityInterval))) return null;

  let routeScore = 0;
  let routeReason = manualOperationalMove ? "manual-operational-move" : "explicit-office-target";
  if (!manualOperationalMove && routePolicy(routeConfig) === ROUTE_POLICIES.ENFORCED) {
    const office = routeConfig.zones.find((zone) => zone.id === routeConfig.officeZoneId);
    const compatibility = routeCompatibility({
      candidateZone,
      existingOrders: sameVanOrders,
      candidateTime: time,
      officePosition: office?.position ?? 50,
      maximumAnchorDistance: routeConfig.maximumAnchorDistance,
    });
    if (!compatibility.allowed) return null;
    routeScore = compatibility.score;
    routeReason = compatibility.reason;
  }

  return {
    vanId: van.id,
    vanName: van.name,
    technicianIds: assignment.technicianIds,
    driverStaffId: assignment.driverStaffId,
    helperStaffId: assignment.helperStaffId,
    quantity: allocation.quantity,
    durationMinutes: requestedInterval.durationMinutes,
    slots: allocation.fullDay ? REGULAR_SLOTS.length : allocation.slots,
    endTime: minutesClock(requestedInterval.end),
    fullDay: allocation.fullDay,
    routeScore,
    routeReason,
  };
}

module.exports = {
  ROUTE_POLICIES,
  allocationDurationMinutes,
  assignmentCapacityInterval,
  candidateAvailability,
  capacityLockSlots,
  endTimeFromDuration,
  endTimeFromOccupiedSlots,
  intervalsOverlap,
  normalizeOrderTime,
  routePolicy,
  vanCanReceiveOperationalMove,
  workOrderBlocksOperationalMoveCapacity,
  workOrderCapacityInterval,
  workOrderDurationMinutes,
};
