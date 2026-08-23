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
  singleWork,
  supportStartTimes,
  timeAllowed,
} = require("./bookingAuthoritySchedulingEngine");

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
  assert.equal(CANONICAL_SCHEDULING_ENGINE_VERSION, 7);
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

test("Scheduling policy uses one primary van through seven Standard Services and one support van above seven", () => {
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

  assert.deepEqual(
    buildAllocationPlan(14, 60, 4, preset, {}),
    [],
    "one support van cannot physically absorb seven additional one-hour executions in the six-slot operating day",
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
