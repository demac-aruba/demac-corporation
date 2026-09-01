const test = require("node:test");
const assert = require("node:assert/strict");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const { normalizeRouteConfig } = require("./bookingSchedulingPrimitives");
const {
  CANONICAL_SCHEDULING_ENGINE_VERSION,
  buildAllocationPlan,
  exactPreset,
  generateCanonicalOptions,
  parseStructuredTimeConstraint,
  resolveWorkScope,
  sanitizeSchedulingDiagnosticFacts,
  singleWork,
  supportStartTimes,
  timeAllowed,
} = require("./bookingAuthoritySchedulingEngine");

test("diagnostic facts are allow-listed and bounded before crossing the authority boundary", () => {
  const facts = sanitizeSchedulingDiagnosticFacts({
    vanPresent: true,
    durationMinutes: 9_999_999,
    routeReason: "r".repeat(300),
    blockingWorkOrderIds: Array.from({ length: 10 }, (_, index) => `WO-${index}`),
    ownedSlots: ["08:30", "09:30", "09:30"],
    customerName: "Private Customer",
    email: "private@example.com",
    arbitraryNestedObject: { secret: true },
  });

  assert.equal(facts.vanPresent, true);
  assert.equal(facts.durationMinutes, 100_000);
  assert.equal(facts.routeReason.length, 120);
  assert.deepEqual(facts.blockingWorkOrderIds, ["WO-0", "WO-1", "WO-2", "WO-3", "WO-4"]);
  assert.deepEqual(facts.ownedSlots, ["08:30", "09:30"]);
  assert.equal(Object.hasOwn(facts, "customerName"), false);
  assert.equal(Object.hasOwn(facts, "email"), false);
  assert.equal(Object.hasOwn(facts, "arbitraryNestedObject"), false);
});

const legacyStandardPreset = {
  id: "standard_service",
  label: "Servicio estándar",
  kind: "service",
  durationMinutesPerUnit: 60,
};

const canonicalStandardService = {
  id: "s1",
  name: "Servicio estándar",
  itemType: "Servicio",
  active: true,
  featured: true,
  durationMinutes: 60,
  serviceDefinition: {
    version: 1,
    bookingCode: "standard_service",
    duration: { minutes: 60 },
  },
};

const canonicalInstallation = {
  id: "s-install",
  name: "Standard Installation",
  itemType: "Servicio",
  active: true,
  featured: true,
  durationMinutes: 120,
  serviceDefinition: {
    version: 1,
    bookingCode: "standard_installation",
    duration: { minutes: 120 },
  },
};

const canonicalOther = {
  id: "s-other",
  name: "Other",
  itemType: "Servicio",
  active: true,
  featured: true,
  durationMinutes: 60,
  serviceDefinition: {
    version: 1,
    bookingCode: "other",
    duration: { minutes: 60 },
  },
};

function bookingRequest(overrides = {}) {
  return {
    customerId: "c1",
    propertyId: "p1",
    workLines: [{
      id: "w1",
      presetId: "standard_service",
      serviceId: "s1",
      quantity: 2,
    }],
    constraints: {},
    ...overrides,
  };
}

function schedulingData({ canonical = true } = {}) {
  return {
    workOrders: [],
    services: canonical ? [canonicalStandardService, canonicalInstallation, canonicalOther] : [{ id: "s1", name: "Servicio estándar" }],
    properties: [{ id: "p1", clientId: "c1", address: "Wayaca 217", operationalZone: "Oranjestad Este" }],
    clients: [{ id: "c1", name: "Test Customer" }],
    vans: [
      { id: "VAN-1", name: "Van 1", active: true, responsibleStaffId: "driver-1" },
      { id: "VAN-2", name: "Van 2", active: true, responsibleStaffId: "driver-2" },
      { id: "VAN-3", name: "Van 3", active: true, responsibleStaffId: "driver-3" },
    ],
    staffProfiles: [
      { id: "driver-1", active: true, availability: "Disponible", canDriveVan: true },
      { id: "driver-2", active: true, availability: "Disponible", canDriveVan: true },
      { id: "driver-3", active: true, availability: "Disponible", canDriveVan: true },
    ],
    dailyVanAssignments: [],
    staffAbsences: [],
    calendarClosures: [],
    vanHalfDaySchedules: [],
    businessSettings: [{
      id: "appointment-work-presets",
      presets: [
        { ...legacyStandardPreset },
        {
          id: "deep_cleaning",
          label: "Deep cleaning",
          kind: "service",
          durationMinutesPerUnit: 120,
        },
      ],
    }, {
      id: "business-calendar",
      closedWeekdays: [0],
    }],
  };
}

