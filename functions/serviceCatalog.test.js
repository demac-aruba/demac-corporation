const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SERVICE_CATALOG_SOURCE,
  bookableCatalogPresets,
  mergeBookablePresets,
  normalizeCatalogService,
  resolveCatalogService,
  serviceVisibleInScheduling,
} = require("./serviceCatalog");

const canonicalStandardService = {
  id: "service-standard",
  itemType: "Servicio",
  name: "Standard Service",
  category: "Maintenance",
  durationMinutes: 60,
  basePrice: 100,
  active: true,
  featured: true,
  serviceDefinition: {
    version: 1,
    bookingCode: "standard_service",
    duration: { minutes: 60 },
  },
};

function workTypeSettings(presets) {
  return [{ id: "appointment-work-presets", workTypesVersion: 2, presets }];
}

test("canonical service definition exposes commercial identity and duration per execution only", () => {
  const result = normalizeCatalogService(canonicalStandardService);
  assert.equal(result.id, "standard_service");
  assert.equal(result.serviceId, "service-standard");
  assert.equal(result.durationMinutesPerUnit, 60);
  assert.equal(result.durationMode, "per_unit");
  assert.equal(result.allocation, undefined);
  assert.equal(result.quantityUnit, undefined);
  assert.equal(result.source, SERVICE_CATALOG_SOURCE);
});

test("products and services without canonical definitions do not masquerade as canonical services", () => {
  assert.equal(normalizeCatalogService({ ...canonicalStandardService, itemType: "Producto" }), null);
  const { serviceDefinition, ...legacy } = canonicalStandardService;
  assert.equal(normalizeCatalogService(legacy), null);
});

test("legacy services are not implicitly opted into Scheduling", () => {
  assert.equal(serviceVisibleInScheduling(canonicalStandardService), true);
  assert.equal(serviceVisibleInScheduling({ ...canonicalStandardService, featured: false }), false);
  const { featured, ...withoutFlag } = canonicalStandardService;
  assert.equal(serviceVisibleInScheduling(withoutFlag), false);
});

test("bookable catalog helper requires explicit featured=true", () => {
  const hidden = {
    ...canonicalStandardService,
    id: "service-hidden",
    name: "12K BTU Split Unit Standard Service",
    featured: undefined,
    serviceDefinition: { ...canonicalStandardService.serviceDefinition, bookingCode: "12k_standard" },
  };
  const visible = bookableCatalogPresets([canonicalStandardService, hidden]);
  assert.deepEqual(visible.map((item) => item.id), ["standard_service"]);
});

test("appointment quick picker is Scheduling Work Types, never the detailed commercial service list", () => {
  const detailed = [
    canonicalStandardService,
    {
      ...canonicalStandardService,
      id: "service-12k",
      name: "12K BTU Split Unit Standard Service - First Floor",
      featured: true,
      serviceDefinition: { ...canonicalStandardService.serviceDefinition, bookingCode: "12k_standard" },
    },
    {
      ...canonicalStandardService,
      id: "service-24k",
      name: "24K BTU Split Unit Standard Service - First Floor",
      featured: true,
      serviceDefinition: { ...canonicalStandardService.serviceDefinition, bookingCode: "24k_standard" },
    },
  ];
  const merged = mergeBookablePresets(detailed, []);
  assert.deepEqual(merged.map((item) => item.id), [
    "standard_service",
    "deep_cleaning",
    "standard_installation",
    "installation_extended_labor",
    "check_up",
    "leak_repair",
    "commercial_service",
    "other",
  ]);
  assert.equal(merged.some((item) => /12k|24k/i.test(item.label)), false);
});

test("Scheduling Work Type settings control label, duration, active state and order", () => {
  const merged = mergeBookablePresets([], workTypeSettings([
    { id: "standard_service", label: "Quick Standard", durationMinutesPerUnit: 75, active: true, sortOrder: 30 },
    { id: "deep_cleaning", label: "Deep", durationMinutesPerUnit: 150, active: false, sortOrder: 20 },
    { id: "commercial_service", label: "Commercial", durationMinutesPerUnit: 210, active: true, sortOrder: 10 },
  ]));
  assert.equal(merged[0].id, "commercial_service");
  assert.equal(merged[0].durationMinutesPerUnit, 210);
  assert.equal(merged.find((item) => item.id === "standard_service").label, "Quick Standard");
  assert.equal(merged.some((item) => item.id === "deep_cleaning"), false);
});

test("legacy schema is replaced by the approved eight quick Work Types", () => {
  const merged = mergeBookablePresets([], [{
    id: "appointment-work-presets",
    presets: [
      { id: "rooftop_installation", label: "Rooftop", durationMinutesPerUnit: 180, active: true },
      { id: "second_floor_installation", label: "Second floor", durationMinutesPerUnit: 180, active: true },
    ],
  }]);
  assert.equal(merged.length, 8);
  assert.equal(merged.filter((item) => item.id === "installation_extended_labor").length, 1);
  assert.equal(merged.some((item) => /Rooftop|Second floor/.test(item.label)), false);
});

test("catalog lookup prefers an explicit commercial service id", () => {
  const result = resolveCatalogService(
    [canonicalStandardService],
    { serviceId: "service-standard", presetId: "standard_service" },
    workTypeSettings([{ id: "standard_service", label: "Quick Standard", durationMinutesPerUnit: 75, active: true }]),
  );
  assert.equal(result.source, SERVICE_CATALOG_SOURCE);
  assert.equal(result.serviceId, "service-standard");
  assert.equal(result.durationMinutesPerUnit, 60);
});

test("preset-only booking resolves the configured Scheduling Work Type instead of a commercial SKU", () => {
  const result = resolveCatalogService(
    [canonicalStandardService],
    { presetId: "standard_service" },
    workTypeSettings([{ id: "standard_service", label: "Quick Standard", durationMinutesPerUnit: 75, active: true }]),
  );
  assert.equal(result.source, "scheduling_work_types");
  assert.equal(result.label, "Quick Standard");
  assert.equal(result.durationMinutesPerUnit, 75);
  assert.equal(result.serviceId, "");
});

test("duplicate active canonical booking codes fail closed instead of silently selecting one commercial service", () => {
  const duplicate = {
    ...canonicalStandardService,
    id: "service-standard-copy",
    name: "Standard Service Copy",
  };
  assert.throws(
    () => bookableCatalogPresets([canonicalStandardService, duplicate]),
    /Duplicate active canonical service bookingCode "standard_service"/,
  );
  assert.throws(
    () => resolveCatalogService([canonicalStandardService, duplicate], { serviceId: "service-standard" }),
    /Duplicate active canonical service bookingCode "standard_service"/,
  );
});
