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

test("old installation variants migrate to the single Extended Labor category", () => {
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

test("normalization adds missing modern work types while honoring configured values", () => {
  const normalized = normalizeSchedulingWorkTypes([{
    id: "appointment-work-presets",
    presets: [
      { id: "standard_service", label: "Service", durationMinutesPerUnit: 90, active: true, sortOrder: 20 },
      { id: "special_installation", label: "Extended", durationMinutesPerUnit: 195, active: true, sortOrder: 30 },
    ],
  }]);
  assert.equal(normalized.length, 8);
  assert.equal(normalized.find((item) => item.id === "standard_service").durationMinutesPerUnit, 90);
  assert.equal(normalized.find((item) => item.id === "installation_extended_labor").durationMinutesPerUnit, 195);
  assert.ok(normalized.find((item) => item.id === "commercial_service"));
  assert.ok(normalized.find((item) => item.id === "other"));
});

test("inactive work types stay resolvable for history but are hidden from the booking picker", () => {
  const settings = [{
    id: "appointment-work-presets",
    presets: [{ id: "deep_cleaning", label: "Deep", durationMinutesPerUnit: 120, active: false, sortOrder: 20 }],
  }];
  assert.equal(bookableSchedulingWorkTypes(settings).some((item) => item.id === "deep_cleaning"), false);
  assert.equal(resolveSchedulingWorkType(settings, "deep_cleaning").id, "deep_cleaning");
});

test("custom future Scheduling Work Types can be added without changing the commercial service catalog", () => {
  const settings = [{
    id: "appointment-work-presets",
    presets: [{ id: "duct_inspection", label: "Duct Inspection", durationMinutesPerUnit: 75, active: true, sortOrder: 90 }],
  }];
  const result = bookableSchedulingWorkTypes(settings);
  assert.equal(result.find((item) => item.id === "duct_inspection").durationMinutesPerUnit, 75);
});

test("settings payload persists only scheduling fields and preserves Other as manual", () => {
  const payload = settingsPayload([
    { id: "other", label: "Special / Other", durationMinutesPerUnit: 60, active: true, sortOrder: 5 },
  ]);
  assert.equal(payload.id, "appointment-work-presets");
  assert.equal(payload.presets.find((item) => item.id === "other").manualDuration, true);
});