function exactTargetRequest(quantity) {
  return bookingRequest({
    workLines: [{ id: "w1", presetId: "standard_service", serviceId: "s1", quantity }],
    constraints: { requestedDate: "2098-12-22", requestedTime: "08:30" },
  });
}

function supportTimes(result) {
  return new Set(result.options.map((option) => option.assignments.find((assignment) => assignment.role === "support")?.time).filter(Boolean));
}

test("canonical scheduling engine has an explicit version", () => {
  assert.equal(CANONICAL_SCHEDULING_ENGINE_VERSION, 11);
});

test("single-work helper still rejects mixed work for operations that require one work type", () => {
  assert.throws(
    () => singleWork({
      ...bookingRequest(),
      workLines: [
        ...bookingRequest().workLines,
        { presetId: "standard_installation", serviceId: "s-install", quantity: 1 },
      ],
    }),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST,
  );
});

test("mixed appointment work resolves into one trusted combined workload", () => {
  const data = schedulingData();
  const request = bookingRequest({
    workLines: [
      { id: "service", presetId: "standard_service", serviceId: "s1", quantity: 2 },
      { id: "install", presetId: "standard_installation", serviceId: "s-install", quantity: 1 },
    ],
    constraints: { requestedDate: "2098-12-22", requestedTime: "08:30" },
  });
  const scope = resolveWorkScope(request, data);
  assert.equal(scope.items.length, 2);
  assert.equal(scope.totalQuantity, 3);
  assert.equal(scope.totalDurationMinutes, 240);
  assert.equal(scope.singleType, false);

  const result = generateCanonicalOptions({
    request,
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2098-12-21",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-1",
    requireRequestedTarget: true,
  });
  assert.equal(result.reason, "available");
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].assignments.length, 1);
  assert.equal(result.options[0].assignments[0].durationMinutes, 240);
  assert.equal(result.options[0].workItems.length, 2);
  assert.equal(result.options[0].durationMode, "mixed");
});

test("Other requires and uses a manual scheduled duration without changing the catalog duration", () => {
  const data = schedulingData();
  const request = bookingRequest({
    workLines: [{ id: "other-work", presetId: "other", serviceId: "s-other", quantity: 1, manualDurationMinutes: 210 }],
  });
  const scope = resolveWorkScope(request, data);
  assert.equal(scope.totalDurationMinutes, 210);
  assert.equal(scope.workItems[0].durationMode, "manual");
  assert.equal(scope.workItems[0].durationMinutes, 210);
  assert.equal(data.services.find((item) => item.id === "s-other").durationMinutes, 60);

  assert.throws(
    () => resolveWorkScope(bookingRequest({ workLines: [{ id: "other", presetId: "other", serviceId: "s-other", quantity: 1 }] }), data),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST,
  );
  assert.throws(
    () => resolveWorkScope(bookingRequest({ workLines: [{ id: "service", presetId: "standard_service", serviceId: "s1", quantity: 1, manualDurationMinutes: 90 }] }), data),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST,
  );
});

function exactOtherTargetFixture(vanId = "VAN-4") {
  const data = schedulingData();
  const suffix = vanId.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const driverId = `driver-${suffix}`;
  const helperId = `helper-${suffix}`;
  data.vans.push({
    id: vanId,
    name: vanId === "VAN-4" ? "Van 4" : "Future Test Field Van",
    active: true,
    responsibleStaffId: driverId,
    regularHelperId: helperId,
  });
  data.staffProfiles.push(
    { id: driverId, active: true, availability: "Disponible", canDriveVan: true },
    { id: helperId, active: true, availability: "Disponible" },
  );
  return {
    data,
    request: bookingRequest({
      workLines: [{
        id: "other-work",
        presetId: "other",
        serviceId: "s-other",
        quantity: 1,
        manualDurationMinutes: 180,
      }],
      constraints: { requestedDate: "2026-09-01", requestedTime: "08:30" },
    }),
  };
}

