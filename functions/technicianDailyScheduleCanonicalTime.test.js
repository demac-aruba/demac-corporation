const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalReservedEndTime,
  displayedOrderEndTime,
  hasCanonicalReservedCapacity,
} = require("./technicianDailyScheduleService");

test("capacity ownership may span the lunch gap without changing technician-visible elapsed time", () => {
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
  assert.equal(displayedOrderEndTime(order), "14:30");
});

test("explicit historical slot arrays remain fallback metadata, not the modern timing authority", () => {
  const order = {
    date: "2026-08-27",
    vanId: "VAN-1",
    time: "09:30",
    scheduledSlots: ["09:30", "10:30", "13:30", "14:30", "15:30"],
    appointmentDurationMinutes: 300,
    appointmentEndTime: "14:30",
  };

  assert.equal(canonicalReservedEndTime(order), "16:30");
  assert.equal(displayedOrderEndTime(order), "14:30");
});

test("half-day duration ends at the real elapsed time and remains inside the half-day window", () => {
  const order = {
    date: "2026-08-29",
    vanId: "VAN-1",
    time: "08:30",
    scheduledSlots: 4,
    appointmentDurationMinutes: 240,
    appointmentEndTime: "12:30",
  };
  const halfDaySchedules = [{ vanId: "VAN-1", weekday: 6, active: true }];

  assert.equal(canonicalReservedEndTime(order, halfDaySchedules), "12:30");
  assert.equal(displayedOrderEndTime(order, halfDaySchedules), "12:30");
});

test("10:30 plus three real hours displays 13:30 and does not add lunch time", () => {
  const order = {
    date: "2026-08-28",
    vanId: "VAN-1",
    time: "10:30",
    scheduledSlots: 3,
    appointmentDurationMinutes: 180,
    appointmentEndTime: "13:30",
  };
  assert.equal(displayedOrderEndTime(order), "13:30");
});

test("records without duration use a valid stored end before slot metadata", () => {
  const order = {
    time: "10:30",
    appointmentEndTime: "12:30",
    scheduledSlots: 2,
  };

  assert.equal(displayedOrderEndTime(order), "12:30");
});

test("full-day capacity policy does not falsify the technician-visible wall-clock end", () => {
  assert.equal(displayedOrderEndTime({
    time: "08:30",
    appointmentDurationMinutes: 360,
    appointmentEndTime: "14:30",
    fullDaySingleProperty: true,
    scheduledSlots: 6,
  }), "14:30");
});
