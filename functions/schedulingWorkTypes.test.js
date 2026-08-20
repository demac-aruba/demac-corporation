const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SCHEDULING_WORK_TYPES,
  bookableSchedulingWorkTypes,
  canonicalSchedulingWorkTypeId,
  normalizeSchedulingWorkTypes,
  resolveSchedulingWorkType,
  settingsPayload,
} = require("./schedulingWorkTypes");

function modern(presets) {
  return [{ id: "appointment-work-presets", workTypesVersion: 2, presets }];
}

test("default Scheduling Work Types are the eight fast appointment choices", () => {
  assert.deepEqual(DEFAULT_SCHEDULING_WORK_TYPES.map((item) => item.id), [
    "standard_service",
    "deep_cleaning",
    "standard_installation",
    "installation_extended_labor",
    "check_up",
    "leak_repair",
    "commercial_service",
    "other",
  ]);
  assert.equal(DEFAULT_SCHEDULING_WORK_TYPES.find((item) => item.id === "commercial_service").durationMinutesPerUnit, 180);
  assert.equal(DEFAULT_SCHEDULING_WORK_TYPES.find((item) => item.id === "other").manualDuration, true);
});

test("old installation variants map to the single Extended Labor identity", () => {
  for (const id of [
    "special_installation",
    "extended_installation",
    "rooftop_installation",
    "second_floor_installation",
    "third_floor_installation",
  ]) {
    assert.equal(canonicalSchedulingWorkTypeId(id), "installation_extended_labor");
  }
});

test("Legacy V1 appointment presets do not leak old labels or narrow installation variants into the new picker", () => {
  const normalized = normalizeSchedulingWorkTypes([{
    id: "appointment-work-presets",
    presets: [
      { id: "standard_service", label: "Servicio estándar", durationMinutesPerUnit: 90, active: true },
      { id: "rooftop_installation", label: "Instalación rooftop", durationMinutesPerUnit: 180, active: true },
    ],
  }]);
  assert.deepEqual(normalized.map((item) => item.label), [
    "Standard Service",
    "Premium Deep Cleaning Service",
    "Standard Installation",
    "Installation Extended Labor",
    "Check Up",
    "Leak Repair",
    "Commercial Service",
    "Other",
  ]);
});

test("modern settings add missing built-ins while honoring configured values", () => {
  const normalized = normalizeSchedulingWorkTypes(modern([
    { id: "standard_service", label: "Quick Standard", durationMinutesPerUnit: 90, active: true, sortOrder: 20 },
    { id: "installation_extended_labor", label: "Extended", durationMinutesPerUnit: 195, active: true, sortOrder: 30 },
  ]));
  assert.equal(normalized.length, 8);
  assert.equal(normalized.find((item) => item.id === "standard_service").durationMinutesPerUnit, 90);
  assert.equal(normalized.find((item) => item.id === "installation_extended_labor").durationMinutesPerUnit, 210);
  assert.ok(normalized.find((item) => item.id === "commercial_service"));
  assert.ok(normalized.find((item) => item.id === "other"));
});

test("Scheduling durations normalize to whole or half-hour increments with a one-hour minimum", () => {
  const normalized = normalizeSchedulingWorkTypes(modern([
    { id: "standard_service", label: "Standard", durationMinutesPerUnit: 75, active: true, sortOrder: 10 },
    { id: "deep_cleaning", label: "Deep", durationMinutesPerUnit: 45, active: true, sortOrder: 20 },
    { id: "custom_quarter", label: "Custom", durationMinutesPerUnit: 105, active: true, sortOrder: 90 },
  ]));
  assert.equal(normalized.find((item) => item.id === "standard_service").durationMinutesPerUnit, 90);
  assert.equal(normalized.find((item) => item.id === "deep_cleaning").durationMinutesPerUnit, 60);
  assert.equal(normalized.find((item) => item.id === "custom_quarter").durationMinutesPerUnit, 120);
});

test("inactive modern work types stay resolvable for history but are hidden from the booking picker", () => {
  const settings = modern([
    { id: "deep_cleaning", label: "Deep", durationMinutesPerUnit: 120, active: false, sortOrder: 20 },
  ]);
  assert.equal(bookableSchedulingWorkTypes(settings).some((item) => item.id === "deep_cleaning"), false);
  assert.equal(resolveSchedulingWorkType(settings, "deep_cleaning").id, "deep_cleaning");
});

test("custom future Scheduling Work Types can be added without changing the commercial service catalog", () => {
  const result = bookableSchedulingWorkTypes(modern([
    { id: "duct_inspection", label: "Duct Inspection", durationMinutesPerUnit: 75, active: true, sortOrder: 90 },
  ]));
  assert.equal(result.find((item) => item.id === "duct_inspection").durationMinutesPerUnit, 90);
});

test("settings payload writes schema v2 and preserves Other as manual", () => {
  const payload = settingsPayload([
    { id: "other", label: "Special / Other", durationMinutesPerUnit: 60, active: true, sortOrder: 5 },
  ]);
  assert.equal(payload.id, "appointment-work-presets");
  assert.equal(payload.workTypesVersion, 2);
  assert.equal(payload.presets.find((item) => item.id === "other").manualDuration, true);
});