function exactOtherTargetResult({ currentTime = "07:00", workOrders = [], vanId = "VAN-4" } = {}) {
  const { data, request } = exactOtherTargetFixture(vanId);
  data.workOrders = workOrders;
  return generateCanonicalOptions({
    request,
    property: data.properties[0],
    data,
    routeConfig: { ...normalizeRouteConfig(), routePolicy: "advisory" },
    today: "2026-09-01",
    currentTime,
    requiredPrimaryVanId: vanId,
    requireRequestedTarget: true,
  });
}

test("exact Van 4 Other 180-minute target resolves three owned slots before its start", () => {
  const result = exactOtherTargetResult();
  assert.equal(result.reason, "available");
  assert.equal(result.diagnostic, null);
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].time, "08:30");
  assert.equal(result.options[0].endTime, "11:30");
  assert.equal(result.options[0].capacityEndTime, "11:30");
  assert.equal(result.options[0].assignments[0].vanId, "VAN-4");
  assert.equal(result.options[0].assignments[0].durationMinutes, 180);
  assert.equal(result.options[0].assignments[0].slots, 3);
  assert.deepEqual(result.options[0].assignments[0].ownedSlots, ["08:30", "09:30", "10:30"]);
  assert.deepEqual(result.resolvedWorkload, {
    quantity: 1,
    durationMinutes: 180,
    durationMode: "manual",
    workItemCount: 1,
    hasManualDuration: true,
    vansRequired: 1,
    slots: 3,
    ownedSlots: ["08:30", "09:30", "10:30"],
    endTime: "11:30",
    capacityEndTime: "11:30",
    halfDay: false,
    allocations: [{ role: "primary", quantity: 1, durationMinutes: 180, slots: 3, fullDay: false }],
  });
});

test("an opaque future Van uses the same full engine path for accept, conflict, and release", () => {
  const vanId = "VAN-FUTURE-TEST-947";
  const available = exactOtherTargetResult({ vanId });
  assert.equal(available.reason, "available");
  assert.equal(available.options[0].assignments[0].vanId, vanId);
  assert.equal(available.options[0].endTime, "11:30");
  assert.deepEqual(available.options[0].assignments[0].ownedSlots, ["08:30", "09:30", "10:30"]);

  const blocker = {
    id: "WO-FUTURE-CONFLICT",
    appointmentId: "APT-FUTURE-CONFLICT",
    date: "2026-09-01",
    time: "09:30",
    status: "Confirmada",
    vanId,
    scheduledSlots: 1,
    propertyId: "p1",
  };
  const blocked = exactOtherTargetResult({ vanId, workOrders: [blocker] });
  assert.equal(blocked.reason, "no-availability");
  assert.equal(blocked.diagnostic.code, "work-order-conflict");
  assert.deepEqual(blocked.diagnostic.facts.blockingSlots, ["09:30"]);

  const restored = exactOtherTargetResult({
    vanId,
    workOrders: [{ ...blocker, status: "Cancelled" }],
  });
  assert.equal(restored.reason, "available");
});

test("exact same-day target rejected after its start exposes a temporal diagnostic", () => {
  const result = exactOtherTargetResult({ currentTime: "09:05" });
  assert.equal(result.reason, "no-availability");
  assert.deepEqual(result.options, []);
  assert.equal(result.diagnostic.stage, "temporal");
  assert.equal(result.diagnostic.code, "START_TIME_PASSED");
  assert.deepEqual(result.diagnostic.requested, {
    date: "2026-09-01",
    time: "08:30",
    primaryVanId: "VAN-4",
  });
  assert.deepEqual(result.diagnostic.evaluated, {
    date: "2026-09-01",
    time: "09:05",
    timeZone: "America/Aruba",
  });
  assert.deepEqual(result.diagnostic.resolvedWorkload.ownedSlots, ["08:30", "09:30", "10:30"]);
  assert.equal(result.diagnostic.resolvedWorkload.durationMinutes, 180);
});

