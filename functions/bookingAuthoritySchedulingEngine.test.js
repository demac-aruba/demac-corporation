const test = require("node:test");
const assert = require("node:assert/strict");
const { BOOKING_ERROR_CODES } = require("./bookingAuthorityCore");
const {
  CANONICAL_SCHEDULING_ENGINE_VERSION,
  buildAllocationPlan,
  exactPreset,
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
    }],
  };
}

test("canonical scheduling engine has an explicit version", () => {
  assert.equal(CANONICAL_SCHEDULING_ENGINE_VERSION, 1);
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
