const { cleanText } = require("./bookingAuthorityCore");
const { normalizeText } = require("./bookingSchedulingPrimitives");
const {
  bookableSchedulingWorkTypes,
  resolveSchedulingWorkType,
} = require("./schedulingWorkTypes");

const SERVICE_DEFINITION_VERSION = 1;
const SERVICE_CATALOG_SOURCE = "service_catalog";
const LEGACY_PRESET_SOURCE = "appointment_work_presets";

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function serviceItem(service = {}) {
  const type = normalizeText(service.itemType || "servicio");
  return service.active !== false && type !== "producto" && type !== "product";
}

// Kept only for backwards compatibility with catalog callers. Scheduling no
// longer derives its Work & Allocation picker from commercial service records.
// A catalog service is considered explicitly featured only when the field is
// true; missing legacy fields must never opt an item into Scheduling by default.
function serviceVisibleInScheduling(service = {}) {
  return serviceItem(service) && service.featured === true;
}

function normalizeDuration(definition = {}, service = {}) {
  const raw = definition.duration || {};
  const fallback = Number(service.durationMinutes || 60);
  const minutes = boundedInteger(raw.minutes, Number.isFinite(fallback) && fallback > 0 ? fallback : 60, 30, 720);
  return { mode: "per_unit", minutes };
}

function normalizeCatalogService(service = {}) {
  if (!serviceItem(service)) return null;
  const definition = service.serviceDefinition;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;

  const bookingCode = cleanText(definition.bookingCode || service.bookingCode || service.id, 120);
  const label = cleanText(service.name || definition.label || bookingCode, 180);
  if (!bookingCode || !label) return null;

  const duration = normalizeDuration(definition, service);
  return {
    id: bookingCode,
    label,
    kind: cleanText(definition.kind || service.category || "service", 80),
    durationMinutesPerUnit: duration.minutes,
    durationMode: duration.mode,
    active: true,
    serviceId: cleanText(service.id, 120),
    source: SERVICE_CATALOG_SOURCE,
    serviceDefinitionVersion: boundedInteger(definition.version, SERVICE_DEFINITION_VERSION, 1, SERVICE_DEFINITION_VERSION),
  };
}

function duplicateBookingCodeError(bookingCode, firstServiceId, secondServiceId) {
  return new Error(
    `Duplicate active canonical service bookingCode "${bookingCode}" for services "${firstServiceId}" and "${secondServiceId}".`,
  );
}

function catalogServicePresets(services = []) {
  const presets = [];
  const codeOwners = new Map();
  const seenServices = new Set();
  for (const service of services) {
    const preset = normalizeCatalogService(service);
    if (!preset || seenServices.has(preset.serviceId)) continue;
    const existingOwner = codeOwners.get(preset.id);
    if (existingOwner && existingOwner !== preset.serviceId) {
      throw duplicateBookingCodeError(preset.id, existingOwner, preset.serviceId);
    }
    codeOwners.set(preset.id, preset.serviceId);
    seenServices.add(preset.serviceId);
    presets.push(preset);
  }
  return presets.sort((left, right) => left.label.localeCompare(right.label));
}

function bookableCatalogPresets(services = []) {
  const visibleServiceIds = new Set(
    services.filter((service) => serviceVisibleInScheduling(service)).map((service) => cleanText(service.id, 120)),
  );
  return catalogServicePresets(services).filter((preset) => visibleServiceIds.has(preset.serviceId));
}

function compactLegacyPreset(item = {}, services = []) {
  const id = cleanText(item.id, 120);
  if (!id || item.active === false) return null;
  const label = cleanText(item.label || id, 180);
  const matchingService = services.find((service) => {
    if (!serviceItem(service)) return false;
    if (cleanText(service.id, 120) === cleanText(item.serviceId, 120)) return true;
    return normalizeText(service.name) === normalizeText(label);
  });
  return {
    id,
    label,
    kind: cleanText(item.kind, 80),
    durationMinutesPerUnit: boundedInteger(item.durationMinutesPerUnit, 60, 30, 720),
    durationMode: item.perUnit === false ? "fixed" : "per_unit",
    active: true,
    serviceId: cleanText(matchingService?.id || item.serviceId, 120),
    source: LEGACY_PRESET_SOURCE,
    serviceDefinitionVersion: 0,
  };
}

function legacyPresetSettings(businessSettings = []) {
  const settings = businessSettings.find((item) => item.id === "appointment-work-presets");
  return Array.isArray(settings?.presets) ? settings.presets : [];
}

// Work & Allocation is an operational scheduling concept, not a commercial
// service picker. The commercial catalog can contain detailed BTU/SKU services;
// only Scheduling Work Types are returned to the appointment quick picker.
function mergeBookablePresets(_services = [], businessSettings = []) {
  return bookableSchedulingWorkTypes(businessSettings);
}

function resolveCatalogService(services = [], work = {}, businessSettings = []) {
  const canonical = catalogServicePresets(services);
  const serviceId = cleanText(work.serviceId, 120);
  if (serviceId) {
    const exact = canonical.find((preset) => preset.serviceId === serviceId);
    if (exact) return exact;
  }

  // When a booking carries only an operational Work Type, Scheduling owns its
  // duration and identity. This prevents a broad "Standard Service" tile from
  // accidentally resolving to a 12K/18K/24K commercial catalog item.
  const scheduling = resolveSchedulingWorkType(businessSettings, work);
  if (scheduling) return scheduling;

  const presetId = cleanText(work.presetId, 120);
  if (!presetId) return null;
  return canonical.find((preset) => preset.id === presetId) || null;
}

module.exports = {
  LEGACY_PRESET_SOURCE,
  SERVICE_CATALOG_SOURCE,
  SERVICE_DEFINITION_VERSION,
  bookableCatalogPresets,
  catalogServicePresets,
  compactLegacyPreset,
  legacyPresetSettings,
  mergeBookablePresets,
  normalizeCatalogService,
  resolveCatalogService,
  serviceItem,
  serviceVisibleInScheduling,
};