test("an unlinked blocking Work Order is explicit in diagnostics and Cancelada restores capacity", () => {
  const blockingOrder = {
    id: "WO-LEGACY-UNLINKED",
    date: "2026-09-01",
    time: "09:30",
    status: "Pendiente",
    vanId: "VAN-4",
    scheduledSlots: 1,
    propertyId: "p1",
  };
  const blocked = exactOtherTargetResult({ workOrders: [blockingOrder] });
  assert.equal(blocked.reason, "no-availability");
  assert.equal(blocked.diagnostic.stage, "work-order");
  assert.equal(blocked.diagnostic.code, "work-order-conflict");
  assert.equal(blocked.diagnostic.facts.blockingWorkOrderCount, 1);
  assert.equal(blocked.diagnostic.facts.unlinkedBlockingWorkOrderCount, 1);
  assert.deepEqual(blocked.diagnostic.facts.blockingWorkOrderIds, ["WO-LEGACY-UNLINKED"]);
  assert.deepEqual(blocked.diagnostic.facts.blockingSlots, ["09:30"]);
  assert.equal(blocked.diagnostic.facts.attemptedEnd, "11:30");
  assert.equal(blocked.diagnostic.facts.attemptedCapacityEnd, "11:30");
  assert.equal(blocked.diagnostic.facts.candidateVanId, "VAN-4");
  assert.equal(blocked.diagnostic.facts.candidateDate, "2026-09-01");
  assert.equal(blocked.diagnostic.facts.candidateStart, "08:30");
  assert.deepEqual(blocked.diagnostic.facts.ownedSlots, ["08:30", "09:30", "10:30"]);

  const restored = exactOtherTargetResult({
    workOrders: [{ ...blockingOrder, status: "Cancelada" }],
  });
  assert.equal(restored.reason, "available");
  assert.equal(restored.options[0].endTime, "11:30");
});

test("Other manual durations preserve exact work and capacity ownership through the full engine", () => {
  const expectations = [
    [60, "09:30", "09:30", ["08:30"]],
    [120, "10:30", "10:30", ["08:30", "09:30"]],
    [180, "11:30", "11:30", ["08:30", "09:30", "10:30"]],
    [210, "12:00", "12:00", ["08:30", "09:30", "10:30"]],
    [360, "14:30", "14:30", ["08:30", "09:30", "10:30", "13:30"]],
  ];
  for (const [durationMinutes, expectedEnd, expectedCapacityEnd, expectedOwnedSlots] of expectations) {
    const { data, request } = exactOtherTargetFixture("VAN-4");
    request.workLines[0].manualDurationMinutes = durationMinutes;
    const result = generateCanonicalOptions({
      request,
      property: data.properties[0],
      data,
      routeConfig: normalizeRouteConfig(),
      today: "2026-08-31",
      currentTime: "07:00",
      requiredPrimaryVanId: "VAN-4",
      requireRequestedTarget: true,
    });
    assert.equal(result.reason, "available", `${durationMinutes} minutes must be schedulable from the open 08:30 target`);
    const assignment = result.options[0].assignments[0];
    assert.equal(assignment.durationMinutes, durationMinutes);
    assert.equal(result.options[0].endTime, expectedEnd);
    assert.equal(result.options[0].capacityEndTime, expectedCapacityEnd);
    assert.deepEqual(assignment.ownedSlots, expectedOwnedSlots);
  }
});

test("Other 180 at 08:30 rejects either the 09:30 or 10:30 occupied capacity start", () => {
  for (const blockingTime of ["09:30", "10:30"]) {
    const result = exactOtherTargetResult({
      workOrders: [{
        id: `WO-BLOCK-${blockingTime}`,
        appointmentId: `APT-BLOCK-${blockingTime}`,
        date: "2026-09-01",
        time: blockingTime,
        status: "Confirmada",
        vanId: "VAN-4",
        scheduledSlots: 1,
        propertyId: "p1",
      }],
    });
    assert.equal(result.reason, "no-availability");
    assert.equal(result.diagnostic.code, "work-order-conflict");
    assert.deepEqual(result.diagnostic.facts.blockingSlots, [blockingTime]);
  }
});

