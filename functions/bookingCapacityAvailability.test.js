const test = require("node:test");
const assert = require("node:assert/strict");
const {
  candidateAvailability,
  capacityLockSlots,
  endTimeFromOccupiedSlots,
  evaluateCandidateAvailability,
  workOrderBlocksOperationalMoveCapacity,
} = require("./bookingCapacityAvailability");
const {
  isHalfDay,
  normalizeWorkOrderStatus,
  occupiedSlots,
  orderBlocksCapacity,
  resolveAssignment,
  workOrderStatusBlocksCapacity,
} = require("./bookingSchedulingPrimitives");

test("normal and operational capacity share normalized non-blocking Work Order statuses", () => {
  const nonBlocking = [
    "Cancelada",
    "cancelada",
    "CANCELLED",
    "canceled",
    "Reprogramada",
    "REPROGRAMADA",
    "rescheduled",
  ];
  for (const status of nonBlocking) {
    assert.equal(workOrderStatusBlocksCapacity(status), false, status);
    assert.equal(orderBlocksCapacity({ status }), false, status);
    assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status }), false, status);
  }

  for (const status of ["Confirmada", "Pendiente", "unknown-legacy-state", ""]) {
    assert.equal(orderBlocksCapacity({ status }), true, status || "blank");
    assert.equal(workOrderBlocksOperationalMoveCapacity({ appointmentId: "APT-1", status }), true, status || "blank");
  }
  assert.equal(workOrderBlocksOperationalMoveCapacity({ status: "Confirmada" }), false);
  assert.equal(normalizeWorkOrderStatus("  REPROGRAMADA  "), "reprogramada");
});

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

test("three reserved half-day spots end at 12:30 without opening forbidden PM capacity", () => {
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
  assert.equal(result.capacityEndTime, "12:30");
  assert.equal(endTimeFromOccupiedSlots(["09:30", "10:30", "11:30"]), "12:30");
});

test("half-day capacity respects configured workdayStart and workdayEnd", () => {
  const base = {
    date: "2026-08-24",
    allocation: { quantity: 1, durationMinutes: 180, slots: 3, fullDay: false },
    van: { id: "VAN-1", name: "Van 1", active: true },
    assignment: {
      driverStaffId: "miguel",
      helperStaffId: "alan",
      technicianIds: ["miguel", "alan"],
      status: "Disponible",
    },
    data: {
      workOrders: [],
      services: [],
      properties: [],
      vanHalfDaySchedules: [{
        id: "half-day-VAN-1",
        vanId: "VAN-1",
        weekday: 1,
        active: true,
        workdayStart: "09:00",
        workdayEnd: "12:30",
        extraMorningSlot: "11:30",
      }],
    },
    routeConfig: { routePolicy: "advisory", zones: [] },
    candidateZone: null,
  };

  const beforeConfiguredStart = evaluateCandidateAvailability({ ...base, time: "08:30" });
  assert.equal(beforeConfiguredStart.available, false);
  assert.equal(beforeConfiguredStart.rejection.code, "half-day-capacity-unavailable");

  const exactConfiguredWindow = evaluateCandidateAvailability({ ...base, time: "09:30" });
  assert.equal(exactConfiguredWindow.available, true);
  assert.equal(exactConfiguredWindow.candidate.endTime, "12:30");
  assert.deepEqual(exactConfiguredWindow.candidate.ownedSlots, ["09:30", "10:30", "11:30"]);

  const shortened = evaluateCandidateAvailability({
    ...base,
    time: "09:30",
    data: {
      ...base.data,
      vanHalfDaySchedules: [{ ...base.data.vanHalfDaySchedules[0], workdayEnd: "12:00" }],
    },
  });
  assert.equal(shortened.available, false);
  assert.equal(shortened.rejection.code, "half-day-capacity-unavailable");
});

