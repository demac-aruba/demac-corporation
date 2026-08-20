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
  singleWork,
  timeAllowed,
} = require("./bookingAuthoritySchedulingEngine");

const standardPreset = {
  id: "standard_service",
  label: "Servicio estándar",
  kind: "service",
  durationMinutesPerUnit: 60,
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

function schedulingData() {
  return {
    workOrders: [],
    services: [{ id: "s1", name: "Servicio estándar" }],
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
        standardPreset,
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

test("canonical scheduling engine has an explicit version", () => {
  assert.equal(CANONICAL_SCHEDULING_ENGINE_VERSION, 2);
});

test("canonical scheduling rejects mixed presets instead of guessing", () => {
  assert.throws(
    () => singleWork({
      ...bookingRequest(),
      workLines: [
        ...bookingRequest().workLines,
        { presetId: "deep_cleaning", quantity: 1 },
      ],
    }),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST,
  );
});

test("exact preset resolution requires the requested ERP preset", () => {
  const preset = exactPreset(schedulingData(), "standard_service");
  assert.equal(preset.durationMinutesPerUnit, 60);
  assert.throws(
    () => exactPreset(schedulingData(), "not-configured"),
    (error) => error.code === BOOKING_ERROR_CODES.INVALID_REQUEST,
  );
});

test("standard-service allocation preserves the canonical 2/7/8-10 unit rules", () => {
  assert.deepEqual(
    buildAllocationPlan(2, 60, 4, standardPreset, {}),
    [{
      quantity: 2,
      slots: 2,
      fullDay: false,
      role: "primary",
      timePolicy: "candidate",
    }],
  );

  assert.deepEqual(
    buildAllocationPlan(7, 60, 4, standardPreset, {}),
    [{
      quantity: 7,
      slots: 6,
      fullDay: true,
      role: "primary",
      fixedTime: "08:30",
      timePolicy: "fixed",
    }],
  );

  const eight = buildAllocationPlan(8, 60, 4, standardPreset, {});
  assert.equal(eight.length, 2);
  assert.equal(eight[0].quantity, 7);
  assert.equal(eight[1].quantity, 1);
  assert.deepEqual(eight[1].allowedTimes, ["08:30", "13:30"]);

  const ten = buildAllocationPlan(10, 60, 4, standardPreset, {});
  assert.equal(ten.length, 2);
  assert.equal(ten[1].quantity, 3);
  assert.deepEqual(buildAllocationPlan(11, 60, 4, standardPreset, {}), []);
});

test("a seven-unit same-property booking keeps the office-selected van as the full-day primary", () => {
  const result = generateCanonicalOptions({
    request: exactTargetRequest(7),
    property: schedulingData().properties[0],
    data: schedulingData(),
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

test("an eight-to-ten-unit booking keeps the selected primary and preserves support vans for office choice", () => {
  const result = generateCanonicalOptions({
    request: exactTargetRequest(10),
    property: schedulingData().properties[0],
    data: schedulingData(),
    routeConfig: normalizeRouteConfig(),
    today: "2098-12-21",
    currentTime: "07:00",
    requiredPrimaryVanId: "VAN-1",
    requireRequestedTarget: true,
  });

  assert.equal(result.reason, "available");
  assert.equal(result.options.length, 2);
  for (const option of result.options) {
    assert.equal(option.assignments.length, 2);
    assert.equal(option.assignments[0].vanId, "VAN-1");
    assert.equal(option.assignments[0].quantity, 7);
    assert.equal(option.assignments[0].role, "primary");
    assert.notEqual(option.assignments[1].vanId, "VAN-1");
    assert.equal(option.assignments[1].quantity, 3);
    assert.equal(option.assignments[1].role, "support");
  }
  assert.deepEqual(
    new Set(result.options.map((option) => option.assignments[1].time)),
    new Set(["08:30", "13:30"]),
  );
});

test("large fixed-primary booking fails cleanly when no support van is operationally available", () => {
  const data = schedulingData();
  data.vans = [data.vans[0]];
  data.staffProfiles = [data.staffProfiles[0]];
  const result = generateCanonicalOptions({
    request: exactTargetRequest(10),
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