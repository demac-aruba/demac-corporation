const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SERVICE_CATALOG_SOURCE,
  bookableCatalogPresets,
  mergeBookablePresets,
  normalizeCatalogService,
  resolveCatalogService,
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

test("canonical service definition exposes identity and duration per execution only", () => {
  const result = normalizeCatalogService(canonicalStandardService);
  assert.equal(result.id, "standard_service");
  assert.equal(result.serviceId, "service-standard");
  assert.equal(result.durationMinutesPerUnit, 60);
  assert.equal(result.durationMode, "per_unit");
  assert.equal(result.allocation, undefined);
  assert.equal(result.quantityUnit, undefined);
  assert.equal(result.source, SERVICE_CATALOG_SOURCE);
});

test("legacy service-definition allocation and quantity metadata are ignored by the canonical runtime", () => {
  const result = normalizeCatalogService({
    ...canonicalStandardService,
    serviceDefinition: {
      ...canonicalStandardService.serviceDefinition,
      quantityUnit: "ac_unit",
      duration: { mode: "fixed", minutes: 90 },
      allocation: {
        mode: "primary_with_support",
        differentPropertyDailyMaxUnits: 3,
        primaryMaxUnits: 4,
        supportSelection: "operator",
      },
    },
  });
  assert.equal(result.durationMinutesPerUnit, 90);
  assert.equal(result.durationMode, "per_unit");
  assert.equal(result.allocation, undefined);
  assert.equal(result.quantityUnit, undefined);
});

test("products and services without canonical definitions do not masquerade as canonical services", () => {
  assert.equal(normalizeCatalogService({ ...canonicalStandardService, itemType: "Producto" }), null);
  const { serviceDefinition, ...legacy } = canonicalStandardService;
  assert.equal(normalizeCatalogService(legacy), null);
});

test("Show in Scheduling filters the quick picker without making the service unresolvable", () => {
  const hidden = { ...canonicalStandardService, id: "service-hidden", name: "12K BTU Standard Service", featured: false, serviceDefinition: { ...canonicalStandardService.serviceDefinition, bookingCode: "12k_standard" } };
  const visible = bookableCatalogPresets([canonicalStandardService, hidden]);
  assert.deepEqual(visible.map((item) => item.id), ["standard_service"]);
  assert.equal(resolveCatalogService([canonicalStandardService, hidden], { serviceId: "service-hidden" }).id, "12k_standard");
});

test("a hidden canonical service cannot leak back into Scheduling through legacy fallback", () => {
  const hidden = { ...canonicalStandardService, featured: false };
  const merged = mergeBookablePresets(
    [hidden],
    [{ id: "appointment-work-presets", presets: [{ id: "standard_service", label: "Standard Service", active: true }] }],
  );
  assert.deepEqual(merged, []);
});

test("canonical catalog shadows matching legacy appointment presets without duplicating them", () => {
  const merged = mergeBookablePresets(
    [canonicalStandardService, { id: "legacy-deep", itemType: "Servicio", name: "Deep Cleaning", active: true }],
    [{
      id: "appointment-work-presets",
      presets: [
        { id: "standard_service", label: "Standard Service", durationMinutesPerUnit: 45, active: true },
        { id: "deep_cleaning", label: "Deep Cleaning", durationMinutesPerUnit: 120, active: true },
      ],
    }],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === "standard_service").source, SERVICE_CATALOG_SOURCE);
  assert.equal(merged.find((item) => item.id === "standard_service").durationMinutesPerUnit, 60);
  assert.equal(merged.find((item) => item.id === "deep_cleaning").serviceId, "legacy-deep");
});

test("catalog lookup prefers explicit service id and also supports booking-code lookup", () => {
  const services = [canonicalStandardService];
  assert.equal(resolveCatalogService(services, { serviceId: "service-standard", presetId: "wrong" }).id, "standard_service");
  assert.equal(resolveCatalogService(services, { presetId: "standard_service" }).serviceId, "service-standard");
});

test("duplicate active canonical booking codes fail closed instead of silently selecting one service", () => {
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

test("canonical migration may shadow its own legacy preset but rejects a legacy collision owned by another service", () => {
  const safe = mergeBookablePresets(
    [canonicalStandardService],
    [{
      id: "appointment-work-presets",
      presets: [{ id: "standard_service", label: "Standard Service", serviceId: "service-standard", active: true }],
    }],
  );
  assert.equal(safe.length, 1);
  assert.equal(safe[0].source, SERVICE_CATALOG_SOURCE);

  assert.throws(
    () => mergeBookablePresets(
      [canonicalStandardService, { id: "service-other", itemType: "Servicio", name: "Other Service", active: true }],
      [{
        id: "appointment-work-presets",
        presets: [{ id: "standard_service", label: "Other Service", serviceId: "service-other", active: true }],
      }],
    ),
    /Duplicate active canonical service bookingCode "standard_service"/,
  );
});