test("a configurable half-day ending at 13:00 rejects Other 180 starting at 10:30", () => {
  const { data, request } = exactOtherTargetFixture("VAN-4");
  request.constraints.requestedTime = "10:30";
  data.vanHalfDaySchedules = [{
    id: "half-day-van-4",
    vanId: "VAN-4",
    weekday: 2,
    active: true,
    workdayStart: "08:30",
    workdayEnd: "13:00",
    extraMorningSlot: "11:30",
  }];
  const result = generateCanonicalOptions({
    request,
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2026-08-31",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-4",
    requireRequestedTarget: true,
  });
  assert.equal(result.reason, "no-availability");
  assert.equal(result.diagnostic.code, "half-day-capacity-unavailable");
  assert.equal(result.diagnostic.resolvedWorkload.durationMinutes, 180);
});

test("end-of-day exact fit is accepted and one additional hour is rejected", () => {
  for (const [durationMinutes, expectedAvailable] of [[60, true], [120, false]]) {
    const { data, request } = exactOtherTargetFixture("VAN-4");
    request.constraints.requestedTime = "15:30";
    request.workLines[0].manualDurationMinutes = durationMinutes;
    const result = generateCanonicalOptions({
      request,
      property: data.properties[0],
      data,
      routeConfig: normalizeRouteConfig(),
      today: "2026-08-31",
      currentTime: "07:00",
      requiredPrimaryVanId: "VAN-4",
      requireRequestedTarget: true,
    });
    assert.equal(result.options.length > 0, expectedAvailable, `${durationMinutes} minutes at 15:30 availability mismatch`);
    if (expectedAvailable) {
      assert.equal(result.options[0].capacityEndTime, "16:30");
      assert.deepEqual(result.options[0].assignments[0].ownedSlots, ["15:30"]);
    } else {
      assert.equal(result.diagnostic.code, "outside-operational-window");
    }
  }
});

test("requested-date grid enumerates every eligible primary Van for fleets of 1, 5, 8 and 15", () => {
  for (const fleetSize of [1, 5, 8, 15]) {
    const data = schedulingData();
    data.vans = Array.from({ length: fleetSize }, (_, index) => ({
      id: `fleet/${fleetSize}/opaque/${index}`,
      name: `Configured Field Unit ${fleetSize}-${index}`,
      active: true,
      responsibleStaffId: `grid-driver-${fleetSize}-${index}`,
      regularHelperId: `grid-helper-${fleetSize}-${index}`,
    }));
    data.staffProfiles = data.vans.flatMap((van) => [
      { id: van.responsibleStaffId, active: true, availability: "Disponible", canDriveVan: true },
      { id: van.regularHelperId, active: true, availability: "Disponible" },
    ]);
    const request = bookingRequest({
      workLines: [{ id: "grid-work", presetId: "other", serviceId: "s-other", quantity: 1, manualDurationMinutes: 60 }],
      constraints: { requestedDate: "2098-12-22", requestedTime: "" },
    });
    const result = generateCanonicalOptions({
      request,
      property: data.properties[0],
      data,
      routeConfig: normalizeRouteConfig(),
      today: "2098-12-21",
      currentTime: "07:00",
      requestedDateGrid: true,
    });
    assert.equal(result.reason, "available");
    assert.equal(result.options.every((option) => option.date === "2098-12-22"), true);
    const primaryVanIds = new Set(result.options.map((option) => option.assignments[0]?.vanId));
    assert.deepEqual(primaryVanIds, new Set(data.vans.map((van) => van.id)), `fleet ${fleetSize} must not lose an eligible primary Van`);
    assert.equal(result.options.length >= fleetSize, true);
  }
});

test("an explicitly requested future date is evaluated directly beyond the automatic 21-day shortlist", () => {
  const data = schedulingData();
  const requestedDate = "2098-12-22";
  const request = bookingRequest({
    workLines: [{ id: "future-grid-work", presetId: "other", serviceId: "s-other", quantity: 1, manualDurationMinutes: 60 }],
    constraints: { requestedDate, requestedTime: "08:30" },
  });
  const result = generateCanonicalOptions({
    request,
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2098-11-01",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-1",
    requireRequestedTarget: true,
    requestedDateGrid: true,
  });
  assert.equal(result.reason, "available");
  assert.equal(result.options[0].date, requestedDate);
  assert.equal(result.options[0].time, "08:30");
});

