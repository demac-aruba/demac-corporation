const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deterministicScheduleChangeQueueId,
  deterministicSupportScheduleChangeQueueId,
  isAdhocSupportOrder,
  renderAdhocPrimaryVanText,
  renderAdhocSupportVanText,
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

test("backdated same-day work never sends a misleading new-job technician alert", () => {
  assert.equal(sameDayScheduleChangeRequired(null, {
    ...base,
    bookingMode: "backdated",
    backdated: true,
    workAlreadyPerformed: true,
  }, { date: "2026-08-27", time: "12:00" }), false);
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

test("ad hoc support is recognized only for linked rescue support work orders", () => {
  assert.equal(isAdhocSupportOrder({ appointmentAssignmentRole: "support", supportAssignmentKind: "adhoc_rescue" }), true);
  assert.equal(isAdhocSupportOrder({ appointmentAssignmentRole: "support", supportAssignmentKind: "planned" }), false);
  assert.equal(isAdhocSupportOrder({ appointmentAssignmentRole: "primary", supportAssignmentKind: "adhoc_rescue" }), false);
});

test("ad hoc support queue identities are deterministic and distinct for primary and support vans", () => {
  const support = deterministicSupportScheduleChangeQueueId({
    eventId: "event-200",
    orderId: "WO-SUP-1",
    vanId: "VAN-2",
    recipientRole: "support",
  });
  const primary = deterministicSupportScheduleChangeQueueId({
    eventId: "event-200",
    orderId: "WO-SUP-1",
    vanId: "VAN-1",
    recipientRole: "primary",
  });
  assert.notEqual(primary, support);
  assert.match(support, /van-adhoc-support-event-200-WO-SUP-1-support-VAN-2/);
  assert.match(primary, /van-adhoc-support-event-200-WO-SUP-1-primary-VAN-1/);
});

test("support van alert includes customer work, selected support time and primary van", () => {
  const staffById = new Map([
    ["support-driver", { id: "support-driver", name: "Walter Gomez" }],
    ["support-helper", { id: "support-helper", name: "Goyo Perez" }],
    ["primary-driver", { id: "primary-driver", name: "Miguel Reyes" }],
  ]);
  const message = renderAdhocSupportVanText({
    supportVan: { id: "VAN-2", name: "Van 2" },
    supportOrder: {
      id: "WO-SUP-1",
      date: "2026-08-27",
      time: "13:30",
      appointmentEndTime: "14:30",
      address: "Pampunastraat 16",
      customerFacingDescription: "Deep cleaning cassette",
      supportReason: "Need a second team for lifting",
      technicianIds: ["stale-tech"],
    },
    primaryVan: { id: "VAN-1", name: "Van 1" },
    client: { name: "Office Systems Aruba" },
    property: { name: "Main Office", address: "Pampunastraat 16", zone: "Oranjestad" },
    appointment: { workLines: [] },
    supportCrew: { technicianIds: ["support-driver", "support-helper"] },
    primaryCrew: { technicianIds: ["primary-driver"] },
    staffById,
    halfDaySchedules: [],
    sequence: 2,
  });
  assert.match(message, /APOYO A COMPAÑERO/);
  assert.match(message, /Office Systems Aruba/);
  assert.match(message, /Deep cleaning cassette/);
  assert.match(message, /1:30 PM/);
  assert.match(message, /Van 1/);
  assert.match(message, /Miguel/);
  assert.match(message, /Need a second team for lifting/);
});

test("primary van alert identifies the actual dated support crew and keeps primary schedule unchanged", () => {
  const staffById = new Map([
    ["support-driver", { id: "support-driver", name: "Walter Gomez" }],
    ["support-helper", { id: "support-helper", name: "Goyo Perez" }],
  ]);
  const message = renderAdhocPrimaryVanText({
    primaryVan: { id: "VAN-1", name: "Van 1" },
    supportVan: { id: "VAN-2", name: "Van 2" },
    supportOrder: {
      time: "13:30",
      appointmentEndTime: "14:30",
      address: "Pampunastraat 16",
      supportReason: "Need a second team for lifting",
    },
    client: { name: "Office Systems Aruba" },
    property: { name: "Main Office", address: "Pampunastraat 16" },
    supportCrew: { technicianIds: ["support-driver", "support-helper"] },
    staffById,
  });
  assert.match(message, /APOYO ASIGNADO/);
  assert.match(message, /Van 2/);
  assert.match(message, /Walter y Goyo/);
  assert.match(message, /1:30 PM/);
  assert.match(message, /agenda principal no cambia/i);
});
