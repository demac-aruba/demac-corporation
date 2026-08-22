const test = require("node:test");
const assert = require("node:assert/strict");
const {
  candidateAvailability,
  endTimeFromOccupiedSlots,
  workOrderBlocksOperationalMoveCapacity,
} = require("./bookingCapacityAvailability");
const { isHalfDay, occupiedSlots, resolveAssignment } = require("./bookingSchedulingPrimitives");

test("operational capacity matches LIVE cancelled/rescheduled status semantics", () => {
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "Confirmada" }), true);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "Pendiente" }), true);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "Cancelada" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "cancelled" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "canceled" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "Reprogramada" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status: "rescheduled" }), false);
  assert.equal(workOrderBlocksOperationalMoveCapacity({ status: "Confirmada" }), false);
});

test("employee-level full-day fields never remove a technician from canonical Van availability", () => {
  const van = {
    id: "VAN-1",
    active: true,
    responsibleStaffId: "staff-driver",
    regularHelperId: "staff-helper",
  };
  const profiles = [
    {
      id: "staff-driver",
      active: true,
      availability: "Disponible",
      canDriveVan: true,
      // Deprecated PR #413 fields may still exist in Firestore temporarily. Runtime must ignore them.
      weeklyDayOffWeekday: 3,
      weeklyDayOffEffectiveFrom: "2026-08-01",
    },
    {
      id: "staff-helper",
      active: true,
      availability: "Disponible",
    },
  ];

  const wednesday = resolveAssignment(van, "2026-08-26", profiles, [], []);
  assert.equal(wednesday.driverStaffId, "staff-driver");
  assert.equal(wednesday.helperStaffId, "staff-helper");
  assert.equal(wednesday.status, "Disponible");
});

test("Van half-day closes afternoon capacity without marking the crew unavailable all day", () => {
  const schedules = [{ id: "half-day-VAN-1", vanId: "VAN-1", weekday: 3, active: true }];
  assert.equal(isHalfDay("VAN-1", "2026-08-26", schedules), true);
  assert.deepEqual(occupiedSlots("08:30", 1, true), ["08:30"]);
  assert.deepEqual(occupiedSlots("11:30", 1, true), ["11:30"]);
  assert.deepEqual(occupiedSlots("13:30", 1, true), []);

  const van = { id: "VAN-1", active: true, responsibleStaffId: "staff-driver", regularHelperId: "staff-helper" };
  const profiles = [
    { id: "staff-driver", active: true, availability: "Disponible", canDriveVan: true },
    { id: "staff-helper", active: true, availability: "Disponible" },
  ];
  const assignment = resolveAssignment(van, "2026-08-26", profiles, [], []);
  assert.equal(assignment.driverStaffId, "staff-driver");
  assert.equal(assignment.helperStaffId, "staff-helper");
  assert.equal(assignment.status, "Disponible");
});

test("three reserved half-day spots end at 12:30 instead of leaking across lunch into PM capacity", () => {
  const data = {
    workOrders: [],
    services: [],
    properties: [],
    vanHalfDaySchedules: [{ id: "half-day-VAN-1", vanId: "VAN-1", weekday: 1, active: true }],
  };
  const result = candidateAvailability({
    date: "2026-08-24",
    time: "09:30",
    allocation: { quantity: 1, durationMinutes: 180, slots: 3, fullDay: false },
    van: { id: "VAN-1", name: "Van 1", active: true },
    assignment: {
      driverStaffId: "miguel",
      helperStaffId: "alan",
      technicianIds: ["miguel", "alan"],
      status: "Disponible",
    },
    data,
    routeConfig: { routePolicy: "advisory", zones: [] },
    candidateZone: null,
  });
  assert.ok(result);
  assert.equal(result.slots, 3);
  assert.equal(result.durationMinutes, 180);
  assert.equal(result.endTime, "12:30");
  assert.equal(endTimeFromOccupiedSlots(["09:30", "10:30", "11:30"]), "12:30");
});

function explicitTargetFixture(existingOrderTime = "08:30") {
  const routeConfig = {
    officeZoneId: "office",
    maximumAnchorDistance: 100,
    zones: [
      { id: "office", label: "Office", position: 50, aliases: ["office"] },
      { id: "north", label: "Noord", position: 90, aliases: ["noord"] },
    ],
  };
  const data = {
    workOrders: [{
      id: "WO-ANCHOR",
      appointmentId: "APT-ANCHOR",
      date: "2098-12-22",
      time: existingOrderTime,
      status: "Confirmada",
      vanId: "VAN-2",
      scheduledSlots: 1,
      propertyId: "p-office",
    }],
    services: [],
    properties: [{ id: "p-office", operationalZone: "Office" }],
    vanHalfDaySchedules: [],
  };
  return {
    date: "2098-12-22",
    time: "09:30",
    allocation: { quantity: 4, durationMinutes: 240, slots: 4, fullDay: false },
    van: { id: "VAN-2", name: "Van 2", active: true },
    assignment: {
      driverStaffId: "mario",
      helperStaffId: "ronald",
      technicianIds: ["mario", "ronald"],
      status: "Disponible",
    },
    data,
    routeConfig,
    candidateZone: { id: "north", label: "Noord", position: 90 },
  };
}

test("automatic routing may reject a geographically incompatible free target", () => {
  const result = candidateAvailability(explicitTargetFixture());
  assert.equal(result, null);
});

test("explicit office target treats route heuristics as advisory while preserving four-hour capacity", () => {
  const fixture = explicitTargetFixture();
  fixture.routeConfig = { ...fixture.routeConfig, routePolicy: "advisory" };
  const result = candidateAvailability(fixture);
  assert.ok(result);
  assert.equal(result.vanId, "VAN-2");
  assert.equal(result.slots, 4);
  assert.equal(result.durationMinutes, 240);
  assert.equal(result.endTime, "15:30");
  assert.equal(result.routeReason, "explicit-office-target");
});

test("explicit office target still refuses a real occupied-slot conflict", () => {
  const fixture = explicitTargetFixture("10:30");
  fixture.routeConfig = { ...fixture.routeConfig, routePolicy: "advisory" };
  assert.equal(candidateAvailability(fixture), null);
});