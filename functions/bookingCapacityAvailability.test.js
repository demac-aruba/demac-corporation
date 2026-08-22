const test = require("node:test");
const assert = require("node:assert/strict");
const { workOrderBlocksOperationalMoveCapacity } = require("./bookingCapacityAvailability");
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