test("requested-date grid keeps one complete support allocation for each feasible primary Van", () => {
  const data = schedulingData();
  data.vans = Array.from({ length: 5 }, (_, index) => ({
    id: `support-grid-van-${index}`,
    name: `Support Grid Van ${index + 1}`,
    active: true,
    responsibleStaffId: `support-grid-driver-${index}`,
    regularHelperId: `support-grid-helper-${index}`,
  }));
  data.staffProfiles = data.vans.flatMap((van) => [
    { id: van.responsibleStaffId, active: true, availability: "Disponible", canDriveVan: true },
    { id: van.regularHelperId, active: true, availability: "Disponible" },
  ]);
  const result = generateCanonicalOptions({
    request: bookingRequest({
      workLines: [{ id: "support-work", presetId: "standard_service", serviceId: "s1", quantity: 8 }],
      constraints: { requestedDate: "2098-12-22", requestedTime: "" },
    }),
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2098-12-21",
    currentTime: "07:00",
    requestedDateGrid: true,
  });
  const primaryVanIds = new Set(result.options.map((candidate) => candidate.assignments[0]?.vanId));
  assert.deepEqual(primaryVanIds, new Set(data.vans.map((van) => van.id)));
  assert.equal(result.options.every((candidate) => candidate.assignments.length === 2), true);
  assert.equal(result.options.every((candidate) => candidate.assignments[0].vanId !== candidate.assignments[1].vanId), true);
});

test("canonical option generation supports governed 14-unit and 16-unit multi-Van plans", () => {
  for (const [quantity, expectedQuantities] of [[14, [7, 7]], [16, [7, 7, 2]]]) {
    const data = schedulingData();
    const result = generateCanonicalOptions({
      request: exactTargetRequest(quantity),
      property: data.properties[0],
      data,
      routeConfig: normalizeRouteConfig(),
      today: "2098-12-21",
      currentTime: "07:00",
      requiredPrimaryVanId: "VAN-1",
      requireRequestedTarget: true,
    });
    assert.equal(result.reason, "available", `${quantity} units must remain schedulable when enough Vans exist`);
    assert.deepEqual(result.options[0].assignments.map((assignment) => assignment.quantity), expectedQuantities);
    assert.equal(new Set(result.options[0].assignments.map((assignment) => assignment.vanId)).size, expectedQuantities.length);
  }
});

test("canonical service catalog overrides legacy duration while Scheduling owns allocation", () => {
  const data = schedulingData();
  data.businessSettings[0].presets[0].durationMinutesPerUnit = 90;
  const preset = exactPreset(data, { presetId: "standard_service", serviceId: "s1" });
  assert.equal(preset.source, "service_catalog");
  assert.equal(preset.serviceId, "s1");
  assert.equal(preset.durationMinutesPerUnit, 60);
  assert.equal(preset.durationMode, "per_unit");
  assert.equal(preset.allocation, undefined);
});

test("stale allocation metadata on a service cannot override Scheduling policy", () => {
  const data = schedulingData();
  data.services[0] = {
    ...data.services[0],
    serviceDefinition: {
      ...data.services[0].serviceDefinition,
      quantityUnit: "ac_unit",
      duration: { mode: "fixed", minutes: 60 },
      allocation: { mode: "single_van", supportSelection: "none" },
    },
  };
  const preset = exactPreset(data, { presetId: "standard_service", serviceId: "s1" });
  const plan = buildAllocationPlan(8, preset.durationMinutesPerUnit, 4, preset, {});
  assert.equal(preset.durationMode, "per_unit");
  assert.equal(preset.allocation, undefined);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].quantity, 7);
  assert.equal(plan[1].quantity, 1);
});

test("legacy appointment presets remain a temporary fallback for unmigrated services", () => {
  const preset = exactPreset(schedulingData({ canonical: false }), { presetId: "standard_service", serviceId: "s1" });
  assert.equal(preset.source, "appointment_work_presets");
  assert.equal(preset.durationMinutesPerUnit, 60);
  assert.throws(
    () => exactPreset(schedulingData({ canonical: false }), { presetId: "not-configured", serviceId: "missing" }),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST,
  );
});

