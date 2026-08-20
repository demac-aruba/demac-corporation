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
  serviceDefinition: {
    version: 1,
    bookingCode: "standard_service",
    quantityUnit: "ac_unit",
    duration: { mode: "per_unit", minutes: 60 },
    allocation: {
      mode: "primary_with_support",
      differentPropertyDailyMaxUnits: 6,
      primaryMaxUnits: 7,
      supportSelection: "operator",
    },
  },
};

test("canonical service definition is normalized from the services collection", () => {
  const result = normalizeCatalogService(canonicalStandardService);
  assert.equal(result.id, "standard_service");
  assert.equal(result.serviceId, "service-standard");
  assert.equal(result.durationMinutesPerUnit, 60);
  assert.equal(result.durationMode, "per_unit");
  assert.equal(result.allocation.mode, "primary_with_support");
  assert.equal(result.allocation.differentPropertyDailyMaxUnits, 6);
  assert.equal(result.allocation.primaryMaxUnits, 7);
  assert.equal(result.source, SERVICE_CATALOG_SOURCE);
});

test("products and services without canonical definitions do not masquerade as canonical services", () => {
  assert.equal(normalizeCatalogService({ ...canonicalStandardService, itemType: "Producto" }), null);
  const { serviceDefinition, ...legacy } = canonicalStandardService;
  assert.equal(normalizeCatalogService(legacy), null);
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

test("bookable canonical services are unique by booking code", () => {
  const duplicate = {
    ...canonicalStandardService,
    id: "service-standard-copy",
  };
  assert.equal(bookableCatalogPresets([canonicalStandardService, duplicate]).length, 1);
});
