const assert = require("node:assert/strict");
const test = require("node:test");

const {
  displayedOrderEndTime,
  hasCanonicalReservedCapacity,
} = require("./technicianDailyScheduleService");

test("reserved Booking Authority capacity owns the technician-visible schedule end", () => {
  const order = {
    time: "09:30",
    scheduledSlots: 5,
    appointmentDurationMinutes: 300,
    appointmentEndTime: "16:30",
  };

  assert.equal(hasCanonicalReservedCapacity(order), true);
  assert.equal(displayedOrderEndTime(order), "16:30");
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

test("full-day same-property records keep the committed schedule end", () => {
  assert.equal(displayedOrderEndTime({
    time: "08:30",
    appointmentDurationMinutes: 360,
    appointmentEndTime: "16:30",
    fullDaySingleProperty: true,
  }), "16:30");
});
