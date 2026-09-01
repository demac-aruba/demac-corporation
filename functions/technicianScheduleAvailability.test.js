const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalDaySlots,
  pendingPeriod,
  pendingSlotsForVan,
  reservedSlotsForOrder,
} = require("./technicianScheduleAvailability");

const van = { id: "VAN-1", active: true, status: "Disponible", responsibleStaffId: "driver-1" };
const staffProfiles = [{ id: "driver-1", active: true, availability: "Disponible", canDriveVan: true }];

test("regular and half-day pending calendars reuse canonical Booking Authority start definitions", () => {
  assert.deepEqual(canonicalDaySlots("VAN-1", "2026-08-28", []), ["08:30", "09:30", "10:30", "13:30", "14:30", "15:30"]);
  assert.deepEqual(canonicalDaySlots("VAN-1", "2026-08-29", [
    { vanId: "VAN-1", weekday: 6, active: true },
  ]), ["08:30", "09:30", "10:30", "11:30"]);
});

test("a three-hour job ending at 13:30 releases the 13:30 PENDIENTE start", () => {
  const order = {
    id: "WO-1",
    status: "Confirmada",
    date: "2026-08-28",
    vanId: "VAN-1",
    time: "10:30",
    appointmentDurationMinutes: 180,
    appointmentEndTime: "13:30",
    scheduledSlots: 3,
  };
  assert.deepEqual(reservedSlotsForOrder(order), ["10:30"]);
  assert.deepEqual(pendingSlotsForVan({
    van,
    dateKey: "2026-08-28",
    capacityOrders: [order],
    staffProfiles,
  }), ["08:30", "09:30", "13:30", "14:30", "15:30"]);
});

test("a real 10:30 to 14:30 span blocks the 13:30 start without making lunch sellable", () => {
  const order = {
    id: "WO-2",
    status: "Confirmada",
    date: "2026-08-28",
    vanId: "VAN-1",
    time: "10:30",
    appointmentDurationMinutes: 240,
    appointmentEndTime: "14:30",
    scheduledSlots: 4,
  };
  assert.deepEqual(reservedSlotsForOrder(order), ["10:30", "13:30"]);
  assert.deepEqual(pendingSlotsForVan({
    van,
    dateKey: "2026-08-28",
    capacityOrders: [order],
    staffProfiles,
  }), ["08:30", "09:30", "14:30", "15:30"]);
});

test("a non-full-day six-hour job releases the 14:30 and 15:30 PENDIENTE starts", () => {
  const order = {
    id: "WO-SIX-1",
    status: "Confirmada",
    date: "2026-08-28",
    vanId: "VAN-1",
    time: "08:30",
    appointmentPresetId: "standard_service",
    airConditionerCount: 6,
    appointmentDurationMinutes: 360,
    appointmentEndTime: "14:30",
    scheduledSlots: 6,
  };
  assert.deepEqual(reservedSlotsForOrder(order), ["08:30", "09:30", "10:30", "13:30"]);
  assert.deepEqual(pendingSlotsForVan({
    van,
    dateKey: "2026-08-28",
    capacityOrders: [order],
    staffProfiles,
  }), ["14:30", "15:30"]);
});

test("temporary holds reserve real continuous capacity but are not technician work messages", () => {
  const hold = {
    id: "WO-HOLD-1",
    status: "Reserva temporal",
    date: "2026-08-28",
    vanId: "VAN-1",
    time: "09:30",
    appointmentDurationMinutes: 60,
    appointmentEndTime: "10:30",
    scheduledSlots: 1,
  };
  assert.deepEqual(reservedSlotsForOrder(hold), ["09:30"]);
  assert.equal(pendingSlotsForVan({
    van,
    dateKey: "2026-08-28",
    capacityOrders: [hold],
    staffProfiles,
  }).includes("09:30"), false);
});

test("full-day policy reserves every sellable start while lunch remains non-sellable", () => {
  const order = {
    id: "WO-FULL-1",
    status: "Confirmada",
    date: "2026-08-28",
    vanId: "VAN-1",
    time: "08:30",
    appointmentDurationMinutes: 420,
    fullDaySingleProperty: true,
    scheduledSlots: 6,
  };
  assert.deepEqual(reservedSlotsForOrder(order), ["08:30", "09:30", "10:30", "13:30", "14:30", "15:30"]);
  assert.deepEqual(pendingSlotsForVan({
    van,
    dateKey: "2026-08-28",
    capacityOrders: [order],
    staffProfiles,
  }), []);
});

test("staff absence removes all PENDIENTE periods instead of advertising unusable capacity", () => {
  assert.deepEqual(pendingSlotsForVan({
    van,
    dateKey: "2026-08-28",
    capacityOrders: [],
    staffProfiles,
    staffAbsences: [{ id: "ABS-1", staffId: "driver-1", fromDate: "2026-08-28", toDate: "2026-08-28", active: true }],
  }), []);
});

test("maintenance and out-of-service vans never publish PENDIENTE periods", () => {
  for (const status of ["Mantenimiento", "Fuera de servicio"]) {
    assert.deepEqual(pendingSlotsForVan({
      van: { ...van, status },
      dateKey: "2026-08-28",
      staffProfiles,
    }), []);
  }
});

test("pending periods are exactly one canonical sellable hour", () => {
  assert.deepEqual(pendingPeriod("15:30"), { start: "15:30", end: "16:30" });
  assert.deepEqual(pendingPeriod("11:30"), { start: "11:30", end: "12:30" });
});