function explicitTargetFixture(existingOrderTime = "08:30", existingDurationMinutes = 60) {
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
      scheduledSlots: Math.ceil(existingDurationMinutes / 60),
      appointmentDurationMinutes: existingDurationMinutes,
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
  const fixture = explicitTargetFixture();
  const evaluated = evaluateCandidateAvailability(fixture);
  assert.equal(evaluated.available, false);
  assert.equal(evaluated.rejection.stage, "route");
  assert.equal(evaluated.rejection.code, "route-policy-rejected");
  assert.equal(evaluated.rejection.facts.routePolicy, "enforced");
  assert.equal(candidateAvailability(fixture), null, "the legacy nullable wrapper remains compatible");
});

test("Other manual duration matrix owns the canonical slots for 1h, 2h, 3h, 3.5h and 6h", () => {
  const cases = [
    [60, ["08:30"]],
    [120, ["08:30", "09:30"]],
    [180, ["08:30", "09:30", "10:30"]],
    [210, ["08:30", "09:30", "10:30"]],
    [360, ["08:30", "09:30", "10:30", "13:30"]],
  ];
  for (const [durationMinutes, expectedSlots] of cases) {
    assert.deepEqual(
      capacityLockSlots({
        time: "08:30",
        durationMinutes,
        slots: Math.ceil(durationMinutes / 60),
        halfDay: false,
        fullDay: false,
      }),
      expectedSlots,
      `${durationMinutes} minutes`,
    );
  }
});

test("candidate diagnostics distinguish crew, Van and half-day rejection stages", () => {
  const crew = explicitTargetFixture();
  crew.routeConfig = { ...crew.routeConfig, routePolicy: "advisory" };
  crew.assignment = { technicianIds: [], status: "Sin personal" };
  const crewResult = evaluateCandidateAvailability(crew);
  assert.equal(crewResult.available, false);
  assert.equal(crewResult.rejection.stage, "crew");
  assert.equal(crewResult.rejection.code, "crew-unavailable");
  assert.equal(crewResult.rejection.vanId, "VAN-2");
  assert.equal(crewResult.rejection.date, "2098-12-22");
  assert.equal(crewResult.rejection.start, "09:30");

  const unavailableVan = explicitTargetFixture();
  unavailableVan.routeConfig = { ...unavailableVan.routeConfig, routePolicy: "advisory" };
  unavailableVan.van = { ...unavailableVan.van, status: "Mantenimiento" };
  unavailableVan.assignment = { ...unavailableVan.assignment, status: "Mantenimiento" };
  const vanResult = evaluateCandidateAvailability(unavailableVan);
  assert.equal(vanResult.available, false);
  assert.equal(vanResult.rejection.stage, "fleet");
  assert.equal(vanResult.rejection.code, "van-unavailable");

  const halfDay = explicitTargetFixture();
  halfDay.date = "2098-12-22";
  halfDay.time = "13:30";
  halfDay.allocation = { quantity: 1, durationMinutes: 60, slots: 1, fullDay: false };
  halfDay.routeConfig = { ...halfDay.routeConfig, routePolicy: "advisory" };
  halfDay.data.workOrders = [];
  halfDay.data.vanHalfDaySchedules = [{ vanId: "VAN-2", weekday: 1, active: true }];
  const halfDayResult = evaluateCandidateAvailability(halfDay);
  assert.equal(halfDayResult.available, false);
  assert.equal(halfDayResult.rejection.stage, "calendar");
  assert.equal(halfDayResult.rejection.code, "half-day-capacity-unavailable");
});

test("explicit office target keeps real elapsed duration while crossing lunch", () => {
  const fixture = explicitTargetFixture();
  fixture.routeConfig = { ...fixture.routeConfig, routePolicy: "advisory" };
  const result = candidateAvailability(fixture);
  assert.ok(result);
  assert.equal(result.vanId, "VAN-2");
  assert.equal(result.slots, 4);
  assert.equal(result.durationMinutes, 240);
  assert.equal(result.endTime, "13:30");
  assert.equal(result.capacityEndTime, "13:30");
  assert.equal(result.routeReason, "explicit-office-target");
});

