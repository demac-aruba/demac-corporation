const {
  EXTRA_MORNING_SLOT,
  REGULAR_SLOTS,
  isHalfDay,
  normalizeTime,
  occupiedSlots,
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
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
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
  const occupied = allocation.fullDay ? REGULAR_SLOTS : occupiedSlots(time, allocation.slots, halfDay);
  if (!occupied.length) return null;

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
      occupied: occupiedSlots(normalizeOrderTime(order.time), orderSlotCount(order, data.services), halfDay),
      zoneInfo: propertyZone(
        data.properties.find((property) => property.id === order.propertyId),
        `${order.zone ?? ""} ${order.address ?? ""}`,
        routeConfig,
      ),
    }));

  if (sameVanOrders.some((order) => order.occupied.some((slot) => occupied.includes(slot)))) return null;

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
    durationMinutes: Number(allocation.durationMinutes || allocation.slots * 60),
    slots: allocation.fullDay ? REGULAR_SLOTS.length : allocation.slots,
    endTime: endTimeFromOccupiedSlots(occupied),
    fullDay: allocation.fullDay,
    routeScore,
    routeReason,
  };
}

module.exports = {
  ROUTE_POLICIES,
  candidateAvailability,
  endTimeFromOccupiedSlots,
  normalizeOrderTime,
  routePolicy,
  vanCanReceiveOperationalMove,
  workOrderBlocksOperationalMoveCapacity,
};