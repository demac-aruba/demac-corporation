const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTechnicianAgendaText,
  isTechnicianProfile,
  technicianAvailableOnDate,
} = require("./technicianDailyScheduleService");

test("technical employee profiles are recognized while office staff are excluded", () => {
  assert.equal(isTechnicianProfile({ active: true, employeeType: "Técnico", role: "Técnico responsable" }), true);
  assert.equal(isTechnicianProfile({ active: true, employeeType: "Administración", role: "Contabilidad" }), false);
  assert.equal(isTechnicianProfile({ active: false, employeeType: "Técnico", role: "Técnico" }), false);
});

test("an active technician on approved time off does not receive a daily schedule", () => {
  const profile = { id: "tech-1", active: true, employeeType: "Técnico", role: "Técnico" };
  const absences = [{ staffId: "tech-1", fromDate: "2026-08-20", toDate: "2026-08-22", active: true }];
  assert.equal(technicianAvailableOnDate(profile, absences, "2026-08-21"), false);
  assert.equal(technicianAvailableOnDate(profile, absences, "2026-08-25"), true);
});

test("agenda is chronological and includes customer, address and work", () => {
  const clients = new Map([
    ["client-a", { name: "Cliente A" }],
    ["client-b", { name: "Cliente B" }],
  ]);
  const text = buildTechnicianAgendaText([
    {
      id: "wo-2",
      clientId: "client-b",
      status: "Confirmada",
      time: "10:30",
      appointmentEndTime: "11:30",
      address: "Noord 2",
      appointmentWorkLabel: "Checkup",
      vanId: "VAN-1",
    },
    {
      id: "wo-1",
      clientId: "client-a",
      status: "Confirmada",
      time: "08:30",
      appointmentEndTime: "09:30",
      address: "Santa Cruz 1",
      appointmentWorkItems: [{ label: "Standard Service", quantity: 2 }],
      vanId: "VAN-1",
    },
  ], clients);
  const lines = text.split("\n");
  assert.match(lines[0], /08:30-09:30 \| Cliente A \| Santa Cruz 1 \| Standard Service x2 \| VAN-1/);
  assert.match(lines[1], /10:30-11:30 \| Cliente B \| Noord 2 \| Checkup \| VAN-1/);
});

test("available technician with no jobs receives an explicit empty agenda", () => {
  assert.match(buildTechnicianAgendaText([], new Map()), /No tienes trabajos asignados/);
});
