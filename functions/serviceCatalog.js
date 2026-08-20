const { cleanText } = require("./bookingAuthorityCore");
const { normalizeText } = require("./bookingSchedulingPrimitives");

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

function normalizeDuration(definition = {}, service = {}) {
  const raw = definition.duration || {};
  const mode = cleanText(raw.mode, 40) === "fixed" ? "fixed" : "per_unit";
  const fallback = Number(service.durationMinutes || 60);
  const minutes = boundedInteger(raw.minutes, Number.isFinite(fallback) && fallback > 0 ? fallback : 60, 30, 720);
  return { mode, minutes };
}

function normalizeAllocation(definition = {}) {
  const raw = definition.allocation || {};
  const mode = cleanText(raw.mode, 60) === "primary_with_support"
    ? "primary_with_support"
    : "single_van";
  const differentPropertyDailyMaxUnits = boundedInteger(raw.differentPropertyDailyMaxUnits, 6, 1, 24);
  const primaryMaxUnits = boundedInteger(
    raw.primaryMaxUnits,
    mode === "primary_with_support" ? Math.max(1, differentPropertyDailyMaxUnits) : 1,
    1,
    48,
  );
  return {
    mode,
    differentPropertyDailyMaxUnits: Math.min(differentPropertyDailyMaxUnits, primaryMaxUnits),
    primaryMaxUnits,
    supportSelection: mode === "primary_with_support" ? "operator" : "none",
  };
}

function normalizeCatalogService(service = {}) {
  if (!serviceItem(service)) return null;
  const definition = service.serviceDefinition;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;

  const bookingCode = cleanText(definition.bookingCode || service.bookingCode || service.id, 120);
  const label = cleanText(service.name || definition.label || bookingCode, 180);
  if (!bookingCode || !label) return null;

  const duration = normalizeDuration(definition, service);
  const allocation = normalizeAllocation(definition);
  return {
    id: bookingCode,
    label,
    kind: cleanText(definition.kind || service.category || "service", 80),
    durationMinutesPerUnit: duration.minutes,
    durationMode: duration.mode,
    allocation,
    quantityUnit: cleanText(definition.quantityUnit || "ac_unit", 80) || "ac_unit",
    active: true,
    serviceId: cleanText(service.id, 120),
    source: SERVICE_CATALOG_SOURCE,
    serviceDefinitionVersion: boundedInteger(definition.version, SERVICE_DEFINITION_VERSION, 1, SERVICE_DEFINITION_VERSION),
  };
}

function bookableCatalogPresets(services = []) {
  const presets = [];
  const seenCodes = new Set();
  const seenServices = new Set();
  for (const service of services) {
    const preset = normalizeCatalogService(service);
    if (!preset || seenCodes.has(preset.id) || seenServices.has(preset.serviceId)) continue;
    seenCodes.add(preset.id);
    seenServices.add(preset.serviceId);
    presets.push(preset);
  }
  return presets.sort((left, right) => left.label.localeCompare(right.label));
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

function mergeBookablePresets(services = [], businessSettings = []) {
  const canonical = bookableCatalogPresets(services);
  const usedCodes = new Set(canonical.map((item) => item.id));
  const usedServices = new Set(canonical.map((item) => item.serviceId).filter(Boolean));
  const legacy = legacyPresetSettings(businessSettings)
    .map((item) => compactLegacyPreset(item, services))
    .filter(Boolean)
    .filter((item) => !usedCodes.has(item.id) && (!item.serviceId || !usedServices.has(item.serviceId)));
  return [...canonical, ...legacy];
}

function resolveCatalogService(services = [], work = {}) {
  const serviceId = cleanText(work.serviceId, 120);
  if (serviceId) {
    const exact = services.find((service) => cleanText(service.id, 120) === serviceId);
    const normalized = normalizeCatalogService(exact);
    if (normalized) return normalized;
  }
  const presetId = cleanText(work.presetId, 120);
  if (!presetId) return null;
  return bookableCatalogPresets(services).find((preset) => preset.id === presetId) || null;
}

module.exports = {
  LEGACY_PRESET_SOURCE,
  SERVICE_CATALOG_SOURCE,
  SERVICE_DEFINITION_VERSION,
  bookableCatalogPresets,
  compactLegacyPreset,
  mergeBookablePresets,
  normalizeAllocation,
  normalizeCatalogService,
  resolveCatalogService,
  serviceItem,
};
