const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deterministicScheduleChangeQueueId,
  sameDayScheduleChangeRequired,
  scheduleMaterialChanged,
} = require("./technicianScheduleChangeService");

const base = {
  id: "WO-1",
  status: "Confirmada",
  date: "2026-08-27",
  time: "09:30",
  vanId: "VAN-1",
  appointmentEndTime: "10:30",
  scheduledSlots: 1,
  technicianIds: ["tech-1", "tech-2"],
};

test("a newly confirmed same-day job after the 8 AM schedule dispatch requires an immediate van alert", () => {
  assert.equal(sameDayScheduleChangeRequired(null, base, { date: "2026-08-27", time: "10:15" }), true);
});

test("same-day work created before the daily 8 AM dispatch is left for the canonical daily schedule", () => {
  assert.equal(sameDayScheduleChangeRequired(null, base, { date: "2026-08-27", time: "07:59" }), false);
});

test("future work never generates a same-day van alert", () => {
  assert.equal(sameDayScheduleChangeRequired(null, { ...base, date: "2026-08-28" }, { date: "2026-08-27", time: "10:15" }), false);
});

test("field execution status changes do not masquerade as scheduling changes", () => {
  assert.equal(scheduleMaterialChanged(base, { ...base, status: "En camino" }), false);
  assert.equal(sameDayScheduleChangeRequired(base, { ...base, status: "En camino" }, { date: "2026-08-27", time: "10:15" }), false);
});

test("time, van, end, reserved slots or crew changes are material schedule changes", () => {
  for (const after of [
    { ...base, time: "10:30" },
    { ...base, vanId: "VAN-2" },
    { ...base, appointmentEndTime: "11:30" },
    { ...base, scheduledSlots: 2 },
    { ...base, technicianIds: ["tech-1", "tech-3"] },
  ]) {
    assert.equal(scheduleMaterialChanged(base, after), true);
    assert.equal(sameDayScheduleChangeRequired(base, after, { date: "2026-08-27", time: "10:15" }), true);
  }
});

test("temporary holds and inactive states do not send technician work alerts", () => {
  assert.equal(sameDayScheduleChangeRequired(null, { ...base, status: "Reserva temporal" }, { date: "2026-08-27", time: "10:15" }), false);
  assert.equal(sameDayScheduleChangeRequired(base, { ...base, status: "Cancelada" }, { date: "2026-08-27", time: "10:15" }), false);
});

test("schedule-change queue identity is deterministic for trigger retries", () => {
  const first = deterministicScheduleChangeQueueId({ eventId: "event-123", orderId: "WO-1", vanId: "VAN-1" });
  const second = deterministicScheduleChangeQueueId({ eventId: "event-123", orderId: "WO-1", vanId: "VAN-1" });
  assert.equal(first, second);
  assert.match(first, /van-same-day-change-event-123-WO-1-VAN-1/);
});
