const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveAssignment,
  vanCanReceiveAppointments,
} = require("./bookingSchedulingPrimitives");

const date = "2026-08-28";
const profiles = [
  { id: "driver", active: true, availability: "Disponible", canDriveVan: true },
  { id: "helper", active: true, availability: "Disponible", canDriveVan: false },
  { id: "third", active: true, availability: "Disponible", canDriveVan: false },
  { id: "dated-third", active: true, availability: "Disponible", canDriveVan: false },
];

const van = {
  id: "VAN-1",
  active: true,
  status: "Disponible",
  responsibleStaffId: "driver",
  regularHelperId: "helper",
  additionalHelperId: "third",
};

test("regular Van crew includes the optional third helper without changing availability status", () => {
  const resolved = resolveAssignment(van, date, profiles, [], []);
  assert.equal(resolved.driverStaffId, "driver");
  assert.equal(resolved.helperStaffId, "helper");
  assert.equal(resolved.additionalHelperStaffId, "third");
  assert.deepEqual(resolved.technicianIds, ["driver", "helper", "third"]);
  assert.equal(resolved.status, "Disponible");
  assert.equal(vanCanReceiveAppointments(van, resolved), true);
});

test("dated third-helper override replaces only the third crew position for that date", () => {
  const resolved = resolveAssignment(van, date, profiles, [{
    id: "VAN-1-2026-08-28",
    date,
    vanId: "VAN-1",
    driverStaffId: "driver",
    helperStaffId: "helper",
    additionalHelperStaffId: "dated-third",
    status: "Disponible",
  }], []);
  assert.deepEqual(resolved.technicianIds, ["driver", "helper", "dated-third"]);
  assert.equal(resolved.additionalHelperStaffId, "dated-third");
});

test("empty dated crew ids fall back to regular crew while Sin personal still blocks the Van", () => {
  const emptyCrewOverride = {
    id: "VAN-1-2026-08-28",
    date,
    vanId: "VAN-1",
    driverStaffId: "",
    helperStaffId: "",
    additionalHelperStaffId: "",
    status: "Disponible",
  };
  const resolved = resolveAssignment(van, date, profiles, [emptyCrewOverride], []);

  assert.deepEqual(resolved.technicianIds, ["driver", "helper", "third"]);
  assert.equal(resolved.status, "Disponible");
  assert.equal(vanCanReceiveAppointments(van, resolved), true);

  const blocked = resolveAssignment(van, date, profiles, [{
    ...emptyCrewOverride,
    status: "Sin personal",
  }], []);
  assert.deepEqual(blocked.technicianIds, ["driver", "helper", "third"]);
  assert.equal(blocked.status, "Sin personal");
  assert.equal(vanCanReceiveAppointments(van, blocked), false);
});

test("absent optional third helper is omitted but does not reduce protected Van capacity status", () => {
  const resolved = resolveAssignment(van, date, profiles, [], [{
    id: "ABS-third",
    staffId: "third",
    fromDate: date,
    toDate: date,
    active: true,
  }]);
  assert.equal(resolved.additionalHelperStaffId, undefined);
  assert.deepEqual(resolved.technicianIds, ["driver", "helper"]);
  assert.equal(resolved.status, "Disponible");
  assert.equal(vanCanReceiveAppointments(van, resolved), true);
});

test("third helper never substitutes for the required regular helper", () => {
  const resolved = resolveAssignment({ ...van, regularHelperId: "missing-helper" }, date, profiles, [], []);
  assert.deepEqual(resolved.technicianIds, ["driver", "third"]);
  assert.equal(resolved.status, "Trabajo liviano");
  // Preserve the established availability rule: driver-backed light work can still
  // receive appointments; the third helper does not silently redefine capacity.
  assert.equal(vanCanReceiveAppointments(van, resolved), true);
});
