const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalReservedEndTime,
  displayedOrderEndTime,
  hasCanonicalReservedCapacity,
} = require("./technicianDailyScheduleService");

test("reserved Booking Authority slots own the technician-visible end even when a stored end is stale", () => {
  const order = {
    date: "2026-08-27",
    vanId: "VAN-1",
    time: "09:30",
    scheduledSlots: 5,
    appointmentDurationMinutes: 300,
    appointmentEndTime: "14:30",
  };

  assert.equal(hasCanonicalReservedCapacity(order), true);
  assert.equal(canonicalReservedEndTime(order), "16:30");
  assert.equal(displayedOrderEndTime(order), "16:30");
});

test("an explicit stored slot array uses the same canonical slot-span end", () => {
  const order = {
    date: "2026-08-27",
    vanId: "VAN-1",
    time: "09:30",
    scheduledSlots: ["09:30", "10:30", "13:30", "14:30", "15:30"],
    appointmentDurationMinutes: 300,
    appointmentEndTime: "14:30",
  };

  assert.equal(canonicalReservedEndTime(order), "16:30");
  assert.equal(displayedOrderEndTime(order), "16:30");
});

test("half-day capacity uses the canonical half-day slot map instead of the regular-day map", () => {
  const order = {
    date: "2026-08-29",
    vanId: "VAN-1",
    time: "08:30",
    scheduledSlots: 4,
    appointmentDurationMinutes: 240,
    appointmentEndTime: "14:30",
  };
  const halfDaySchedules = [{ vanId: "VAN-1", weekday: 6, active: true }];

  assert.equal(canonicalReservedEndTime(order, halfDaySchedules), "12:30");
  assert.equal(displayedOrderEndTime(order, halfDaySchedules), "12:30");
});

test("legacy records without reserved capacity keep duration compatibility behavior", () => {
  const order = {
    time: "10:30",
    appointmentDurationMinutes: 120,
    appointmentEndTime: "14:30",
  };

  assert.equal(hasCanonicalReservedCapacity(order), false);
  assert.equal(displayedOrderEndTime(order), "12:30");
});

test("full-day same-property legacy records keep the committed schedule end", () => {
  assert.equal(displayedOrderEndTime({
    time: "08:30",
    appointmentDurationMinutes: 360,
    appointmentEndTime: "16:30",
    fullDaySingleProperty: true,
  }), "16:30");
});