test("a three-hour interval ending at 13:30 releases the 13:30 customer start", () => {
  const first = explicitTargetFixture();
  first.time = "10:30";
  first.allocation = { quantity: 3, durationMinutes: 180, slots: 3, fullDay: false };
  first.routeConfig = { ...first.routeConfig, routePolicy: "advisory" };
  first.data.workOrders = [];
  const longJob = candidateAvailability(first);
  assert.ok(longJob);
  assert.equal(longJob.endTime, "13:30");
  assert.equal(longJob.capacityEndTime, "13:30");
  assert.deepEqual(longJob.ownedSlots, ["10:30"]);
  assert.deepEqual(
    capacityLockSlots({ time: "10:30", durationMinutes: 180, slots: 3, halfDay: false, fullDay: false }),
    ["10:30"],
  );

  const followUp = explicitTargetFixture("10:30", 180);
  followUp.time = "13:30";
  followUp.allocation = { quantity: 1, durationMinutes: 60, slots: 1, fullDay: false };
  followUp.routeConfig = { ...followUp.routeConfig, routePolicy: "advisory" };
  assert.ok(candidateAvailability(followUp));
});

test("a non-full-day six-hour interval owns only starts before its real 14:30 release", () => {
  const fixture = explicitTargetFixture();
  fixture.time = "08:30";
  fixture.allocation = { quantity: 6, durationMinutes: 360, slots: 6, fullDay: false };
  fixture.routeConfig = { ...fixture.routeConfig, routePolicy: "advisory" };
  fixture.data.workOrders = [];
  const result = candidateAvailability(fixture);
  assert.ok(result);
  assert.equal(result.endTime, "14:30");
  assert.equal(result.capacityEndTime, "14:30");
  assert.equal(result.slots, 6);
  assert.deepEqual(
    capacityLockSlots({ time: "08:30", durationMinutes: 360, slots: 6, halfDay: false, fullDay: false }),
    ["08:30", "09:30", "10:30", "13:30"],
  );
});

test("a three-hour interval starting at 09:30 owns the two sellable starts before 12:30", () => {
  assert.deepEqual(
    capacityLockSlots({ time: "09:30", durationMinutes: 180, slots: 3, halfDay: false, fullDay: false }),
    ["09:30", "10:30"],
  );
});

test("a real continuous-time overlap is still rejected across lunch", () => {
  const fixture = explicitTargetFixture("10:30", 180);
  fixture.time = "13:00";
  fixture.allocation = { quantity: 1, durationMinutes: 60, slots: 1, fullDay: false };
  fixture.routeConfig = { ...fixture.routeConfig, routePolicy: "advisory" };
  // 13:00 is not a sellable canonical start, so the scheduler rejects it before conflict evaluation.
  assert.equal(candidateAvailability(fixture), null);

  const canonicalOverlap = explicitTargetFixture("10:30", 240);
  canonicalOverlap.time = "13:30";
  canonicalOverlap.allocation = { quantity: 1, durationMinutes: 60, slots: 1, fullDay: false };
  canonicalOverlap.routeConfig = { ...canonicalOverlap.routeConfig, routePolicy: "advisory" };
  assert.equal(candidateAvailability(canonicalOverlap), null);
});

test("full-day policy still owns every sellable regular start", () => {
  assert.deepEqual(
    capacityLockSlots({ time: "08:30", durationMinutes: 420, slots: 6, halfDay: false, fullDay: true }),
    ["08:30", "09:30", "10:30", "13:30", "14:30", "15:30"],
  );
});

test("full-day availability exposes work end and reserved capacity end separately", () => {
  const fixture = explicitTargetFixture();
  fixture.time = "08:30";
  fixture.allocation = { quantity: 7, durationMinutes: 420, slots: 6, fullDay: true };
  fixture.routeConfig = { ...fixture.routeConfig, routePolicy: "advisory" };
  fixture.data.workOrders = [];
  const result = candidateAvailability(fixture);
  assert.ok(result);
  assert.equal(result.endTime, "15:30");
  assert.equal(result.capacityEndTime, "16:30");
  assert.equal(result.fullDay, true);
  assert.equal(result.slots, 6);
});
