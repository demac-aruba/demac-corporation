const test = require("node:test");
const assert = require("node:assert/strict");
const { workOrderBlocksOperationalMoveCapacity } = require("./bookingCapacityAvailability");
const { resolveAssignment } = require("./bookingSchedulingPrimitives");

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

test("canonical crew availability respects an employee weekly day off without changing the van", () => {
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
  assert.equal(wednesday.driverStaffId, undefined);
  assert.equal(wednesday.helperStaffId, "staff-helper");
  assert.equal(wednesday.status, "Sin personal");

  const thursday = resolveAssignment(van, "2026-08-27", profiles, [], []);
  assert.equal(thursday.driverStaffId, "staff-driver");
  assert.equal(thursday.helperStaffId, "staff-helper");
  assert.equal(thursday.status, "Disponible");

  const beforeEffectiveDate = resolveAssignment(van, "2026-07-29", profiles, [], []);
  assert.equal(beforeEffectiveDate.driverStaffId, "staff-driver");
});
