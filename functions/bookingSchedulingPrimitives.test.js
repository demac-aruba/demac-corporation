const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveAssignment, resolveCrewMembership } = require("./bookingSchedulingPrimitives");

test("dated crew membership overrides recurring crew without applying readiness", () => {
  const van = {
    id: "VAN-1",
    responsibleStaffId: "regular-driver",
    regularHelperId: "regular-helper",
    additionalHelperId: "regular-additional-helper",
  };
  const assignments = [{
    id: "2026-08-24-VAN-1",
    date: "2026-08-24",
    vanId: "VAN-1",
    driverStaffId: "dated-driver",
    helperStaffId: "dated-helper",
    additionalHelperStaffId: "dated-additional-helper",
    status: "Mantenimiento",
  }];

  const membership = resolveCrewMembership(van, "2026-08-24", assignments);
  assert.deepEqual(membership.technicianIds, ["dated-driver", "dated-helper", "dated-additional-helper"]);
  assert.equal(membership.driverStaffId, "dated-driver");
  assert.equal(membership.helperStaffId, "dated-helper");
  assert.equal(membership.additionalHelperStaffId, "dated-additional-helper");
  assert.equal(membership.source, "daily_assignment");
  assert.equal(membership.assignmentStatus, "Mantenimiento");
});

test("crew membership falls back to recurring Van ownership when no dated override exists", () => {
  const membership = resolveCrewMembership({
    id: "VAN-2",
    responsibleStaffId: "regular-driver",
    regularHelperId: "regular-helper",
    additionalHelperId: "regular-additional-helper",
  }, "2026-08-24", []);

  assert.equal(membership.driverStaffId, "regular-driver");
  assert.equal(membership.helperStaffId, "regular-helper");
  assert.equal(membership.additionalHelperStaffId, "regular-additional-helper");
  assert.deepEqual(membership.technicianIds, ["regular-driver", "regular-helper", "regular-additional-helper"]);
  assert.equal(membership.source, "regular_crew");
  assert.equal(membership.assignmentStatus, undefined);
});

test("resolveAssignment keeps Scheduling readiness semantics while consuming membership", () => {
  const van = {
    id: "VAN-3",
    active: true,
    responsibleStaffId: "regular-driver",
    regularHelperId: "regular-helper",
    additionalHelperId: "regular-additional-helper",
  };
  const assignments = [{
    id: "2026-08-24-VAN-3",
    date: "2026-08-24",
    vanId: "VAN-3",
    driverStaffId: "dated-driver",
    helperStaffId: "dated-helper",
    additionalHelperStaffId: "dated-additional-helper",
  }];
  const profiles = [
    { id: "dated-driver", active: true, availability: "Disponible", canDriveVan: true },
    { id: "dated-helper", active: true, availability: "Disponible" },
    { id: "dated-additional-helper", active: true, availability: "Disponible" },
  ];

  const available = resolveAssignment(van, "2026-08-24", profiles, assignments, []);
  assert.deepEqual(available, {
    vanId: "VAN-3",
    driverStaffId: "dated-driver",
    helperStaffId: "dated-helper",
    additionalHelperStaffId: "dated-additional-helper",
    technicianIds: ["dated-driver", "dated-helper", "dated-additional-helper"],
    status: "Disponible",
  });

  const absent = resolveAssignment(van, "2026-08-24", profiles, assignments, [{
    id: "absence-1",
    active: true,
    staffId: "dated-driver",
    fromDate: "2026-08-24",
    toDate: "2026-08-24",
  }]);
  assert.equal(absent.driverStaffId, undefined);
  assert.equal(absent.helperStaffId, "dated-helper");
  assert.equal(absent.status, "Sin personal");
});

test("an explicit blank dated crew slot does not silently fall back to recurring ownership", () => {
  const membership = resolveCrewMembership({
    id: "VAN-4",
    responsibleStaffId: "regular-driver",
    regularHelperId: "regular-helper",
  }, "2026-08-24", [{
    id: "2026-08-24-VAN-4",
    date: "2026-08-24",
    vanId: "VAN-4",
    driverStaffId: "",
    helperStaffId: "dated-helper",
  }]);

  assert.equal(membership.driverStaffId, "");
  assert.equal(membership.helperStaffId, "dated-helper");
  assert.deepEqual(membership.technicianIds, ["dated-helper"]);
});