test("support start candidates are broad and physical capacity decides which ones actually fit", () => {
  assert.deepEqual(
    supportStartTimes(1),
    ["08:30", "09:30", "10:30", "11:30", "13:30", "14:30", "15:30"],
  );
  assert.deepEqual(
    supportStartTimes(4),
    ["08:30", "09:30", "10:30", "11:30", "13:30", "14:30", "15:30"],
  );
  assert.deepEqual(supportStartTimes(7), []);
});

test("Scheduling policy scales Standard Service across every staffed Van required by the governed thresholds", () => {
  const preset = exactPreset(schedulingData(), { presetId: "standard_service", serviceId: "s1" });

  assert.deepEqual(
    buildAllocationPlan(2, 60, 4, preset, {}),
    [{
      quantity: 2,
      durationMinutes: 120,
      slots: 2,
      fullDay: false,
      role: "primary",
      timePolicy: "candidate",
    }],
  );

  const six = buildAllocationPlan(6, 60, 4, preset, {});
  assert.equal(six.length, 1);
  assert.equal(six[0].quantity, 6);
  assert.equal(six[0].slots, 6);
  assert.equal(six[0].durationMinutes, 360);
  assert.equal(six[0].fullDay, false);

  const seven = buildAllocationPlan(7, 60, 4, preset, {});
  assert.equal(seven.length, 1);
  assert.equal(seven[0].quantity, 7);
  assert.equal(seven[0].fullDay, true);
  assert.equal(seven[0].fixedTime, "08:30");

  for (const quantity of [8, 9, 10, 11, 12, 13]) {
    const plan = buildAllocationPlan(quantity, 60, 4, preset, {});
    assert.equal(plan.length, 2, `expected ${quantity} units to use primary + support`);
    assert.equal(plan[0].quantity, 7);
    assert.equal(plan[0].role, "primary");
    assert.equal(plan[1].quantity, quantity - 7);
    assert.equal(plan[1].role, "support");
  }

  const fourteen = buildAllocationPlan(14, 60, 4, preset, {});
  assert.equal(fourteen.length, 2);
  assert.deepEqual(fourteen.map((allocation) => allocation.quantity), [7, 7]);
  assert.equal(fourteen.every((allocation) => allocation.fullDay && allocation.fixedTime === "08:30"), true);

  const sixteen = buildAllocationPlan(16, 60, 4, preset, {});
  assert.equal(sixteen.length, 3);
  assert.deepEqual(sixteen.map((allocation) => allocation.quantity), [7, 7, 2]);
  assert.deepEqual(sixteen.map((allocation) => allocation.fullDay), [true, true, false]);

  assert.deepEqual(buildAllocationPlan(16, 60, 2, preset, {}), [], "real staffed Van count is the limit");
  assert.deepEqual(
    buildAllocationPlan(11, 60, 4, preset, { standardService: { automaticSupportMaxUnits: 10 } }),
    [],
    "a positive governed automatic maximum remains enforceable",
  );
});

test("a seven-unit same-property booking keeps the office-selected van as the full-day primary", () => {
  const data = schedulingData();
  const result = generateCanonicalOptions({
    request: exactTargetRequest(7),
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2098-12-21",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-1",
    requireRequestedTarget: true,
  });

  assert.equal(result.reason, "available");
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].date, "2098-12-22");
  assert.equal(result.options[0].time, "08:30");
  assert.equal(result.options[0].assignments.length, 1);
  assert.equal(result.options[0].assignments[0].vanId, "VAN-1");
  assert.equal(result.options[0].assignments[0].quantity, 7);
  assert.equal(result.options[0].assignments[0].fullDay, true);
  assert.equal(result.options[0].endTime, "15:30");
  assert.equal(result.options[0].capacityEndTime, "16:30");
  assert.equal(result.options[0].assignments[0].endTime, "15:30");
  assert.equal(result.options[0].assignments[0].capacityEndTime, "16:30");
});

test("eight-unit support can arrive in any one-hour opening that actually exists", () => {
  const data = schedulingData();
  const result = generateCanonicalOptions({
    request: exactTargetRequest(8),
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2098-12-21",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-1",
    requireRequestedTarget: true,
  });

  assert.equal(result.reason, "available");
  const times = supportTimes(result);
  assert.equal(times.has("08:30"), true);
  assert.equal(times.has("09:30"), true);
  assert.equal(times.has("10:30"), true);
  assert.equal(times.has("13:30"), true);
  assert.equal(times.has("14:30"), true);
  assert.equal(times.has("15:30"), true);
  assert.equal(times.has("11:30"), false, "11:30 is only an operational slot for a half-day van");
  const optionsBySupportVan = new Map();
  for (const option of result.options) {
    const support = option.assignments.find((assignment) => assignment.role === "support");
    if (!support) continue;
    const current = optionsBySupportVan.get(support.vanId) || [];
    current.push({ optionId: option.id, start: support.time, end: support.endTime });
    optionsBySupportVan.set(support.vanId, current);
  }
  const repeatedVanWindows = [...optionsBySupportVan.values()].find((windows) => windows.length > 1);
  assert.ok(repeatedVanWindows, "at least one support Van must expose multiple independently selectable windows");
  assert.equal(new Set(repeatedVanWindows.map((window) => window.optionId)).size, repeatedVanWindows.length);
  assert.equal(new Set(repeatedVanWindows.map((window) => `${window.start}|${window.end}`)).size, repeatedVanWindows.length);
});

test("eleven-unit Standard Service is not rejected by an arbitrary ten-unit ceiling", () => {
  const data = schedulingData();
  const result = generateCanonicalOptions({
    request: exactTargetRequest(11),
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2098-12-21",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-1",
    requireRequestedTarget: true,
  });

  assert.equal(result.reason, "available");
  assert.ok(result.options.length > 0);
  for (const option of result.options) {
    assert.equal(option.assignments[0].vanId, "VAN-1");
    assert.equal(option.assignments[0].quantity, 7);
    const support = option.assignments.find((assignment) => assignment.role === "support");
    assert.ok(support);
    assert.equal(support.quantity, 4);
    assert.notEqual(support.vanId, "VAN-1");
  }
});

test("support alternatives skip occupied windows but preserve a later valid arrival", () => {
  const data = schedulingData();
  data.workOrders.push({
    id: "existing-v2-am",
    appointmentId: "appt-existing-v2-am",
    date: "2098-12-22",
    time: "08:30",
    vanId: "VAN-2",
    propertyId: "p1",
    status: "Confirmada",
    scheduledSlots: 1,
  });
  const result = generateCanonicalOptions({
    request: exactTargetRequest(9),
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2098-12-21",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-1",
    requireRequestedTarget: true,
  });

  assert.equal(result.reason, "available");
  assert.equal(result.options.some((option) => option.assignments[1]?.vanId === "VAN-2" && option.assignments[1]?.time === "08:30"), false);
  assert.equal(result.options.some((option) => option.assignments[1]?.vanId === "VAN-2" && option.assignments[1]?.time === "09:30"), true);
});

test("large fixed-primary booking fails cleanly when no support van is operationally available", () => {
  const data = schedulingData();
  data.vans = [data.vans[0]];
  data.staffProfiles = [data.staffProfiles[0]];
  const result = generateCanonicalOptions({
    request: exactTargetRequest(11),
    property: data.properties[0],
    data,
    routeConfig: normalizeRouteConfig(),
    today: "2098-12-21",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-1",
    requireRequestedTarget: true,
  });
  assert.equal(result.options.length, 0);
  assert.equal(result.reason, "capacity");
});

test("time constraints accept canonical internal forms rather than customer-language parsing", () => {
  assert.deepEqual(
    parseStructuredTimeConstraint({ requestedTime: "14:30" }),
    { kind: "exact", time: "14:30" },
  );
  assert.deepEqual(
    parseStructuredTimeConstraint({ preferredTime: "afternoon" }),
    { kind: "afternoon", time: "" },
  );
  assert.deepEqual(
    parseStructuredTimeConstraint({ preferredTime: "from 13:00" }),
    { kind: "from", time: "13:00" },
  );
  assert.deepEqual(
    parseStructuredTimeConstraint({ preferredTime: "cliente dijo despues de almuerzo por favor" }),
    { kind: "", time: "" },
  );
  assert.equal(timeAllowed("13:30", { kind: "from", time: "13:00" }), true);
  assert.equal(timeAllowed("10:30", { kind: "from", time: "13:00" }), false);
});
